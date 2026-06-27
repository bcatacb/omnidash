import { useEffect, useRef } from "react";

// Polls `refresh` every `intervalMs`.
// On tab becoming visible (browser tab switch / focus), always triggers a
// refresh so you never need a hard refresh to see fresh data after switching tabs.
export function useAutoRefresh(
  refresh: () => void | Promise<void>,
  intervalMs = 60_000,
) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    const tick = () => { void refreshRef.current(); };
    const t = setInterval(tick, intervalMs);

    const onFocusOrVisible = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };

    const onWindowFocus = () => tick();

    document.addEventListener("visibilitychange", onFocusOrVisible);
    window.addEventListener("focus", onWindowFocus);

    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, [intervalMs]);

  // Always fetch fresh on initial mount
  useEffect(() => {
    void refreshRef.current();
  }, []);
}
