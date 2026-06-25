import { useEffect, useRef } from "react";

// Polls `refresh` every `intervalMs` and re-fires it when the browser tab
// regains focus after being hidden for more than `staleAfterMs`.
// Eliminates the "need hard refresh to see updates" problem on every page.
export function useAutoRefresh(
  refresh: () => void | Promise<void>,
  intervalMs = 60_000,
  staleAfterMs = 30_000,
) {
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    const t = setInterval(refresh, intervalMs);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
      } else if (hiddenAt.current !== null) {
        if (Date.now() - hiddenAt.current >= staleAfterMs) void refresh();
        hiddenAt.current = null;
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, intervalMs, staleAfterMs]);
}
