import SourcingAssistant from "@/components/sourcing/SourcingAssistant";

// AI Sourcing Assistant entry point in the builder portal.
//
// Route is protected by middleware.ts (/sourcing is in PROTECTED_PREFIXES) and
// renders inside the existing (builder) layout, so it inherits the portal nav,
// header, cart drawer and design language — not a separate chat app.
//
// The heavy lifting is a client component because the flow is interactive; all
// data access and every AI call happen server-side behind
// /api/builder/sourcing/*, so no API key is ever exposed to the browser.

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI Sourcing Assistant",
  description:
    "Tell us what material you need. Our AI Sourcing Assistant will help you find the best sourcing option.",
};

export default function SourcingPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-slate-900">AI Sourcing Assistant</h1>
        <p className="text-sm text-slate-500">
          Tell us what material you need. Our AI Sourcing Assistant will help you find the best
          sourcing option.
        </p>
      </header>

      <SourcingAssistant />
    </div>
  );
}
