"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({
  intervalMs = 5000,
  enabled = true,
}: {
  intervalMs?: number;
  enabled?: boolean;
}) {
  const router = useRouter();
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      try {
        router.refresh();
      } finally {
        setTimeout(() => {
          inFlightRef.current = false;
        }, 1000);
      }
    }, intervalMs);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && !inFlightRef.current) {
        inFlightRef.current = true;
        try {
          router.refresh();
        } finally {
          setTimeout(() => {
            inFlightRef.current = false;
          }, 1000);
        }
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [router, intervalMs, enabled]);

  return null;
}
