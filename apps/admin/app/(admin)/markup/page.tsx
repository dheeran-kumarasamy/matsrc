import { MarkupSettingsManager } from "@/components/admin/MarkupSettingsManager";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";

type MarkupListResponse = {
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

type CatalogItem = { id: string; name: string };

// Admin-Configurable Product Markup — admin settings screen. Follows the
// existing Catalog Master Data page's exact server/client split convention
// (see app/(admin)/catalog/page.tsx): server component fetches initial
// data via the admin-only /admin/markup API, client component
// (MarkupSettingsManager) owns the interactive create/update/delete flows.
export default async function MarkupPage() {
  await requireMenu("markup");

  const [markup, categories] = await Promise.all([
    adminApiGet<MarkupListResponse>("/admin/markup").catch(() => ({
      global: null,
      categoryOverrides: [],
      productOverrides: [],
    })),
    adminApiGet<CatalogItem[]>("/admin/catalog/category").catch(() => []),
  ]);

  return <MarkupSettingsManager initialData={markup} categories={categories} />;
}
