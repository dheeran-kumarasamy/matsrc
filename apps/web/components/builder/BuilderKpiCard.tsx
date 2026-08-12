import Link from "next/link";

type BuilderKpiCardProps = {
  label: string;
  value: string;
  hint: string;
  href?: string;
};

// KPI card — refined with Instrument Serif large value and amber accent label.
export function BuilderKpiCard({ label, value, hint, href }: BuilderKpiCardProps) {
  const content = (
    <article className="panel p-5 hover:shadow-md transition-shadow group">
      <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-400">{label}</p>
      <p
        className="mt-2 text-4xl font-normal tracking-tight"
        style={{ fontFamily: "'Instrument Serif', Georgia, serif", color: "#1a4f8a" }}
      >
        {value}
      </p>
      <p className="mt-1.5 text-sm text-slate-500">{hint}</p>
    </article>
  );

  return href ? <Link href={href} className="block">{content}</Link> : content;
}

