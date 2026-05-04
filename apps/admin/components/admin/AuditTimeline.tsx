type AuditEvent = {
  id: string;
  actor: string;
  action: string;
  target: string;
  time: string;
};

export function AuditTimeline({ events }: { events: AuditEvent[] }) {
  return (
    <section className="panel p-4">
      <h3 className="text-lg font-bold text-slate-950">Audit Trail</h3>
      <div className="mt-4 space-y-4">
        {events.map((event) => (
          <div key={event.id} className="flex gap-3">
            <div className="mt-1 h-3 w-3 rounded-full bg-slate-900" />
            <div>
              <p className="text-sm font-semibold text-slate-900">{event.actor} {event.action}</p>
              <p className="text-sm text-slate-600">{event.target}</p>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{event.time}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}