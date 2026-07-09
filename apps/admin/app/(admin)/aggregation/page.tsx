import { AggregationPoolsBoard, type AdminAggregationPool } from "@/components/admin/AggregationPoolsBoard";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";

type BackendPool = {
  id: string;
  supplierId: string;
  supplierName: string;
  productId: string;
  productName: string;
  zoneKey: string;
  status: "OPEN" | "LOCKED" | "FULFILLING" | "CLOSED" | "CANCELLED";
  currentQuantity: number;
  participantCount: number;
  currentUnitPrice: number;
  lockedUnitPrice: number | null;
  deliveryWindowStart: string;
  deliveryWindowEnd: string;
  windowCloseAt: string;
  lockedAt: string | null;
};

export default async function AggregationPoolsPage() {
  await requireMenu("aggregation");

  const poolsRaw = await adminApiGet<BackendPool[]>("/admin/aggregation/pools").catch(() => []);

  const pools: AdminAggregationPool[] = poolsRaw.map((pool) => ({
    id: pool.id,
    supplierId: pool.supplierId,
    supplierName: pool.supplierName,
    productId: pool.productId,
    productName: pool.productName,
    zoneKey: pool.zoneKey,
    status: pool.status,
    currentQuantity: pool.currentQuantity,
    participantCount: pool.participantCount,
    currentUnitPrice: pool.currentUnitPrice,
    lockedUnitPrice: pool.lockedUnitPrice,
    deliveryWindowStart: pool.deliveryWindowStart,
    deliveryWindowEnd: pool.deliveryWindowEnd,
    windowCloseAt: pool.windowCloseAt,
    lockedAt: pool.lockedAt,
  }));

  return <AggregationPoolsBoard pools={pools} />;
}
