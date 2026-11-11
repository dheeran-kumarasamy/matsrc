import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import React from "react";
import {
  PollingController,
  isDocumentVisible,
  usePolling,
} from "./use-polling";

describe("Visibility-Aware Shared Layout Polling and Overlap Prevention", () => {
  let visibilityListeners: Set<() => void>;
  let currentVisibilityState: "visible" | "hidden";

  async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  function setDocumentVisibility(state: "visible" | "hidden") {
    currentVisibilityState = state;
  }

  function dispatchVisibilityChange(state: "visible" | "hidden") {
    setDocumentVisibility(state);
    for (const listener of Array.from(visibilityListeners)) {
      listener();
    }
  }

  /**
   * Lightweight simulated hook harness for testing hook effect queuing and cleanups
   * in the project's 'node' vitest environment (which does not include jsdom or
   * @testing-library/react). Used for unit-level effect lifecycle verification.
   * Note: This simulates effect registration, execution, and cleanup semantics;
   * it does not claim to execute full React DOM reconciliation.
   */
  function renderHook<P, R>(hookFn: (props: P) => R, initialProps: P) {
    let props = initialProps;
    let result: { current: R } = { current: undefined as any };

    const refStore: any[] = [];
    const effectCleanups = new Map<number, (() => void) | void>();
    const effectDeps = new Map<number, any[] | undefined>();
    const pendingEffects: Array<{ index: number; fn: () => (() => void) | void }> = [];

    let refIdx = 0;
    let effectIdx = 0;
    let callbackIdx = 0;
    const callbackStore: Array<{ fn: any; deps: any[] | undefined }> = [];

    const dispatcher = {
      useRef: (initialValue: any) => {
        const idx = refIdx++;
        if (idx >= refStore.length) {
          refStore.push({ current: initialValue });
        }
        return refStore[idx];
      },
      useEffect: (fn: () => (() => void) | void, deps?: any[]) => {
        const idx = effectIdx++;
        const prevDeps = effectDeps.get(idx);
        const shouldRun =
          prevDeps === undefined ||
          deps === undefined ||
          deps.length !== prevDeps.length ||
          deps.some((d, i) => !Object.is(d, prevDeps[i]));

        if (shouldRun) {
          effectDeps.set(idx, deps ? [...deps] : undefined);
          pendingEffects.push({ index: idx, fn });
        }
      },
      useCallback: (fn: any, deps?: any[]) => {
        const idx = callbackIdx++;
        if (idx >= callbackStore.length) {
          callbackStore.push({ fn, deps });
          return fn;
        }
        const prev = callbackStore[idx];
        const shouldUpdate =
          prev.deps === undefined ||
          deps === undefined ||
          deps.length !== prev.deps.length ||
          deps.some((d, i) => !Object.is(d, prev.deps![i]));
        if (shouldUpdate) {
          callbackStore[idx] = { fn, deps };
          return fn;
        }
        return prev.fn;
      },
    };

    function flushPendingEffects() {
      const toRun = [...pendingEffects];
      pendingEffects.length = 0;
      for (const { index, fn } of toRun) {
        const prevCleanup = effectCleanups.get(index);
        if (typeof prevCleanup === "function") {
          prevCleanup();
        }
        const cleanup = fn();
        effectCleanups.set(index, cleanup);
      }
    }

    function render(newProps?: P, onRenderPhase?: () => void) {
      if (newProps !== undefined) {
        props = newProps;
      }
      refIdx = 0;
      effectIdx = 0;
      callbackIdx = 0;

      const prevDispatcher = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
        ?.ReactCurrentDispatcher?.current;
      try {
        (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current =
          dispatcher;
        result.current = hookFn(props);
        if (onRenderPhase) {
          onRenderPhase();
        }
      } finally {
        (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current =
          prevDispatcher;
      }

      flushPendingEffects();
      return result.current;
    }

    function unmount() {
      for (const [, cleanup] of effectCleanups) {
        if (typeof cleanup === "function") {
          cleanup();
        }
      }
      effectCleanups.clear();
    }

    function simulateStrictMode() {
      // 1. Run cleanups (simulate unmount)
      for (const [, cleanup] of effectCleanups) {
        if (typeof cleanup === "function") {
          cleanup();
        }
      }
      effectCleanups.clear();
      effectDeps.clear();

      // 2. Re-render and remount on the same component instance (preserving useRef)
      refIdx = 0;
      effectIdx = 0;
      callbackIdx = 0;

      const prevDispatcher = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
        ?.ReactCurrentDispatcher?.current;
      try {
        (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current =
          dispatcher;
        result.current = hookFn(props);
      } finally {
        (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current =
          prevDispatcher;
      }

      flushPendingEffects();
    }

    // Initial render
    render();

    return {
      get result() {
        return result;
      },
      rerender: (newProps?: P, onRenderPhase?: () => void) => render(newProps, onRenderPhase),
      simulateStrictMode,
      unmount,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    visibilityListeners = new Set();
    currentVisibilityState = "visible";

    (globalThis as any).document = {
      get visibilityState() {
        return currentVisibilityState;
      },
      addEventListener: vi.fn((event: string, cb: () => void) => {
        if (event === "visibilitychange") {
          visibilityListeners.add(cb);
        }
      }),
      removeEventListener: vi.fn((event: string, cb: () => void) => {
        if (event === "visibilitychange") {
          visibilityListeners.delete(cb);
        }
      }),
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (globalThis as any).document;
  });

  // =========================================================================
  // 1. Visibility Behavior (Requirements 1 - 9)
  // =========================================================================
  describe("Visibility Behavior", () => {
    it("1. Initial fetch occurs when enabled and visible", async () => {
      setDocumentVisibility("visible");
      const fetcher = vi.fn().mockResolvedValue({ ok: true });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      await flushMicrotasks();

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(controller.getLastSuccessTime()).toBeGreaterThan(0);
      controller.unmount();
    });

    it("2. No initial request occurs while hidden", async () => {
      setDocumentVisibility("hidden");
      const fetcher = vi.fn().mockResolvedValue({ ok: true });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      await flushMicrotasks();

      expect(fetcher).not.toHaveBeenCalled();
      expect(controller.getLastSuccessTime()).toBe(0);
      controller.unmount();
    });

    it("3. Polling occurs at the existing 30-second interval while visible", async () => {
      setDocumentVisibility("visible");
      const fetcher = vi.fn().mockResolvedValue({ ok: true });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Advance by 30 seconds
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher).toHaveBeenCalledTimes(2);

      // Advance another 30 seconds
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher).toHaveBeenCalledTimes(3);

      controller.unmount();
    });

    it("4. Polling stops when visibility changes to hidden", async () => {
      setDocumentVisibility("visible");
      const fetcher = vi.fn().mockResolvedValue({ ok: true });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Tab becomes hidden
      dispatchVisibilityChange("hidden");

      // Advance 90 seconds while hidden
      await vi.advanceTimersByTimeAsync(90_000);

      // No additional fetches dispatched while hidden
      expect(fetcher).toHaveBeenCalledTimes(1);
      controller.unmount();
    });

    it("5. Polling resumes when visibility changes to visible", async () => {
      setDocumentVisibility("visible");
      const fetcher = vi.fn().mockResolvedValue({ ok: true });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Tab hidden
      dispatchVisibilityChange("hidden");
      await vi.advanceTimersByTimeAsync(10_000);

      // Tab returns to visible within 10s (not stale, so immediate fetch skipped)
      dispatchVisibilityChange("visible");
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Scheduled polling resumes after 30s
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher).toHaveBeenCalledTimes(2);

      controller.unmount();
    });

    it("6. Returning to visible triggers an immediate refresh if at least 30 seconds have elapsed since last successful fetch", async () => {
      setDocumentVisibility("visible");
      const fetcher = vi.fn().mockResolvedValue({ ok: true });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Tab becomes hidden after 5s
      await vi.advanceTimersByTimeAsync(5_000);
      dispatchVisibilityChange("hidden");

      // Hidden for 40 seconds (total elapsed = 45s >= 30s)
      await vi.advanceTimersByTimeAsync(40_000);

      // Tab becomes visible again
      dispatchVisibilityChange("visible");
      await flushMicrotasks();

      // Immediate refresh triggered!
      expect(fetcher).toHaveBeenCalledTimes(2);

      // Regular polling continues 30s later
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher).toHaveBeenCalledTimes(3);

      controller.unmount();
    });

    it("7. Returning to visible does not trigger an immediate refresh if less than 30 seconds have elapsed", async () => {
      setDocumentVisibility("visible");
      const fetcher = vi.fn().mockResolvedValue({ ok: true });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Tab becomes hidden after 5s
      await vi.advanceTimersByTimeAsync(5_000);
      dispatchVisibilityChange("hidden");

      // Hidden for only 10s (total elapsed since fetch = 15s < 30s)
      await vi.advanceTimersByTimeAsync(10_000);

      // Tab returns to visible
      dispatchVisibilityChange("visible");
      await flushMicrotasks();

      // No immediate fetch dispatched because data is still fresh (< 30s old)
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Regular polling resumes at the scheduled interval
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher).toHaveBeenCalledTimes(2);

      controller.unmount();
    });

    it("8. If no successful fetch has occurred, returning to visible triggers a refresh", async () => {
      // Mount while hidden (fetcher not called on mount)
      setDocumentVisibility("hidden");
      const fetcher = vi.fn().mockResolvedValue({ ok: true });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      await flushMicrotasks();
      expect(fetcher).not.toHaveBeenCalled();

      // Tab becomes visible
      dispatchVisibilityChange("visible");
      await flushMicrotasks();

      // Immediate refresh triggered because lastSuccessTime === 0
      expect(fetcher).toHaveBeenCalledTimes(1);

      controller.unmount();
    });

    it("9. Repeated visibility events do not dispatch duplicate requests", async () => {
      setDocumentVisibility("visible");
      let resolvePromise: (val: any) => void;
      const fetcher = vi.fn().mockImplementation(() => {
        return new Promise((res) => {
          resolvePromise = res;
        });
      });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      // First fetch is in flight
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Multiple rapid visibilitychange events arrive while visible
      dispatchVisibilityChange("visible");
      dispatchVisibilityChange("visible");
      dispatchVisibilityChange("visible");

      // Still only 1 request dispatched
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Resolve the in-flight request
      resolvePromise!({ ok: true });
      await flushMicrotasks();

      // Further rapid visible events immediately after completion also do not dispatch
      // duplicate requests because data is fresh (< 30s)
      dispatchVisibilityChange("visible");
      dispatchVisibilityChange("visible");
      expect(fetcher).toHaveBeenCalledTimes(1);

      controller.unmount();
    });
  });

  // =========================================================================
  // 2. In-Flight Request Protection & Race-Safety (Requirements 10 - 15)
  // =========================================================================
  describe("In-Flight Request Protection & Race-Safety", () => {
    it("10. A second interval tick cannot dispatch a request while previous request is pending", async () => {
      setDocumentVisibility("visible");
      let resolveFirst: (val: any) => void;
      const fetcher = vi.fn().mockImplementation(() => {
        return new Promise((res) => {
          resolveFirst = res;
        });
      });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(controller.getIsInFlight()).toBe(true);

      // Advance 30s while first request is still slow / pending
      await vi.advanceTimersByTimeAsync(30_000);

      // Second tick is blocked by in-flight guard!
      expect(fetcher).toHaveBeenCalledTimes(1);

      // First request resolves
      resolveFirst!({ ok: true });
      await flushMicrotasks();
      expect(controller.getIsInFlight()).toBe(false);

      // Next tick can now proceed normally
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher).toHaveBeenCalledTimes(2);

      controller.unmount();
    });

    it("11. Manual refresh cannot dispatch a duplicate concurrent request", async () => {
      setDocumentVisibility("visible");
      let resolveFirst: (val: any) => void;
      const fetcher = vi.fn().mockImplementation(() => {
        return new Promise((res) => {
          resolveFirst = res;
        });
      });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Trigger manual refresh while first request is pending
      const refreshPromise = controller.refresh();

      // Fetcher not called again!
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Both promises share the same underlying request
      resolveFirst!({ ok: true });
      await refreshPromise;
      expect(fetcher).toHaveBeenCalledTimes(1);

      controller.unmount();
    });

    it("12. Dropdown opening during an active notification poll does not dispatch a duplicate request", async () => {
      setDocumentVisibility("visible");
      let resolvePoll: (val: any) => void;
      const fetcher = vi.fn().mockImplementation(() => {
        return new Promise((res) => {
          resolvePoll = res;
        });
      });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      expect(fetcher).toHaveBeenCalledTimes(1);

      // User clicks notification bell / opens dropdown
      // Dropdown calls controller.refresh()
      const dropdownPromise = controller.refresh();
      expect(fetcher).toHaveBeenCalledTimes(1);

      resolvePoll!({ count: 5 });
      await dropdownPromise;
      expect(fetcher).toHaveBeenCalledTimes(1);

      controller.unmount();
    });

    it("13. A failed request does not create an automatic infinite retry loop", async () => {
      setDocumentVisibility("visible");
      const fetcher = vi.fn().mockRejectedValue(new Error("Network Error"));
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      await flushMicrotasks();

      // Failed once on initial mount
      expect(fetcher).toHaveBeenCalledTimes(1);
      // In-flight guard is cleared despite failure
      expect(controller.getIsInFlight()).toBe(false);
      // lastSuccessTime is not updated
      expect(controller.getLastSuccessTime()).toBe(0);

      // Verify no fast immediate loop: advance 5s
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fetcher).toHaveBeenCalledTimes(1);

      controller.unmount();
    });

    it("14. A subsequent scheduled or manual refresh can retry after failure", async () => {
      setDocumentVisibility("visible");
      let attempts = 0;
      const fetcher = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("Temporary 503");
        }
        return { success: true };
      });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(controller.getLastSuccessTime()).toBe(0);

      // Scheduled 30s tick arrives
      await vi.advanceTimersByTimeAsync(30_000);

      // Retried and succeeded
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(controller.getLastSuccessTime()).toBeGreaterThan(0);

      controller.unmount();
    });

    it("15. A request resolving after a visibility transition does not cause overlapping requests", async () => {
      setDocumentVisibility("visible");
      let resolveSlowRequest: (val: any) => void;
      const fetcher = vi.fn().mockImplementation(() => {
        return new Promise((res) => {
          resolveSlowRequest = res;
        });
      });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Tab hidden while request in-flight
      dispatchVisibilityChange("hidden");
      await vi.advanceTimersByTimeAsync(15_000);

      // Request completes while hidden
      resolveSlowRequest!({ ok: true });
      await flushMicrotasks();
      expect(controller.getIsInFlight()).toBe(false);
      expect(controller.getLastSuccessTime()).toBeGreaterThan(0);

      // User returns to tab 5s later (only 5s since resolution, < 30s)
      await vi.advanceTimersByTimeAsync(5_000);
      dispatchVisibilityChange("visible");
      await flushMicrotasks();

      // No overlapping or redundant request dispatched
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Regular schedule resumes
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher).toHaveBeenCalledTimes(2);

      controller.unmount();
    });

    it("CR1. Manual refresh while hidden does not dispatch a request", async () => {
      setDocumentVisibility("hidden");
      const fetcher = vi.fn().mockResolvedValue({ ok: true });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      await flushMicrotasks();
      expect(fetcher).not.toHaveBeenCalled();

      // Explicit manual refresh while hidden must be suppressed
      const promise = controller.refresh();
      await promise;
      await flushMicrotasks();

      expect(fetcher).not.toHaveBeenCalled();
      expect(controller.getIsInFlight()).toBe(false);
      expect(controller.getLastSuccessTime()).toBe(0);

      controller.unmount();
    });

    it("CR2. Existing in-flight requests can safely be joined (even across visibility changes)", async () => {
      setDocumentVisibility("visible");
      let resolveFirst: (val: any) => void;
      const fetcher = vi.fn().mockImplementation(() => {
        return new Promise((res) => {
          resolveFirst = res;
        });
      });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(controller.getIsInFlight()).toBe(true);

      // Document becomes hidden while first request is in-flight
      dispatchVisibilityChange("hidden");

      // Caller invokes refresh() while hidden and request is in-flight: receives the existing promise
      const joinPromise = controller.refresh();
      expect(fetcher).toHaveBeenCalledTimes(1);

      resolveFirst!({ ok: true });
      await joinPromise;
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(controller.getIsInFlight()).toBe(false);

      controller.unmount();
    });

    it("CR3. Reentrant refresh cannot dispatch a second request", async () => {
      setDocumentVisibility("visible");
      let reentrantPromise: Promise<void> | null = null;
      let resolveFetcher: (val: any) => void;

      const fetcher = vi.fn().mockImplementation(() => {
        // Reentrantly invoke refresh while fetcher is executing!
        reentrantPromise = controller.refresh();
        return new Promise((res) => {
          resolveFetcher = res;
        });
      });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(reentrantPromise).not.toBeNull();

      resolveFetcher!({ ok: true });
      await reentrantPromise;
      expect(fetcher).toHaveBeenCalledTimes(1);

      controller.unmount();
    });

    it("CR4. Synchronous fetcher exceptions release the in-flight lock correctly", async () => {
      setDocumentVisibility("visible");
      let attempts = 0;
      const fetcher = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts === 1) {
          throw new Error("Synchronous throw in fetcher");
        }
        return Promise.resolve({ ok: true });
      });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      await flushMicrotasks();

      expect(fetcher).toHaveBeenCalledTimes(1);
      // In-flight lock is cleanly released despite synchronous throw
      expect(controller.getIsInFlight()).toBe(false);
      expect(controller.getLastSuccessTime()).toBe(0);

      // Subsequent tick can run without being blocked by a stuck in-flight lock
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(controller.getLastSuccessTime()).toBeGreaterThan(0);

      controller.unmount();
    });
  });

  // =========================================================================
  // 3. Lifecycle Behavior & React Hook Integration (Requirements 16 - 20, CR5 - CR8)
  // =========================================================================
  describe("Lifecycle Behavior & React Hook Integration", () => {
    it("16. Timers are cleared on unmount", async () => {
      setDocumentVisibility("visible");
      const fetcher = vi.fn().mockResolvedValue({ ok: true });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);

      controller.unmount();

      // Advance by 60 seconds
      await vi.advanceTimersByTimeAsync(60_000);

      // No fetches dispatched after unmount
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("17. Visibility listeners are removed on unmount", () => {
      setDocumentVisibility("visible");
      const fetcher = vi.fn().mockResolvedValue({ ok: true });
      const controller = new PollingController(fetcher, 30_000, true);

      expect(visibilityListeners.size).toBe(0);
      controller.mount();
      expect(visibilityListeners.size).toBe(1);

      controller.unmount();
      expect(visibilityListeners.size).toBe(0);
    });

    it("18. Duplicate mount calls are safely guarded (idempotent mount)", async () => {
      setDocumentVisibility("visible");
      const fetcher = vi.fn().mockResolvedValue({ ok: true });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(visibilityListeners.size).toBe(1);

      // Duplicate mount call while already mounted
      controller.mount();
      await flushMicrotasks();

      // Does not re-add listener or fire duplicate fetch
      expect(visibilityListeners.size).toBe(1);
      expect(fetcher).toHaveBeenCalledTimes(1);

      controller.unmount();
      expect(visibilityListeners.size).toBe(0);
    });

    it("19. Late responses after unmount cannot update state or timestamp on a genuinely unmounted controller", async () => {
      setDocumentVisibility("visible");
      let resolveSlowRequest: (val: any) => void;

      const fetcher = vi.fn().mockImplementation(async () => {
        await new Promise((res) => {
          resolveSlowRequest = res;
        });
      });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Unmount before response arrives
      controller.unmount();
      expect(controller.getIsMounted()).toBe(false);

      // Late response arrives from the dead lifecycle
      resolveSlowRequest!({ ok: true });
      await flushMicrotasks();

      // lastSuccessTime was not updated after unmount
      expect(controller.getLastSuccessTime()).toBe(0);
    });

    it("20. Disabling polling cleans up active timers and prevents new requests", async () => {
      setDocumentVisibility("visible");
      const fetcher = vi.fn().mockResolvedValue({ ok: true });
      const controller = new PollingController(fetcher, 30_000, true);

      controller.mount();
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Disable polling
      controller.updateOptions(30_000, false);

      // Advance 60s
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Calling refresh while disabled is a safe no-op
      await controller.refresh();
      expect(fetcher).toHaveBeenCalledTimes(1);

      controller.unmount();
    });

    it("CR5. Changing enabled does not create timers during render", () => {
      setDocumentVisibility("visible");
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      const fetcher = vi.fn().mockResolvedValue({ ok: true });

      let timersDuringRender = 0;
      const hook = renderHook(
        (props: { enabled: boolean }) =>
          usePolling(fetcher, { intervalMs: 30_000, enabled: props.enabled }),
        { enabled: false }
      );

      // Initially disabled: no timer created
      expect(setIntervalSpy).toHaveBeenCalledTimes(0);

      // Re-render with enabled: true. Inspect timer creation strictly during render phase!
      hook.rerender({ enabled: true }, () => {
        timersDuringRender = setIntervalSpy.mock.calls.length;
      });

      // No timers were started in render phase!
      expect(timersDuringRender).toBe(0);
      // Timer was started in commit phase (effect)
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);

      hook.unmount();
      setIntervalSpy.mockRestore();
    });

    it("CR6. Changing the polling interval cleans up and recreates the timer correctly", async () => {
      setDocumentVisibility("visible");
      const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
      const fetcher = vi.fn().mockResolvedValue({ ok: true });

      const hook = renderHook(
        (props: { intervalMs: number }) =>
          usePolling(fetcher, { intervalMs: props.intervalMs, enabled: true }),
        { intervalMs: 30_000 }
      );
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Advance 30s with initial interval
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher).toHaveBeenCalledTimes(2);

      // Change interval to 10s
      hook.rerender({ intervalMs: 10_000 });
      expect(clearIntervalSpy).toHaveBeenCalled();

      // Advance 10s with new interval
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetcher).toHaveBeenCalledTimes(3);

      hook.unmount();
      clearIntervalSpy.mockRestore();
    });

    it("CR7. Changing the fetcher callback does not trigger an unnecessary initial fetch", async () => {
      setDocumentVisibility("visible");
      const fetcher1 = vi.fn().mockResolvedValue({ v: 1 });
      const fetcher2 = vi.fn().mockResolvedValue({ v: 2 });

      const hook = renderHook(
        (props: { fetcher: () => Promise<any> }) =>
          usePolling(props.fetcher, { intervalMs: 30_000, enabled: true }),
        { fetcher: fetcher1 }
      );
      await flushMicrotasks();
      expect(fetcher1).toHaveBeenCalledTimes(1);
      expect(fetcher2).not.toHaveBeenCalled();

      // Change fetcher identity (e.g. parent component re-render)
      hook.rerender({ fetcher: fetcher2 });
      await flushMicrotasks();

      // No redundant immediate fetch dispatched
      expect(fetcher1).toHaveBeenCalledTimes(1);
      expect(fetcher2).not.toHaveBeenCalled();

      // On next scheduled interval tick, the new fetcher is called!
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher1).toHaveBeenCalledTimes(1);
      expect(fetcher2).toHaveBeenCalledTimes(1);

      hook.unmount();
    });

    it("CR8. Simulated React Strict Mode lifecycle does not leave duplicate timers or listeners", async () => {
      setDocumentVisibility("visible");
      const fetcher = vi.fn().mockResolvedValue({ ok: true });

      // Render hook instance in simulated hook harness
      const hook = renderHook(
        () => usePolling(fetcher, { intervalMs: 30_000, enabled: true }),
        undefined
      );
      await flushMicrotasks();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(visibilityListeners.size).toBe(1);

      // Simulate React Strict Mode lifecycle (unmount + remount on same hook instance)
      hook.simulateStrictMode();
      await flushMicrotasks();

      // Exactly 1 visibility listener remains active
      expect(visibilityListeners.size).toBe(1);
      // No duplicate initial fetch executed
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Single timer runs at 30s
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher).toHaveBeenCalledTimes(2);

      hook.unmount();
      expect(visibilityListeners.size).toBe(0);
    });

    it("CR9. In-flight request across effect cleanup/remount correctly records success and prevents duplicate fetch on visibility return", async () => {
      setDocumentVisibility("visible");
      let resolveFirst: (val: any) => void;
      const fetcher = vi.fn().mockImplementation(() => {
        return new Promise((res) => {
          resolveFirst = res;
        });
      });
      const controller = new PollingController(fetcher, 30_000, true);

      // 1. Mount and start initial request
      controller.mount();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(controller.getIsInFlight()).toBe(true);

      // 2. Simulate effect cleanup (unmount) while request is pending
      controller.unmount();
      expect(controller.getIsMounted()).toBe(false);
      expect(controller.getIsInFlight()).toBe(true);

      // 3. Remount (new lifecycle) while request is still pending
      controller.mount();
      expect(controller.getIsMounted()).toBe(true);
      // Still only 1 request dispatched (joined in-flight)
      expect(fetcher).toHaveBeenCalledTimes(1);

      // 4. Invoke refresh during the new lifecycle
      const refreshPromise = controller.refresh();
      // Shares the in-flight promise, no duplicate request dispatched
      expect(fetcher).toHaveBeenCalledTimes(1);

      // 5. Resolve the original request
      resolveFirst!({ ok: true });
      await refreshPromise;
      await flushMicrotasks();

      // Controller correctly records successful data!
      expect(controller.getLastSuccessTime()).toBeGreaterThan(0);
      expect(controller.getIsInFlight()).toBe(false);

      // 6. Tab switches to hidden and returns to visible within polling interval (e.g. after 5 seconds)
      await vi.advanceTimersByTimeAsync(5_000);
      dispatchVisibilityChange("hidden");
      await vi.advanceTimersByTimeAsync(10_000);

      // Total elapsed since success = 15s < 30s
      dispatchVisibilityChange("visible");
      await flushMicrotasks();

      // Returning to visible within the polling interval does NOT cause an unnecessary duplicate request!
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Normal schedule resumes at 30s after visibility return
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher).toHaveBeenCalledTimes(2);

      controller.unmount();
    });

    it("CR10. In-flight request where fetcher callback identity changed triggers single refresh for new fetcher", async () => {
      setDocumentVisibility("visible");
      let resolveFirst: (val: any) => void;
      const fetcher1 = vi.fn().mockImplementation(() => {
        return new Promise((res) => {
          resolveFirst = res;
        });
      });
      const fetcher2 = vi.fn().mockResolvedValue({ user: "B" });
      const controller = new PollingController(fetcher1, 30_000, true);

      // 1. Mount with fetcher1
      controller.mount();
      expect(fetcher1).toHaveBeenCalledTimes(1);

      // 2. Unmount, update fetcher to fetcher2, and remount while fetcher1 request is pending
      controller.unmount();
      controller.updateFetcher(fetcher2);
      controller.mount();

      // fetcher2 not invoked yet because in-flight request is pending
      expect(fetcher2).not.toHaveBeenCalled();

      // 3. Resolve old fetcher1 request
      resolveFirst!({ user: "A" });
      await flushMicrotasks();

      // Old request was not adopted for fetcher2's success timestamp
      // Instead, a single fresh request was dispatched for fetcher2!
      expect(fetcher2).toHaveBeenCalledTimes(1);
      expect(controller.getLastSuccessTime()).toBeGreaterThan(0);

      controller.unmount();
    });
  });

  // =========================================================================
  // 4. Pending Refresh When Fetcher Changes in a Hidden Tab (Tests A - E)
  // =========================================================================
  describe("Pending Refresh When Fetcher Changes in a Hidden Tab", () => {
    it("Test A: Fetcher changes while hidden, executes once on visibility return despite recent old success timestamp", async () => {
      setDocumentVisibility("visible");
      let resolveFirst: (val: any) => void;
      const fetcher1 = vi.fn().mockImplementation(() => {
        return new Promise((res) => {
          resolveFirst = res;
        });
      });
      const fetcher2 = vi.fn().mockResolvedValue({ user: "B" });
      const controller = new PollingController(fetcher1, 30_000, true);

      // 1. Mount and complete initial fetch with fetcher1 so lastSuccessTime is recorded
      controller.mount();
      expect(fetcher1).toHaveBeenCalledTimes(1);
      resolveFirst!({ user: "A_initial" });
      await flushMicrotasks();
      expect(controller.getLastSuccessTime()).toBeGreaterThan(0);
      const initialSuccessTime = controller.getLastSuccessTime();

      // 2. Advance 5 seconds (< 30s) and start second in-flight request with fetcher1
      await vi.advanceTimersByTimeAsync(5_000);
      let resolveSecond: (val: any) => void;
      fetcher1.mockImplementation(() => {
        return new Promise((res) => {
          resolveSecond = res;
        });
      });
      const refreshPromise = controller.refresh();
      expect(fetcher1).toHaveBeenCalledTimes(2);
      expect(controller.getIsInFlight()).toBe(true);

      // 3. User switches to another tab (document becomes hidden)
      dispatchVisibilityChange("hidden");

      // 4. Fetcher callback changes to fetcher2 while document is hidden
      controller.updateFetcher(fetcher2);

      // 5. Old fetcher1 request completes while document is hidden
      resolveSecond!({ user: "A_second" });
      await refreshPromise;
      await flushMicrotasks();

      // Verify no new request was dispatched while hidden!
      expect(fetcher2).not.toHaveBeenCalled();
      expect(controller.getIsInFlight()).toBe(false);

      // Verify time elapsed since initial success is still well under 30s (e.g. 10s total)
      await vi.advanceTimersByTimeAsync(5_000);
      expect(Date.now() - initialSuccessTime).toBeLessThan(30_000);
      expect(fetcher2).not.toHaveBeenCalled();

      // 6. User returns to tab (document becomes visible)
      dispatchVisibilityChange("visible");
      await flushMicrotasks();

      // 7. Verify fetcher2 executes exactly once despite recent old success timestamp!
      expect(fetcher2).toHaveBeenCalledTimes(1);
      expect(controller.getLastSuccessTime()).toBeGreaterThan(initialSuccessTime);

      controller.unmount();
    });

    it("Test B: No duplicate refresh and normal 30-second interval schedule resumes", async () => {
      setDocumentVisibility("visible");
      let resolveFirst: (val: any) => void;
      const fetcher1 = vi.fn().mockImplementation(() => {
        return new Promise((res) => {
          resolveFirst = res;
        });
      });
      const fetcher2 = vi.fn().mockResolvedValue({ user: "B" });
      const controller = new PollingController(fetcher1, 30_000, true);

      controller.mount();
      resolveFirst!({ user: "A" });
      await flushMicrotasks();

      // Advance 5s and trigger second fetch with fetcher1
      await vi.advanceTimersByTimeAsync(5_000);
      let resolveSecond: (val: any) => void;
      fetcher1.mockImplementation(() => {
        return new Promise((res) => {
          resolveSecond = res;
        });
      });
      const refreshPromise = controller.refresh();

      // Tab hidden, fetcher updated, request completes while hidden
      dispatchVisibilityChange("hidden");
      controller.updateFetcher(fetcher2);
      resolveSecond!({ user: "A2" });
      await refreshPromise;
      await flushMicrotasks();

      // Return to visible -> triggers pending refresh for fetcher2
      dispatchVisibilityChange("visible");
      await flushMicrotasks();
      expect(fetcher2).toHaveBeenCalledTimes(1);

      // Subsequent manual refresh while visible does not create overlapping requests
      await controller.refresh();
      expect(fetcher2).toHaveBeenCalledTimes(2);

      // Advance timers by full 30 seconds: regular polling resumes
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher2).toHaveBeenCalledTimes(3);

      // Advance another 30s
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher2).toHaveBeenCalledTimes(4);

      // Verify fetcher1 was never called again
      expect(fetcher1).toHaveBeenCalledTimes(2);

      controller.unmount();
    });

    it("Test C: Unmounting while refresh is pending prevents any request or lingering timers/listeners", async () => {
      setDocumentVisibility("visible");
      let resolveFirst: (val: any) => void;
      const fetcher1 = vi.fn().mockImplementation(() => {
        return new Promise((res) => {
          resolveFirst = res;
        });
      });
      const fetcher2 = vi.fn().mockResolvedValue({ user: "B" });
      const controller = new PollingController(fetcher1, 30_000, true);

      controller.mount();
      expect(fetcher1).toHaveBeenCalledTimes(1);

      // Hide document while request is in flight
      dispatchVisibilityChange("hidden");

      // Update fetcher to fetcher2
      controller.updateFetcher(fetcher2);

      // Resolve old fetcher1 while hidden
      resolveFirst!({ user: "A" });
      await flushMicrotasks();
      expect(fetcher2).not.toHaveBeenCalled();

      // Unmount the controller BEFORE visibility is restored
      controller.unmount();
      expect(controller.getIsMounted()).toBe(false);
      expect(visibilityListeners.size).toBe(0);

      // Restore visibility
      dispatchVisibilityChange("visible");
      await flushMicrotasks();

      // Verify no request was dispatched
      expect(fetcher2).not.toHaveBeenCalled();
      expect(fetcher1).toHaveBeenCalledTimes(1);

      // Advance timers by 60 seconds: verify no lingering timers run
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetcher2).not.toHaveBeenCalled();
      expect(fetcher1).toHaveBeenCalledTimes(1);
    });

    it("Test D: Latest fetcher wins when fetcher changes multiple times while hidden", async () => {
      setDocumentVisibility("visible");
      let resolveFirst: (val: any) => void;
      const fetcher1 = vi.fn().mockImplementation(() => {
        return new Promise((res) => {
          resolveFirst = res;
        });
      });
      const fetcher2 = vi.fn().mockResolvedValue({ user: "B" });
      const fetcher3 = vi.fn().mockResolvedValue({ user: "C" });
      const controller = new PollingController(fetcher1, 30_000, true);

      controller.mount();
      expect(fetcher1).toHaveBeenCalledTimes(1);

      // Hide tab
      dispatchVisibilityChange("hidden");

      // Fetcher updates to fetcher2, then to fetcher3
      controller.updateFetcher(fetcher2);
      controller.updateFetcher(fetcher3);

      // Resolve old request while hidden
      resolveFirst!({ user: "A" });
      await flushMicrotasks();

      // Verify neither fetcher2 nor fetcher3 ran while hidden
      expect(fetcher2).not.toHaveBeenCalled();
      expect(fetcher3).not.toHaveBeenCalled();

      // Restore visibility
      dispatchVisibilityChange("visible");
      await flushMicrotasks();

      // Exactly the latest fetcher (fetcher3) executes, fetcher2 was never called
      expect(fetcher2).not.toHaveBeenCalled();
      expect(fetcher3).toHaveBeenCalledTimes(1);

      controller.unmount();
    });

    it("Test E: Enabled/disabled transitions preserve pending refresh without firing while disabled", async () => {
      setDocumentVisibility("visible");
      let resolveFirst: (val: any) => void;
      const fetcher1 = vi.fn().mockImplementation(() => {
        return new Promise((res) => {
          resolveFirst = res;
        });
      });
      const fetcher2 = vi.fn().mockResolvedValue({ user: "B" });
      const controller = new PollingController(fetcher1, 30_000, true);

      controller.mount();
      expect(fetcher1).toHaveBeenCalledTimes(1);

      // Tab hidden
      dispatchVisibilityChange("hidden");

      // Update to fetcher2 and resolve fetcher1 while hidden -> records pending refresh
      controller.updateFetcher(fetcher2);
      resolveFirst!({ user: "A" });
      await flushMicrotasks();

      // Disable polling while hidden
      controller.updateOptions(30_000, false);

      // Restore visibility while disabled
      dispatchVisibilityChange("visible");
      await flushMicrotasks();

      // Must not dispatch requests while disabled!
      expect(fetcher2).not.toHaveBeenCalled();

      // Advance timers by 60s while disabled: still no requests
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetcher2).not.toHaveBeenCalled();

      // Re-enable polling while visible -> pending refresh fires immediately!
      controller.updateOptions(30_000, true);
      await flushMicrotasks();

      expect(fetcher2).toHaveBeenCalledTimes(1);

      // Regular 30s schedule resumes
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher2).toHaveBeenCalledTimes(2);

      controller.unmount();
    });

    it("Test E (variant): Re-enabling while hidden does not execute until tab becomes visible", async () => {
      setDocumentVisibility("visible");
      let resolveFirst: (val: any) => void;
      const fetcher1 = vi.fn().mockImplementation(() => {
        return new Promise((res) => {
          resolveFirst = res;
        });
      });
      const fetcher2 = vi.fn().mockResolvedValue({ user: "B" });
      const controller = new PollingController(fetcher1, 30_000, true);

      controller.mount();
      expect(fetcher1).toHaveBeenCalledTimes(1);

      // Tab hidden
      dispatchVisibilityChange("hidden");

      // Update to fetcher2 and resolve fetcher1 while hidden -> records pending refresh
      controller.updateFetcher(fetcher2);
      resolveFirst!({ user: "A" });
      await flushMicrotasks();

      // Disable polling while hidden
      controller.updateOptions(30_000, false);

      // Re-enable polling while STILL hidden
      controller.updateOptions(30_000, true);
      await flushMicrotasks();

      // Still no request dispatched while hidden!
      expect(fetcher2).not.toHaveBeenCalled();

      // Now restore visibility
      dispatchVisibilityChange("visible");
      await flushMicrotasks();

      // Immediately refreshes on visibility return!
      expect(fetcher2).toHaveBeenCalledTimes(1);

      controller.unmount();
    });

    it("Test F: Preserves pending refresh when polling is disabled while request is in flight (14-step sequence)", async () => {
      // 1. Set document visibility to visible.
      setDocumentVisibility("visible");

      // 2. Create fetcher1 that returns a pending promise.
      let resolveFetcher1: (val: any) => void;
      const fetcher1 = vi.fn().mockImplementation(() => {
        return new Promise((res) => {
          resolveFetcher1 = res;
        });
      });
      const fetcher2 = vi.fn().mockResolvedValue({ user: "B" });
      const controller = new PollingController(fetcher1, 30_000, true);

      // 3. Mount the controller and verify fetcher1 starts once.
      controller.mount();
      expect(fetcher1).toHaveBeenCalledTimes(1);
      expect(fetcher2).not.toHaveBeenCalled();

      // 4. Hide the document.
      dispatchVisibilityChange("hidden");

      // 5. Change the fetcher to fetcher2.
      controller.updateFetcher(fetcher2);

      // 6. Disable polling while the original request remains in flight.
      controller.updateOptions(30_000, false);

      // 7. Resolve the original fetcher1 request.
      resolveFetcher1!({ user: "A" });
      await flushMicrotasks();

      // 8. Verify fetcher2 has not executed.
      expect(fetcher2).not.toHaveBeenCalled();

      // 9. Restore document visibility while polling remains disabled.
      dispatchVisibilityChange("visible");
      await flushMicrotasks();

      // 10. Verify fetcher2 still has not executed.
      expect(fetcher2).not.toHaveBeenCalled();

      // 11. Advance fake timers while disabled and verify no request occurs.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetcher2).not.toHaveBeenCalled();
      expect(fetcher1).toHaveBeenCalledTimes(1);

      // 12. Re-enable polling while visible.
      controller.updateOptions(30_000, true);
      await flushMicrotasks();

      // 13. Verify fetcher2 executes exactly once.
      expect(fetcher2).toHaveBeenCalledTimes(1);

      // 14. Advance the next 30-second interval and verify normal polling resumes without duplicate requests.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher2).toHaveBeenCalledTimes(2);
      expect(fetcher1).toHaveBeenCalledTimes(1);

      controller.unmount();
    });

    it("Test G: Unmounting while disabled with pending refresh prevents any request after visibility restoration", async () => {
      setDocumentVisibility("visible");
      let resolveFetcher1: (val: any) => void;
      const fetcher1 = vi.fn().mockImplementation(() => {
        return new Promise((res) => {
          resolveFetcher1 = res;
        });
      });
      const fetcher2 = vi.fn().mockResolvedValue({ user: "B" });
      const controller = new PollingController(fetcher1, 30_000, true);

      // Mount controller
      controller.mount();
      expect(fetcher1).toHaveBeenCalledTimes(1);

      // Tab hidden, fetcher updated to fetcher2, polling disabled while request in flight
      dispatchVisibilityChange("hidden");
      controller.updateFetcher(fetcher2);
      controller.updateOptions(30_000, false);

      // Resolve original request while disabled and hidden
      resolveFetcher1!({ user: "A" });
      await flushMicrotasks();
      expect(fetcher2).not.toHaveBeenCalled();

      // Unmount the controller BEFORE re-enabling polling
      controller.unmount();
      expect(controller.getIsMounted()).toBe(false);
      expect(visibilityListeners.size).toBe(0);

      // Restore visibility and advance timers
      dispatchVisibilityChange("visible");
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(60_000);

      // Verify no request is dispatched after unmount
      expect(fetcher2).not.toHaveBeenCalled();
      expect(fetcher1).toHaveBeenCalledTimes(1);
    });

    it("Hook integration: Fetcher callback update while tab hidden triggers refresh on visibility return", async () => {
      setDocumentVisibility("visible");
      let resolveFirst: (val: any) => void;
      const fetcher1 = vi.fn().mockImplementation(() => {
        return new Promise((res) => {
          resolveFirst = res;
        });
      });
      const fetcher2 = vi.fn().mockResolvedValue({ user: "B" });

      const hook = renderHook(
        (props: { fetcher: () => Promise<any> }) =>
          usePolling(props.fetcher, { intervalMs: 30_000, enabled: true }),
        { fetcher: fetcher1 }
      );
      expect(fetcher1).toHaveBeenCalledTimes(1);

      // Hide tab
      dispatchVisibilityChange("hidden");

      // Update fetcher in component rerender
      hook.rerender({ fetcher: fetcher2 });

      // Resolve first request while hidden
      resolveFirst!({ user: "A" });
      await flushMicrotasks();

      expect(fetcher2).not.toHaveBeenCalled();

      // Restore visibility
      dispatchVisibilityChange("visible");
      await flushMicrotasks();

      expect(fetcher2).toHaveBeenCalledTimes(1);

      hook.unmount();
    });

    it("Test H: Fetcher changes and refreshes while hidden with no request in flight, executes immediately upon visibility return (10-step sequence)", async () => {
      // 1. Mount an enabled polling controller while the document is visible
      setDocumentVisibility("visible");
      const fetcherA = vi.fn().mockResolvedValue({ user: "account_A" });
      const fetcherB = vi.fn().mockResolvedValue({ user: "account_B" });
      const controller = new PollingController(fetcherA, 30_000, true);

      controller.mount();

      // 2. Execute and successfully complete the initial fetch using fetcher A
      await flushMicrotasks();
      expect(fetcherA).toHaveBeenCalledTimes(1);
      expect(fetcherB).not.toHaveBeenCalled();
      expect(controller.getLastSuccessTime()).toBeGreaterThan(0);
      const initialSuccessTime = controller.getLastSuccessTime();

      // 3. Confirm there is no request in flight
      expect(controller.getIsInFlight()).toBe(false);

      // 4. Change the document visibility to hidden
      dispatchVisibilityChange("hidden");

      // 5. Change the fetcher to fetcher B, representing the newly authenticated account
      controller.updateFetcher(fetcherB);

      // 6. Trigger a refresh while the document remains hidden
      const refreshPromise = controller.refresh();
      await refreshPromise;
      await flushMicrotasks();

      // 7. Verify fetcher B has NOT executed while hidden
      expect(fetcherB).not.toHaveBeenCalled();
      expect(fetcherA).toHaveBeenCalledTimes(1);
      expect(controller.getIsInFlight()).toBe(false);

      // Verify that while still under 30s since fetcher A's success, no request fires while hidden
      await vi.advanceTimersByTimeAsync(5_000);
      expect(Date.now() - initialSuccessTime).toBeLessThan(30_000);
      expect(fetcherB).not.toHaveBeenCalled();

      // 8. Change document visibility back to visible and dispatch the visibility-change event
      dispatchVisibilityChange("visible");
      await flushMicrotasks();

      // 9. Verify fetcher B executes immediately, without waiting for the previous 30-second interval
      // Also verifies the new fetcher (fetcherB) is invoked, NOT the old fetcher (fetcherA)
      expect(fetcherB).toHaveBeenCalledTimes(1);
      expect(fetcherA).toHaveBeenCalledTimes(1);
      expect(controller.getLastSuccessTime()).toBeGreaterThan(initialSuccessTime);

      // 10. Verify the controller returns to its normal polling schedule and does not dispatch duplicate requests
      await vi.advanceTimersByTimeAsync(29_000);
      await flushMicrotasks();
      expect(fetcherB).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000); // exactly 30s elapsed since visibility return fetch
      await flushMicrotasks();
      expect(fetcherB).toHaveBeenCalledTimes(2);
      expect(fetcherA).toHaveBeenCalledTimes(1);

      controller.unmount();
    });
  });

  // =========================================================================
  // 5. Helper Function Tests
  // =========================================================================
  describe("isDocumentVisible Helper", () => {
    it("handles SSR and document state correctly", () => {
      setDocumentVisibility("visible");
      expect(isDocumentVisible()).toBe(true);

      setDocumentVisibility("hidden");
      expect(isDocumentVisible()).toBe(false);

      // SSR simulation: document undefined
      delete (globalThis as any).document;
      expect(isDocumentVisible()).toBe(false);
    });
  });

  // =========================================================================
  // 6. Component Source Regression Guards
  // =========================================================================
  describe("Component Source Regression Guards", () => {
    const profileMenuPath = path.resolve(__dirname, "../components/shared/ProfileMenu.tsx");
    const profileMenuSource = readFileSync(profileMenuPath, "utf-8");

    const notificationBellPath = path.resolve(__dirname, "../components/builder/NotificationBell.tsx");
    const notificationBellSource = readFileSync(notificationBellPath, "utf-8");

    it("ProfileMenu imports and uses usePolling", () => {
      expect(profileMenuSource).toMatch(/import\s*\{[^}]*usePolling[^}]*\}\s*from\s*["']@\/lib\/use-polling["']/);
      expect(profileMenuSource).toMatch(/usePolling\s*\(\s*load\s*,\s*\{\s*intervalMs:\s*BALANCE_POLL_INTERVAL_MS\s*,\s*enabled\s*\}\s*\)/);
    });

    it("ProfileMenu retains 30-second interval constant", () => {
      expect(profileMenuSource).toMatch(/const\s+BALANCE_POLL_INTERVAL_MS\s*=\s*30_000/);
    });

    it("ProfileMenu eliminated raw setInterval polling", () => {
      expect(profileMenuSource).not.toMatch(/setInterval\s*\(\s*load\s*,\s*BALANCE_POLL_INTERVAL_MS\s*\)/);
    });

    it("ProfileMenu preserves Work Item 1 auth-client signOut import and call", () => {
      expect(profileMenuSource).toMatch(/import\s*\{[^}]*signOut[^}]*\}\s*from\s*["']@\/lib\/auth-client["']/);
      expect(profileMenuSource).toMatch(/void\s+signOut\(\s*\{\s*callbackUrl:\s*["']\/auth\/login["']\s*\}\s*\)/);
    });

    it("ProfileMenu preserves advance balance endpoint and types", () => {
      expect(profileMenuSource).toMatch(/\/advance/);
      expect(profileMenuSource).toMatch(/type\s+AdvanceBalanceSummary/);
      expect(profileMenuSource).toMatch(/availableBalance:\s*number/);
    });

    it("ProfileMenu guards state updates with isMountedRef", () => {
      expect(profileMenuSource).toMatch(/isMountedRef\.current/);
    });

    it("NotificationBell imports and uses usePolling", () => {
      expect(notificationBellSource).toMatch(/import\s*\{[^}]*usePolling[^}]*\}\s*from\s*["']@\/lib\/use-polling["']/);
      expect(notificationBellSource).toMatch(/const\s*\{\s*refresh\s*\}\s*=\s*usePolling\s*\(\s*fetchNotifications/);
    });

    it("NotificationBell retains 30-second interval constant", () => {
      expect(notificationBellSource).toMatch(/const\s+POLL_INTERVAL_MS\s*=\s*30_000/);
    });

    it("NotificationBell eliminated raw setInterval polling", () => {
      expect(notificationBellSource).not.toMatch(/setInterval\s*\(\s*fetchNotifications\s*,\s*POLL_INTERVAL_MS\s*\)/);
    });

    it("NotificationBell dropdown open effect triggers guarded refresh", () => {
      expect(notificationBellSource).toMatch(/if\s*\(\s*open\s*\)\s*\{\s*void\s+refresh\(\);?\s*\}/);
    });

    it("NotificationBell preserves notifications endpoint and response types", () => {
      expect(notificationBellSource).toMatch(/\/notifications/);
      expect(notificationBellSource).toMatch(/type\s+NotificationItem/);
      expect(notificationBellSource).toMatch(/type\s+NotificationsResponse/);
    });

    it("NotificationBell guards state updates with isMountedRef", () => {
      expect(notificationBellSource).toMatch(/isMountedRef\.current/);
    });
  });
});
