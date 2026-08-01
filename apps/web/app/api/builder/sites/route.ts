import { NextResponse } from "next/server";
import {
  prisma,
  getOrCreateBuilder,
  getUserCtx,
} from "@/lib/builder-db";

export const dynamic = "force-dynamic";

// GET /api/builder/sites — list all sites (active + archived) for the
// authenticated builder, with a live order count for each. Builder-scoped
// only (never cross-builder).
export async function GET(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);

    const sites = await prisma.site.findMany({
      where: { builderId: user.id },
      select: {
        id: true,
        name: true,
        code: true,
        addressLine: true,
        city: true,
        state: true,
        pincode: true,
        gstin: true,
        lat: true,
        lng: true,
        status: true,
        createdAt: true,
        _count: { select: { orders: true } },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });

    return NextResponse.json(
      sites.map((site) => ({
        id: site.id,
        name: site.name,
        code: site.code,
        addressLine: site.addressLine,
        city: site.city,
        state: site.state,
        pincode: site.pincode,
        gstin: site.gstin,
        lat: site.lat,
        lng: site.lng,
        status: site.status,
        createdAt: site.createdAt,
        orderCount: site._count.orders,
      }))
    );

  } catch (error) {
    console.error("Sites GET error:", error);
    return NextResponse.json({ error: "Failed to fetch sites" }, { status: 500 });
  }
}

// POST /api/builder/sites — create a new site/project for this builder.
export async function POST(request: Request) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Site name is required" }, { status: 400 });
    }

    const existing = await prisma.site.findUnique({
      where: { builderId_name: { builderId: user.id, name } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: "A site with this name already exists" },
        { status: 409 }
      );
    }

    const site = await prisma.site.create({
      data: {
        builderId: user.id,
        name,
        code: typeof body.code === "string" && body.code.trim() ? body.code.trim() : null,
        addressLine:
          typeof body.addressLine === "string" && body.addressLine.trim()
            ? body.addressLine.trim()
            : null,
        city: typeof body.city === "string" && body.city.trim() ? body.city.trim() : null,
        state: typeof body.state === "string" && body.state.trim() ? body.state.trim() : null,
        pincode: typeof body.pincode === "string" && body.pincode.trim() ? body.pincode.trim() : null,
        gstin: typeof body.gstin === "string" && body.gstin.trim() ? body.gstin.trim() : null,
        lat: typeof body.lat === "number" && Number.isFinite(body.lat) ? body.lat : null,
        lng: typeof body.lng === "number" && Number.isFinite(body.lng) ? body.lng : null,
      },
      select: {
        id: true,
        name: true,
        code: true,
        addressLine: true,
        city: true,
        state: true,
        pincode: true,
        gstin: true,
        lat: true,
        lng: true,
        status: true,
        createdAt: true,
      },
    });


    return NextResponse.json(site, { status: 201 });
  } catch (error) {
    console.error("Sites POST error:", error);
    return NextResponse.json({ error: "Failed to create site" }, { status: 500 });
  }
}
