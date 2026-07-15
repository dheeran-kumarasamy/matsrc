import { CatalogMasterDataManager } from "@/components/admin/CatalogMasterDataManager";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";

type CatalogItem = {
  id: string;
  name: string;
  slug?: string | null;
  code?: string | null;
  isActive: boolean;
};

export default async function CatalogPage() {
  await requireMenu("catalog");

  const [category, brand, grade, unit] = await Promise.all([
    adminApiGet<CatalogItem[]>("/admin/catalog/category").catch(() => []),
    adminApiGet<CatalogItem[]>("/admin/catalog/brand").catch(() => []),
    adminApiGet<CatalogItem[]>("/admin/catalog/grade").catch(() => []),
    adminApiGet<CatalogItem[]>("/admin/catalog/unit").catch(() => []),
  ]);

  return (
    <CatalogMasterDataManager
      initialData={{ category, brand, grade, unit }}
    />
  );
}
