import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AnomalyReason } from "@matsrc/db";
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard";
import { Roles } from "src/auth/roles.decorator";
import { RoleGuard } from "src/auth/role.guard";
import { CurrentUser } from "src/auth/current-user.decorator";
import { PrismaService } from "src/prisma/prisma.service";
import { PricingAnomalyDetectionService } from "src/pricing/pricing-anomaly-detection.service";
import { PricingDailyRollupService } from "src/pricing/pricing-daily-rollup.service";
import { PricingMonthlyRollupService } from "src/pricing/pricing-monthly-rollup.service";
import { PricingIngestionService } from "src/pricing/pricing-ingestion.service";
import { ResolveAnomalyDto } from "./dto/resolve-anomaly.dto";
import { TriggerDailyRollupDto, TriggerMonthlyRollupDto } from "./dto/trigger-rollup.dto";
import { TriggerIngestDto } from "./dto/trigger-ingest.dto";
import { PricingAdminOpsService } from "./pricing-admin-ops.service";
import { UpdateSourceStatusDto } from "./dto/update-source-status.dto";
import { UpdateEndpointStatusDto } from "./dto/update-endpoint-status.dto";
import { MergeCanonicalSkuDto } from "./dto/merge-canonical-sku.dto";
import { RenameCanonicalSkuDto } from "./dto/rename-canonical-sku.dto";
import { AliasActionDto } from "./dto/alias-action.dto";
import { BulkAssignAliasDto } from "./dto/bulk-assign-alias.dto";
import { UnmappedQueueActionDto, BulkUnmappedQueueActionDto } from "./dto/unmapped-queue-action.dto";
import { BulkResolveAnomalyDto, CommentAnomalyDto } from "./dto/bulk-resolve-anomaly.dto";



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
    private readonly monthlyRollup: PricingMonthlyRollupService,
    private readonly ingestion: PricingIngestionService,
    private readonly ops: PricingAdminOpsService
  ) {}

  // ───────────────────────── Batch A: Dashboard ─────────────────────────

  @Get("dashboard")
  getDashboard() {
    return this.ops.getDashboardSummary();
  }

  // ───────────────────────── Batch A: Source Management ─────────────────────────

  @Get("sources")
  listSources() {
    return this.ops.listSources();
  }

  @Patch("sources/:id/status")
  updateSourceStatus(@CurrentUser() user: any, @Param("id") id: string, @Body() dto: UpdateSourceStatusDto) {
    const actorId = user?.userId ?? user?.id ?? "unknown";
    return this.ops.updateSourceStatus(id, dto.action, dto.reason, actorId);
  }

  @Post("sources/:id/test-connection")
  testSourceConnection(@CurrentUser() user: any, @Param("id") id: string) {
    const actorId = user?.userId ?? user?.id ?? "unknown";
    return this.ops.testSourceConnection(id, actorId);
  }

  // ───────────────────────── Batch A: Endpoint Health ─────────────────────────

  @Get("endpoints")
  listEndpoints(@Query("sourceId") sourceId?: string) {
    return this.ops.listEndpoints(sourceId);
  }

  @Patch("endpoints/:id/status")
  updateEndpointStatus(@CurrentUser() user: any, @Param("id") id: string, @Body() dto: UpdateEndpointStatusDto) {
    const actorId = user?.userId ?? user?.id ?? "unknown";
    return this.ops.updateEndpointStatus(id, dto.action, dto.reason, actorId);
  }

  @Post("endpoints/:id/retry")
  async retryEndpoint(@CurrentUser() user: any, @Param("id") id: string) {
    const actorId = user?.userId ?? user?.id ?? "unknown";
    try {
      return await this.ops.retryEndpoint(id, actorId);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : String(error));
    }
  }

  // ───────────────────────── Batch A: Scheduler Dashboard ─────────────────────────

  @Get("scheduler")
  getScheduler() {
    return this.ops.getSchedulerStatus();
  }

  @Post("scheduler/:name/pause")
  pauseScheduler(@CurrentUser() user: any, @Param("name") name: string) {
    const actorId = user?.userId ?? user?.id ?? "unknown";
    return this.ops.pauseSchedulerJob(name, actorId);
  }

  @Post("scheduler/:name/resume")
  resumeScheduler(@CurrentUser() user: any, @Param("name") name: string) {
    const actorId = user?.userId ?? user?.id ?? "unknown";
    return this.ops.resumeSchedulerJob(name, actorId);
  }

  // ───────────────────────── Batch A: Rollup Administration ─────────────────────────

  @Get("rollups/status")
  getRollupStatus() {
    return this.ops.getRollupStatus();
  }

  @Post("rollups/daily/preview")
  previewDailyRollup(@Body() dto: TriggerDailyRollupDto) {
    const priceDate = new Date(dto.priceDate);
    if (Number.isNaN(priceDate.getTime())) {
      throw new BadRequestException("Invalid priceDate");
    }
    return this.ops.previewDailyRollup(priceDate);
  }


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

  /**
   * Ad-hoc "Force Run" trigger for a single PricingSourceEndpoint's
   * ingestion — invokes PricingIngestionService.ingestEndpoint() directly.
   * Uses whichever ApifyActorClient is currently bound in PricingModule
   * (StubApifyActorClient unless PRICING_APIFY_LIVE_ENABLED=true and a
   * LiveApifyActorClient is wired in).
   */
  @Post("endpoints/:id/ingest")
  async triggerIngest(@CurrentUser() user: any, @Param("id") id: string, @Body() dto: TriggerIngestDto) {
    const triggeredBy = dto.triggeredBy ?? `admin:${user?.userId ?? user?.id ?? "unknown"}`;
    try {
      return await this.ingestion.ingestEndpoint(id, triggeredBy);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : String(error));
    }
  }

  // ───────────────────────── Batch C: Canonical SKU Management ─────────────────────────

  @Get("sku/canonical")
  listCanonicalSkus(@Query("search") search?: string) {
    return this.ops.listCanonicalSkus(search);
  }

  @Get("sku/canonical/:id/history")
  getCanonicalSkuHistory(@Param("id") id: string) {
    return this.ops.getCanonicalSkuHistory(id);
  }

  @Post("sku/canonical/:id/merge")
  mergeCanonicalSku(@CurrentUser() user: any, @Param("id") id: string, @Body() dto: MergeCanonicalSkuDto) {
    const actorId = user?.userId ?? user?.id ?? "unknown";
    return this.ops.mergeCanonicalSku(id, dto.targetSkuId, actorId);
  }

  @Post("sku/canonical/:id/rename")
  renameCanonicalSku(@CurrentUser() user: any, @Param("id") id: string, @Body() dto: RenameCanonicalSkuDto) {
    const actorId = user?.userId ?? user?.id ?? "unknown";
    return this.ops.renameCanonicalSku(id, dto.code, dto.grade, actorId);
  }

  @Post("sku/alias/:id/action")
  aliasAction(@CurrentUser() user: any, @Param("id") id: string, @Body() dto: AliasActionDto) {
    const actorId = user?.userId ?? user?.id ?? "unknown";
    return this.ops.aliasAction(id, dto.action, dto.canonicalSkuId, dto.note, actorId);
  }

  @Post("sku/alias/bulk-assign")
  bulkAssignAlias(@CurrentUser() user: any, @Body() dto: BulkAssignAliasDto) {
    const actorId = user?.userId ?? user?.id ?? "unknown";
    return this.ops.bulkAssignAlias(dto.aliasIds, dto.canonicalSkuId, dto.note, actorId);
  }

  // ───────────────────────── Batch C: Unmapped Queue ─────────────────────────

  @Get("sku/unmapped")
  listUnmappedQueue() {
    return this.ops.listUnmappedQueue();
  }

  @Post("sku/unmapped/:id/action")
  unmappedQueueAction(@CurrentUser() user: any, @Param("id") id: string, @Body() dto: UnmappedQueueActionDto) {
    const actorId = user?.userId ?? user?.id ?? "unknown";
    return this.ops.unmappedQueueAction(
      id,
      dto.action,
      { canonicalSkuId: dto.canonicalSkuId, newSkuCode: dto.newSkuCode, materialCategoryId: dto.materialCategoryId, note: dto.note },
      actorId
    );
  }

  @Post("sku/unmapped/bulk-action")
  bulkUnmappedQueueAction(@CurrentUser() user: any, @Body() dto: BulkUnmappedQueueActionDto) {
    const actorId = user?.userId ?? user?.id ?? "unknown";
    return this.ops.bulkUnmappedQueueAction(
      dto.aliasIds,
      dto.action,
      { canonicalSkuId: dto.canonicalSkuId, newSkuCode: dto.newSkuCode, materialCategoryId: dto.materialCategoryId, note: dto.note },
      actorId
    );
  }

  // ───────────────────────── Batch C: Enhanced Anomaly Board ─────────────────────────

  @Post("anomalies/bulk-resolve")
  bulkResolveAnomalies(@CurrentUser() user: any, @Body() dto: BulkResolveAnomalyDto) {
    const actorId = user?.userId ?? user?.id ?? "unknown";
    return this.ops.bulkResolveAnomalies(dto.anomalyIds, dto.action, dto.note, actorId);
  }

  @Post("anomalies/:id/comment")
  commentOnAnomaly(@CurrentUser() user: any, @Param("id") id: string, @Body() dto: CommentAnomalyDto) {
    const actorId = user?.userId ?? user?.id ?? "unknown";
    return this.ops.commentOnAnomaly(id, dto.note, actorId);
  }

  // ───────────────────────── Batch C: Global Search ─────────────────────────

  @Get("search")
  globalSearch(@Query("q") q: string) {
    return this.ops.globalSearch(q ?? "");
  }
}

