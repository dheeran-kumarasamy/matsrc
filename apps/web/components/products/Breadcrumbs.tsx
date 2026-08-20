import Link from "next/link";
import type { Breadcrumb } from "@/lib/breadcrumbs";

// P2-C — shared, semantic breadcrumb navigation used across the product
// area (catalogue, category-filtered catalogue, PDP, price report). Derives
// its content entirely from lib/breadcrumbs.ts (the single source of truth
// also used to generate BreadcrumbList JSON-LD — see lib/json-ld.ts), never
// a second hardcoded hierarchy.
//
// Semantic/accessible markup: a <nav aria-label="Breadcrumb"> containing an
// ordered list, with the current page marked aria-current="page" and not a
// link. Separators are decorative (aria-hidden) so screen readers don't read
// stray "/" characters as content.
export default function Breadcrumbs({ items }: { items: Breadcrumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-slate-400">
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-2">
              {index > 0 ? (
                <span aria-hidden="true" className="text-slate-300">
                  /
                </span>
              ) : null}
              {item.href && !isLast ? (
                <Link href={item.href} className="hover:text-[color:var(--posh-primary)] hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={isLast ? "page" : undefined} className={isLast ? "text-slate-600" : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
