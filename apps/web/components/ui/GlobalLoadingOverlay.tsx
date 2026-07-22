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

  useEffect(() => {
    if (!visible) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [visible]);

  const screen = useMemo(() => SCREENS[screenIndex], [screenIndex]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-auto">
      <div className={`absolute inset-0 bg-gradient-to-br ${screen.accent}`} />
      <div className="absolute inset-0 bg-black/20" />
      <div className="relative flex h-full items-center justify-center p-6 text-white">
        <div className="w-full max-w-3xl rounded-3xl border border-white/20 bg-white/10 p-8 backdrop-blur-md">
          <p className="text-xs uppercase tracking-[0.3em] text-white/80">BuildMart Loading</p>
          <h1 className="mt-3 text-3xl font-extrabold leading-tight">{screen.title}</h1>
          <p className="mt-5 text-lg leading-relaxed text-white/95">"{screen.quote}"</p>
          <p className="mt-2 text-sm font-semibold text-white/80">{screen.line}</p>

          <div className="mt-7 flex items-center gap-3 text-sm text-white/85">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            <span>Preparing your workspace. Actions are paused until loading completes.</span>
          </div>

          <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-white/20">
            <div className="h-full w-1/3 animate-[loadingBar_2s_ease-in-out_infinite] rounded-full bg-white" />
          </div>
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
