"use client";

import { Boxes } from "lucide-react";

import type { ProductMatchView } from "./types";

// "Products found" card in the §15 conversation rail.
//
// When the assistant could not confidently match the request, `alternatives` are
// shown under an explicitly tentative heading — the §24 "I found 10mm and 16mm
// options" behaviour. A near-miss is never presented as if it were the requested
// product.

type Props = {
  matches: ProductMatchView[];
  alternatives: ProductMatchView[];
};

function ProductRow({ product }: { product: ProductMatchView }) {
  const details = [product.brand, product.grade, product.unit].filter(Boolean).join(" · ");

  return (
    <li className="flex items-baseline justify-between gap-3 py-1.5">
      <div>
        <p className="text-sm text-slate-800">{product.name}</p>
        {details && <p className="text-xs text-slate-500">{details}</p>}
      </div>
      <span className="shrink-0 text-xs text-slate-400">{product.category}</span>
    </li>
  );
}

export default function ProductMatchCard({ matches, alternatives }: Props) {
  if (matches.length === 0 && alternatives.length === 0) return null;

  return (
    <section className="panel p-4">
      <header className="mb-2 flex items-center gap-2">
        <Boxes className="h-4 w-4 text-blue-600" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-slate-800">
          {matches.length > 0 ? "Products found" : "Closest products in the catalogue"}
        </h2>
      </header>

      {matches.length > 0 ? (
        <ul className="divide-y divide-slate-100">
          {matches.slice(0, 6).map((product) => (
            <ProductRow key={product.productId} product={product} />
          ))}
        </ul>
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-500">
            These are not exact matches for what you asked for — tell me if one of them works.
          </p>
          <ul className="divide-y divide-slate-100">
            {alternatives.slice(0, 6).map((product) => (
              <ProductRow key={product.productId} product={product} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
