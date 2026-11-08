import { NextResponse } from "next/server";
import { revalidateTag, revalidatePath } from "next/cache";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * Constant-time comparison between two strings using fixed-length SHA-256 digests.
 * Both digests are guaranteed to be exactly 32 bytes, eliminating length-based timing leaks.
 */
function timingSafeSecretMatch(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  const hashA = crypto.createHash("sha256").update(a, "utf8").digest();
  const hashB = crypto.createHash("sha256").update(b, "utf8").digest();

  return crypto.timingSafeEqual(hashA, hashB);
}

// Strict allowlists for catalogue resources only.
// Product IDs in matsrc use CUID format or alphanumeric/hyphen/underscore identifiers up to 64 chars.
const VALID_TAG_REGEX = /^(catalog-listings|product-[a-zA-Z0-9_-]{1,64})$/;
const VALID_PATH_REGEX = /^\/products(\/[a-zA-Z0-9_-]{1,64})?$/;
const MAX_ALLOWED_ITEMS = 50;

/**
 * Secure Server-to-Server Cache Invalidation Endpoint
 *
 * Allows authorized internal services (such as the Supplier App or Admin workers)
 * to immediately invalidate Next.js Data Cache tags and Route paths upon product,
 * price, stock, or markup changes.
 *
 * Security: Gated by dedicated INTERNAL_REVALIDATION_SECRET token using fixed-digest timingSafeEqual.
 * Rejects unauthenticated requests with 401 before any body parsing or cache invalidation.
 * Enforces strict allowlisting on tags and paths to prevent unauthorized route purges.
 */
export async function POST(req: Request) {
  const configuredSecret = process.env.INTERNAL_REVALIDATION_SECRET;

  if (!configuredSecret) {
    console.error("[revalidate-endpoint] Error: INTERNAL_REVALIDATION_SECRET is not configured on this server");
    return NextResponse.json(
      { message: "INTERNAL_REVALIDATION_SECRET is not configured on this server" },
      { status: 500 }
    );
  }

  const incomingSecret =
    req.headers.get("x-revalidate-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!incomingSecret || !timingSafeSecretMatch(incomingSecret, configuredSecret)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ message: "Invalid request body" }, { status: 400 });
    }

    // Extract raw tags
    let rawTags: unknown[] = [];
    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags)) {
        return NextResponse.json({ message: "tags must be an array" }, { status: 400 });
      }
      rawTags = body.tags;
    } else if (body.tag !== undefined) {
      if (typeof body.tag !== "string") {
        return NextResponse.json({ message: "tag must be a string" }, { status: 400 });
      }
      rawTags = [body.tag];
    } else {
      rawTags = ["catalog-listings"];
    }

    // Extract raw paths
    let rawPaths: unknown[] = [];
    if (body.paths !== undefined) {
      if (!Array.isArray(body.paths)) {
        return NextResponse.json({ message: "paths must be an array" }, { status: 400 });
      }
      rawPaths = body.paths;
    } else if (body.path !== undefined) {
      if (typeof body.path !== "string") {
        return NextResponse.json({ message: "path must be a string" }, { status: 400 });
      }
      rawPaths = [body.path];
    } else {
      rawPaths = [];
    }

    if (rawTags.length > MAX_ALLOWED_ITEMS || rawPaths.length > MAX_ALLOWED_ITEMS) {
      return NextResponse.json({ message: "Too many tags or paths specified" }, { status: 400 });
    }

    // Validate every tag against strict allowlist
    const validatedTags: string[] = [];
    for (const item of rawTags) {
      if (typeof item !== "string") {
        return NextResponse.json({ message: "Every tag must be a string" }, { status: 400 });
      }
      const trimmed = item.trim();
      if (!VALID_TAG_REGEX.test(trimmed)) {
        return NextResponse.json({ message: `Disallowed or malformed tag: ${trimmed}` }, { status: 400 });
      }
      validatedTags.push(trimmed);
    }

    // Validate every path against strict allowlist
    const validatedPaths: string[] = [];
    for (const item of rawPaths) {
      if (typeof item !== "string") {
        return NextResponse.json({ message: "Every path must be a string" }, { status: 400 });
      }
      const trimmed = item.trim();
      if (!VALID_PATH_REGEX.test(trimmed)) {
        return NextResponse.json({ message: `Disallowed or malformed path: ${trimmed}` }, { status: 400 });
      }
      validatedPaths.push(trimmed);
    }

    const tags = Array.from(new Set(validatedTags));
    const paths = Array.from(new Set(validatedPaths));

    // Next.js App Router ISR gap fix: if catalog-listings tag is invalidated,
    // also ensure /products path is invalidated so static page HTML is regenerated.
    if (tags.includes("catalog-listings") && !paths.includes("/products")) {
      paths.push("/products");
    }

    for (const tag of tags) {
      revalidateTag(tag);
    }

    for (const path of paths) {
      revalidatePath(path);
    }

    return NextResponse.json({
      revalidated: true,
      tags,
      paths,
      now: Date.now(),
    });
  } catch (error: any) {
    console.error("Cache Revalidation Error:", error);
    return NextResponse.json({ message: error?.message || "Revalidation failed" }, { status: 500 });
  }
}

