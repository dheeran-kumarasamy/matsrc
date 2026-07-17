// Notifications entry point (REQ-04). No wired data source/unread-count
// exists yet on the Builder side (only supplier-facing WhatsApp notification
// writes were found in apps/web/lib/notify.ts and the NestJS
// notifications module). This is a stub landing page with a TODO to wire up
// real notification listing/read-state once a Builder-facing notifications
// API is available.
export default function NotificationsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Notifications</h1>
      <div className="panel p-10 text-center">
        <p className="text-sm text-slate-500">
          You&apos;re all caught up.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {/* TODO: Wire this page to a real Builder-facing notifications API
              (unread count + list) once available. Currently only
              supplier-facing notifications exist in the backend. */}
          In-app notification history isn&apos;t available yet — you&apos;ll continue to receive updates via WhatsApp.
        </p>
      </div>
    </div>
  );
}
