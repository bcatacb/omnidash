import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const TEMPLATE_DIR = process.env.ORCH_TEMPLATE_DIR ?? "/app/templates";
const CFG_DIR = process.env.ORCH_BRIDGE_CFG_DIR ?? "/etc/hungry";

export interface ConfigVars {
  TENANT_ID: string;
  ACCOUNT_ID: string;
  AS_TOKEN: string;
  HS_TOKEN: string;
  HOMESERVER_URL: string;
  HOMESERVER_DOMAIN: string;
  POSTGRES_DSN: string;
  APPSERVICE_PORT: string;
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

function loadTemplate(name: string): string {
  // Try the canonical install location first, then a dev-mode fallback so
  // `npm run dev` works straight from the repo without docker.
  const candidates = [
    path.join(TEMPLATE_DIR, name),
    path.join(__dirname, "..", "..", "templates", name),
    path.join(process.cwd(), "templates", name),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf8");
    }
  }
  throw new Error(`template not found: ${name} (looked in ${candidates.join(", ")})`);
}

function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    if (v === undefined) throw new Error(`template variable not provided: ${key}`);
    return v;
  });
}

export function writeBridgeConfig(vars: ConfigVars): {
  configPath: string;
  registrationPath: string;
} {
  const dir = path.join(CFG_DIR, "accounts", vars.ACCOUNT_ID);
  fs.mkdirSync(dir, { recursive: true });

  const cfg = render(loadTemplate("mautrix-discord-config.yaml"), vars as unknown as Record<string, string>);
  const reg = render(loadTemplate("registration.yaml"), vars as unknown as Record<string, string>);

  const configPath = path.join(dir, "config.yaml");
  const registrationPath = path.join(dir, "registration.yaml");
  fs.writeFileSync(configPath, cfg, { mode: 0o600 });
  fs.writeFileSync(registrationPath, reg, { mode: 0o600 });
  return { configPath, registrationPath };
}

export function writeTokenIndex(allTokens: Array<{ account_id: string; as_token: string; hs_token: string }>): void {
  const file = path.join(CFG_DIR, "tokens.json");
  fs.mkdirSync(CFG_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ tokens: allTokens }, null, 2), { mode: 0o600 });
}

export function deleteBridgeConfig(account_id: string): void {
  const dir = path.join(CFG_DIR, "accounts", account_id);
  fs.rmSync(dir, { recursive: true, force: true });
}
