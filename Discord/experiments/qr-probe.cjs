const WebSocket = require("ws");
const { generateKeyPairSync, privateDecrypt, constants, createHash } = require("node:crypto");

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const encodedPublicKey = publicKey.export({ type: "spki", format: "der" }).toString("base64");

const ws = new WebSocket("wss://remote-auth-gateway.discord.gg/?v=2", {
  origin: "https://discord.com",
  headers: {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  },
});

const decrypt = (b64) => privateDecrypt(
  { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
  Buffer.from(b64, "base64")
);
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let hb = null;
ws.on("open", () => console.error("[probe] ws open"));
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  console.error(`[probe] ← op=${msg.op}`);
  switch (msg.op) {
    case "hello":
      hb = setInterval(() => ws.send(JSON.stringify({ op: "heartbeat" })), msg.heartbeat_interval);
      ws.send(JSON.stringify({ op: "init", encoded_public_key: encodedPublicKey }));
      break;
    case "nonce_proof": {
      const proof = b64url(createHash("sha256").update(decrypt(msg.encrypted_nonce)).digest());
      ws.send(JSON.stringify({ op: "nonce_proof", proof }));
      break;
    }
    case "pending_remote_init":
      console.log("\n=== SUCCESS ===");
      console.log("fingerprint:", msg.fingerprint);
      console.log("QR URL:", `https://discord.com/ra/${msg.fingerprint}`);
      clearInterval(hb);
      ws.close();
      break;
    default:
      console.error("[probe] op:", msg.op, JSON.stringify(msg).slice(0, 200));
  }
});
ws.on("error", (e) => console.error("[probe] ERROR:", e.message));
ws.on("close", (code, reason) => { console.error(`[probe] closed code=${code} reason=${reason?.toString() || ''}`); process.exit(0); });
setTimeout(() => { console.error("[probe] timeout"); process.exit(1); }, 15000);
