import { GstSettingsManager } from "@/components/admin/GstSettingsManager";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";

type GstListResponse = {
  global: { id: string; percentage: number; isEnabled: boolean; updatedAt: string } | null;
  categoryOverrides: Array<{
    id: string;
    categoryId: string;
    categoryName: string;
    percentage: number;
    isEnabled: boolean;
    updatedAt: string;
  }>;
  productOverrides: Array<{
    id: string;
    productId: string;
    productName: string;
    percentage: number;
    isEnabled: boolean;
    updatedAt: string;
  }>;
};

type AdvanceConfigResponse = { id: string; percentage: number; isEnabled: boolean; updatedAt: string } | null;

type CatalogItem = { id: string; name: string };

// Product-Level GST / Advance Configuration — admin settings screen.
// Follows the existing Product Markup page's exact server/client split
// convention (see app/(admin)/markup/page.tsx): server component fetches
// initial data via the admin-only /admin/gst API, client component
// (GstSettingsManager) owns the interactive create/update/delete flows and
// the product tax-coverage worklist.
export default async function GstSettingsPage() {
  await requireMenu("gst");

  const [gst, advanceConfig, categories] = await Promise.all([
    adminApiGet<GstListResponse>("/admin/gst").catch(() => ({
      global: null,
      categoryOverrides: [],
      productOverrides: [],
    })),
    adminApiGet<AdvanceConfigResponse>("/admin/gst/advance-config").catch(() => null),
    adminApiGet<CatalogItem[]>("/admin/catalog/category").catch(() => []),
  ]);

  return <GstSettingsManager initialData={gst} initialAdvanceConfig={advanceConfig} categories={categories} />;
}
