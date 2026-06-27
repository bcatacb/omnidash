// v0.71.2 — Gemini 2.5 Flash universal hCaptcha solver.
//
// hCaptcha doesn't only serve 3x3 image grids. Common variants:
//   - GRID_3X3              "Click each image containing a cat" (9 tiles)
//   - GRID_CHAINED          Same as grid but 2-3 batches refresh in sequence
//   - SINGLE_BBOX           "Click on the bird in this picture" — one image
//   - DRAG_DROP             "Drag the piece to complete the puzzle"
//   - YES_NO                "Is this a car?" with two buttons
//   - ROTATE_OBJECT         "Click on the image where X is upside-down"
//   - ORDERED_CLICK         "Click the images in order: 1, 2, 3"
//
// We let Gemini classify AND produce the action list in one call. Returns
// NORMALIZED coords (0..1) relative to the screenshot's full extent — the
// caller multiplies by iframe bounding-box pixels to get screen coords.
//
// Why universal vs. variant-specific prompts: cost & latency. One round-trip
// per challenge with the right prompt template is faster than two (classify
// then solve). Gemini Flash is precise enough at this scale.

import { createHash } from "node:crypto";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const MODEL = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type CaptchaType =
  | "grid_3x3"
  | "single_bbox"
  | "drag_drop"
  | "yes_no"
  | "rotate_object"
  | "ordered_click"
  | "unknown";

export interface VisionAction {
  // "click_tile" uses tileIndex (0-8 row-major), reliable for grids.
  // "click" uses x/y in 0..1 normalized to the screenshot extent.
  // "drag" uses (x,y) start + end.
  // "click_button" uses buttonLabel (matched against on-screen text).
  type: "click_tile" | "click" | "drag" | "click_button" | "skip";
  tileIndex?: number;
  x?: number;
  y?: number;
  endX?: number;
  endY?: number;
  buttonLabel?: string;
  reason?: string; // for skip: why we couldn't solve
}

export interface VisionSolveResult {
  ok: boolean;
  captchaType?: CaptchaType;
  question?: string;
  actions?: VisionAction[];
  needsVerifyClick?: boolean; // most variants require pressing Verify after
  raw?: string;
  error?: string;
  costCents?: number;
}

export async function solveCaptcha(
  imagePngBase64: string,
  questionHint?: string,
): Promise<VisionSolveResult> {
  if (!GEMINI_API_KEY) return { ok: false, error: "GEMINI_API_KEY not configured" };
  if (!imagePngBase64) return { ok: false, error: "no image provided" };

  // The prompt below is intentionally long and structured. Gemini Flash
  // handles instruction-heavy prompts well and the structure massively
  // reduces parse errors compared to free-form output.
  const prompt = `You are analyzing a screenshot of an hCaptcha verification challenge. Identify what TYPE of challenge it is, then produce a list of actions a user would take to solve it.

CHALLENGE TYPES:
- grid_3x3: A 3x3 grid of 9 images with a question like "Click each image containing X". Numbering: top row 0,1,2 / middle 3,4,5 / bottom 6,7,8.
- single_bbox: A single large image with a question like "Click on the X". Answer is one click at the object's location.
- drag_drop: A puzzle where you drag a piece to fit somewhere. Answer is one drag from start to end.
- yes_no: A single image with two buttons (Yes/No, True/False, or similar).
- rotate_object: A grid where you must identify the rotated/odd-one-out image.
- ordered_click: Click multiple objects in a specified order.
- unknown: Anything you can't confidently classify.

COORDINATE SYSTEM:
All x,y values must be NORMALIZED to the screenshot bounds, where (0,0) is top-left and (1,1) is bottom-right. So x=0.5 means horizontally centered, y=0.7 means 70% down from the top.

${questionHint ? `Hint: the question may relate to "${questionHint}"\n\n` : ""}OUTPUT FORMAT (JSON only, no markdown, no extra text):
{
  "captchaType": "<one of the types above>",
  "question": "<the question text as you see it>",
  "actions": [
    // For grid_3x3, use tileIndex (0-8):
    {"type": "click_tile", "tileIndex": 3},
    // For single_bbox/ordered_click, use normalized x/y:
    {"type": "click", "x": 0.45, "y": 0.62},
    // For drag_drop:
    {"type": "drag", "x": 0.2, "y": 0.5, "endX": 0.6, "endY": 0.5},
    // For yes_no:
    {"type": "click_button", "buttonLabel": "Yes"},
    // If you genuinely cannot solve (e.g. asks for unfamiliar object you can't recognize):
    {"type": "skip", "reason": "<why>"}
  ],
  "needsVerifyClick": true
}

Set needsVerifyClick=true for grid_3x3, ordered_click, drag_drop. Set false for single_bbox and yes_no (those usually auto-submit).

If you're confident no tiles/objects match in a grid_3x3, return actions: [] (we'll click Verify with no selections, which sometimes counts as "none of the above").`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: "image/png", data: imagePngBase64 } },
        ],
      },
    ],
    generationConfig: {
      maxOutputTokens: 512,
      temperature: 0.0,
      responseMimeType: "application/json",
    },
  };

  let costCents = 0;
  try {
    const url = `${API_BASE}/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return { ok: false, error: `gemini HTTP ${r.status}: ${text.slice(0, 200)}` };
    }
    const j: any = await r.json();
    const inputTokens = Number(j?.usageMetadata?.promptTokenCount || 0);
    const outputTokens = Number(j?.usageMetadata?.candidatesTokenCount || 0);
    // gemini-2.5-flash: $0.075/M in, $0.30/M out — typical solve <$0.001
    const costMicroCents = inputTokens * 7.5 + outputTokens * 30;
    costCents = Math.max(0, Math.ceil(costMicroCents / 10_000));

    const candidates = Array.isArray(j?.candidates) ? j.candidates : [];
    const text = String(candidates[0]?.content?.parts?.[0]?.text || "").trim();
    if (!text) {
      const reason = candidates[0]?.finishReason || "EMPTY";
      return { ok: false, error: `gemini empty response (${reason})`, costCents };
    }
    const parsed = extractJson(text);
    if (!parsed) {
      return { ok: false, raw: text, error: "failed to parse JSON from model output", costCents };
    }
    const captchaType = (parsed.captchaType || "unknown") as CaptchaType;
    const actions: VisionAction[] = Array.isArray(parsed.actions) ? parsed.actions : [];
    const question = String(parsed.question || "").slice(0, 200);
    const needsVerifyClick = parsed.needsVerifyClick !== false; // default true
    return { ok: true, captchaType, question, actions, needsVerifyClick, raw: text, costCents };
  } catch (err: any) {
    return { ok: false, error: `gemini call threw: ${err?.message || err}` };
  }
}

// Back-compat shim for the original 3x3-only signature. browser-captcha-join.ts
// imports both — internal callers should migrate to solveCaptcha() above.
export async function solveCaptchaGrid(
  imagePngBase64: string,
  questionHint?: string,
): Promise<{ ok: boolean; tilesToClick?: number[]; raw?: string; error?: string; costCents?: number }> {
  const r = await solveCaptcha(imagePngBase64, questionHint);
  if (!r.ok) return { ok: false, error: r.error, raw: r.raw, costCents: r.costCents };
  const tiles = (r.actions || [])
    .filter((a) => a.type === "click_tile" && Number.isInteger(a.tileIndex))
    .map((a) => a.tileIndex!) as number[];
  return { ok: true, tilesToClick: tiles, raw: r.raw, costCents: r.costCents };
}

function extractJson(s: string): any | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth += 1;
    else if (s[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

export function hashImage(base64: string): string {
  return createHash("sha256").update(base64).digest("hex").slice(0, 16);
}
