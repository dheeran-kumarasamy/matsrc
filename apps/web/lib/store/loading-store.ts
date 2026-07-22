import { create } from "zustand";

// Global "pause the user" loading indicator. Unlike Next.js's Suspense-driven
// app/loading.tsx (which only triggers for async Server Component boundaries),
// this store can be toggled from anywhere — client-side data fetches
// (see lib/api.ts), route transitions (see NavigationLoadingListener), and
// any async action that should visibly block interaction until it settles.

interface LoadingState {
  activeCount: number;
  isLoading: boolean;
  startLoading: () => void;
  stopLoading: () => void;
}

export const useLoadingStore = create<LoadingState>((set, get) => ({
  activeCount: 0,
  isLoading: false,
  startLoading: () => {
    const next = get().activeCount + 1;
    set({ activeCount: next, isLoading: true });
  },
  stopLoading: () => {
    const next = Math.max(0, get().activeCount - 1);
    set({ activeCount: next, isLoading: next > 0 });
  },
}));
