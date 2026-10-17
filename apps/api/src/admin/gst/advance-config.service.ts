import { BadRequestException, Injectable } from "@nestjs/common";
import { isValidAdvancePercent } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";

// Global Advance Configuration — admin configuration service for the
// AdvanceConfig singleton row (see schema's "global" singleton-id
// convention, identical to NotificationGlobalSettings/AdvanceConfig.id's
// own @default("global")).
//
// IMPORTANT — this configuration is informational only (see AdvanceConfig's
// schema doc comment): it NEVER gates, blocks, or alters the existing
// optional Buildohub Advance Balance wallet or the existing bank-transfer
// payment flow. A buyer who pays nothing toward the displayed advance
// target can still fully use every existing payment path unchanged. This
// service never debits a wallet, never consumes a credit, and never adds a
// payment gate — it only stores the percentage used by
// packages/db/lib/order-payable-calculation.ts's calculateRequiredAdvanceAmount
// to compute an informational figure for display.
//
// Every write is audit-logged via the existing AuditLog model, mirroring
// MarkupService/GstService's established convention exactly.
@Injectable()
export class AdvanceConfigService {
  private static readonly SINGLETON_ID = "global";

  constructor(private readonly prisma: PrismaService) {}

  private assertValidPercentage(percentage: number) {
    if (!isValidAdvancePercent(percentage)) {
      throw new BadRequestException(
        "percentage must be a non-negative, finite number (negative/NaN/Infinity values are rejected)."
      );
    }
  }

  // Returns the singleton row, or null if never configured yet — distinct
  // from an explicit 0% (an intentionally-disabled-looking "no advance
  // requested" configuration is still a deliberate admin choice, never the
  // same as "nobody has ever configured this").
  async get() {
    return this.prisma.advanceConfig.findUnique({ where: { id: AdvanceConfigService.SINGLETON_ID } });
  }

  async upsert(percentage: number, isEnabled: boolean | undefined, actorId: string) {
    this.assertValidPercentage(percentage);

    const existing = await this.get();
    const data = {
      percentage,
      isEnabled: isEnabled ?? true,
      updatedBy: actorId,
    };

    const saved = existing
      ? await this.prisma.advanceConfig.update({ where: { id: AdvanceConfigService.SINGLETON_ID }, data })
      : await this.prisma.advanceConfig.create({ data: { id: AdvanceConfigService.SINGLETON_ID, ...data } });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: existing ? "ADVANCE_CONFIG_UPDATED" : "ADVANCE_CONFIG_CREATED",
        entityType: "AdvanceConfig",
        entityId: saved.id,
        metadata: { percentage, isEnabled: data.isEnabled },
      },
    });

    return saved;
  }
}
