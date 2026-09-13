import Link from "next/link";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";
import { ScrapedPricesTable } from "@/components/admin/pricing/ScrapedPricesTable";
import type { PricingScrapedPricesResponse } from "@/lib/pricing-admin-types";

type SearchParams = {
  search?: string;
  districtId?: string;
  fromDate?: string;
  toDate?: string;
  page?: string;
};

function toQueryString(params: SearchParams & { page?: string }) {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.districtId) qs.set("districtId", params.districtId);
  if (params.fromDate) qs.set("fromDate", params.fromDate);
  if (params.toDate) qs.set("toDate", params.toDate);
  if (params.page) qs.set("page", params.page);
  return qs.toString();
}

/**
 * Scraped Prices — lists the normalized, rolled-up scraped price per
 * product (PricingCanonicalSku) from PricingDistrictPriceDaily, the same
 * serving-layer table the public pricing endpoints and the AI Sourcing
 * Assistant's price intelligence already read from. Deliberately NOT the
 * raw PricingRawObservation/PricingObservation rows — see
 * PricingAdminOpsService.listScrapedPrices()'s doc comment for why.
 *
 * This did not exist anywhere in the existing admin Price Intelligence
 * surface: CanonicalSkuManagementPanel only showed aggregate stats
 * (observation count, last seen date, coverage), and CoverageMatrixPanel
 * only showed a district×category coverage state grid — neither exposes
 * the actual scraped price value per product/day.
 */
export default async function ScrapedPricesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireMenu("pricing");

  const query = toQueryString(searchParams);
  const response = await adminApiGet<PricingScrapedPricesResponse>(
    `/admin/pricing/scraped-prices${query ? `?${query}` : ""}`
  ).catch(() => ({ rows: [], total: 0, page: 1, pageSize: 50 }) as PricingScrapedPricesResponse);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/pricing" className="text-xs font-semibold text-slate-500 hover:text-slate-800">
            ← Back to Price Intelligence
          </Link>
          <h3 className="mt-1 text-xl font-extrabold text-slate-950">Scraped Prices</h3>
          <p className="mt-1 text-sm text-slate-600">
            Normalized daily prices per product, as computed by the pricing rollup pipeline from scraped
            observations. One row per product × geography × day.
          </p>
        </div>
      </div>

      <ScrapedPricesTable initial={response} searchParams={searchParams} />
    </div>
  );
}
