"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useLoadingStore } from "@/lib/store/loading-store";

/**
 * Toggles the global loading overlay during client-side route transitions.
 * Next.js App Router doesn't expose explicit navigation start/end events,
 * so we detect a transition by watching for pathname/search param changes
 * and briefly showing the overlay while the new route's content mounts.
 */
export default function NavigationLoadingListener() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const startLoading = useLoadingStore((state) => state.startLoading);
  const stopLoading = useLoadingStore((state) => state.stopLoading);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    startLoading();
    const timer = window.setTimeout(() => {
      stopLoading();
    }, 400);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams?.toString()]);

  return null;
}
