import Link from "next/link";

type BuilderKpiCardProps = {
  label: string;
  value: string;
  hint: string;
  href?: string;
};

export function BuilderKpiCard({ label, value, hint, href }: BuilderKpiCardProps) {
  const content = (
    <article className="panel p-4 hover:shadow-md transition-shadow">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-extrabold text-slate-900">{value}</p>
      <p className="mt-1 text-sm text-slate-600">{hint}</p>
    </article>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}
