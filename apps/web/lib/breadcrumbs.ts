// breadcrumbs.ts — P2-C (Breadcrumbs) + P2-D (Breadcrumb JSON-LD).
//
// Single, pure source of truth for the product-area breadcrumb hierarchy —
// reused verbatim by the shared <Breadcrumbs> UI component and by the
// BreadcrumbList JSON-LD generator, so the two never drift apart into two
// competing hardcoded hierarchies (an explicit P2-C requirement).
//
// Every crumb here is derived from real data the caller already has (real
// category/product names, real canonical routes) — this module never
// invents a category or a route.

export type Breadcrumb = {
  label: string;
  /** Absolute path, e.g. "/products?category=Cement". Omitted (null) for the current page, which is not a link. */
  href: string | null;
};

const HOME: Breadcrumb = { label: "Home", href: "/" };
const MATERIALS: Breadcrumb = { label: "Materials", href: "/products" };

/** Home → Materials (the catalogue root). */
export function catalogueBreadcrumbs(): Breadcrumb[] {
  return [HOME, { ...MATERIALS, href: null }];
}

/** Home → Materials → <Category> (the current, filtered catalogue page). */
export function categoryBreadcrumbs(categoryName: string): Breadcrumb[] {
  return [
    HOME,
    MATERIALS,
    { label: categoryName, href: null },
  ];
}

// Shared base: Home → Materials → <Category>?, used by both
// productBreadcrumbs() and productReportBreadcrumbs() so the category crumb
// is defined in exactly one place.
function catalogueAndCategoryBase(categoryName: string | null): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [HOME, MATERIALS];
  if (categoryName) {
    crumbs.push({
      label: categoryName,
      href: `/products?category=${encodeURIComponent(categoryName)}`,
    });
  }
  return crumbs;
}

/**
 * Home → Materials → <Category> → <Product>. `categoryName` is null when the
 * product genuinely has no category (never invented) — the crumb is simply
 * omitted rather than fabricated.
 */
export function productBreadcrumbs(params: {
  categoryName: string | null;
  productName: string;
}): Breadcrumb[] {
  return [...catalogueAndCategoryBase(params.categoryName), { label: params.productName, href: null }];
}

/**
 * Home → Materials → <Category> → <Product> → Price Report. Reuses the same
 * catalogue/category base as productBreadcrumbs() — never a second
 * hierarchy definition — and adds the product as a real link (since Report
 * is now the current/leaf page) followed by the Report leaf itself.
 */
export function productReportBreadcrumbs(params: {
  categoryName: string | null;
  productName: string;
  productSlug: string;
}): Breadcrumb[] {
  return [
    ...catalogueAndCategoryBase(params.categoryName),
    { label: params.productName, href: `/products/${params.productSlug}` },
    { label: "Price Report", href: null },
  ];
}
