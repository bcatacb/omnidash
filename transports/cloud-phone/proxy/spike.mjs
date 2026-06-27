// Read-only spike: confirm DuoPlus live auth + response shape.
// Run with:  node --env-file=proxy/.env proxy/spike.mjs
// Prints the real response structure. Never prints your API key.

const key = process.env.DUOPLUS_API_KEY;
const base = process.env.DUOPLUS_BASE_URL ?? "https://openapi.duoplus.net";

if (!key || key === "PASTE_YOUR_KEY_HERE") {
  console.error("✗ Put your real key in proxy/.env (DUOPLUS_API_KEY=...) first.");
  process.exit(1);
}

const url = `${base}/api/v1/cloudPhone/list`;
console.log(`POST ${url}  (key length: ${key.length}, not shown)`);

try {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "DuoPlus-API-Key": key,
      "Lang": "en",
    },
    body: JSON.stringify({ page: 1, pagesize: 5 }),
  });

  console.log(`HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { console.log("non-JSON body:\n", text.slice(0, 2000)); process.exit(0); }

  // Top-level shape
  console.log("top-level keys:", Object.keys(json));
  console.log("code:", json.code, "| message:", json.message);

  const data = json.data ?? {};
  console.log("data keys:", Object.keys(data));
  console.log("paging:", { page: data.page, pagesize: data.pagesize, total: data.total, total_page: data.total_page });

  const list = data.list ?? [];
  console.log(`list length: ${list.length}`);
  if (list[0]) {
    console.log("first phone keys:", Object.keys(list[0]));
    // Show the status field + a couple identifying fields across all returned phones
    console.log("status values seen:", list.map((p) => ({ id: p.id, name: p.name, status: p.status, adb: p.adb })));
    // Full first object so we can map every field precisely
    console.log("first phone (full):", JSON.stringify(list[0], null, 2));
  }
} catch (err) {
  console.error("✗ request failed:", err.message);
  process.exit(1);
}
