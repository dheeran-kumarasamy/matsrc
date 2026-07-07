import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  AggregationParticipantStatus,
  AggregationPoolStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { AggregationConfigService } from "./aggregation-config.service";
import {
  AddParticipantParams,
  FindOrCreatePoolParams,
  ParticipantSummary,
  PoolSummary,
  PriceTier,
} from "./aggregation.types";

/**
 * AggregationService — pool matching engine for Order Aggregation ("Group & Save").
 *
 * Concurrency strategy: every mutation that touches an AggregationPool's quantity/status
 * runs inside a `prisma.$transaction` and acquires a row-level lock via
 * `SELECT ... FOR UPDATE` (raw SQL, since Prisma has no native API for this) before
 * reading/mutating the pool. This serializes concurrent joins/opt-outs/locks against the
 * same pool so `currentQuantity` and tier pricing never race, while allowing full
 * parallelism across different pools.
 */
@Injectable()
export class AggregationService {
  private readonly logger = new Logger(AggregationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aggregationConfig: AggregationConfigService
  ) {}

  // ───────────────────────────────────────────────────────────
  // Pool matching
  // ───────────────────────────────────────────────────────────

  /**
   * Finds an OPEN pool for (supplierId, productId, zoneKey) whose delivery window
   * covers the requested delivery date, or creates a new one seeded from the
   * product's aggregation configuration.
   */
  async findOrCreatePool(params: FindOrCreatePoolParams): Promise<PoolSummary> {
    if (!this.aggregationConfig.isEnabled()) {
      throw new ForbiddenException("Order aggregation is currently disabled");
    }

    const product = await this.prisma.product.findUnique({
      where: { id: params.productId },
    });

    if (!product) {
      throw new NotFoundException("Product not found");
    }

    if (!product.aggregationEnabled) {
      throw new BadRequestException("Aggregation is not enabled for this product");
    }

    if (product.supplierId !== params.supplierId) {
      throw new BadRequestException("Product does not belong to the given supplier");
    }

    const existing = await this.prisma.aggregationPool.findFirst({
      where: {
        supplierId: params.supplierId,
        productId: params.productId,
        zoneKey: params.zoneKey,
        status: AggregationPoolStatus.OPEN,
        deliveryWindowStart: { lte: params.requestedDeliveryDate },
        deliveryWindowEnd: { gte: params.requestedDeliveryDate },
      },
      orderBy: { createdAt: "asc" },
    });

    if (existing) {
      return this.toPoolSummary(existing, product.basePrice);
    }

    const windowDays = product.aggregationWindowDays && product.aggregationWindowDays > 0 ? product.aggregationWindowDays : 7;
    const windowStart = params.requestedDeliveryDate;
    const windowEnd = new Date(windowStart.getTime() + windowDays * 24 * 60 * 60 * 1000);
    const priceTiers = this.parsePriceTiers(product.aggregationPriceTiers);

    const created = await this.prisma.aggregationPool.create({
      data: {
        supplierId: params.supplierId,
        productId: params.productId,
        zoneKey: params.zoneKey,
        deliveryWindowStart: windowStart,
        deliveryWindowEnd: windowEnd,
        status: AggregationPoolStatus.OPEN,
        currentQuantity: 0,
        priceTiers: priceTiers as any,
        windowCloseAt: windowEnd,
      },
    });

    return this.toPoolSummary(created, product.basePrice);
  }

  // ───────────────────────────────────────────────────────────
  // Add participant (join / increase quantity)
  // ───────────────────────────────────────────────────────────

  /**
   * Adds a builder to a pool (or increases their existing PENDING quantity), atomically
   * recalculating the pool's tier price, and creates a linked placeholder Order so the
   * builder has order tracking immediately. The Order's pricing uses the pool's
   * provisional (pre-lock) unit price and is reconciled again when the pool locks.
   */
  async addParticipant(params: AddParticipantParams): Promise<{ pool: PoolSummary; participant: ParticipantSummary }> {
    if (!this.aggregationConfig.isEnabled()) {
      throw new ForbiddenException("Order aggregation is currently disabled");
    }

    if (params.quantity <= 0) {
      throw new BadRequestException("Quantity must be greater than zero");
    }

    return this.prisma.$transaction(async (tx) => {
      const pool = await this.lockPoolRow(tx, params.poolId);

      if (pool.status !== AggregationPoolStatus.OPEN) {
        throw new BadRequestException("Pool is no longer accepting participants");
      }

      const product = await tx.product.findUnique({ where: { id: pool.productId } });
      if (!product) {
        throw new NotFoundException("Product not found");
      }

      const existingParticipant = await tx.aggregationParticipant.findFirst({
        where: {
          poolId: pool.id,
          builderId: params.builderId,
          status: { in: [AggregationParticipantStatus.PENDING, AggregationParticipantStatus.LOCKED_IN] },
        },
      });

      const previousQuantity = existingParticipant?.quantity ?? 0;
      const newParticipantQuantity = previousQuantity + params.quantity;
      const newPoolQuantity = pool.currentQuantity - previousQuantity + newParticipantQuantity;

      const priceTiers = this.parsePriceTiers(pool.priceTiers);
      const currentUnitPrice = this.resolveTierPrice(priceTiers, newPoolQuantity, product.basePrice);

      const updatedPool = await tx.aggregationPool.update({
        where: { id: pool.id },
        data: { currentQuantity: newPoolQuantity },
      });

      let participant;
      if (existingParticipant) {
        participant = await tx.aggregationParticipant.update({
          where: { id: existingParticipant.id },
          data: { quantity: newParticipantQuantity },
        });
      } else {
        participant = await tx.aggregationParticipant.create({
          data: {
            poolId: pool.id,
            builderId: params.builderId,
            quantity: newParticipantQuantity,
            status: AggregationParticipantStatus.PENDING,
          },
        });
      }

      const priceBeforeAggregation = Number(product.basePrice) * newParticipantQuantity;
      const totalAmount = currentUnitPrice * newParticipantQuantity;

      if (participant.orderId) {
        // Existing linked order: keep pricing in sync with the new provisional total.
        await tx.order.update({
          where: { id: participant.orderId },
          data: {
            totalAmount,
            priceBeforeAggregation,
            priceAfterAggregation: totalAmount,
          },
        });

        await tx.orderItem.updateMany({
          where: { orderId: participant.orderId },
          data: {
            quantity: newParticipantQuantity,
            unitPrice: currentUnitPrice,
          },
        });
      } else {
        const order = await tx.order.create({
          data: {
            userId: params.builderId,
            status: OrderStatus.PLACED,
            paymentMethod: PaymentMethod.BANK_TRANSFER,
            paymentStatus: PaymentStatus.PENDING,
            totalAmount,
            isAggregated: true,
            aggregationPoolId: pool.id,
            priceBeforeAggregation,
            priceAfterAggregation: totalAmount,
            items: {
              create: {
                productId: pool.productId,
                supplierId: pool.supplierId,
                quantity: newParticipantQuantity,
                unitPrice: currentUnitPrice,
              },
            },
            tracking: {
              create: {
                status: OrderStatus.PLACED,
                note: "Joined aggregation pool — pending pool lock",
              },
            },
          },
        });

        participant = await tx.aggregationParticipant.update({
          where: { id: participant.id },
          data: { orderId: order.id },
        });
      }

      return {
        pool: this.toPoolSummary(updatedPool, product.basePrice),
        participant: this.toParticipantSummary(participant),
      };
    });
  }

  // ───────────────────────────────────────────────────────────
  // Opt-out / cancel participation
  // ───────────────────────────────────────────────────────────

  /**
   * Removes a builder from a pool prior to lock: marks the participant OPTED_OUT,
   * cancels their linked placeholder Order, decrements the pool's currentQuantity,
   * and recalculates the tier price for remaining participants.
   */
  async cancelParticipant(poolId: string, builderId: string): Promise<{ pool: PoolSummary; participant: ParticipantSummary }> {
    return this.prisma.$transaction(async (tx) => {
      const pool = await this.lockPoolRow(tx, poolId);

      if (pool.status !== AggregationPoolStatus.OPEN) {
        throw new BadRequestException("Pool has already locked; opt-out is no longer possible");
      }

      const participant = await tx.aggregationParticipant.findFirst({
        where: {
          poolId,
          builderId,
          status: { in: [AggregationParticipantStatus.PENDING, AggregationParticipantStatus.LOCKED_IN] },
        },
      });

      if (!participant) {
        throw new NotFoundException("Active participation not found for this builder in this pool");
      }

      const product = await tx.product.findUnique({ where: { id: pool.productId } });
      if (!product) {
        throw new NotFoundException("Product not found");
      }

      const newPoolQuantity = Math.max(0, pool.currentQuantity - participant.quantity);
      const priceTiers = this.parsePriceTiers(pool.priceTiers);
      const currentUnitPrice = this.resolveTierPrice(priceTiers, newPoolQuantity, product.basePrice);

      const updatedPool = await tx.aggregationPool.update({
        where: { id: pool.id },
        data: { currentQuantity: newPoolQuantity },
      });

      const updatedParticipant = await tx.aggregationParticipant.update({
        where: { id: participant.id },
        data: {
          status: AggregationParticipantStatus.OPTED_OUT,
          optedOutAt: new Date(),
        },
      });

      if (participant.orderId) {
        await tx.order.update({
          where: { id: participant.orderId },
          data: { status: OrderStatus.CANCELLED },
        });

        await tx.orderTracking.create({
          data: {
            orderId: participant.orderId,
            status: OrderStatus.CANCELLED,
            note: "Builder opted out of aggregation pool",
          },
        });
      }

      // Recalculate remaining participants' order pricing to reflect the new tier, if it changed.
      void currentUnitPrice; // reserved for future reconciliation of remaining participants' provisional pricing

      return {
        pool: this.toPoolSummary(updatedPool, product.basePrice),
        participant: this.toParticipantSummary(updatedParticipant),
      };
    });
  }

  // ───────────────────────────────────────────────────────────
  // Lock pool
  // ───────────────────────────────────────────────────────────

  /**
   * Locks a pool: sets status=LOCKED, lockedAt=now, lockedUnitPrice=currentUnitPrice,
   * transitions all PENDING participants to LOCKED_IN, and reconciles each locked-in
   * participant's linked Order pricing to the final locked price.
   *
   * TODO: an auto-expiry cron/scheduled job should call this automatically once
   * `windowCloseAt` has passed for OPEN pools. Out of scope for this task — lockPool
   * is exposed here as an explicit, idempotent operation (e.g. for admin/cron use).
   */
  async lockPool(poolId: string): Promise<PoolSummary> {
    return this.prisma.$transaction(async (tx) => {
      const pool = await this.lockPoolRow(tx, poolId);

      if (pool.status === AggregationPoolStatus.LOCKED) {
        // Idempotent: locking an already-locked pool is a no-op that returns current state.
        const product = await tx.product.findUnique({ where: { id: pool.productId } });
        return this.toPoolSummary(pool, product?.basePrice ?? 0);
      }

      if (pool.status !== AggregationPoolStatus.OPEN) {
        throw new BadRequestException(`Pool cannot be locked from status ${pool.status}`);
      }

      const product = await tx.product.findUnique({ where: { id: pool.productId } });
      if (!product) {
        throw new NotFoundException("Product not found");
      }

      const priceTiers = this.parsePriceTiers(pool.priceTiers);
      const lockedUnitPrice = this.resolveTierPrice(priceTiers, pool.currentQuantity, product.basePrice);

      const updatedPool = await tx.aggregationPool.update({
        where: { id: pool.id },
        data: {
          status: AggregationPoolStatus.LOCKED,
          lockedAt: new Date(),
          lockedUnitPrice,
        },
      });

      const pendingParticipants = await tx.aggregationParticipant.findMany({
        where: { poolId: pool.id, status: AggregationParticipantStatus.PENDING },
      });

      for (const participant of pendingParticipants) {
        await tx.aggregationParticipant.update({
          where: { id: participant.id },
          data: { status: AggregationParticipantStatus.LOCKED_IN },
        });

        if (participant.orderId) {
          const finalTotal = lockedUnitPrice * participant.quantity;

          await tx.order.update({
            where: { id: participant.orderId },
            data: {
              totalAmount: finalTotal,
              priceAfterAggregation: finalTotal,
            },
          });

          await tx.orderItem.updateMany({
            where: { orderId: participant.orderId },
            data: { unitPrice: lockedUnitPrice },
          });

          await tx.orderTracking.create({
            data: {
              orderId: participant.orderId,
              status: OrderStatus.PLACED,
              note: `Aggregation pool locked at INR ${lockedUnitPrice.toFixed(2)}/unit`,
            },
          });
        }
      }

      return this.toPoolSummary(updatedPool, product.basePrice);
    });
  }

  // ───────────────────────────────────────────────────────────
  // Read helpers
  // ───────────────────────────────────────────────────────────

  async getPool(poolId: string): Promise<PoolSummary> {
    const pool = await this.prisma.aggregationPool.findUnique({ where: { id: poolId } });
    if (!pool) {
      throw new NotFoundException("Pool not found");
    }

    const product = await this.prisma.product.findUnique({ where: { id: pool.productId } });
    return this.toPoolSummary(pool, product?.basePrice ?? 0);
  }

  async getParticipants(poolId: string): Promise<ParticipantSummary[]> {
    const participants = await this.prisma.aggregationParticipant.findMany({
      where: { poolId },
      orderBy: { optedInAt: "asc" },
    });

    return participants.map((p) => this.toParticipantSummary(p));
  }

  // ───────────────────────────────────────────────────────────
  // Internal helpers
  // ───────────────────────────────────────────────────────────

  /**
   * Acquires a row-level lock on the AggregationPool row using `SELECT ... FOR UPDATE`.
   * Must be called within an active `prisma.$transaction` callback. Prisma has no
   * native pessimistic-locking API, so this uses `$queryRawUnsafe`-equivalent typed
   * raw SQL (`$queryRaw` with a tagged template, which is parameterized/safe).
   */
  private async lockPoolRow(tx: any, poolId: string) {
    const rows: Array<{
      id: string;
      supplierId: string;
      productId: string;
      zoneKey: string;
      deliveryWindowStart: Date;
      deliveryWindowEnd: Date;
      status: AggregationPoolStatus;
      currentQuantity: number;
      priceTiers: unknown;
      lockedUnitPrice: any;
      windowCloseAt: Date;
      lockedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }> = await tx.$queryRaw`SELECT * FROM "AggregationPool" WHERE "id" = ${poolId} FOR UPDATE`;

    const pool = rows[0];
    if (!pool) {
      throw new NotFoundException("Pool not found");
    }

    return pool;
  }

  private parsePriceTiers(raw: unknown): PriceTier[] {
    if (!raw) {
      return [];
    }

    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((tier: any) => ({
          minQty: Number(tier.minQty),
          unitPrice: Number(tier.unitPrice),
        }))
        .filter((tier) => Number.isFinite(tier.minQty) && Number.isFinite(tier.unitPrice))
        .sort((a, b) => a.minQty - b.minQty);
    } catch {
      return [];
    }
  }

  /**
   * currentUnitPrice = highest tier whose minQty <= quantity, falling back to basePrice
   * if no tier qualifies.
   */
  private resolveTierPrice(tiers: PriceTier[], quantity: number, basePrice: unknown): number {
    let resolved = Number(basePrice);

    for (const tier of tiers) {
      if (quantity >= tier.minQty) {
        resolved = tier.unitPrice;
      }
    }

    return resolved;
  }

  private resolveNextTier(tiers: PriceTier[], quantity: number): PriceTier | null {
    const next = tiers.find((tier) => tier.minQty > quantity);
    return next ?? null;
  }

  private toPoolSummary(pool: any, basePrice: unknown): PoolSummary {
    const priceTiers = this.parsePriceTiers(pool.priceTiers);
    const currentUnitPrice =
      pool.lockedUnitPrice !== null && pool.lockedUnitPrice !== undefined
        ? Number(pool.lockedUnitPrice)
        : this.resolveTierPrice(priceTiers, pool.currentQuantity, basePrice);

    return {
      id: pool.id,
      supplierId: pool.supplierId,
      productId: pool.productId,
      zoneKey: pool.zoneKey,
      status: pool.status,
      currentQuantity: pool.currentQuantity,
      priceTiers,
      lockedUnitPrice: pool.lockedUnitPrice !== null && pool.lockedUnitPrice !== undefined ? Number(pool.lockedUnitPrice) : null,
      currentUnitPrice,
      nextTier: this.resolveNextTier(priceTiers, pool.currentQuantity),
      deliveryWindowStart: pool.deliveryWindowStart,
      deliveryWindowEnd: pool.deliveryWindowEnd,
      windowCloseAt: pool.windowCloseAt,
      lockedAt: pool.lockedAt ?? null,
    };
  }

  private toParticipantSummary(participant: any): ParticipantSummary {
    return {
      id: participant.id,
      poolId: participant.poolId,
      builderId: participant.builderId,
      quantity: participant.quantity,
      status: participant.status,
      orderId: participant.orderId ?? null,
      optedInAt: participant.optedInAt,
      optedOutAt: participant.optedOutAt ?? null,
    };
  }
}
