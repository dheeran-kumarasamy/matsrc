"use client";

import { useEffect, useMemo, useState } from "react";
import { useLoadingStore } from "@/lib/store/loading-store";

type LoadingScreen = {
  title: string;
  quote: string;
  line: string;
  accent: string;
};

const SCREENS: LoadingScreen[] = [
  {
    title: "Structural Wisdom",
    quote: "Good buildings come from good people, and all problems are solved by good design.",
    line: "Stephen Gardiner",
    accent: "from-blue-700 to-cyan-600",
  },
  {
    title: "Material Truth",
    quote: "The bitterness of poor quality remains long after the sweetness of low price is forgotten.",
    line: "Benjamin Franklin",
    accent: "from-slate-700 to-slate-500",
  },
  {
    title: "Craft First",
    quote: "Quality means doing it right when no one is looking.",
    line: "Henry Ford",
    accent: "from-emerald-700 to-teal-600",
  },
  {
    title: "Design For Use",
    quote: "Form follows function.",
    line: "Louis Sullivan",
    accent: "from-indigo-700 to-blue-600",
  },
  {
    title: "Durability Matters",
    quote: "We shape our buildings; thereafter they shape us.",
    line: "Winston Churchill",
    accent: "from-orange-700 to-amber-600",
  },
  {
    title: "Build With Care",
    quote: "Excellence is in the details. Give attention to the details and excellence will come.",
    line: "Perry Paxton",
    accent: "from-rose-700 to-pink-600",
  },
  {
    title: "Foundation Thinking",
    quote: "A great building must begin with the unmeasurable, must go through measurable means when it is being designed and in the end must be unmeasurable.",
    line: "Louis Kahn",
    accent: "from-violet-700 to-fuchsia-600",
  },
  {
    title: "Site Discipline",
    quote: "Plans are only good intentions unless they immediately degenerate into hard work.",
    line: "Peter Drucker",
    accent: "from-cyan-700 to-sky-600",
  },
  {
    title: "Supply Confidence",
    quote: "The strength of the team is each individual member. The strength of each member is the team.",
    line: "Phil Jackson",
    accent: "from-lime-700 to-green-600",
  },
  {
    title: "On-Time Delivery",
    quote: "Productivity is never an accident. It is always the result of a commitment to excellence, intelligent planning, and focused effort.",
    line: "Paul J. Meyer",
    accent: "from-red-700 to-orange-600",
  },
];

/**
 * App-wide "pause the user" loading overlay. Driven by lib/store/loading-store.ts
 * so that ANY client-side async action — data fetches (lib/api.ts), route
 * transitions (NavigationLoadingListener) — can show/hide it, unlike the
 * Suspense-only app/loading.tsx which never fires for client useEffect fetches.
 *
 * Renders as a small centered card (roughly 20% of the viewport) over a
 * transparent, click-blocking backdrop — NOT a full-bleed page — so the
 * rest of the UI stays visible behind it while interaction is paused.
 */
export default function GlobalLoadingOverlay() {
  const isLoading = useLoadingStore((state) => state.isLoading);
  const [visible, setVisible] = useState(false);
  const [screenIndex, setScreenIndex] = useState(0);

  useEffect(() => {
    if (!isLoading) {
      setVisible(false);
      return;
    }

    setScreenIndex(Math.floor(Math.random() * SCREENS.length));

    // Small delay avoids flashing the overlay for near-instant fetches.
    const delayedShowTimer = window.setTimeout(() => {
      setVisible(true);
    }, 250);

    return () => {
      window.clearTimeout(delayedShowTimer);
    };
  }, [isLoading]);

  useEffect(() => {
    if (!visible) return;

    const rotateTimer = window.setInterval(() => {
      setScreenIndex((prev) => (prev + 1) % SCREENS.length);
    }, 5000);

    return () => window.clearInterval(rotateTimer);
  }, [visible]);

  const screen = useMemo(() => SCREENS[screenIndex], [screenIndex]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/20 pointer-events-auto"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="w-[min(90vw,22rem)] rounded-2xl border border-white/20 bg-white/95 p-5 shadow-2xl backdrop-blur-md">
        <div className={`-m-5 mb-4 rounded-t-2xl bg-gradient-to-br ${screen.accent} p-4 text-white`}>
          <p className="text-[10px] uppercase tracking-[0.25em] text-white/80">BuildMart Loading</p>
          <h1 className="mt-1 text-base font-bold leading-tight">{screen.title}</h1>
        </div>

        <p className="text-sm leading-relaxed text-slate-700">"{screen.quote}"</p>
        <p className="mt-1 text-xs font-semibold text-slate-500">{screen.line}</p>

        <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
          <span>Actions are paused until loading completes.</span>
        </div>

        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full w-1/3 rounded-full bg-gradient-to-r ${screen.accent} animate-[loadingBar_2s_ease-in-out_infinite]`}
          />
        </div>
      </div>

      <style jsx>{`
        @keyframes loadingBar {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(350%);
          }
        }
      `}</style>
    </div>
  );
}
