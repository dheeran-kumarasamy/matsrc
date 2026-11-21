import { CatalogMasterDataManager } from "@/components/admin/CatalogMasterDataManager";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";

export type CatalogItem = {
  id: string;
  name: string;
  slug?: string | null;
  code?: string | null;
  isActive: boolean;
  isOrderable?: boolean;
};

export type CatalogProduct = {
  id: string;
  name: string;
  slug: string;
  categoryId: string;
  category: { id: string; name: string };
  supplierId: string;
  supplier: { id: string; companyName: string };
  basePrice: number | string;
  stock: number;
  unit: string;
  isActive: boolean;
  isOrderable: boolean;
};

export type OrderSplittingConfig = {
  id: string;
  allowMultiSupplierSplitting: boolean;
  splitOnlyAcrossCategories: boolean;
  updatedAt?: string;
  updatedBy?: string | null;
};

export default async function CatalogPage() {
  await requireMenu("catalog");

  const [category, brand, grade, unit, products, orderSplittingConfig] = await Promise.all([
    adminApiGet<CatalogItem[]>("/admin/catalog/category").catch(() => []),
    adminApiGet<CatalogItem[]>("/admin/catalog/brand").catch(() => []),
    adminApiGet<CatalogItem[]>("/admin/catalog/grade").catch(() => []),
    adminApiGet<CatalogItem[]>("/admin/catalog/unit").catch(() => []),
    adminApiGet<CatalogProduct[]>("/admin/catalog/products").catch(() => []),
    adminApiGet<OrderSplittingConfig>("/admin/catalog/order-splitting-config").catch(() => null),
  ]);

  return (
    <CatalogMasterDataManager
      initialData={{ category, brand, grade, unit }}
      initialProducts={products}
      initialOrderSplittingConfig={orderSplittingConfig}
    />
  );
}
