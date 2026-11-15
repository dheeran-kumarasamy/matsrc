// Shared enquiry/order creation pipeline (UF-03).
//
// Extracted from apps/web/app/api/builder/orders/route.ts POST so that any
// flow which needs to turn a builder's cart into real, supplier-routed
// enquiries — the standard cart/checkout flow AND the homepage "Quick
// Material Request" nearest-match flow — creates orders through this single
// shared function. This satisfies the requirement that quick-request must
// "reuse existing cart/checkout enquiry submission pipeline (UF-03) — no
// parallel/duplicate enquiry path".
//
// Behaviour is unchanged from the original inline POST handler logic: cart
// items are re-resolved against the live public supplier listings (fresh
// price/stock at submission time), grouped by the RESOLVED supplier, and one
// Order (+ OrderItems + OrderTracking) is created per supplier group — this
// is also exactly the "multi-supplier grouping" logic quick-request must
// reuse rather than reimplement.

import {
  OrderStatus,
  PaymentStatus,
  PaymentMethod,
  generateEnquiryId,
  allocateEnquiryNumbers,
  notifySupplierRfqReceived,
  resolveMarkupForProduct,
  resolveMarkupForProductsBatch,
} from "@matsrc/db";
import { createHash } from "crypto";
import { prisma } from "@/lib/builder-db";
import { notifySupplierOrderSubmitted } from "@/lib/notify";
import { getSupplierDisplayName } from "@/lib/supplier-display";
import {
  resolveLowestPriceForQuantity,
  resolvePriceRange,
  rankCandidatesForQuantity,
  type ResolutionCandidate,
  type ResolutionResult,
} from "@/lib/resolution";

export type CreateOrdersOptions = {
  deliveryDate?: string | null;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
  deliveryAddress?: string | null;
  // Site-wise purchase reporting: optional builder-owned Site to tag every
  // order created from this checkout to. Nullable/additive — omitting it
  // (or passing null) leaves the order "Unassigned", the existing default
  // behaviour for every checkout flow that doesn't pass this.
  siteId?: string | null;
  // Cart/checkout enquiry basket flow now REQUIRES a Site to be selected
  // before an enquiry can be placed (checkout overlay "Select Site" step —
  // replaces the old optional delivery-location/map/address capture).
  // Defaults to false so other callers of this shared pipeline (e.g. the
  // Quick Material Request nearest-match flow, which doesn't collect a
  // site) are unaffected.
  requireSiteId?: boolean;
  // Durable checkout idempotency: client-supplied UUID to prevent duplicate
  // enquiry creation across retries, network blips, or rapid double clicks.
  idempotencyKey?: string | null;
};


export type CreatedOrderSummary = {
  id: string;
  enquiryId: string;
  orderNumber?: string | null;
  supplierName: string;
  total: number;
  itemCount: number;
  status: OrderStatus;
  itemIds: string[];
};

export type CreateOrdersResult =
  | { ok: true; orders: CreatedOrderSummary[] }
  | { ok: false; error: string; status: number };

/**
 * Turns the given builder's current cart into one or more real, supplier-
 * routed Orders (the same enquiry pipeline used by cart checkout). Any
 * caller that has already added the desired CartItem rows for a builder can
 * call this to submit them — used by both the standard checkout POST
 * handler and the Quick Material Request nearest-match flow.
 */
export async function createOrdersFromCart(
  userId: string,
  options: CreateOrdersOptions = {}
): Promise<CreateOrdersResult> {
  const cartItems = await prisma.cartItem.findMany({
    where: { userId },
    include: {
      product: {
        select: {
          supplierId: true,
          canonicalProductId: true,
          categoryId: true,
          basePrice: true,
          supplier: { select: { companyName: true } },
          pricingTiers: {
            select: { minQty: true, maxQty: true, tierPrice: true },
            orderBy: { minQty: "asc" },
          },
        },
      },
    },
  });

  if (!cartItems.length) {
    return { ok: false, error: "Cart is empty", status: 400 };
  }

  // Pre-validate that every cart item has a valid, non-empty database identifier.
  // Synthetic ID fallback is strictly forbidden (Section 6).
  const snapshotItemIds = cartItems
    .map((item) => item.id)
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0);

  if (snapshotItemIds.length !== cartItems.length) {
    return {
      ok: false,
      error: "One or more items in your cart are missing identifiers. Please refresh your cart.",
      status: 400,
    };
  }

  // Checkout requirement #6: a valid, builder-owned Site must be selected
  // before an enquiry can be placed. Validated server-side (not just in the
  // UI) so the enquiry can never be created/persisted without one.
  const requestedSiteId =
    typeof options.siteId === "string" && options.siteId ? options.siteId : null;

  if (options.requireSiteId) {
    if (!requestedSiteId) {
      return { ok: false, error: "Please select a site to continue.", status: 400 };
    }

    // Ownership AND active-status are both re-verified here, server-side,
    // regardless of which flow (cart checkout or the AI Sourcing Assistant's
    // confirm step) supplied the siteId. An archived site (e.g. one the
    // customer selected earlier in a session that has since become
    // inactive) must never be attached to a new order.
    const site = await prisma.site.findFirst({
      where: { id: requestedSiteId, builderId: userId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!site) {
      return {
        ok: false,
        error: "Selected site was not found or is no longer active. Please choose another site.",
        status: 400,
      };
    }
  }

  // Targeted database query for the products and canonical supplier groups in the current cart.
  // Replaces the synchronous, uncached 2.2s–8.0s HTTP fetch to /api/public/listings.
  const canonicalProductIds = Array.from(
    new Set(
      cartItems
        .map((item) => item.product.canonicalProductId)
        .filter((id): id is string => typeof id === "string" && id.trim() !== "")
    )
  );
  const productIds = Array.from(new Set(cartItems.map((item) => item.productId)));

  // Authoritative database query: database failures propagate naturally rather than being caught and silenced into empty arrays.
  // Never synthesize synthetic product records from cart snapshots.
  const dbProducts = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: [
        { id: { in: productIds } },
        ...(canonicalProductIds.length > 0 ? [{ canonicalProductId: { in: canonicalProductIds } }] : []),
      ],
    },
    include: {
      category: true,
      supplier: { select: { companyName: true } },
      pricingTiers: { orderBy: { minQty: "asc" } },
    },
    orderBy: { updatedAt: "desc" },
  });

  type ResolvedLine = {
    productId: string;
    quantity: number;
    // Admin-Configurable Product Markup: `unitPrice` is now the BUYER-FACING
    // marked-up price (what gets written onto OrderItem.unitPrice /
    // Order.totalAmount) — `supplierUnitPrice` preserves the resolved
    // ORIGINAL supplier price this was derived from. See the markup
    // resolution pass immediately below this map(), the only place that
    // turns one into the other.
    unitPrice: number;
    supplierUnitPrice: number;
    markupPercent: number;
    markupAmount: number;
    // REQ-06 askPrice remains the SUPPLIER-side figure (the only price
    // surfaced to the supplier) — never marked up.
    askPrice: number | null;
    supplierId: string;
    supplierName: string;
    categoryId: string;
    canonicalProductId: string | null;
    resolvedListingId: string | null;
    tierMinQty: number | null;
    tierMaxQty: number | null;
    // Multi-supplier fan-out: full ranked pool of eligible candidate
    // suppliers (rank 0 = current winner, matches supplierId above).
    // Empty when no live resolution was available (legacy fallback).
    candidates: ResolutionResult[];
  };

  // Case 2 & Case 3 — Validate product availability and resolve each line.
  // All-or-nothing checkout: if any cart item cannot be matched to active products
  // or resolved to an eligible supplier tier, return a clean controlled failure and
  // preserve the cart without creating partial orders or using stale cart snapshots.
  type SupplierResolvedLine = Omit<ResolvedLine, "unitPrice" | "markupPercent" | "markupAmount">;
  const supplierResolvedLines: SupplierResolvedLine[] = [];

  for (const item of cartItems) {
    const group = dbProducts.filter((p) => {
      if (item.product.canonicalProductId && p.canonicalProductId === item.product.canonicalProductId) {
        return true;
      }
      return p.id === item.productId;
    });

    if (group.length === 0) {
      return {
        ok: false,
        error: "One or more items in your cart are no longer available. Please review your cart.",
        status: 400,
      };
    }

    const candidates = group.map((p) => {
      const fallbackMaxQty = p.maxServiceableQty ?? p.stock;
      const pricingTiers =
        Array.isArray(p.pricingTiers) && p.pricingTiers.length > 0
          ? p.pricingTiers.map((t: any) => ({
            minQty: Number(t.minQty),
            maxQty: Number(t.maxQty),
            tierPrice: Number(t.tierPrice),
          }))
          : [
            {
              minQty: 1,
              maxQty: Math.max(Number(fallbackMaxQty) || 0, 1),
              tierPrice: Number(p.basePrice),
            },
          ];

      return {
        listingId: p.id,
        supplierId: p.supplierId,
        basePrice: Number(p.basePrice),
        stock: Number(p.stock),
        maxServiceableQty: p.maxServiceableQty != null ? Number(p.maxServiceableQty) : Number(p.stock),
        pricingTiers,
        isActive: p.isActive,
      };
    });

    // Serviceability & Capacity verification (Section 2):
    // Candidates must be active and have sufficient capacity (maxServiceableQty or stock >= quantity) to fulfill the line.
    // When maxServiceableQty is explicitly configured (including 0), it takes precedence over stock.
    // Zero capacity represents a genuine out-of-capacity condition and must not fall back to stock.
    const eligibleCandidates = candidates.filter((c) => {
      if (!c.isActive) return false;
      const serviceable = c.maxServiceableQty ?? c.stock;
      return serviceable > 0 && serviceable >= item.quantity;
    });

    const resolution = resolveLowestPriceForQuantity(eligibleCandidates, item.quantity);
    if (!resolution || !resolution.supplierId) {
      return {
        ok: false,
        error: "One or more items in your cart are no longer available. Please review your cart.",
        status: 400,
      };
    }

    const range = resolvePriceRange(eligibleCandidates);
    const minPrice = range?.minPrice ?? null;
    const ranked = rankCandidatesForQuantity(eligibleCandidates, item.quantity);
    const winningProduct = group.find((p) => p.id === resolution.listingId);
    const matchedSupplierName = winningProduct?.supplier?.companyName;

    supplierResolvedLines.push({
      productId: item.productId,
      quantity: item.quantity,
      supplierUnitPrice: resolution.unitPrice,
      // REQ-06: askPrice is the minimum of the full canonical price
      // range shown to the builder — the only price figure surfaced
      // to the supplier. Falls back to the resolved unitPrice if no
      // range could be computed (e.g. single-listing canonical group).
      askPrice: minPrice ?? resolution.unitPrice,
      supplierId: resolution.supplierId,
      supplierName: matchedSupplierName ?? item.product.supplier.companyName,
      categoryId: item.product.categoryId,
      canonicalProductId: item.product.canonicalProductId,
      resolvedListingId: resolution.listingId,
      tierMinQty: resolution.tierMinQty,
      tierMaxQty: resolution.tierMaxQty,
      candidates: ranked,
    });
  }

  // Admin-Configurable Product Markup — batched database query resolving
  // PRODUCT -> CATEGORY -> GLOBAL precedence for all cart items in ONE query.
  // Missing/disabled configuration fails safe to 0% (never blocks
  // checkout) rather than throwing, mirroring
  // BestPriceSelectionService.selectAndFinalizeIfEligible's identical
  // fallback for the RFQ acceptance path.
  const markups = await resolveMarkupForProductsBatch(
    prisma as any,
    supplierResolvedLines.map((line) => ({
      productId: line.productId,
      categoryId: line.categoryId,
      supplierUnitPrice: line.supplierUnitPrice,
    }))
  ).catch(() => supplierResolvedLines.map(() => null));

  const resolvedLines: ResolvedLine[] = supplierResolvedLines.map((line, idx) => {
    const resolved =
      markups[idx] ?? {
        supplierUnitPrice: line.supplierUnitPrice,
        buyerUnitPrice: line.supplierUnitPrice,
        markupPercent: 0,
        markupAmount: 0,
      };

    return {
      ...line,
      unitPrice: resolved.buyerUnitPrice,
      supplierUnitPrice: resolved.supplierUnitPrice,
      markupPercent: resolved.markupPercent,
      markupAmount: resolved.markupAmount,
    };
  });


  // Group by the RESOLVED supplier (routing-bug fix: an enquiry must be
  // assigned to the specific supplier whose price is lowest for the tier
  // the builder selected — not just whichever card/listing they clicked).
  // This is the SAME grouping logic reused for multi-supplier Quick
  // Material Request matches (distinct matched products routed to
  // different suppliers become separate grouped Orders here).
  const groups = new Map<
    string,
    {
      supplierId: string;
      supplierName: string;
      items: ResolvedLine[];
    }
  >();

  for (const line of resolvedLines) {
    const group = groups.get(line.supplierId) ?? {
      supplierId: line.supplierId,
      supplierName: line.supplierName,
      items: [],
    };
    group.items.push(line);
    groups.set(line.supplierId, group);
  }

  let createdOrders: CreatedOrderSummary[] = [];

  // BUGFIX: `new Date(options.deliveryDate)` silently produces an Invalid
  // Date object for any unparseable string — Prisma doesn't reject that
  // until deep inside the per-supplier-group $transaction below, surfacing
  // as an uncaught 500 ("Failed to create order") instead of a clean,
  // actionable validation error. Validate up front and refuse the request
  // the same way an empty cart or missing site already does.
  let deliveryDate: Date | null = null;
  if (options.deliveryDate) {
    const parsed = new Date(options.deliveryDate);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: "That delivery date isn't valid. Please choose another date.", status: 400 };
    }
    deliveryDate = parsed;
  }
  // REQ-07: map-based geolocation capture, replacing the checkout pincode
  // field. All optional/nullable — existing flows that don't send these
  // are unaffected.
  const deliveryLat = typeof options.deliveryLat === "number" ? options.deliveryLat : null;
  const deliveryLng = typeof options.deliveryLng === "number" ? options.deliveryLng : null;
  const deliveryAddress =
    typeof options.deliveryAddress === "string" && options.deliveryAddress.trim()
      ? options.deliveryAddress.trim()
      : null;
  // Site-wise purchase reporting: tag every order created in this checkout
  // batch to the given Site (nullable — omitted/null leaves "Unassigned").
  const siteId = typeof options.siteId === "string" && options.siteId ? options.siteId : null;


  // Fetched once, outside the per-supplier-group loop below, since the
  // builder's own name/email never change across the multiple grouped
  // Orders created from a single checkout — used to derive the first-name
  // component of the Consolidated Enquiry ID (see
  // packages/db/lib/enquiry-id.ts).
  const builderForEnquiryId = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  // Pre-compute normalized fingerprint to detect distinct requests sharing an idempotency key
  const sortedSnapshotItemIds = [...snapshotItemIds].sort();
  const requestFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        userId,
        siteId,
        itemIds: sortedSnapshotItemIds,
        deliveryDate: deliveryDate ? deliveryDate.toISOString() : null,
      })
    )
    .digest("hex");

  // Durable checkout idempotency (reusing existing CartIdempotency mechanism):
  // If an order for this exact idempotency key and fingerprint was already completed,
  // return the cached response without creating duplicate orders or modifying the cart.
  if (options.idempotencyKey && typeof (prisma as any).cartIdempotency?.findUnique === "function") {
    const existingIdempotency = await (prisma as any).cartIdempotency.findUnique({
      where: { userId_key: { userId, key: options.idempotencyKey } },
    });
    if (existingIdempotency) {
      if (existingIdempotency.requestFingerprint !== requestFingerprint) {
        return {
          ok: false,
          error: "Idempotency key was previously used with a different request payload.",
          status: 409,
        };
      }
      if (existingIdempotency.responsePayload && typeof existingIdempotency.responsePayload === "object") {
        const payload = existingIdempotency.responsePayload as any;
        return {
          ok: true,
          orders: Array.isArray(payload.orders) ? payload.orders : [],
        };
      }
    }
  }

  // P0: Pre-allocate enquiry numbers upfront using a short, dedicated sequence transaction.
  // This completely decouples sequence generation from the main long-running order
  // and candidate creation transaction, eliminating global lock contention on
  // BusinessSequence ('EQ_26') while preserving formatting and distinct numbering.
  let allocatedEnquiryIds: string[] = [];
  try {
    if (typeof allocateEnquiryNumbers === "function") {
      allocatedEnquiryIds = await allocateEnquiryNumbers(prisma, groups.size);
    }
  } catch {
    allocatedEnquiryIds = [];
  }

  // Wrap ALL supplier groups and cart cleanup in a single atomic transaction.
  // Guarantees all-or-nothing: if any supplier group fails, NO orders are created,
  // NO partial enquiry is left behind, and the buyer's cart is preserved.
  try {
    createdOrders = await prisma.$transaction(
      async (tx) => {
        // 1. PostgreSQL Row-Level Locking & Snapshot Revalidation (Requirements 3A & 3B):
        // Acquire exclusive row locks on the buyer's original snapshot cart items (SELECT ... FOR UPDATE).
        // Any concurrent checkout or modification for these rows will block until this transaction commits.
        // Once unblocked/acquired, we read the authoritative committed state.
        if (sortedSnapshotItemIds.length > 0) {
          let lockedRows: { id: string; quantity: number }[] = [];

          if (typeof (tx as any).$queryRaw === "function") {
            lockedRows = await (tx as any).$queryRaw`
              SELECT "id", "quantity"
              FROM "CartItem"
              WHERE "userId" = ${userId}
                AND "id" = ANY(${sortedSnapshotItemIds}::text[])
              ORDER BY "id" ASC
              FOR UPDATE
            `;
          } else {
            // Mock fallback if $queryRaw is not provided by the test environment
            const found = await tx.cartItem.findMany({
              where: {
                id: { in: sortedSnapshotItemIds },
                userId,
              },
              select: {
                id: true,
                quantity: true,
              },
              orderBy: {
                id: "asc",
              },
            });
            lockedRows = (found || []).map((row: any) => ({
              id: row.id,
              quantity: row.quantity,
            }));
          }

          // If none of the snapshot items exist, a concurrent checkout already consumed them.
          if (!lockedRows || lockedRows.length === 0) {
            throw new Error("CART_ALREADY_SUBMITTED");
          }

          // If any locked row has an invalid or missing id, abort safely (Section 6)
          const validLockedRows = lockedRows.filter(
            (row) => row && typeof row.id === "string" && row.id.trim().length > 0
          );
          if (validLockedRows.length !== lockedRows.length) {
            throw new Error("CART_MUTATED_DURING_CHECKOUT");
          }

          // If any snapshot item was removed, abort to avoid submitting an incomplete enquiry.
          if (lockedRows.length !== sortedSnapshotItemIds.length) {
            throw new Error("CART_MUTATED_DURING_CHECKOUT");
          }

          // Strict ID match: ensure every locked row belongs to the expected snapshot (Section 6)
          const snapshotIdSet = new Set(sortedSnapshotItemIds);
          for (const row of lockedRows) {
            if (!snapshotIdSet.has(row.id)) {
              throw new Error("CART_MUTATED_DURING_CHECKOUT");
            }
          }

          const lockedItemMap = new Map(lockedRows.map((item) => [item.id, item.quantity]));
          for (const item of cartItems) {
            const currentQty = lockedItemMap.get(item.id);
            if (currentQty === undefined || currentQty !== item.quantity) {
              throw new Error("CART_MUTATED_DURING_CHECKOUT");
            }
          }
        }

        const ordersList: typeof createdOrders = [];
        const allCandidatesToInsert: Array<{
          orderItemId: string;
          supplierId: string;
          listingId: string | null;
          unitPrice: number;
          rank: number;
        }> = [];

        let groupIdx = 0;
        const supportsBatchCandidates =
          typeof (tx as any).orderItemSupplierCandidate?.createMany === "function" ||
          typeof (tx as any).orderItemSupplierCandidate?.create === "function";

        for (const group of groups.values()) {
          const currentGroupIdx = groupIdx++;
          const totalAmount = group.items.reduce((acc, item) => acc + item.unitPrice * item.quantity, 0);
          const resolvedAt = new Date();

          // P0: Use the pre-allocated enquiry ID, falling back to generateEnquiryId(tx) if not pre-allocated
          const enquiryId =
            allocatedEnquiryIds[currentGroupIdx] ??
            (await generateEnquiryId(tx, {
              builderId: userId,
              builderName: builderForEnquiryId?.name,
              builderEmail: builderForEnquiryId?.email,
              siteId,
            }));

          const order = await tx.order.create({
            data: {
              userId,
              enquiryId,
              paymentMethod: PaymentMethod.BANK_TRANSFER,
              status: OrderStatus.PLACED,
              paymentStatus: PaymentStatus.PENDING,
              totalAmount,
              deliveryDate,
              deliveryLat: deliveryLat ?? undefined,
              deliveryLng: deliveryLng ?? undefined,
              deliveryAddress: deliveryAddress ?? undefined,
              siteId: siteId ?? undefined,

              items: {
                create: group.items.map((item) => ({
                  productId: item.productId,
                  supplierId: group.supplierId,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  supplierUnitPrice: item.supplierUnitPrice,
                  markupPercent: item.markupPercent,
                  markupAmount: item.markupAmount,
                  askPrice: item.askPrice ?? item.unitPrice,
                  deliveryDate,
                  canonicalProductId: item.canonicalProductId ?? undefined,
                  resolvedListingId: item.resolvedListingId ?? undefined,
                  tierMinQty: item.tierMinQty ?? undefined,
                  tierMaxQty: item.tierMaxQty ?? undefined,
                  priceAtResolution: item.resolvedListingId ? item.unitPrice : undefined,
                  resolvedAt: item.resolvedListingId ? resolvedAt : undefined,
                  // If candidate batch insertion is not supported in the current environment (e.g. legacy test mocks),
                  // keep nested candidate creation as a safe fallback
                  candidates:
                    !supportsBatchCandidates && item.candidates.length > 0
                      ? {
                          create: item.candidates.map((candidate, index) => ({
                            supplierId: candidate.supplierId,
                            listingId: candidate.listingId,
                            unitPrice: candidate.unitPrice,
                            rank: index,
                          })),
                        }
                      : undefined,
                })),
              },

              tracking: {
                create: {
                  status: OrderStatus.PLACED,
                  note: "Pending supplier confirmation",
                },
              },
            },
            select: {
              id: true,
              enquiryId: true,
              status: true,
              totalAmount: true,
              items: {
                select: {
                  id: true,
                },
              },
            },
          });

          // P0: If batch candidate insertion is supported, collect candidate records with real OrderItem IDs
          if (supportsBatchCandidates && Array.isArray(order?.items)) {
            for (let i = 0; i < group.items.length; i++) {
              const lineItem = group.items[i];
              const createdOrderItem = order.items[i];
              if (createdOrderItem && lineItem.candidates && lineItem.candidates.length > 0) {
                for (let cIdx = 0; cIdx < lineItem.candidates.length; cIdx++) {
                  const candidate = lineItem.candidates[cIdx];
                  allCandidatesToInsert.push({
                    orderItemId: createdOrderItem.id,
                    supplierId: candidate.supplierId,
                    listingId: candidate.listingId ?? null,
                    unitPrice: candidate.unitPrice,
                    rank: cIdx,
                  });
                }
              }
            }
          }

          ordersList.push({
            id: order.id,
            enquiryId: order.enquiryId ?? order.id,
            orderNumber: (order as any).orderNumber ?? null,
            supplierName: getSupplierDisplayName(group.supplierName, group.supplierId, currentGroupIdx),
            total: totalAmount,
            itemCount: group.items.length,
            status: order.status,
            itemIds: (order?.items || []).map((item: any) => item.id),
          });
        }

        // P0: Batch insert candidate suppliers across all orders in a single database operation
        if (allCandidatesToInsert.length > 0) {
          if (typeof (tx as any).orderItemSupplierCandidate?.createMany === "function") {
            await (tx as any).orderItemSupplierCandidate.createMany({
              data: allCandidatesToInsert,
            });
          } else if (typeof (tx as any).orderItemSupplierCandidate?.create === "function") {
            for (const c of allCandidatesToInsert) {
              await (tx as any).orderItemSupplierCandidate.create({ data: c });
            }
          }
        }

        // Cart deletion occurs only AFTER all required database writes succeed (Section 4).
        // Delete ONLY the exact snapshot items that were submitted in this checkout.
        // Any item added concurrently (e.g. Item C) is never deleted and remains safely in the cart (Section 3).
        const deleteWhere =
          sortedSnapshotItemIds.length > 0
            ? { id: { in: sortedSnapshotItemIds }, userId }
            : { userId };

        const deleteResult = await tx.cartItem.deleteMany({
          where: deleteWhere,
        });

        // Deletion Count Verification (Section 4):
        // The number of deleted rows must equal the number of snapshot items expected to be consumed.
        // If the count differs, roll back the transaction and return a safe error response.
        const expectedCount = sortedSnapshotItemIds.length;
        if (!deleteResult || typeof deleteResult.count !== "number" || deleteResult.count !== expectedCount) {
          if (deleteResult && deleteResult.count === 0) {
            throw new Error("CART_ALREADY_SUBMITTED");
          }
          throw new Error("CART_MUTATED_DURING_CHECKOUT");
        }

        // Record CartIdempotency atomically inside the checkout transaction
        if (options.idempotencyKey && typeof (tx as any).cartIdempotency?.create === "function") {
          await (tx as any).cartIdempotency.create({
            data: {
              userId,
              key: options.idempotencyKey,
              requestFingerprint,
              responseStatus: 201,
              responsePayload: { orders: ordersList },
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          });
        }

        return ordersList;
      },
      { maxWait: 5000, timeout: 10000 }
    );
  } catch (error: any) {
    if (
      options.idempotencyKey &&
      (error?.code === "P2002" || /unique.*constraint/i.test(error?.message ?? "")) &&
      typeof (prisma as any).cartIdempotency?.findUnique === "function"
    ) {
      const existing = await (prisma as any).cartIdempotency.findUnique({
        where: { userId_key: { userId, key: options.idempotencyKey } },
      });
      if (existing?.responsePayload && typeof existing.responsePayload === "object") {
        const payload = existing.responsePayload as any;
        return {
          ok: true,
          orders: Array.isArray(payload.orders) ? payload.orders : [],
        };
      }
    }
    if (error?.message === "CART_ALREADY_SUBMITTED") {
      return { ok: false, error: "Cart is empty", status: 400 };
    }
    if (error?.message === "CART_MUTATED_DURING_CHECKOUT") {
      return {
        ok: false,
        error: "Your cart was updated during checkout. Please review your cart and try again.",
        status: 409,
      };
    }
    if (
      error?.code === "P2034" ||
      error?.code === "40P01" ||
      error?.code === "40001" ||
      error?.code === "55P03" ||
      /deadlock|lock.*timeout|serialization.*failure/i.test(error?.message ?? "")
    ) {
      return {
        ok: false,
        error: "Checkout could not be completed due to a temporary conflict. Please try again.",
        status: 409,
      };
    }
    throw error;
  }

  // P1: Supplier WhatsApp notification dispatch with bounded concurrency (max 2 concurrent connections)
  // to prevent connection pool exhaustion and event-loop blocking while preserving all delivery records.
  const notificationTasks: Array<() => Promise<void>> = [];

  for (const order of createdOrders) {
    notificationTasks.push(async () => {
      try {
        await notifySupplierOrderSubmitted(order.id);
      } catch (error) {
        console.error(`Failed to send supplier notification for order ${order.id}:`, error);
      }
    });

    // Notification Engine — supplier_quote_alert WhatsApp template
    // (SUPPLIER_RFQ_RECEIVED). Fires once per newly-created OrderItem — each
    // item is a distinct RFQ line the just-assigned (rank-0) supplier is now
    // expected to quote. Uses the shared, framework-agnostic
    // notifySupplierRfqReceived() (packages/db/lib/supplier-rfq-received-notification.ts).
    for (const itemId of order.itemIds) {
      notificationTasks.push(async () => {
        try {
          await notifySupplierRfqReceived(prisma as any, { orderItemId: itemId }, (message) => {
            console.log(`[supplier-rfq-received] ${message}`);
          });
        } catch (error) {
          console.error(`Failed to send supplier_quote_alert notification for orderItem ${itemId}:`, error);
        }
      });
    }
  }

  if (notificationTasks.length > 0) {
    const notifyPromise = runWithBoundedConcurrency(notificationTasks, 2);
    // If Vercel serverless waitUntil exists, register it so the lambda does not terminate early
    if (typeof (globalThis as any)[Symbol.for("vercel.waitUntil")] === "function") {
      (globalThis as any)[Symbol.for("vercel.waitUntil")](notifyPromise);
    } else if (typeof (globalThis as any).waitUntil === "function") {
      (globalThis as any).waitUntil(notifyPromise);
    } else {
      // Give notifications up to 1.5s to finish cleanly within the request lifecycle without blocking indefinitely
      await Promise.race([
        notifyPromise,
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    }
  }

  // P1: Price-discovery snapshot hook — batch inserted via createMany where supported
  // (source: ORDER). Reliably persisted before returning response, but errors are safely
  // caught so snapshot-write failures never fail an otherwise successful checkout.
  //
  // Admin-Configurable Product Markup: price-discovery/market intelligence
  // (regional price comparison, trend reports consuming PriceSnapshot) must
  // reflect the real SUPPLIER market price, never the buyer's marked-up
  // figure — using item.unitPrice (post-markup) here would silently inflate
  // every downstream market-price report by the platform's own margin.
  const priceSnapshotsData: Array<{
    productId: string;
    supplierId: string;
    canonicalProductId?: string;
    price: number;
    source: "ORDER";
  }> = [];

  for (const group of groups.values()) {
    for (const item of group.items) {
      priceSnapshotsData.push({
        productId: item.productId,
        supplierId: group.supplierId,
        canonicalProductId: item.canonicalProductId ?? undefined,
        price: item.supplierUnitPrice,
        source: "ORDER",
      });
    }
  }

  if (priceSnapshotsData.length > 0) {
    if (typeof (prisma as any).priceSnapshot?.createMany === "function") {
      try {
        await (prisma as any).priceSnapshot.createMany({ data: priceSnapshotsData });
      } catch (error: any) {
        console.error("Failed to record price snapshots batch:", error);
      }
    } else if (typeof (prisma as any).priceSnapshot?.create === "function") {
      for (const snapshot of priceSnapshotsData) {
        try {
          await (prisma as any).priceSnapshot.create({ data: snapshot });
        } catch (error: any) {
          console.error(`Failed to record price snapshot for order item (product ${snapshot.productId}):`, error);
        }
      }
    }
  }

  return { ok: true, orders: createdOrders };
}

/**
 * P1: Executes an array of asynchronous tasks with bounded concurrency.
 * Ensures non-critical background jobs (notifications, tracking dispatches)
 * do not saturate the shared Prisma / PostgreSQL connection pool.
 */
async function runWithBoundedConcurrency(
  tasks: Array<() => Promise<void>>,
  concurrency = 2
): Promise<void> {
  if (tasks.length === 0) return;
  let nextIdx = 0;
  async function worker() {
    while (nextIdx < tasks.length) {
      const currentTask = tasks[nextIdx++];
      try {
        await currentTask();
      } catch {
        // Individual error logging handled inside currentTask
      }
    }
  }
  const workerCount = Math.min(concurrency, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

