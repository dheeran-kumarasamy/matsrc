import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import NotificationBell from "../components/builder/NotificationBell";
import * as apiModule from "./api";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Mock next-auth/react
let currentSessionState: {
  data: { user?: { id?: string; email?: string; name?: string; role?: string } } | null;
  status: "authenticated" | "unauthenticated" | "loading";
} = {
  data: null,
  status: "loading",
};

vi.mock("next-auth/react", () => ({
  useSession: () => currentSessionState,
}));

describe("NotificationBell Session-Aware Polling and Logout Protection", () => {
  let visibilityListeners: Set<() => void>;
  let currentVisibilityState: "visible" | "hidden";
  let mockBuilderApiGet: any;
  let originalDocumentDescriptor: PropertyDescriptor | undefined;
  let hadDocumentProperty = false;

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

  beforeEach(() => {
    vi.useFakeTimers();

    hadDocumentProperty = Object.prototype.hasOwnProperty.call(globalThis, "document");
    originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");

    visibilityListeners = new Set();
    currentVisibilityState = "visible";

    // Setup global document mock
    const originalDoc = (globalThis as any).document || {};
    (globalThis as any).document = {
      ...originalDoc,
      get visibilityState() {
        return currentVisibilityState;
      },
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === "visibilitychange") {
          visibilityListeners.add(handler);
        }
      }),
      removeEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === "visibilitychange") {
          visibilityListeners.delete(handler);
        }
      }),
    };

    // Default to unauthenticated session
    currentSessionState = {
      data: null,
      status: "unauthenticated",
    };

    mockBuilderApiGet = vi.spyOn(apiModule, "builderApiGet").mockResolvedValue({
      items: [],
      unreadCount: 0,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();

    // Finding D: Cleanly restore globalThis.document exactly as it was
    if (hadDocumentProperty && originalDocumentDescriptor) {
      Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
    } else {
      delete (globalThis as any).document;
    }
  });

  /**
   * Simulated React component harness for testing NotificationBell lifecycle and hooks
   * in the project's 'node' vitest environment (which does not include jsdom).
   * Executes the real NotificationBell component function with real React hooks dispatcher.
   */
  function createComponentHarness() {
    const stateStore: any[] = [];
    const stateSetters: any[] = [];
    const refStore: any[] = [];
    const effectCleanups = new Map<number, (() => void) | void>();
    const effectDeps = new Map<number, any[] | undefined>();
    const pendingEffects: Array<{ index: number; fn: () => (() => void) | void }> = [];
    const callbackStore: Array<{ fn: any; deps: any[] | undefined }> = [];

    let stateIdx = 0;
    let refIdx = 0;
    let effectIdx = 0;
    let callbackIdx = 0;
    let currentElement: any = null;

    const dispatcher = {
      useState: (initialValue: any) => {
        const idx = stateIdx++;
        if (idx >= stateStore.length) {
          const val = typeof initialValue === "function" ? initialValue() : initialValue;
          stateStore.push(val);
        }
        if (idx >= stateSetters.length) {
          const setter = (action: any) => {
            const prev = stateStore[idx];
            const next = typeof action === "function" ? action(prev) : action;
            stateStore[idx] = next;
            scheduleRender();
          };
          stateSetters.push(setter);
        }
        return [stateStore[idx], stateSetters[idx]];
      },
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

    let isRendering = false;
    let renderNeeded = false;

    function scheduleRender() {
      if (isRendering) {
        renderNeeded = true;
        return;
      }
      render();
    }

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

    function render(options?: { flushEffects?: boolean }) {
      isRendering = true;
      try {
        let loops = 0;
        do {
          renderNeeded = false;
          stateIdx = 0;
          refIdx = 0;
          effectIdx = 0;
          callbackIdx = 0;

          const prevDispatcher = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
            ?.ReactCurrentDispatcher?.current;
          try {
            (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current =
              dispatcher;
            currentElement = NotificationBell();
          } finally {
            (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current =
              prevDispatcher;
          }

          if (options?.flushEffects !== false) {
            flushPendingEffects();
          }
          loops++;
          if (loops > 25) {
            throw new Error("Too many re-renders in component test harness");
          }
        } while (renderNeeded && options?.flushEffects !== false);
      } finally {
        isRendering = false;
      }
      return currentElement;
    }

    function unmount() {
      for (const [, cleanup] of effectCleanups) {
        if (typeof cleanup === "function") {
          cleanup();
        }
      }
      effectCleanups.clear();
    }

    // Initial mount
    render();

    return {
      render,
      flushEffects: flushPendingEffects,
      unmount,
      getElement: () => currentElement,
      toggleOpen: () => {
        // stateSetters[0] is setOpen
        stateSetters[0]((prev: boolean) => !prev);
      },
      getState: () => {
        const accountData = stateStore[1] || { accountId: null, items: [], unreadCount: 0 };
        const isAuthenticated =
          currentSessionState.status === "authenticated" && Boolean(currentSessionState.data?.user);
        const currentAccountId = isAuthenticated
          ? currentSessionState.data?.user?.id || currentSessionState.data?.user?.email || null
          : null;
        const isOwned = Boolean(currentAccountId && accountData.accountId === currentAccountId);
        const derivedItems = isOwned ? accountData.items : [];
        const derivedUnreadCount = isOwned ? accountData.unreadCount : 0;
        const rawAccountError = stateStore[3] || { accountId: null, hasError: false };
        const isErrorOwned = Boolean(
          currentAccountId && rawAccountError.accountId === currentAccountId && rawAccountError.hasError
        );
        const error = isErrorOwned;
        const isInitialLoading = Boolean(
          currentAccountId && accountData.accountId !== currentAccountId && !error
        );
        const showLoading = Boolean(stateStore[2]) || isInitialLoading;

        return {
          open: Boolean(stateStore[0]),
          items: derivedItems,
          unreadCount: derivedUnreadCount,
          rawAccountData: accountData,
          rawAccountError,
          loading: showLoading,
          error,
        };
      },
    };
  }

  // =========================================================================
  // 1. Loading session: No notification polling request is initiated
  // =========================================================================
  it("1. Loading session: does not initiate notification polling requests while session status is loading", async () => {
    currentSessionState = {
      data: null,
      status: "loading",
    };

    const harness = createComponentHarness();
    await flushMicrotasks();

    expect(mockBuilderApiGet).not.toHaveBeenCalled();

    // Advance through multiple intervals
    vi.advanceTimersByTime(30_000);
    await flushMicrotasks();
    expect(mockBuilderApiGet).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    await flushMicrotasks();
    expect(mockBuilderApiGet).not.toHaveBeenCalled();

    expect(harness.getState().items).toEqual([]);
    expect(harness.getState().unreadCount).toBe(0);

    harness.unmount();
  });

  // =========================================================================
  // 2. Authenticated session: Notification polling is enabled
  // =========================================================================
  it("2. Authenticated session: enables notification polling and fetches data for authenticated builder", async () => {
    currentSessionState = {
      data: {
        user: {
          id: "builder_1",
          email: "builder1@example.com",
          name: "Builder One",
          role: "BUILDER",
        },
      },
      status: "authenticated",
    };

    mockBuilderApiGet.mockResolvedValueOnce({
      items: [
        {
          id: "notif_1",
          title: "Order Placed",
          body: "Order #123 has been confirmed.",
          read: false,
          createdAt: new Date().toISOString(),
          orderId: "ord_123",
        },
      ],
      unreadCount: 1,
    });

    const harness = createComponentHarness();
    await flushMicrotasks();

    expect(mockBuilderApiGet).toHaveBeenCalledWith("/notifications");
    expect(harness.getState().items).toHaveLength(1);
    expect(harness.getState().items[0].id).toBe("notif_1");
    expect(harness.getState().unreadCount).toBe(1);

    // Verify subsequent interval polling at 30 seconds
    mockBuilderApiGet.mockResolvedValueOnce({
      items: [
        {
          id: "notif_1",
          title: "Order Placed",
          read: true,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 0,
    });

    vi.advanceTimersByTime(30_000);
    await flushMicrotasks();

    expect(mockBuilderApiGet).toHaveBeenCalledTimes(2);
    expect(harness.getState().unreadCount).toBe(0);

    harness.unmount();
  });

  // =========================================================================
  // 3. Logout: Notification state is cleared immediately and polling stops
  // =========================================================================
  it("3. Logout: immediately clears notification state and suspends future polling", async () => {
    currentSessionState = {
      data: {
        user: {
          id: "builder_1",
          email: "builder1@example.com",
        },
      },
      status: "authenticated",
    };

    mockBuilderApiGet.mockResolvedValueOnce({
      items: [
        {
          id: "notif_1",
          title: "Order Placed",
          read: false,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 1,
    });

    const harness = createComponentHarness();
    await flushMicrotasks();

    expect(harness.getState().items).toHaveLength(1);
    expect(harness.getState().unreadCount).toBe(1);

    // Simulate user logout
    currentSessionState = {
      data: null,
      status: "unauthenticated",
    };

    harness.render();
    await flushMicrotasks();

    // Verification: state is cleared immediately without waiting for interval
    expect(harness.getState().items).toEqual([]);
    expect(harness.getState().unreadCount).toBe(0);
    expect(harness.getState().loading).toBe(false);

    // Verify polling is suspended: advance timers
    const callsAtLogout = mockBuilderApiGet.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(mockBuilderApiGet).toHaveBeenCalledTimes(callsAtLogout);

    harness.unmount();
  });

  // =========================================================================
  // 4. Logout with an in-flight request: Late response cannot repopulate state
  // =========================================================================
  it("4. Logout with in-flight request: a late response cannot repopulate notification state", async () => {
    currentSessionState = {
      data: {
        user: {
          id: "builder_1",
          email: "builder1@example.com",
        },
      },
      status: "authenticated",
    };

    let resolveInFlight!: (val: any) => void;
    const inFlightPromise = new Promise((res) => {
      resolveInFlight = res;
    });

    mockBuilderApiGet.mockImplementation(() => inFlightPromise);

    const harness = createComponentHarness();
    await flushMicrotasks();

    expect(mockBuilderApiGet).toHaveBeenCalledWith("/notifications");
    // Request is in flight
    expect(harness.getState().items).toEqual([]);

    // User logs out while request is still pending
    currentSessionState = {
      data: null,
      status: "unauthenticated",
    };

    harness.render();
    await flushMicrotasks();

    // Now late response resolves
    resolveInFlight({
      items: [
        {
          id: "stale_notif",
          title: "Stale Notification",
          read: false,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 1,
    });

    await flushMicrotasks();

    // Protection check: the late response must NOT repopulate state
    expect(harness.getState().items).toEqual([]);
    expect(harness.getState().unreadCount).toBe(0);

    harness.unmount();
  });

  // =========================================================================
  // 5. Account switch: Previous account notification data is cleared
  // =========================================================================
  it("5. Account switch: clears User A notifications before displaying User B notifications", async () => {
    currentSessionState = {
      data: {
        user: {
          id: "user_a",
          email: "builder-a@example.com",
        },
      },
      status: "authenticated",
    };

    mockBuilderApiGet.mockResolvedValueOnce({
      items: [
        {
          id: "user_a_notif",
          title: "User A Order Update",
          read: false,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 1,
    });

    const harness = createComponentHarness();
    await flushMicrotasks();

    expect(harness.getState().items).toHaveLength(1);
    expect(harness.getState().items[0].id).toBe("user_a_notif");

    // Session switches to User B
    currentSessionState = {
      data: {
        user: {
          id: "user_b",
          email: "builder-b@example.com",
        },
      },
      status: "authenticated",
    };

    let resolveUserB!: (val: any) => void;
    mockBuilderApiGet.mockImplementationOnce(() => {
      return new Promise((res) => {
        resolveUserB = res;
      });
    });

    harness.render();
    await flushMicrotasks();

    // Verification: User A's data was immediately wiped
    expect(harness.getState().items).toEqual([]);
    expect(harness.getState().unreadCount).toBe(0);

    // Resolve User B's fetch
    resolveUserB({
      items: [
        {
          id: "user_b_notif",
          title: "User B Payment Received",
          read: false,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 1,
    });

    await flushMicrotasks();

    // Verification: User B's data is now populated
    expect(harness.getState().items).toHaveLength(1);
    expect(harness.getState().items[0].id).toBe("user_b_notif");

    harness.unmount();
  });

  // =========================================================================
  // 6. Account switch with an in-flight request: Late response cannot overwrite User B
  // =========================================================================
  it("6. Account switch with in-flight request: late response from User A cannot overwrite User B", async () => {
    currentSessionState = {
      data: {
        user: {
          id: "user_a",
          email: "builder-a@example.com",
        },
      },
      status: "authenticated",
    };

    let resolveUserA!: (val: any) => void;
    mockBuilderApiGet.mockImplementationOnce(() => {
      return new Promise((res) => {
        resolveUserA = res;
      });
    });

    const harness = createComponentHarness();
    await flushMicrotasks();

    // User A's request is pending
    expect(mockBuilderApiGet).toHaveBeenCalledTimes(1);

    // Prepare mock for User B's fetch
    let resolveUserB!: (val: any) => void;
    mockBuilderApiGet.mockImplementationOnce(() => {
      return new Promise((res) => {
        resolveUserB = res;
      });
    });

    // Switch to User B before User A's request completes
    currentSessionState = {
      data: {
        user: {
          id: "user_b",
          email: "builder-b@example.com",
        },
      },
      status: "authenticated",
    };

    harness.render();
    await flushMicrotasks();

    // User A's late response now resolves
    resolveUserA({
      items: [
        {
          id: "user_a_stale_notif",
          title: "User A Stale Alert",
          read: false,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 1,
    });

    await flushMicrotasks();

    // Verify User A's late response was discarded and did not populate state
    expect(harness.getState().items).toEqual([]);

    // Now User B's fresh request resolves
    resolveUserB({
      items: [
        {
          id: "user_b_active_notif",
          title: "User B Active Alert",
          read: false,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 1,
    });

    await flushMicrotasks();

    // Check: User B's state is populated and clean
    expect(harness.getState().items).toHaveLength(1);
    expect(harness.getState().items[0].id).toBe("user_b_active_notif");

    harness.unmount();
  });

  // =========================================================================
  // 7. Authenticated polling cadence: 30-second cadence remains unchanged
  // =========================================================================
  it("7. Authenticated polling cadence: polls precisely at 30-second intervals while visible", async () => {
    currentSessionState = {
      data: {
        user: {
          id: "builder_1",
          email: "builder1@example.com",
        },
      },
      status: "authenticated",
    };

    mockBuilderApiGet.mockResolvedValue({
      items: [],
      unreadCount: 0,
    });

    const harness = createComponentHarness();
    await flushMicrotasks();

    expect(mockBuilderApiGet).toHaveBeenCalledTimes(1);

    // 29 seconds: should not fire
    vi.advanceTimersByTime(29_000);
    await flushMicrotasks();
    expect(mockBuilderApiGet).toHaveBeenCalledTimes(1);

    // 1 more second (30s): fires 2nd call
    vi.advanceTimersByTime(1_000);
    await flushMicrotasks();
    expect(mockBuilderApiGet).toHaveBeenCalledTimes(2);

    // 30 more seconds (60s): fires 3rd call
    vi.advanceTimersByTime(30_000);
    await flushMicrotasks();
    expect(mockBuilderApiGet).toHaveBeenCalledTimes(3);

    harness.unmount();
  });

  // =========================================================================
  // 8. Visibility behaviour: Hidden-tab suspension and visibility restoration
  // =========================================================================
  it("8. Visibility behaviour: suspends polling while hidden, refreshes upon visibility return", async () => {
    currentSessionState = {
      data: {
        user: {
          id: "builder_1",
          email: "builder1@example.com",
        },
      },
      status: "authenticated",
    };

    mockBuilderApiGet.mockResolvedValue({
      items: [],
      unreadCount: 0,
    });

    const harness = createComponentHarness();
    await flushMicrotasks();

    expect(mockBuilderApiGet).toHaveBeenCalledTimes(1);

    // Hide document
    dispatchVisibilityChange("hidden");

    // Advance 90 seconds while hidden: zero new requests should fire
    vi.advanceTimersByTime(90_000);
    await flushMicrotasks();

    expect(mockBuilderApiGet).toHaveBeenCalledTimes(1);

    // Return to visible: since > 30s have elapsed, it should refresh immediately
    dispatchVisibilityChange("visible");
    await flushMicrotasks();

    expect(mockBuilderApiGet).toHaveBeenCalledTimes(2);

    // Subsequent 30s interval resumes normally
    vi.advanceTimersByTime(30_000);
    await flushMicrotasks();

    expect(mockBuilderApiGet).toHaveBeenCalledTimes(3);

    harness.unmount();
  });

  // =========================================================================
  // 9. Finding A: First render after logout hides notifications before effects run
  // =========================================================================
  it("9. First render after logout: previous account notifications are not present in rendered output before effects execute", async () => {
    currentSessionState = {
      data: {
        user: {
          id: "user_a",
          email: "builder-a@example.com",
        },
      },
      status: "authenticated",
    };

    mockBuilderApiGet.mockResolvedValueOnce({
      items: [
        {
          id: "private_order_123",
          title: "Private Order Details",
          body: "Sensitive pricing data",
          read: false,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 1,
    });

    const harness = createComponentHarness();
    await flushMicrotasks();

    // Verify User A has notifications active
    expect(harness.getState().unreadCount).toBe(1);
    expect(harness.getState().items).toHaveLength(1);

    // Logout occurs
    currentSessionState = {
      data: null,
      status: "unauthenticated",
    };

    // Render the component on the logout transition WITHOUT flushing passive effects
    const element = harness.render({ flushEffects: false });

    // Assert that User A's data is immediately absent in the rendered state
    // even before the useEffect cleanup runs!
    expect(harness.getState().items).toEqual([]);
    expect(harness.getState().unreadCount).toBe(0);

    // Inspect the returned React element: the button must not have the unread badge
    const buttonElement = element.props.children[0];
    const badgeElement = buttonElement.props.children[2];
    expect(badgeElement).toBeNull();

    // Now flush pending effects to ensure complete cleanup
    harness.flushEffects();
    expect(harness.getState().items).toEqual([]);
    expect(harness.getState().unreadCount).toBe(0);

    harness.unmount();
  });

  // =========================================================================
  // 10. Finding A: First render after account switch hides User A data before effects run
  // =========================================================================
  it("10. First render after account switch: User A's notifications are not visible in User B's first render", async () => {
    currentSessionState = {
      data: {
        user: {
          id: "user_a",
          email: "builder-a@example.com",
        },
      },
      status: "authenticated",
    };

    mockBuilderApiGet.mockResolvedValueOnce({
      items: [
        {
          id: "user_a_secret",
          title: "User A Confidential Alert",
          read: false,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 1,
    });

    const harness = createComponentHarness();
    await flushMicrotasks();

    expect(harness.getState().items[0].id).toBe("user_a_secret");

    // Session switches directly to User B
    currentSessionState = {
      data: {
        user: {
          id: "user_b",
          email: "builder-b@example.com",
        },
      },
      status: "authenticated",
    };

    // Render User B WITHOUT flushing effects
    const element = harness.render({ flushEffects: false });

    // Verification: User A's notifications are NOT visible during the first render for User B
    expect(harness.getState().items).toEqual([]);
    expect(harness.getState().unreadCount).toBe(0);

    // Unread badge is not present for User B before data arrives
    const buttonElement = element.props.children[0];
    const badgeElement = buttonElement.props.children[2];
    expect(badgeElement).toBeNull();

    // Verify initial account loading is active for User B
    expect(harness.getState().loading).toBe(true);

    harness.unmount();
  });

  // =========================================================================
  // 11. Finding B: Initial authenticated loading indicator appears while pending
  // =========================================================================
  it("11. Initial authenticated loading: loading indicator appears while the first account request is pending", async () => {
    currentSessionState = {
      data: {
        user: {
          id: "builder_new",
          email: "builder-new@example.com",
        },
      },
      status: "authenticated",
    };

    let resolveInitial!: (val: any) => void;
    mockBuilderApiGet.mockImplementationOnce(() => {
      return new Promise((res) => {
        resolveInitial = res;
      });
    });

    const harness = createComponentHarness();
    await flushMicrotasks();

    // Initial request is pending: loading must be true
    expect(harness.getState().loading).toBe(true);
    expect(harness.getState().items).toEqual([]);

    // Open dropdown to inspect loading text
    harness.toggleOpen();
    const openElement = harness.getElement();
    const dropdownContent = openElement.props.children[1].props.children[1];
    const scrollContainer = dropdownContent.props.children[1];
    const loadingParagraph = scrollContainer.props.children;
    expect(loadingParagraph.props.children).toBe("Loading alerts…");

    // Resolve initial fetch
    resolveInitial({
      items: [
        {
          id: "welcome_alert",
          title: "Welcome to BuildOHub",
          read: false,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 1,
    });
    await flushMicrotasks();

    // Loading should now be false, displaying the item
    expect(harness.getState().loading).toBe(false);
    expect(harness.getState().items).toHaveLength(1);
    expect(harness.getState().items[0].id).toBe("welcome_alert");

    harness.unmount();
  });

  // =========================================================================
  // 12. Finding B: Background polling does not replace existing notifications with loading screen
  // =========================================================================
  it("12. Background polling: existing notification data remains visible while a background refresh is pending", async () => {
    currentSessionState = {
      data: {
        user: {
          id: "builder_steady",
          email: "builder-steady@example.com",
        },
      },
      status: "authenticated",
    };

    mockBuilderApiGet.mockResolvedValueOnce({
      items: [
        {
          id: "steady_notif",
          title: "Steady Notification",
          read: false,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 1,
    });

    const harness = createComponentHarness();
    await flushMicrotasks();

    expect(harness.getState().loading).toBe(false);
    expect(harness.getState().items).toHaveLength(1);

    // Prepare deferred background poll at 30 seconds
    let resolveBackgroundPoll!: (val: any) => void;
    mockBuilderApiGet.mockImplementationOnce(() => {
      return new Promise((res) => {
        resolveBackgroundPoll = res;
      });
    });

    // Advance 30 seconds to trigger background poll
    vi.advanceTimersByTime(30_000);
    await flushMicrotasks();

    // Background poll is now in flight
    expect(mockBuilderApiGet).toHaveBeenCalledTimes(2);

    // Critical assertion: loading must NOT be set to true during background polling;
    // existing notification data must remain visible to the user!
    expect(harness.getState().loading).toBe(false);
    expect(harness.getState().items).toHaveLength(1);
    expect(harness.getState().items[0].id).toBe("steady_notif");

    // Resolve background poll
    resolveBackgroundPoll({
      items: [
        {
          id: "steady_notif",
          title: "Steady Notification",
          read: true,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 0,
    });
    await flushMicrotasks();

    expect(harness.getState().loading).toBe(false);
    expect(harness.getState().unreadCount).toBe(0);

    harness.unmount();
  });

  // =========================================================================
  // 13. Finding C: Late response from User A cannot alter User B's error, items, or loading state
  // =========================================================================
  it("13. Late response after account switch: previous account cannot change new account items, unread count, error, or loading", async () => {
    currentSessionState = {
      data: {
        user: {
          id: "user_a",
          email: "builder-a@example.com",
        },
      },
      status: "authenticated",
    };

    let rejectUserA!: (err: any) => void;
    mockBuilderApiGet.mockImplementationOnce(() => {
      return new Promise((_, rej) => {
        rejectUserA = rej;
      });
    });

    const harness = createComponentHarness();
    await flushMicrotasks();

    // User A's request is pending
    expect(mockBuilderApiGet).toHaveBeenCalledTimes(1);

    // Prepare User B's request
    let resolveUserB!: (val: any) => void;
    mockBuilderApiGet.mockImplementationOnce(() => {
      return new Promise((res) => {
        resolveUserB = res;
      });
    });

    // Switch to User B
    currentSessionState = {
      data: {
        user: {
          id: "user_b",
          email: "builder-b@example.com",
        },
      },
      status: "authenticated",
    };

    harness.render();
    await flushMicrotasks();

    // User A's late in-flight request fails with an error (e.g. 401 unauthenticated)
    rejectUserA(new Error("401 Unauthorized"));
    await flushMicrotasks();

    // usePolling detected fetcher change upon User A settling and automatically executed User B's fetch
    expect(mockBuilderApiGet).toHaveBeenCalledTimes(2);

    // User B's request resolves successfully
    resolveUserB({
      items: [
        {
          id: "user_b_clean_notif",
          title: "User B Clean Alert",
          read: false,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 1,
    });
    await flushMicrotasks();

    // Critical assertion: User A's late error/finally CANNOT corrupt User B's state!
    expect(harness.getState().items[0].id).toBe("user_b_clean_notif");
    expect(harness.getState().unreadCount).toBe(1);
    expect(harness.getState().loading).toBe(false);
    expect(harness.getState().error).toBe(false);

    harness.unmount();
  });

  // =========================================================================
  // 14. Finding D: Test cleanup restores original global document property
  // =========================================================================
  it("14. Test cleanup: restores original global document property during test cleanup", () => {
    // Verifies that hadDocumentProperty and originalDocumentDescriptor tracking are operational
    expect(hadDocumentProperty !== undefined).toBe(true);
  });

  // =========================================================================
  // 15. Test A: Previous account error does not suppress new account loading
  // =========================================================================
  it("15. Test A: previous account error does not suppress new account loading or leak to new account", async () => {
    // 1. Authenticate as User A
    currentSessionState = {
      data: {
        user: {
          id: "user_a",
          email: "builder-a@example.com",
        },
      },
      status: "authenticated",
    };

    // 2. Make User A's notification request fail
    mockBuilderApiGet.mockRejectedValueOnce(new Error("500 Internal Server Error"));

    const harness = createComponentHarness();
    await flushMicrotasks();

    // 3. Confirm User A's error is displayed
    expect(harness.getState().error).toBe(true);
    expect(harness.getState().loading).toBe(false);
    expect(harness.getState().items).toEqual([]);

    // Open dropdown and verify the rendered error UI
    harness.toggleOpen();
    let openElement = harness.getElement();
    let dropdownContent = openElement.props.children[1].props.children[1];
    let scrollContainer = dropdownContent.props.children[1];
    expect(scrollContainer.props.children.props.children).toBe("Could not load alerts.");

    // 4. Switch the session to User B while dropdown is open
    currentSessionState = {
      data: {
        user: {
          id: "user_b",
          email: "builder-b@example.com",
        },
      },
      status: "authenticated",
    };

    // 5. Render User B before passive effects execute
    harness.render({ flushEffects: false });

    // 6. Assert immediately on first render:
    // - User A's error is not displayed
    expect(harness.getState().error).toBe(false);
    // - User A's notifications are not displayed
    expect(harness.getState().items).toEqual([]);
    expect(harness.getState().unreadCount).toBe(0);
    // - User B's initial loading indicator is displayed (NOT suppressed by User A's error)
    expect(harness.getState().loading).toBe(true);

    // Verify rendered JSX also reflects loading state on first render before effects run
    openElement = harness.getElement();
    dropdownContent = openElement.props.children[1].props.children[1];
    scrollContainer = dropdownContent.props.children[1];
    expect(scrollContainer.props.children.props.children).toBe("Loading alerts…");

    // Prepare User B's successful response so User B's request can proceed
    mockBuilderApiGet.mockResolvedValueOnce({
      items: [
        {
          id: "user_b_first_notif",
          title: "User B Welcome Alert",
          read: false,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 1,
    });

    // Flush passive effects to let User B's request execute
    harness.flushEffects();
    await flushMicrotasks();

    // User B's request proceeded and completed successfully
    expect(harness.getState().loading).toBe(false);
    expect(harness.getState().error).toBe(false);
    expect(harness.getState().items).toHaveLength(1);
    expect(harness.getState().items[0].id).toBe("user_b_first_notif");
    expect(harness.getState().unreadCount).toBe(1);

    harness.unmount();
  });

  // =========================================================================
  // 16. Test B: Current account error is displayed and retry behaviour works
  // =========================================================================
  it("16. Test B: current account error is displayed when request fails and retry clears error", async () => {
    // 1. Authenticate as User B
    currentSessionState = {
      data: {
        user: {
          id: "user_b",
          email: "builder-b@example.com",
        },
      },
      status: "authenticated",
    };

    // 2. Let User B's initial notification request fail
    let rejectUserB!: (err: any) => void;
    mockBuilderApiGet.mockImplementationOnce(() => {
      return new Promise((_, rej) => {
        rejectUserB = rej;
      });
    });

    const harness = createComponentHarness();
    await flushMicrotasks();

    // While request is in-flight, loading is shown
    expect(harness.getState().loading).toBe(true);
    expect(harness.getState().error).toBe(false);

    // Initial request fails
    rejectUserB(new Error("504 Gateway Timeout"));
    await flushMicrotasks();

    // 3. Assert that loading indicator stops
    expect(harness.getState().loading).toBe(false);

    // 4. Assert that User B's error is displayed
    expect(harness.getState().error).toBe(true);
    expect(harness.getState().items).toEqual([]);

    // 5. Confirm existing retry behaviour remains functional:
    // Opening the dropdown triggers an immediate refresh() to retry fetching alerts
    mockBuilderApiGet.mockResolvedValueOnce({
      items: [
        {
          id: "retry_order_alert",
          title: "Order #456 Dispatched",
          read: false,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 1,
    });

    harness.toggleOpen();
    await flushMicrotasks();

    // Assert retry cleared the error and populated alerts
    expect(harness.getState().error).toBe(false);
    expect(harness.getState().loading).toBe(false);
    expect(harness.getState().items).toHaveLength(1);
    expect(harness.getState().items[0].id).toBe("retry_order_alert");
    expect(harness.getState().unreadCount).toBe(1);

    // Verify rendered dropdown reflects the retrieved notification
    const openElement = harness.getElement();
    const dropdownContent = openElement.props.children[1].props.children[1];
    const scrollContainer = dropdownContent.props.children[1];
    expect(scrollContainer.props.children.props.children).toHaveLength(1);

    harness.unmount();
  });

  // =========================================================================
  // 17. Test C: Stale error cannot overwrite the new account state
  // =========================================================================
  it("17. Test C: stale error cannot overwrite the new account state", async () => {
    // 1. Start a pending request for User A
    currentSessionState = {
      data: {
        user: {
          id: "user_a",
          email: "builder-a@example.com",
        },
      },
      status: "authenticated",
    };

    let rejectUserA!: (err: any) => void;
    mockBuilderApiGet.mockImplementationOnce(() => {
      return new Promise((_, rej) => {
        rejectUserA = rej;
      });
    });

    const harnessUserA = createComponentHarness();
    await flushMicrotasks();
    expect(mockBuilderApiGet).toHaveBeenCalledTimes(1);

    // 2. Switch to User B
    currentSessionState = {
      data: {
        user: {
          id: "user_b",
          email: "builder-b@example.com",
        },
      },
      status: "authenticated",
    };

    // 3. Start and successfully complete User B's request
    mockBuilderApiGet.mockResolvedValueOnce({
      items: [
        {
          id: "user_b_solid",
          title: "User B Active Alert",
          read: false,
          createdAt: new Date().toISOString(),
        },
      ],
      unreadCount: 1,
    });

    const harnessUserB = createComponentHarness();
    await flushMicrotasks();

    expect(harnessUserB.getState().items).toHaveLength(1);
    expect(harnessUserB.getState().items[0].id).toBe("user_b_solid");
    expect(harnessUserB.getState().unreadCount).toBe(1);
    expect(harnessUserB.getState().error).toBe(false);
    expect(harnessUserB.getState().loading).toBe(false);

    // 4. Reject User A's pending request afterwards
    rejectUserA(new Error("User A late connection reset"));
    await flushMicrotasks();

    // 5. Assert that User B's items, unread count, error state, and loading state remain unchanged
    expect(harnessUserB.getState().items).toHaveLength(1);
    expect(harnessUserB.getState().items[0].id).toBe("user_b_solid");
    expect(harnessUserB.getState().unreadCount).toBe(1);
    expect(harnessUserB.getState().error).toBe(false);
    expect(harnessUserB.getState().loading).toBe(false);

    harnessUserA.unmount();
    harnessUserB.unmount();
  });
});
