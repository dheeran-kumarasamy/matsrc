import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";

/**
 * Surfaces supplier-rejected enquiries for ops staff, reusing the existing `AuditLog`
 * table (rows written by `EnquiryDecisionFlow.finalizeRejection`, tagged
 * `action: "ENQUIRY_REJECT"` and `metadata.requiresAdminAction: true`) rather than
 * introducing a new Prisma model — mirrors the read pattern in
 * `admin/whatsapp-escalations` (WhatsAppEscalationsService.findRecent).
 *
 * A supplier rejection deliberately does NOT notify the Builder over WhatsApp — it is
 * routed here instead so ops can decide next steps (re-route to another supplier,
 * contact the builder directly, etc.) with full context (reason, enquiry, builder,
 * product, supplier) without digging through raw audit logs.
 */
@Injectable()
export class SupplierRejectionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findRecent(
    limit: number = 50
  ): Promise<
    Array<{
      id: string;
      enquiryId: string;
      supplierId: string | null;
      supplierName: string | null;
      builderName: string | null;
      productName: string | null;
      reason: string | null;
      createdAt: Date;
    }>
  > {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        action: "ENQUIRY_REJECT",
        entityType: "Order",
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
    });

    return logs
      .filter((log) => {
        const metadata = (log.metadata as Record<string, unknown> | null) ?? {};
        return metadata.requiresAdminAction === true;
      })
      .map((log) => {
        const metadata = (log.metadata as Record<string, unknown> | null) ?? {};
        return {
          id: log.id,
          enquiryId: log.entityId,
          supplierId: typeof metadata.supplierId === "string" ? metadata.supplierId : null,
          supplierName: typeof metadata.supplierName === "string" ? metadata.supplierName : null,
          builderName: typeof metadata.builderName === "string" ? metadata.builderName : null,
          productName: typeof metadata.productName === "string" ? metadata.productName : null,
          reason: typeof metadata.reason === "string" ? metadata.reason : null,
          createdAt: log.createdAt,
        };
      });
  }
}
