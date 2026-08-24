import { FileBarChart } from "lucide-react";

import BuildOHubLogo from "@/components/shared/BuildOHubLogo";
import HeaderSearchForm from "@/components/shared/HeaderSearchForm";
import CartLauncher from "@/components/cart/CartLauncher";
import NotificationBell from "@/components/builder/NotificationBell";
import HeaderIconLink from "@/components/builder/HeaderIconLink";
import ProfileMenu from "@/components/shared/ProfileMenu";

// Single top-navigation reference implementation, standardized on the
// visual layout/spacing previously bespoke to /newdashboard: a search bar
// that grows to fill available space, followed by Cart -> Alerts ->
// Reports -> Profile, in that fixed order, at the far right.
//
// This is now the ONE place that composes those five controls. Every page
// that shows the main application top navigation renders THIS component
// (see app/(builder)/layout.tsx and app/(newdash)/newdashboard/page.tsx)
// instead of hand-rolling its own header markup, so there is a single
// source of truth — no risk of Products/Orders/Sourcing/Cart/Reports/
// Alerts ever drifting out of sync with each other or with /newdashboard.
//
// `leftAccessory` lets callers slot in layout-specific left-hand controls
// (e.g. the builder portal's mobile sidebar trigger) without forking the
// shared search/action-row markup. `showLogo` is for route groups with no
// persistent sidebar (e.g. /newdashboard) where the wordmark must live in
// the header itself rather than a sidebar brand block.
export default function AppHeader({
  className = "",
  leftAccessory,
  showLogo = false,
}: {
  className?: string;
  leftAccessory?: React.ReactNode;
  showLogo?: boolean;
}) {
  return (
    <header className={className}>
      {leftAccessory}
      {showLogo ? (
        <div className="flex shrink-0 items-center gap-3">
          <BuildOHubLogo size="lg" />
        </div>
      ) : null}

      <HeaderSearchForm />

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <CartLauncher />
        {/* Alerts: overlay dropdown from the bell icon (not a separate
            page) — see NotificationBell.tsx. Every order status change
            already creates a Notification row via apps/api's
            NotificationService; this surfaces them here with an unread
            badge + read/unread markers inside the dropdown. */}
        <NotificationBell />
        {/* "Reports" entry point: opens the Reports catalogue overlay
            (Material Consumption, Best Supplier Pricing, etc). */}
        <HeaderIconLink href="/reports" label="Reports" icon={FileBarChart} ariaLabel="View reports" />
        <ProfileMenu />
      </div>
    </header>
  );
}
