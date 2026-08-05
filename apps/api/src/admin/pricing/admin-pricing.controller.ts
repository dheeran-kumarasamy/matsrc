import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AnomalyReason } from "@matsrc/db";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { PrismaService } from "src/prisma/prisma.service";
import { PricingAnomalyDetectionService } from "src/pricing/pricing-anomaly-detection.service";
import { PricingDailyRollupService } from "src/pricing/pricing-daily-rollup.service";
import { PricingMonthlyRollupService } from "src/pricing/pricing-monthly-rollup.service";
import { ResolveAnomalyDto } from "./dto/resolve-anomaly.dto";
import { TriggerDailyRollupDto, TriggerMonthlyRollupDto } from "./dto/trigger-rollup.dto";

/**
 * Phase 4 admin surface for the Price Intelligence module: anomaly review
 * and manual rollup triggers. Follows the same guard/role shape as
 * AdminAggregationController.
 */
@Controller("admin/pricing")
@UseGuards(OptionalJwtAuthGuard, RoleGuard)
@Roles("ADMIN")
export class AdminPricingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly anomalyDetection: PricingAnomalyDetectionService,
    private readonly dailyRollup: PricingDailyRollupService,
    private readonly monthlyRollup: PricingMonthlyRollupService
  ) {}

  @Get("anomalies")
  getAnomalies(
    @Query("reason") reason?: AnomalyReason,
    @Query("resolved") resolved?: string,
    @Query("from") from?: string,
    @Query("to") to?: string
  ) {
    const where: Record<string, unknown> = {};
    if (reason) where.reason = reason;
    if (resolved === "true") where.resolvedAt = { not: null };
    if (resolved === "false") where.resolvedAt = null;
    if (from || to) {
      where.detectedAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }

    return this.prisma.pricingAnomaly.findMany({
      where,
      orderBy: { detectedAt: "desc" },
      take: 200,
      include: {
        observation: {
          include: {
            canonicalSku: { select: { id: true, code: true } },
            district: { select: { id: true, code: true, name: true } },
            source: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
  }

  @Post("anomalies/:id/resolve")
  async resolveAnomaly(@CurrentUser() user: any, @Param("id") id: string, @Body() dto: ResolveAnomalyDto) {
    const anomaly = await this.prisma.pricingAnomaly.findUnique({ where: { id }, include: { observation: true } });
    if (!anomaly) {
      throw new NotFoundException("Anomaly not found");
    }
    if (anomaly.resolvedAt) {
      throw new BadRequestException("Anomaly already resolved");
    }

    const adminId = user?.userId ?? user?.id ?? null;

    const updates: Promise<unknown>[] = [
      this.prisma.pricingAnomaly.update({
        where: { id },
        data: {
          resolvedByAdminId: adminId,
          resolvedAt: new Date(),
          resolutionAction: dto.note ? `${dto.action}: ${dto.note}` : dto.action,
        },
      }),
    ];

    // "accepted" means the flagged price was actually legitimate — reverse
    // the soft-exclusion so the observation re-enters the next rollup.
    if (dto.action === "accepted" && anomaly.observationId) {
      updates.push(
        this.prisma.pricingObservation.update({
          where: { id: anomaly.observationId },
          data: { isExcluded: false, exclusionReason: null },
        })
      );
    }

    await this.prisma.$transaction(updates as any);

    return this.prisma.pricingAnomaly.findUnique({ where: { id } });
  }

  @Post("rollups/daily")
  async triggerDailyRollup(@Body() dto: TriggerDailyRollupDto) {
    const priceDate = new Date(dto.priceDate);
    if (Number.isNaN(priceDate.getTime())) {
      throw new BadRequestException("Invalid priceDate");
    }

    const detection = await this.anomalyDetection.detectForDate(priceDate);
    const rollup = await this.dailyRollup.rollupForDate(priceDate);
    return { priceDate: dto.priceDate, detection, rollup };
  }

  @Post("rollups/monthly")
  async triggerMonthlyRollup(@Body() dto: TriggerMonthlyRollupDto) {
    const monthStart = new Date(dto.monthStart);
    if (Number.isNaN(monthStart.getTime())) {
      throw new BadRequestException("Invalid monthStart");
    }

    const result = await this.monthlyRollup.rollupForMonth(monthStart);
    return { monthStart: dto.monthStart, result };
  }
}
