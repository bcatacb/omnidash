// v0.70 — spintax template expander.
//
// Standard format: `{a|b|c}` picks one of a/b/c. Nesting OK: `{Hey {there|friend}|Yo}`.
// Pick is DETERMINISTIC given (template, seed) so we can replay exactly what a
// given (account, lead) pair received. The audit log stores the seed, so a row
// like {seed:"acct_X::lead_Y", template:"{Hey|Yo} {there|friend}"} reproduces
// the same output forever.
//
// Why deterministic: lets us answer "what did vivocious_moose actually send to
// AlIa..." three weeks later by reading warmup_actions.payload OR by re-running
// expand(template, action.spintax_seed). Catches bugs without storing the full
// rendered text twice.

import { createHash } from "node:crypto";

export function expand(template: string, seed: string): string {
  if (!template) return "";
  let out = "";
  let i = 0;
  let pickCounter = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch === "{") {
      const close = matchClose(template, i);
      if (close < 0) {
        // Unbalanced — treat as literal and stop trying to expand from here.
        out += template.slice(i);
        break;
      }
      const inner = template.slice(i + 1, close);
      const options = splitTopLevel(inner);
      const picked = pickOption(options, seed, pickCounter);
      out += expand(picked, `${seed}:${pickCounter}`);
      pickCounter += 1;
      i = close + 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

// Find matching `}` for the `{` at position `open`. Returns -1 if unbalanced.
function matchClose(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth += 1;
    else if (s[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Split on top-level `|` (ignoring | inside nested braces).
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === "|" && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

// Deterministic pick from `options` using sha256(seed + counter) % options.length.
// Counter so multiple expansions inside the same template don't all pick the
// same index when they happen to have similar surrounding text.
function pickOption(options: string[], seed: string, counter: number): string {
  if (options.length === 1) return options[0]!;
  const hash = createHash("sha256").update(`${seed}::${counter}`).digest();
  // First 4 bytes as uint32 — plenty of entropy, easy to mod.
  const n = hash.readUInt32BE(0);
  return options[n % options.length]!;
}

// Quick way to produce a stable seed for "this (account, target, day)" tuple.
// Date-stamped so the same lead doesn't always get variant N — they get a
// fresh roll every day, but still deterministic within the day.
export function dailySeed(parts: string[]): string {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return [day, ...parts].join("::");
}
