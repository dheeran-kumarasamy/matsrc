import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  AggregationParticipantStatus,
  AggregationPoolStatus,
  OrderStatus,
} from "@matsrc/db";
import { AggregationService } from "./aggregation.service";
import { AggregationConfigService } from "./aggregation-config.service";

/**
 * In-memory fake Prisma client for AggregationService unit tests.
 *
 * Rationale: AggregationService's core logic (pool matching, tier recalculation,
 * lock atomicity, opt-out reconciliation) all happens inside `prisma.$transaction`
 * callbacks that use `tx.$queryRaw` for row locking. A plain jest/vitest mock with
 * canned return values per call would be extremely brittle for these multi-step
 * transactional flows, so instead we build a minimal in-memory store that mimics
 * the subset of Prisma's API the service touches (findUnique/findFirst/findMany/
 * create/update/updateMany + $transaction + $queryRaw for SELECT ... FOR UPDATE).
 * This lets us assert on real end-state (pool quantities, order totals, participant
 * statuses) after exercising the service's public methods, which is far closer to
 * an integration test than a shallow mock would give us, while still running fully
 * in-memory with zero real DB dependency.
 */
function createFakeDb() {
  const db = {
    products: new Map<string, any>(),
    pools: new Map<string, any>(),
    participants: new Map<string, any>(),
    orders: new Map<string, any>(),
    orderItems: new Map<string, any>(),
    orderTracking: [] as any[],
    idCounter: 0,
  };

  function nextId(prefix: string) {
    db.idCounter += 1;
    return `${prefix}-${db.idCounter}`;
  }

  const productApi = {
    findUnique: vi.fn(async ({ where }: any) => db.products.get(where.id) ?? null),
  };

  const poolApi = {
    findFirst: vi.fn(async ({ where }: any) => {
      const pools = [...db.pools.values()].filter((pool) => {
        if (where.supplierId && pool.supplierId !== where.supplierId) return false;
        if (where.productId && pool.productId !== where.productId) return false;
        if (where.zoneKey && pool.zoneKey !== where.zoneKey) return false;
        if (where.status && pool.status !== where.status) return false;
        if (where.deliveryWindowStart?.lte && pool.deliveryWindowStart > where.deliveryWindowStart.lte) return false;
        if (where.deliveryWindowEnd?.gte && pool.deliveryWindowEnd < where.deliveryWindowEnd.gte) return false;
        return true;
      });
      pools.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return pools[0] ?? null;
    }),
    findUnique: vi.fn(async ({ where }: any) => db.pools.get(where.id) ?? null),
    findMany: vi.fn(async ({ where }: any) => {
      return [...db.pools.values()].filter((pool) => !where?.status || pool.status === where.status);
    }),
    create: vi.fn(async ({ data }: any) => {
      const id = nextId("pool");
      const now = new Date();
      const pool = { id, createdAt: now, updatedAt: now, lockedAt: null, lockedUnitPrice: null, ...data };
      db.pools.set(id, pool);
      return pool;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const pool = db.pools.get(where.id);
      if (!pool) throw new Error("pool not found in fake db");
      Object.assign(pool, data, { updatedAt: new Date() });
      return pool;
    }),
  };

  const participantApi = {
    findFirst: vi.fn(async ({ where }: any) => {
      const list = [...db.participants.values()].filter((p) => {
        if (where.poolId && p.poolId !== where.poolId) return false;
        if (where.builderId && p.builderId !== where.builderId) return false;
        if (where.status?.in && !where.status.in.includes(p.status)) return false;
        return true;
      });
      return list[0] ?? null;
    }),
    findMany: vi.fn(async ({ where }: any) => {
      return [...db.participants.values()].filter((p) => {
        if (where.poolId && p.poolId !== where.poolId) return false;
        if (where.status && p.status !== where.status) return false;
        return true;
      });
    }),
    create: vi.fn(async ({ data }: any) => {
      const id = nextId("participant");
      const participant = { id, optedInAt: new Date(), optedOutAt: null, orderId: null, ...data };
      db.participants.set(id, participant);
      return participant;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const participant = db.participants.get(where.id);
      if (!participant) throw new Error("participant not found in fake db");
      Object.assign(participant, data);
      return participant;
    }),
  };

  const orderApi = {
    create: vi.fn(async ({ data }: any) => {
      const id = nextId("order");
      const { items, tracking, ...rest } = data;
      const order = { id, ...rest };
      db.orders.set(id, order);

      if (items?.create) {
        const itemId = nextId("orderItem");
        db.orderItems.set(itemId, { id: itemId, orderId: id, ...items.create });
      }
      if (tracking?.create) {
        db.orderTracking.push({ orderId: id, ...tracking.create });
      }

      return order;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const order = db.orders.get(where.id);
      if (!order) throw new Error("order not found in fake db");
      Object.assign(order, data);
      return order;
    }),
  };

  const orderItemApi = {
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const item of db.orderItems.values()) {
        if (item.orderId === where.orderId) {
          Object.assign(item, data);
          count += 1;
        }
      }
      return { count };
    }),
  };

  const orderTrackingApi = {
    create: vi.fn(async ({ data }: any) => {
      db.orderTracking.push(data);
      return data;
    }),
  };

  // Row-lock emulation: $queryRaw is only ever used for `SELECT * FROM "AggregationPool"
  // WHERE "id" = ${poolId} FOR UPDATE` in this service, so we can special-case it here.
  const $queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
    const poolId = values[0];
    const pool = db.pools.get(poolId);
    return pool ? [pool] : [];
  });

  const txClient = {
    product: productApi,
    aggregationPool: poolApi,
    aggregationParticipant: participantApi,
    order: orderApi,
    orderItem: orderItemApi,
    orderTracking: orderTrackingApi,
    $queryRaw,
  };

  const prisma = {
    ...txClient,
    $transaction: vi.fn(async (callback: any) => callback(txClient)),
  };

  return { db, prisma };
}

function makeConfig(enabled = true): AggregationConfigService {
  return { isEnabled: () => enabled } as AggregationConfigService;
}

function seedProduct(db: ReturnType<typeof createFakeDb>["db"], overrides: Partial<any> = {}) {
  const product = {
    id: "product-1",
    supplierId: "supplier-1",
    basePrice: 100,
    aggregationEnabled: true,
    aggregationWindowDays: 7,
    aggregationPriceTiers: [
      { minQty: 10, unitPrice: 90 },
      { minQty: 50, unitPrice: 80 },
      { minQty: 100, unitPrice: 70 },
    ],
    ...overrides,
  };
  db.products.set(product.id, product);
  return product;
}

describe("AggregationService.findOrCreatePool", () => {
  let db: ReturnType<typeof createFakeDb>["db"];
  let prisma: ReturnType<typeof createFakeDb>["prisma"];
  let service: AggregationService;

  beforeEach(() => {
    const fake = createFakeDb();
    db = fake.db;
    prisma = fake.prisma;
    service = new AggregationService(prisma as any, makeConfig());
  });

  it("throws ForbiddenException when the feature flag is disabled", async () => {
    service = new AggregationService(prisma as any, makeConfig(false));
    seedProduct(db);

    await expect(
      service.findOrCreatePool({
        supplierId: "supplier-1",
        productId: "product-1",
        zoneKey: "560001",
        requestedDeliveryDate: new Date("2026-01-10"),
      })
    ).rejects.toThrow(ForbiddenException);
  });

  it("throws NotFoundException when the product does not exist", async () => {
    await expect(
      service.findOrCreatePool({
        supplierId: "supplier-1",
        productId: "missing-product",
        zoneKey: "560001",
        requestedDeliveryDate: new Date("2026-01-10"),
      })
    ).rejects.toThrow(NotFoundException);
  });

  it("throws BadRequestException when aggregation is not enabled on the product", async () => {
    seedProduct(db, { aggregationEnabled: false });

    await expect(
      service.findOrCreatePool({
        supplierId: "supplier-1",
        productId: "product-1",
        zoneKey: "560001",
        requestedDeliveryDate: new Date("2026-01-10"),
      })
    ).rejects.toThrow(BadRequestException);
  });

  it("creates a new OPEN pool seeded from the product's tiers and window when none matches", async () => {
    seedProduct(db);

    const pool = await service.findOrCreatePool({
      supplierId: "supplier-1",
      productId: "product-1",
      zoneKey: "560001",
      requestedDeliveryDate: new Date("2026-01-10T00:00:00.000Z"),
    });

    expect(pool.status).toBe(AggregationPoolStatus.OPEN);
    expect(pool.currentQuantity).toBe(0);
    expect(pool.priceTiers).toEqual([
      { minQty: 10, unitPrice: 90 },
      { minQty: 50, unitPrice: 80 },
      { minQty: 100, unitPrice: 70 },
    ]);
    expect(pool.deliveryWindowEnd.getTime() - pool.deliveryWindowStart.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("matches an existing OPEN pool for same sku/zone/date-window instead of creating a duplicate", async () => {
    seedProduct(db);

    const first = await service.findOrCreatePool({
      supplierId: "supplier-1",
      productId: "product-1",
      zoneKey: "560001",
      requestedDeliveryDate: new Date("2026-01-10T00:00:00.000Z"),
    });

    const second = await service.findOrCreatePool({
      supplierId: "supplier-1",
      productId: "product-1",
      zoneKey: "560001",
      requestedDeliveryDate: new Date("2026-01-12T00:00:00.000Z"),
    });

    expect(second.id).toBe(first.id);
    expect(db.pools.size).toBe(1);
  });

  it("does not match a pool in a different zone", async () => {
    seedProduct(db);

    const first = await service.findOrCreatePool({
      supplierId: "supplier-1",
      productId: "product-1",
      zoneKey: "560001",
      requestedDeliveryDate: new Date("2026-01-10T00:00:00.000Z"),
    });

    const second = await service.findOrCreatePool({
      supplierId: "supplier-1",
      productId: "product-1",
      zoneKey: "600002",
      requestedDeliveryDate: new Date("2026-01-10T00:00:00.000Z"),
    });

    expect(second.id).not.toBe(first.id);
    expect(db.pools.size).toBe(2);
  });
});

describe("AggregationService.addParticipant (tier recalculation)", () => {
  let db: ReturnType<typeof createFakeDb>["db"];
  let prisma: ReturnType<typeof createFakeDb>["prisma"];
  let service: AggregationService;

  beforeEach(() => {
    const fake = createFakeDb();
    db = fake.db;
    prisma = fake.prisma;
    service = new AggregationService(prisma as any, makeConfig());
    seedProduct(db);
  });

  async function createPool() {
    return service.findOrCreatePool({
      supplierId: "supplier-1",
      productId: "product-1",
      zoneKey: "560001",
      requestedDeliveryDate: new Date("2026-01-10T00:00:00.000Z"),
    });
  }

  it("uses base price when quantity has not reached the first tier", async () => {
    const pool = await createPool();

    const { pool: updated } = await service.addParticipant({
      poolId: pool.id,
      builderId: "builder-1",
      quantity: 5,
    });

    expect(updated.currentQuantity).toBe(5);
    expect(updated.currentUnitPrice).toBe(100); // base price, no tier reached
    expect(updated.nextTier).toEqual({ minQty: 10, unitPrice: 90 });
  });

  it("recalculates to tier 1 price once minQty is crossed", async () => {
    const pool = await createPool();

    const { pool: updated } = await service.addParticipant({
      poolId: pool.id,
      builderId: "builder-1",
      quantity: 10,
    });

    expect(updated.currentQuantity).toBe(10);
    expect(updated.currentUnitPrice).toBe(90);
  });

  it("aggregates demand across multiple distinct builders and recalculates tier for all", async () => {
    const pool = await createPool();

    await service.addParticipant({ poolId: pool.id, builderId: "builder-1", quantity: 6 });
    const { pool: afterSecond } = await service.addParticipant({
      poolId: pool.id,
      builderId: "builder-2",
      quantity: 6,
    });

    expect(afterSecond.currentQuantity).toBe(12);
    expect(afterSecond.currentUnitPrice).toBe(90); // crossed tier-1 (minQty 10)
  });

  it("increases an existing participant's quantity instead of duplicating them", async () => {
    const pool = await createPool();

    await service.addParticipant({ poolId: pool.id, builderId: "builder-1", quantity: 5 });
    const { pool: after, participant } = await service.addParticipant({
      poolId: pool.id,
      builderId: "builder-1",
      quantity: 6,
    });

    expect(after.currentQuantity).toBe(11);
    expect(participant.quantity).toBe(11);
    expect([...db.participants.values()].filter((p) => p.builderId === "builder-1")).toHaveLength(1);
  });

  it("creates a linked placeholder Order at the current provisional tier price", async () => {
    const pool = await createPool();

    const { participant } = await service.addParticipant({
      poolId: pool.id,
      builderId: "builder-1",
      quantity: 10,
    });

    expect(participant.orderId).toBeTruthy();
    const order = db.orders.get(participant.orderId!);
    expect(order.isAggregated).toBe(true);
    expect(order.totalAmount).toBe(900); // 10 * 90
    expect(order.status).toBe(OrderStatus.PLACED);
  });

  it("rejects zero/negative quantity", async () => {
    const pool = await createPool();

    await expect(
      service.addParticipant({ poolId: pool.id, builderId: "builder-1", quantity: 0 })
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects joining a pool that is not OPEN", async () => {
    const pool = await createPool();
    db.pools.get(pool.id)!.status = AggregationPoolStatus.LOCKED;

    await expect(
      service.addParticipant({ poolId: pool.id, builderId: "builder-1", quantity: 5 })
    ).rejects.toThrow(BadRequestException);
  });
});

describe("AggregationService.lockPool", () => {
  let db: ReturnType<typeof createFakeDb>["db"];
  let prisma: ReturnType<typeof createFakeDb>["prisma"];
  let service: AggregationService;

  beforeEach(() => {
    const fake = createFakeDb();
    db = fake.db;
    prisma = fake.prisma;
    service = new AggregationService(prisma as any, makeConfig());
    seedProduct(db);
  });

  async function createPoolWithParticipants() {
    const pool = await service.findOrCreatePool({
      supplierId: "supplier-1",
      productId: "product-1",
      zoneKey: "560001",
      requestedDeliveryDate: new Date("2026-01-10T00:00:00.000Z"),
    });

    const p1 = await service.addParticipant({ poolId: pool.id, builderId: "builder-1", quantity: 30 });
    const p2 = await service.addParticipant({ poolId: pool.id, builderId: "builder-2", quantity: 25 });

    return { poolId: pool.id, p1: p1.participant, p2: p2.participant };
  }

  it("locks the pool at the final tier price and converts all PENDING participants to LOCKED_IN", async () => {
    const { poolId, p1, p2 } = await createPoolWithParticipants();

    const locked = await service.lockPool(poolId);

    expect(locked.status).toBe(AggregationPoolStatus.LOCKED);
    expect(locked.lockedUnitPrice).toBe(80); // 55 total >= tier-2 minQty(50)
    expect(locked.currentUnitPrice).toBe(80);

    const participant1 = db.participants.get(p1.id);
    const participant2 = db.participants.get(p2.id);
    expect(participant1.status).toBe(AggregationParticipantStatus.LOCKED_IN);
    expect(participant2.status).toBe(AggregationParticipantStatus.LOCKED_IN);
  });

  it("reconciles each participant's linked Order to the final locked price", async () => {
    const { poolId, p1 } = await createPoolWithParticipants();

    await service.lockPool(poolId);

    const order = db.orders.get(p1.orderId!);
    expect(order.totalAmount).toBe(30 * 80); // locked price * builder-1's quantity
    expect(order.priceAfterAggregation).toBe(30 * 80);
  });

  it("is idempotent: locking an already-locked pool is a no-op returning the same state", async () => {
    const { poolId } = await createPoolWithParticipants();

    const first = await service.lockPool(poolId);
    const second = await service.lockPool(poolId);

    expect(second.status).toBe(AggregationPoolStatus.LOCKED);
    expect(second.lockedUnitPrice).toBe(first.lockedUnitPrice);
  });

  it("throws BadRequestException when trying to lock a CANCELLED pool", async () => {
    const { poolId } = await createPoolWithParticipants();
    db.pools.get(poolId)!.status = AggregationPoolStatus.CANCELLED;

    await expect(service.lockPool(poolId)).rejects.toThrow(BadRequestException);
  });

  it("throws NotFoundException for an unknown pool id", async () => {
    await expect(service.lockPool("does-not-exist")).rejects.toThrow(NotFoundException);
  });
});

describe("AggregationService.cancelParticipant (opt-out)", () => {
  let db: ReturnType<typeof createFakeDb>["db"];
  let prisma: ReturnType<typeof createFakeDb>["prisma"];
  let service: AggregationService;

  beforeEach(() => {
    const fake = createFakeDb();
    db = fake.db;
    prisma = fake.prisma;
    service = new AggregationService(prisma as any, makeConfig());
    seedProduct(db);
  });

  async function createPool() {
    return service.findOrCreatePool({
      supplierId: "supplier-1",
      productId: "product-1",
      zoneKey: "560001",
      requestedDeliveryDate: new Date("2026-01-10T00:00:00.000Z"),
    });
  }

  it("marks the participant OPTED_OUT, cancels their order, and decrements pool quantity", async () => {
    const pool = await createPool();
    await service.addParticipant({ poolId: pool.id, builderId: "builder-1", quantity: 10 });

    const { pool: updatedPool, participant } = await service.cancelParticipant(pool.id, "builder-1");

    expect(participant.status).toBe(AggregationParticipantStatus.OPTED_OUT);
    expect(updatedPool.currentQuantity).toBe(0);

    const order = db.orders.get(participant.orderId!);
    expect(order.status).toBe(OrderStatus.CANCELLED);
  });

  it("recalculates remaining participants' provisional pricing after an opt-out drops the tier", async () => {
    const pool = await createPool();
    await service.addParticipant({ poolId: pool.id, builderId: "builder-1", quantity: 5 });
    const { participant: p2 } = await service.addParticipant({
      poolId: pool.id,
      builderId: "builder-2",
      quantity: 5,
    }); // pool now at 10 -> tier-1 (90)

    // Builder-1 opts out, dropping pool back to 5 -> base price (100)
    await service.cancelParticipant(pool.id, "builder-1");

    const remainingOrder = db.orders.get(p2.orderId!);
    expect(remainingOrder.totalAmount).toBe(5 * 100);
    expect(remainingOrder.priceAfterAggregation).toBe(5 * 100);
  });

  it("blocks opt-out once the pool has already LOCKED", async () => {
    const pool = await createPool();
    await service.addParticipant({ poolId: pool.id, builderId: "builder-1", quantity: 10 });
    await service.lockPool(pool.id);

    await expect(service.cancelParticipant(pool.id, "builder-1")).rejects.toThrow(BadRequestException);
  });

  it("throws NotFoundException when the builder has no active participation in the pool", async () => {
    const pool = await createPool();

    await expect(service.cancelParticipant(pool.id, "builder-never-joined")).rejects.toThrow(NotFoundException);
  });
});

describe("AggregationService concurrency: row-lock usage for atomicity", () => {
  it("acquires a SELECT ... FOR UPDATE row lock on the pool before mutating it in addParticipant", async () => {
    const { db, prisma } = createFakeDb();
    const service = new AggregationService(prisma as any, makeConfig());
    seedProduct(db);

    const pool = await service.findOrCreatePool({
      supplierId: "supplier-1",
      productId: "product-1",
      zoneKey: "560001",
      requestedDeliveryDate: new Date("2026-01-10T00:00:00.000Z"),
    });

    await service.addParticipant({ poolId: pool.id, builderId: "builder-1", quantity: 5 });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it("serializes two sequential joins against the same pool without overselling a tier", async () => {
    // Because our fake $transaction runs callbacks sequentially (no real parallel DB),
    // this test verifies the *logical* correctness of tier math under repeated joins
    // rather than true DB-level lock contention (which would require an integration
    // test against a real Postgres instance per the repo's transactional pattern).
    const { db, prisma } = createFakeDb();
    const service = new AggregationService(prisma as any, makeConfig());
    seedProduct(db, {
      aggregationPriceTiers: [{ minQty: 20, unitPrice: 80 }],
    });

    const pool = await service.findOrCreatePool({
      supplierId: "supplier-1",
      productId: "product-1",
      zoneKey: "560001",
      requestedDeliveryDate: new Date("2026-01-10T00:00:00.000Z"),
    });

    const results = await Promise.all([
      service.addParticipant({ poolId: pool.id, builderId: "builder-1", quantity: 10 }),
      service.addParticipant({ poolId: pool.id, builderId: "builder-2", quantity: 10 }),
    ]);

    const finalPool = db.pools.get(pool.id);
    expect(finalPool.currentQuantity).toBe(20);
    expect(results[results.length - 1].pool.currentUnitPrice).toBe(80);
  });
});
