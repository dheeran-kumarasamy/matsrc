import Link from "next/link";

type BuilderKpiCardProps = {
  label: string;
  value: string;
  hint: string;
  href?: string;
};

// KPI card — bold Inter value in the deep charcoal brand ink, orange-accent
// eyebrow label, soft shadow surface (industrial redesign).
export function BuilderKpiCard({ label, value, hint, href }: BuilderKpiCardProps) {
  const content = (
    <article className="panel p-5 hover:shadow-md transition-shadow group">
      <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-400">{label}</p>
      <p
        className="mt-2 text-4xl font-extrabold tracking-tight"
        style={{ color: "#1e293b" }}
      >
        {value}
      </p>
      <p className="mt-1.5 text-sm text-slate-500">{hint}</p>
    </article>
  );

  return href ? <Link href={href} className="block">{content}</Link> : content;
}

