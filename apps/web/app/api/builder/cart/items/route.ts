import { NextResponse } from "next/server";
import {
  prisma,
  resolveUnitPrice,
  formatCurrency,
  getOrCreateBuilder,
  resolveUserCtx,
} from "@/lib/builder-db";
import { getSupplierDisplayName } from "@/lib/supplier-display";
import {
  getCartForUser,
  resolveProductGroupForCart,
  computeRequestFingerprint,
} from "@/lib/cart-data";
import { resolveLowestPriceForQuantity } from "@/lib/resolution";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const ctx = await resolveUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const items = await prisma.cartItem.findMany({
      where: { userId: user.id },
      include: {
        product: {
          select: {
            name: true,
            unit: true,
            supplierId: true,
            basePrice: true,
            supplier: { select: { companyName: true } },
            pricingTiers: {
              select: { minQty: true, maxQty: true, tierPrice: true },
              orderBy: { minQty: "asc" },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const subtotal = items.reduce(
      (acc, item) =>
        acc +
        (item.resolvedUnitPrice != null
          ? Number(item.resolvedUnitPrice)
          : resolveUnitPrice(item.product, item.quantity)) *
          item.quantity,
      0
    );

    return NextResponse.json({
      items: items.map((item) => {
        const unitPrice =
          item.resolvedUnitPrice != null
            ? Number(item.resolvedUnitPrice)
            : resolveUnitPrice(item.product, item.quantity);

        return {
          id: item.id,
          productId: item.productId,
          name: item.product.name,
          unit: item.product.unit,
          supplierId: item.resolvedSupplierId ?? item.product.supplierId,
          supplierName: getSupplierDisplayName(
            item.product.supplier.companyName,
            item.resolvedSupplierId ?? item.product.supplierId
          ),
          quantity: item.quantity,
          unitPrice,
          lineTotal: unitPrice * item.quantity,
        };
      }),
      summary: {
        itemCount: items.length,
        subtotal,
        subtotalLabel: formatCurrency(subtotal),
      },
    });
  } catch (error: any) {
    if (error?.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    console.error("Cart items GET error:", error);
    return NextResponse.json({ error: "Failed to fetch cart" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));
    const productId = typeof body.productId === "string" ? body.productId.trim() : "";
    const quantity = Number(body.quantity);

    if (!productId || !Number.isInteger(quantity) || quantity < 1) {
      return NextResponse.json(
        { error: "Valid productId and quantity are required" },
        { status: 400 }
      );
    }

    // Operation-level idempotency key (header takes precedence, body fallback)
    const idempotencyKey = (
      request.headers.get("Idempotency-Key") ||
      request.headers.get("X-Idempotency-Key") ||
      (typeof body.idempotencyKey === "string" ? body.idempotencyKey : "")
    )?.trim();

    // Distinguish additive operation (Add to Enquiry Basket) from replacement
    // operation (quantity edit in cart drawer/page).
    const isSetMode =
      body.mode === "set" || (typeof body.cartItemId === "string" && body.cartItemId && body.mode !== "increment");
    const operationMode: "increment" | "set" = isSetMode ? "set" : "increment";
    const cartItemId = typeof body.cartItemId === "string" ? body.cartItemId.trim() : null;

    const requestFingerprint = idempotencyKey
      ? computeRequestFingerprint({
          productId,
          quantity,
          mode: operationMode,
          cartItemId,
        })
      : "";

    const runInTx =
      typeof prisma.$transaction === "function"
        ? (fn: (tx: any) => Promise<any>) =>
            prisma.$transaction(fn, { maxWait: 10000, timeout: 20000 })
        : (fn: (tx: any) => Promise<any>) => fn(prisma);

    const groupResult = await resolveProductGroupForCart(productId, quantity);
    if (!groupResult) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    const { product, candidates } = groupResult;

    let result: any;

    if (isSetMode) {
      // Replacement operation (mode: "set"):
      // Target existing item inside transaction with advisory lock.
      // If consumed or deleted by concurrent checkout, return a clear HTTP 409 Conflict response.
      // Never recreate an unapproved row automatically.
      try {
        result = await runInTx(async (tx: any) => {
          if (typeof tx.$executeRaw === "function") {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}), hashtext(${productId}))`;
          } else if (typeof tx.$queryRaw === "function") {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}), hashtext(${productId}))::text`;
          }

          // Durable Database-Backed Idempotency Check
          if (idempotencyKey && typeof tx.cartIdempotency?.findUnique === "function") {
            const existingRecord = await tx.cartIdempotency.findUnique({
              where: { userId_key: { userId: user.id, key: idempotencyKey } },
            });
            if (existingRecord) {
              // Check expiry: expired records must not be treated as valid duplicates
              if (existingRecord.expiresAt && existingRecord.expiresAt < new Date()) {
                return {
                  conflict: true,
                  status: 410,
                  error: "Idempotency key has expired. Please submit a new request with a fresh key.",
                };
              }

              if (existingRecord.requestFingerprint !== requestFingerprint) {
                return {
                  conflict: true,
                  status: 409,
                  error: "Idempotency key was previously used with a different request payload.",
                };
              }

              // Latest authoritative cart state for replay (prevents restoring stale cart snapshots)
              const currentCart = await getCartForUser(user.id, tx);
              const currentItem = currentCart.items.find((i) => i.productId === productId);
              return {
                cached: true,
                status: existingRecord.responseStatus || 200,
                payload: {
                  ...(existingRecord.responsePayload as any),
                  id: currentItem?.id ?? (existingRecord.responsePayload as any)?.id,
                  quantity: currentItem?.quantity ?? (existingRecord.responsePayload as any)?.quantity,
                  items: currentCart.items,
                  summary: currentCart.summary,
                  isReplay: true,
                },
              };
            }
          }

          let existing: any = null;
          if (typeof tx.$queryRaw === "function") {
            const rows =
              typeof body.cartItemId === "string" && body.cartItemId
                ? await tx.$queryRaw`
                    SELECT "id", "quantity"
                    FROM "CartItem"
                    WHERE "userId" = ${user.id} AND ("id" = ${body.cartItemId} OR "productId" = ${productId})
                    FOR UPDATE
                  `
                : await tx.$queryRaw`
                    SELECT "id", "quantity"
                    FROM "CartItem"
                    WHERE "userId" = ${user.id} AND "productId" = ${productId}
                    FOR UPDATE
                  `;
            existing = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
          }
          if (!existing) {
            existing = await tx.cartItem.findFirst({
              where: {
                userId: user.id,
                OR: [
                  ...(typeof body.cartItemId === "string" && body.cartItemId ? [{ id: body.cartItemId }] : []),
                  { productId },
                ],
              },
            });
          }

          if (!existing) {
            throw new Error("ITEM_CONSUMED_OR_NOT_FOUND");
          }

          const resolution = resolveLowestPriceForQuantity(candidates, quantity);
          const resolvedFields = resolution
            ? {
                resolvedListingId: resolution.listingId,
                resolvedSupplierId: resolution.supplierId || null,
                resolvedTierMinQty: resolution.tierMinQty,
                resolvedTierMaxQty: resolution.tierMaxQty,
                resolvedUnitPrice: resolution.unitPrice,
                resolvedAt: new Date(),
              }
            : {};

          const updatedItem = await tx.cartItem.update({
            where: { id: existing.id },
            data: {
              quantity,
              ...resolvedFields,
            },
          });

          const cart = await getCartForUser(user.id, tx);
          const responsePayload = {
            id: updatedItem.id,
            productId: updatedItem.productId,
            quantity: updatedItem.quantity,
            resolvedSupplierId: updatedItem.resolvedSupplierId,
            resolvedUnitPrice: updatedItem.resolvedUnitPrice != null ? Number(updatedItem.resolvedUnitPrice) : null,
            items: cart.items,
            summary: cart.summary,
          };

          if (idempotencyKey && typeof tx.cartIdempotency?.create === "function") {
            await tx.cartIdempotency.create({
              data: {
                userId: user.id,
                key: idempotencyKey,
                requestFingerprint,
                responseStatus: 200,
                responsePayload,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24-hour durability
              },
            });
          }

          return { success: true, payload: responsePayload };
        });
      } catch (error: any) {
        if (
          error?.message === "ITEM_CONSUMED_OR_NOT_FOUND" ||
          error?.code === "P2025" ||
          /record.*not found/i.test(error?.message ?? "")
        ) {
          const cart = await getCartForUser(user.id);
          return NextResponse.json(
            {
              error: "This cart item was checked out or removed. Please refresh your cart.",
              message: "This cart item was checked out or removed. Please refresh your cart.",
              items: cart.items,
              summary: cart.summary,
            },
            { status: 409 }
          );
        }
        if (error?.message === "PRODUCT_NOT_FOUND") {
          return NextResponse.json({ error: "Product not found" }, { status: 404 });
        }
        if (
          error?.code === "P2034" ||
          error?.code === "P2028" ||
          error?.code === "40P01" ||
          error?.code === "40001" ||
          /deadlock|conflict|serialization|expired transaction|timeout/i.test(error?.message ?? "")
        ) {
          const cart = await getCartForUser(user.id);
          return NextResponse.json(
            {
              error: "Cart was updated concurrently. Please refresh your cart.",
              message: "Cart was updated concurrently. Please refresh your cart.",
              items: cart.items,
              summary: cart.summary,
            },
            { status: 409 }
          );
        }

        // P2002 handling: Unique constraint violation on CartIdempotency(userId, key)
        if (
          idempotencyKey &&
          (error?.code === "P2002" || /unique.*constraint/i.test(error?.message ?? ""))
        ) {
          const existing = await prisma.cartIdempotency.findUnique({
            where: { userId_key: { userId: user.id, key: idempotencyKey } },
          });
          if (existing) {
            if (existing.requestFingerprint !== requestFingerprint) {
              return NextResponse.json(
                {
                  error: "Idempotency key was previously used with a different request payload.",
                  message: "Idempotency key was previously used with a different request payload.",
                },
                { status: 409 }
              );
            }
            const currentCart = await getCartForUser(user.id);
            const currentItem = currentCart.items.find((i) => i.productId === productId);
            return NextResponse.json(
              {
                ...(existing.responsePayload as any),
                id: currentItem?.id ?? (existing.responsePayload as any)?.id,
                quantity: currentItem?.quantity ?? (existing.responsePayload as any)?.quantity,
                items: currentCart.items,
                summary: currentCart.summary,
                isReplay: true,
              },
              { status: existing.responseStatus || 200 }
            );
          }
        }

        throw error;
      }
    } else {
      // Additive operation (mode: "increment"):
      // Database-level serialization:
      // 1. Transaction-scoped advisory lock on (userId, productId) ensures strict serialization
      //    across concurrent additions (e.g. Tab 2 +5, Tab 3 +3) without lost updates.
      // 2. Database-backed durable idempotency check: prevents duplicate increments across
      //    instances, restarts, and concurrent retries.
      // 3. Row-level read with FOR UPDATE coordinates with checkout: if checkout holds the row lock,
      //    we wait. If checkout deletes the row, we read null and create a fresh row with only the added quantity.
      // 4. Dynamic quantity-tier pricing re-resolution for the actual committed final quantity.
      // 5. Atomic upsert and durable idempotency record persistence inside the same transaction.
      const MAX_ADD_ATTEMPTS = 3;

      for (let attempt = 1; attempt <= MAX_ADD_ATTEMPTS; attempt++) {
        try {
          result = await runInTx(async (tx: any) => {
            if (typeof tx.$executeRaw === "function") {
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}), hashtext(${productId}))`;
            } else if (typeof tx.$queryRaw === "function") {
              await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}), hashtext(${productId}))::text`;
            }

            // Durable Database-Backed Idempotency Check
            if (idempotencyKey && typeof tx.cartIdempotency?.findUnique === "function") {
              const existingRecord = await tx.cartIdempotency.findUnique({
                where: { userId_key: { userId: user.id, key: idempotencyKey } },
              });
              if (existingRecord) {
                // Check expiry: expired records must not be treated as valid duplicates
                if (existingRecord.expiresAt && existingRecord.expiresAt < new Date()) {
                  return {
                    conflict: true,
                    status: 410,
                    error: "Idempotency key has expired. Please submit a new request with a fresh key.",
                  };
                }

                if (existingRecord.requestFingerprint !== requestFingerprint) {
                  return {
                    conflict: true,
                    status: 409,
                    error: "Idempotency key was previously used with a different request payload.",
                  };
                }

                // Latest authoritative cart state for replay (prevents restoring stale cart snapshots)
                const currentCart = await getCartForUser(user.id, tx);
                const currentItem = currentCart.items.find((i) => i.productId === productId);
                return {
                  cached: true,
                  status: existingRecord.responseStatus || 200,
                  payload: {
                    ...(existingRecord.responsePayload as any),
                    id: currentItem?.id ?? (existingRecord.responsePayload as any)?.id,
                    quantity: currentItem?.quantity ?? (existingRecord.responsePayload as any)?.quantity,
                    items: currentCart.items,
                    summary: currentCart.summary,
                    isReplay: true,
                  },
                };
              }
            }

            let current: any = null;
            if (typeof tx.$queryRaw === "function") {
              const rows = await tx.$queryRaw`
                SELECT "id", "quantity"
                FROM "CartItem"
                WHERE "userId" = ${user.id} AND "productId" = ${productId}
                FOR UPDATE
              `;
              current = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
            }
            if (!current) {
              current = await tx.cartItem.findUnique({
                where: { userId_productId: { userId: user.id, productId } },
              });
            }

            // Actual final committed quantity for this cart item
            const targetQuantity = current ? current.quantity + quantity : quantity;

            // Re-resolve pricing tier for the ACTUAL final quantity
            const resolution = resolveLowestPriceForQuantity(candidates, targetQuantity);
            const resolvedFields = resolution
              ? {
                  resolvedListingId: resolution.listingId,
                  resolvedSupplierId: resolution.supplierId || null,
                  resolvedTierMinQty: resolution.tierMinQty,
                  resolvedTierMaxQty: resolution.tierMaxQty,
                  resolvedUnitPrice: resolution.unitPrice,
                  resolvedAt: new Date(),
                }
              : {};

            const savedItem = await tx.cartItem.upsert({
              where: { userId_productId: { userId: user.id, productId: product.id } },
              update: {
                quantity: targetQuantity,
                ...resolvedFields,
              },
              create: {
                userId: user.id,
                productId: product.id,
                quantity: targetQuantity,
                ...resolvedFields,
              },
            });

            const cart = await getCartForUser(user.id, tx);
            const responsePayload = {
              id: savedItem.id,
              productId: savedItem.productId,
              quantity: savedItem.quantity,
              resolvedSupplierId: savedItem.resolvedSupplierId,
              resolvedUnitPrice: savedItem.resolvedUnitPrice != null ? Number(savedItem.resolvedUnitPrice) : null,
              items: cart.items,
              summary: cart.summary,
            };

            // Atomically record the idempotency token inside the SAME transaction
            if (idempotencyKey && typeof tx.cartIdempotency?.create === "function") {
              await tx.cartIdempotency.create({
                data: {
                  userId: user.id,
                  key: idempotencyKey,
                  requestFingerprint,
                  responseStatus: 200,
                  responsePayload,
                  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24-hour durability
                },
              });
            }

            return { success: true, payload: responsePayload };
          });

          break; // Succeeded!
        } catch (error: any) {
          if (error?.message === "PRODUCT_NOT_FOUND") {
            return NextResponse.json({ error: "Product not found" }, { status: 404 });
          }

          // P2002 handling on CartIdempotency unique constraint
          // If a competing transaction commits the same idempotency key concurrently:
          // 1. Allow this failed transaction to roll back cleanly.
          // 2. Resolve the existing idempotency record OUTSIDE the failed transaction.
          // 3. Compare the request fingerprint.
          // 4. Return the original operation outcome for matching payload; 409 for mismatch.
          if (
            idempotencyKey &&
            (error?.code === "P2002" || /unique.*constraint/i.test(error?.message ?? ""))
          ) {
            try {
              const existingRecord = await prisma.cartIdempotency.findUnique({
                where: { userId_key: { userId: user.id, key: idempotencyKey } },
              });
              if (existingRecord) {
                if (existingRecord.requestFingerprint !== requestFingerprint) {
                  return NextResponse.json(
                    {
                      error: "Idempotency key was previously used with a different request payload.",
                      message: "Idempotency key was previously used with a different request payload.",
                    },
                    { status: 409 }
                  );
                }
                const currentCart = await getCartForUser(user.id);
                const currentItem = currentCart.items.find((i) => i.productId === productId);
                return NextResponse.json(
                  {
                    ...(existingRecord.responsePayload as any),
                    id: currentItem?.id ?? (existingRecord.responsePayload as any)?.id,
                    quantity: currentItem?.quantity ?? (existingRecord.responsePayload as any)?.quantity,
                    items: currentCart.items,
                    summary: currentCart.summary,
                    isReplay: true,
                  },
                  { status: existingRecord.responseStatus || 200 }
                );
              }
            } catch (resolveErr) {
              console.error("Failed to resolve competing idempotency record:", resolveErr);
            }
          }

          const isConcurrentRace =
            error?.code === "P2025" || // Row deleted while waiting for lock (checkout consumed it)
            /record.*not found/i.test(error?.message ?? "");

          if (isConcurrentRace && attempt < MAX_ADD_ATTEMPTS) {
            continue;
          }

          if (
            error?.code === "P2034" ||
            error?.code === "P2028" ||
            error?.code === "40P01" ||
            error?.code === "40001" ||
            /deadlock|conflict|serialization|expired transaction|timeout/i.test(error?.message ?? "")
          ) {
            const cart = await getCartForUser(user.id);
            return NextResponse.json(
              {
                error: "Cart was updated concurrently. Please retry adding this item.",
                message: "Cart was updated concurrently. Please retry adding this item.",
                items: cart.items,
                summary: cart.summary,
              },
              { status: 409 }
            );
          }
          throw error;
        }
      }
    }

    if (result?.conflict) {
      return NextResponse.json(
        { error: result.error, message: result.error },
        { status: result.status || 409 }
      );
    }

    if (result?.cached) {
      return NextResponse.json(result.payload, { status: result.status || 200 });
    }

    if (result?.success) {
      return NextResponse.json(result.payload);
    }

    throw new Error("UNEXPECTED_CART_MUTATION_OUTCOME");
  } catch (error: any) {
    if (error?.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    if (
      error?.code === "P2034" ||
      error?.code === "P2028" ||
      error?.code === "40P01" ||
      error?.code === "40001" ||
      /deadlock|conflict|serialization|expired transaction|timeout/i.test(error?.message ?? "")
    ) {
      return NextResponse.json(
        { error: "Cart was updated concurrently. Please try again." },
        { status: 409 }
      );
    }
    console.error("Cart items POST error:", error);
    return NextResponse.json(
      { error: "Failed to update cart" },
      { status: 500 }
    );
  }
}
