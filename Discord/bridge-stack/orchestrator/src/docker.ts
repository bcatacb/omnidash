import Docker from "dockerode";
import path from "node:path";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

const BRIDGE_IMAGE = process.env.ORCH_BRIDGE_IMAGE ?? "dock.mau.dev/mautrix/discord:latest";
const BRIDGE_NETWORK = process.env.ORCH_BRIDGE_NETWORK ?? "bridgenet";

export interface SpawnArgs {
  account_id: string;
  configPath: string;        // host path to config.yaml
  registrationPath: string;  // host path to registration.yaml
}

export interface SpawnResult {
  container_id: string;
  container_name: string;
}

/**
 * Spawn a mautrix-discord container for the given account. The container
 * mounts the per-account config and registration files from the shared
 * `bridgecfg` volume.
 *
 * NOTE: configPath/registrationPath are paths INSIDE the orchestrator
 * container (which has /etc/hungry mounted from the bridgecfg volume).
 * The bridge container mounts the same volume at the same path so the
 * paths are identical on both sides.
 */
export async function spawnBridge(args: SpawnArgs): Promise<SpawnResult> {
  const name = `bridge-${args.account_id}`;
  // Pull image best-effort. If already present this is fast.
  try {
    await new Promise<void>((resolve, reject) => {
      docker.pull(BRIDGE_IMAGE, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (e) => (e ? reject(e) : resolve()));
      });
    });
  } catch (e) {
    // Non-fatal: image may already be local. The createContainer call will
    // produce the real error if it's actually missing.
  }

  const cfgDir = path.dirname(args.configPath); // /etc/hungry/accounts/<id>
  const container = await docker.createContainer({
    name,
    Image: BRIDGE_IMAGE,
    Env: [
      `MAUTRIX_DISCORD_CONFIG=${args.configPath}`,
      `MAUTRIX_DISCORD_REGISTRATION=${args.registrationPath}`,
    ],
    Labels: {
      "bridgestack.role": "mautrix-discord",
      "bridgestack.account_id": args.account_id,
    },
    HostConfig: {
      NetworkMode: BRIDGE_NETWORK,
      RestartPolicy: { Name: "unless-stopped" },
      Binds: [`bridgecfg:/etc/hungry`],
    },
    Cmd: ["/usr/bin/mautrix-discord", "-c", args.configPath, "-r", args.registrationPath, "--no-update"],
  });
  await container.start();
  // Re-inspect to get the container ID confirmed running.
  const inspect = await container.inspect();
  return { container_id: inspect.Id, container_name: name };
}

export async function bridgeStatus(container_id: string): Promise<{ running: boolean; state: string } | null> {
  try {
    const c = docker.getContainer(container_id);
    const i = await c.inspect();
    return { running: i.State.Running, state: i.State.Status };
  } catch {
    return null;
  }
}

export async function execLoginToken(container_id: string, kind: "user" | "bot", token: string): Promise<{ exitCode: number; output: string }> {
  // mautrix-discord bridges expose login via the management room only.
  // The clean path for a SaaS is to drive the bridge bot from our shim or
  // from a backend Matrix client. As a stop-gap we use the bridge's
  // `--login-token` style flags if present, otherwise we exec a helper
  // script we drop into the container.
  //
  // For now we just pipe the token to the bridge's stdin via a wrapped
  // exec command — TODO replace with provisioning HTTP API once we wire
  // it through hungryshim. See research doc section 6.
  const c = docker.getContainer(container_id);
  const exec = await c.exec({
    Cmd: ["sh", "-c", `printf '%s' "${token.replace(/"/g, "\\\"")}" | /usr/bin/mautrix-discord login-token ${kind} -`],
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve) => {
    stream.on("data", (d: Buffer) => chunks.push(d));
    stream.on("end", () => resolve());
    stream.on("close", () => resolve());
  });
  const inspect = await exec.inspect();
  return { exitCode: inspect.ExitCode ?? -1, output: Buffer.concat(chunks).toString("utf8") };
}

export async function stopAndRemove(container_id: string): Promise<void> {
  try {
    const c = docker.getContainer(container_id);
    try { await c.stop({ t: 10 }); } catch { /* may already be stopped */ }
    try { await c.remove({ force: true }); } catch { /* may already be gone */ }
  } catch {
    /* container gone */
  }
}
