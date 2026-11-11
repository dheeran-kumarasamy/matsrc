"use client";

import { useCallback, useEffect, useRef } from "react";

export type UsePollingOptions = {
  /** Polling interval in milliseconds. Defaults to 30,000 ms. */
  intervalMs?: number;
  /** Whether polling is active. Defaults to true. */
  enabled?: boolean;
};

export type UsePollingResult = {
  /**
   * Manually triggers a refresh. Subject to visibility and in-flight guards,
   * meaning concurrent manual or scheduled triggers will not dispatch
   * duplicate requests, and no new requests start while hidden.
   */
  refresh: () => Promise<void>;
};

export function isDocumentVisible(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.visibilityState !== "hidden";
}

/**
 * Controller class encapsulating all visibility, interval, in-flight,
 * and lifecycle logic. Can be used directly or through the `usePolling` React hook.
 */
export class PollingController {
  private fetcher: () => Promise<unknown> | unknown;
  private intervalMs: number;
  private enabled: boolean;
  private isMounted: boolean = false;
  private inFlight: boolean = false;
  private inFlightPromise: Promise<void> | null = null;
  private lastSuccessTime: number = 0;
  private pendingRefresh: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private boundVisibilityHandler: (() => void) | null = null;

  constructor(
    fetcher: () => Promise<unknown> | unknown,
    intervalMs: number = 30_000,
    enabled: boolean = true
  ) {
    this.fetcher = fetcher;
    this.intervalMs = intervalMs;
    this.enabled = enabled;
  }

  public updateFetcher(fetcher: () => Promise<unknown> | unknown): void {
    this.fetcher = fetcher;
  }

  public updateOptions(intervalMs: number, enabled: boolean): void {
    const prevEnabled = this.enabled;
    const prevInterval = this.intervalMs;
    this.intervalMs = intervalMs;
    this.enabled = enabled;

    if (this.isMounted) {
      if (!enabled && prevEnabled) {
        this.stopTimer();
      } else if (enabled) {
        if (this.isVisible() && this.pendingRefresh) {
          this.pendingRefresh = false;
          void this.executeFetch();
        }
        if (!prevEnabled || prevInterval !== intervalMs) {
          if (this.isVisible()) {
            this.startTimer();
          }
        }
      }
    }
  }

  public isVisible(): boolean {
    return isDocumentVisible();
  }

  public getIsMounted(): boolean {
    return this.isMounted;
  }

  public getIsInFlight(): boolean {
    return this.inFlight;
  }

  public getLastSuccessTime(): number {
    return this.lastSuccessTime;
  }

  public executeFetch(): Promise<void> {
    if (!this.isMounted || !this.enabled) {
      return Promise.resolve();
    }

    // If an existing request is already in-flight, join and return its promise.
    if (this.inFlight && this.inFlightPromise !== null) {
      return this.inFlightPromise;
    }

    // Disallow initiating new requests when document is hidden.
    // Preserve the requested refresh so it executes immediately when visibility returns.
    if (!this.isVisible()) {
      this.pendingRefresh = true;
      return Promise.resolve();
    }

    this.inFlight = true;
    this.pendingRefresh = false;

    // Race-safe in-flight assignment: create the promise and assign this.inFlightPromise
    // BEFORE invoking this.fetcher(). A synchronous or reentrant refresh will see
    // this.inFlight === true and this.inFlightPromise !== null, safely sharing the promise.
    const fetcherAtStart = this.fetcher;
    let runFetcher: () => Promise<void>;
    const promise = new Promise<void>((resolve) => {
      runFetcher = async () => {
        try {
          await fetcherAtStart();
          // If the controller is currently mounted, enabled, and the fetcher callback
          // has not changed (even if an unmount/remount cycle occurred while the request
          // was in flight), adopt the successful result and record lastSuccessTime.
          if (this.isMounted && this.enabled && this.fetcher === fetcherAtStart) {
            this.lastSuccessTime = Date.now();
          }
        } catch {
          // Do not update lastSuccessTime on failure so future visibility or scheduled
          // ticks can retry. Do not auto-loop on error.
        } finally {
          this.inFlight = false;
          this.inFlightPromise = null;
          resolve();

          // If the controller is mounted, but the fetcher callback changed while
          // the request was in flight, the old request could not be safely adopted.
          // If disabled or hidden, record a pending refresh to execute when enabled and visible.
          // If enabled and visible, trigger a single fresh refresh immediately.
          if (this.isMounted && this.fetcher !== fetcherAtStart) {
            if (!this.enabled || !this.isVisible()) {
              this.pendingRefresh = true;
            } else {
              this.pendingRefresh = false;
              void this.executeFetch();
            }
          }
        }
      };
    });

    this.inFlightPromise = promise;
    void runFetcher!();
    return promise;
  }

  public refresh(): Promise<void> {
    return this.executeFetch();
  }

  public startTimer(): void {
    this.stopTimer();
    if (!this.enabled || !this.isMounted) {
      return;
    }
    this.intervalId = setInterval(() => {
      if (!this.isVisible() || this.inFlight) {
        return;
      }
      void this.executeFetch();
    }, this.intervalMs);
  }

  public stopTimer(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  public handleVisibilityChange(): void {
    if (!this.isMounted || !this.enabled) {
      return;
    }

    if (this.isVisible()) {
      const now = Date.now();
      const timeSinceLastSuccess = now - this.lastSuccessTime;
      const isStale =
        this.pendingRefresh ||
        this.lastSuccessTime === 0 ||
        timeSinceLastSuccess >= this.intervalMs;

      this.pendingRefresh = false;

      if (isStale) {
        void this.executeFetch();
      }
      this.startTimer();
    } else {
      this.stopTimer();
    }
  }

  public mount(): void {
    if (this.isMounted) {
      return;
    }
    this.isMounted = true;

    if (!this.enabled) {
      this.stopTimer();
      return;
    }

    this.boundVisibilityHandler = () => this.handleVisibilityChange();

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.boundVisibilityHandler);
    }

    if (this.isVisible()) {
      const now = Date.now();
      const isStale =
        this.pendingRefresh ||
        this.lastSuccessTime === 0 ||
        now - this.lastSuccessTime >= this.intervalMs;
      this.pendingRefresh = false;
      if (isStale) {
        void this.executeFetch();
      }
      this.startTimer();
    }
  }

  public unmount(): void {
    if (!this.isMounted) {
      return;
    }
    this.isMounted = false;
    this.stopTimer();
    if (typeof document !== "undefined" && this.boundVisibilityHandler !== null) {
      document.removeEventListener("visibilitychange", this.boundVisibilityHandler);
      this.boundVisibilityHandler = null;
    }
  }
}

/**
 * Reusable, visibility-aware polling hook with in-flight request protection.
 *
 * Behavior:
 * 1. Initial fetch: executes on mount if enabled and document is visible.
 * 2. Visible polling: runs every intervalMs while document is visible, guarding against overlaps.
 * 3. Hidden tab: suspends polling timers while document is hidden; dispatches no background requests.
 * 4. Visibility return: immediately refreshes if >= intervalMs elapsed since last successful fetch,
 *    then resumes regular interval schedule.
 * 5. Lifecycle & unmount: safely cleans up timers, visibility event listeners, and prevents
 *    late responses from updating unmounted state.
 */
export function usePolling(
  fetcher: () => Promise<unknown> | unknown,
  intervalOrOptions: number | UsePollingOptions = 30_000,
  legacyEnabled = true
): UsePollingResult {
  const intervalMs =
    typeof intervalOrOptions === "number"
      ? intervalOrOptions
      : (intervalOrOptions.intervalMs ?? 30_000);
  const enabled =
    typeof intervalOrOptions === "object"
      ? (intervalOrOptions.enabled ?? true)
      : legacyEnabled;

  const controllerRef = useRef<PollingController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new PollingController(fetcher, intervalMs, enabled);
  }

  // Update fetcher callback in an effect so changing fetcher identity never causes
  // render side effects or unnecessary effect restarts.
  useEffect(() => {
    controllerRef.current?.updateFetcher(fetcher);
  });

  // Apply options and handle lifecycle strictly in an effect (never during render).
  useEffect(() => {
    const controller = controllerRef.current!;
    controller.updateOptions(intervalMs, enabled);
    controller.mount();
    return () => {
      controller.unmount();
    };
  }, [enabled, intervalMs]);

  const refresh = useCallback(() => {
    return controllerRef.current?.refresh() ?? Promise.resolve();
  }, []);

  return { refresh };
}
