import { redirect } from "next/navigation";

// Alerts are now surfaced exclusively via the bell-icon overlay dropdown
// (see components/builder/NotificationBell.tsx) mounted in the (builder)
// layout header, rather than a separate full page. Redirect any stray
// deep-links to /notifications back to the dashboard.
export default function NotificationsPage() {
  redirect("/dashboard");
}
