import { NextResponse } from "next/server";
import { SiteStatus } from "@matsrc/db";
import {
  prisma,
  getOrCreateBuilder,
  getUserCtx,
} from "@/lib/builder-db";

export const dynamic = "force-dynamic";

// PATCH /api/builder/sites/[id] — update site details or change status
// (ACTIVE/ARCHIVED, i.e. "archive"). Builder-scoped: only ever mutates a
// site owned by the authenticated builder — never cross-builder.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = getUserCtx(request);
    const user = await getOrCreateBuilder(ctx.userId, ctx.email, ctx.name);
    const body = await request.json().catch(() => ({}));

    const site = await prisma.site.findFirst({
      where: { id: params.id, builderId: user.id },
      select: { id: true },
    });
    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};

    if (typeof body.name === "string" && body.name.trim()) {
      const name = body.name.trim();
      const existing = await prisma.site.findUnique({
        where: { builderId_name: { builderId: user.id, name } },
        select: { id: true },
      });
      if (existing && existing.id !== site.id) {
        return NextResponse.json(
          { error: "A site with this name already exists" },
          { status: 409 }
        );
      }
      data.name = name;
    }
    if ("code" in body) {
      data.code = typeof body.code === "string" && body.code.trim() ? body.code.trim() : null;
    }
    if ("addressLine" in body) {
      data.addressLine =
        typeof body.addressLine === "string" && body.addressLine.trim()
          ? body.addressLine.trim()
          : null;
    }
    if ("city" in body) {
      data.city = typeof body.city === "string" && body.city.trim() ? body.city.trim() : null;
    }
    if ("state" in body) {
      data.state = typeof body.state === "string" && body.state.trim() ? body.state.trim() : null;
    }
    if ("pincode" in body) {
      data.pincode = typeof body.pincode === "string" && body.pincode.trim() ? body.pincode.trim() : null;
    }
    if ("gstin" in body) {
      data.gstin = typeof body.gstin === "string" && body.gstin.trim() ? body.gstin.trim() : null;
    }
    if ("lat" in body) {
      data.lat = typeof body.lat === "number" && Number.isFinite(body.lat) ? body.lat : null;
    }
    if ("lng" in body) {
      data.lng = typeof body.lng === "number" && Number.isFinite(body.lng) ? body.lng : null;
    }
    if (body.status === "ACTIVE" || body.status === "ARCHIVED") {
      data.status = body.status as SiteStatus;
    }

    const updated = await prisma.site.update({
      where: { id: site.id },
      data,
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


    return NextResponse.json(updated);
  } catch (error) {
    console.error("Site PATCH error:", error);
    return NextResponse.json({ error: "Failed to update site" }, { status: 500 });
  }
}
