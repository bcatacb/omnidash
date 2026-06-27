// Singleton SSE connection — one EventSource shared across ALL pages.
// Stays alive across tab switches so each page gets events immediately
// without paying a fresh TCP+HTTP handshake on every navigation.

type Handler = (evt: MessageEvent) => void;

let es: EventSource | null = null;
let retryMs = 2_000;
const MAX_RETRY = 60_000;
const handlers = new Set<Handler>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function connect() {
  if (es) return;
  if (typeof EventSource === "undefined") return;
  try {
    es = new EventSource("/api/realtime");
    es.onopen = () => { retryMs = 2_000; };
    es.onmessage = (evt) => {
      handlers.forEach((h) => { try { h(evt); } catch { /* ignore bad handlers */ } });
    };
    es.onerror = () => {
      es?.close();
      es = null;
      if (retryTimer) return;
      const delay = retryMs + Math.random() * 1_000;
      retryTimer = setTimeout(() => { retryTimer = null; connect(); }, delay);
      retryMs = Math.min(retryMs * 2, MAX_RETRY);
    };
  } catch { /* SSE not available */ }
}

// Subscribe to all SSE events. Returns an unsubscribe fn.
// The connection is NOT closed when subscribers leave — it stays warm
// for the next page mount so there is zero reconnect delay on tab switch.
export function subscribeRealtime(handler: Handler): () => void {
  if (!es && !retryTimer) connect();
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}

// Force reconnect on tab focus (helps if browser throttled the connection)
if (typeof window !== "undefined") {
  const onVisible = () => {
    if (document.visibilityState === "visible") {
      if (es) {
        es.close();
        es = null;
      }
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      connect();
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  connect();
}
