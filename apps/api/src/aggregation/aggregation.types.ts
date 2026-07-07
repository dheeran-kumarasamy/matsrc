import { AggregationParticipantStatus, AggregationPoolStatus } from "@matsrc/db";

export type PriceTier = {
  minQty: number;
  unitPrice: number;
};

export type FindOrCreatePoolParams = {
  supplierId: string;
  productId: string;
  zoneKey: string;
  /** Requested delivery date from the builder — used to bucket into the supplier's rolling window. */
  requestedDeliveryDate: Date;
};

export type AddParticipantParams = {
  poolId: string;
  builderId: string;
  quantity: number;
};

export type PoolSummary = {
  id: string;
  supplierId: string;
  productId: string;
  zoneKey: string;
  status: AggregationPoolStatus;
  currentQuantity: number;
  priceTiers: PriceTier[];
  lockedUnitPrice: number | null;
  currentUnitPrice: number;
  nextTier: PriceTier | null;
  deliveryWindowStart: Date;
  deliveryWindowEnd: Date;
  windowCloseAt: Date;
  lockedAt: Date | null;
};

export type ParticipantSummary = {
  id: string;
  poolId: string;
  builderId: string;
  quantity: number;
  status: AggregationParticipantStatus;
  orderId: string | null;
  optedInAt: Date;
  optedOutAt: Date | null;
};
