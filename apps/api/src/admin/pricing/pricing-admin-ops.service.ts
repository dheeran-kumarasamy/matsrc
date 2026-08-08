import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { PrismaService } from "src/prisma/prisma.service";
import { PricingIngestionService } from "src/pricing/pricing-ingestion.service";
import type { SourceStatusAction } from "./dto/update-source-status.dto";
import type { EndpointStatusAction } from "./dto/update-endpoint-status.dto";

/**
 * Phase 6C Batch A: admin operational-control surface for the Price
 * Intelligence platform (Dashboard, Source Management, Endpoint Health,
 * Scheduler Dashboard, Rollup Administration). Deliberately reads/writes
 * only PricingSource / PricingSourceEndpoint / PricingScrapeRun /
 * PricingRawObservation / PricingDistrictPriceDaily / PricingTrendMonthly
 * rows and existing AuditLog — never touches ingestion/normalization/
 * aggregation logic itself (those services are only ever invoked through
 * their existing public methods, unchanged).
 */
@Injectable()
export class PricingAdminOpsService {
  private readonly logger = new Logger(PricingAdminOpsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: PricingIngestionService,
    private readonly schedulerRegistry: SchedulerRegistry
  ) {}

  // ───────────────────────── Dashboard ─────────────────────────

  async getDashboardSummary() {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      sourcesEnabled,
      sourcesDisabled,
      failedSources,
      lastSuccessfulIngestionRun,
      lastFailedIngestionRun,
      lastDailyRow,
      lastMonthlyRow,
      raw24h,
      raw7d,
      raw30d,
      parsedCount,
      rejectedCount,
      unmappedCount,
      quarantinedCount,
      publishedCount,
      derivedCount,
    ] = await Promise.all([
      this.prisma.pricingSource.count({ where: { isEnabled: true } }),
      this.prisma.pricingSource.count({ where: { isEnabled: false } }),
      this.prisma.pricingSource.count({
        where: { isEnabled: true, endpoints: { some: { consecutiveFailures: { gte: 3 } } } },
      }),
      this.prisma.pricingScrapeRun.findFirst({ where: { status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" } }),
      this.prisma.pricingScrapeRun.findFirst({ where: { status: "FAILED" }, orderBy: { finishedAt: "desc" } }),
      this.prisma.pricingDistrictPriceDaily.findFirst({ orderBy: { computedAt: "desc" } }),
      this.prisma.pricingTrendMonthly.findFirst({ orderBy: { id: "desc" } }),
      this.prisma.pricingRawObservation.count({ where: { fetchedAt: { gte: last24h } } }),
      this.prisma.pricingRawObservation.count({ where: { fetchedAt: { gte: last7d } } }),
      this.prisma.pricingRawObservation.count({ where: { fetchedAt: { gte: last30d } } }),
      this.prisma.pricingRawObservation.count({ where: { parseStatus: "PARSED" } }),
      this.prisma.pricingRawObservation.count({ where: { parseStatus: "REJECTED" } }),
      this.prisma.pricingRawObservation.count({ where: { parseStatus: "UNMAPPED" } }),
      this.prisma.pricingRawObservation.count({ where: { parseStatus: "QUARANTINED" } }),
      this.prisma.pricingDistrictPriceDaily.count({ where: { publicDisplayAllowed: true } }),
      this.prisma.pricingDistrictPriceDaily.count({ where: { method: { not: "OBSERVED" } } }),
    ]);

    const activeSchedulers = this.schedulerRegistry.getCronJobs().size;
    const rawTotal = await this.prisma.pricingRawObservation.count();

    return {
      platformHealth: {
        sourcesEnabled,
        sourcesDisabled,
        healthySources: Math.max(sourcesEnabled - failedSources, 0),
        failedSources,
        activeSchedulers,
        lastSuccessfulIngestion: lastSuccessfulIngestionRun?.finishedAt ?? null,
        lastFailedIngestion: lastFailedIngestionRun?.finishedAt ?? null,
        lastSuccessfulRollup: lastDailyRow?.computedAt ?? null,
        lastSuccessfulNormalization: lastDailyRow?.computedAt ?? null,
        lastMonthlyRollup: lastMonthlyRow ? true : false,
        lastRefreshTime: now.toISOString(),
      },
      processingSummary: {
        raw: rawTotal,
        parsed: parsedCount,
        normalized: parsedCount,
        rejected: rejectedCount,
        unmapped: unmappedCount,
        quarantined: quarantinedCount,
        published: publishedCount,
        derived: derivedCount,
      },
      observationTrend: {
        last24h: raw24h,
        last7d: raw7d,
        last30d: raw30d,
      },
      pipelineStatus: this.buildPipelineStatus({
        failedSources,
        lastSuccessfulIngestionRun,
        lastDailyRow,
      }),
    };
  }

  private buildPipelineStatus(input: {
    failedSources: number;
    lastSuccessfulIngestionRun: { finishedAt: Date | null } | null;
    lastDailyRow: { computedAt: Date } | null;
  }) {
    const stageStatus = (ok: boolean, warn: boolean) => (ok ? "HEALTHY" : warn ? "WARNING" : "FAILED");

    return [
      { stage: "Ingestion", status: stageStatus(input.failedSources === 0, input.failedSources < 3) },
      { stage: "Normalization", status: input.lastDailyRow ? "HEALTHY" : "WARNING" },
      { stage: "Aggregation", status: input.lastDailyRow ? "HEALTHY" : "WARNING" },
      { stage: "Publishing", status: input.lastDailyRow ? "HEALTHY" : "WARNING" },
      { stage: "Builder", status: "HEALTHY" },
      { stage: "Supplier", status: "HEALTHY" },
    ];
  }

  // ───────────────────────── Source Management ─────────────────────────

  async listSources() {
    const sources = await this.prisma.pricingSource.findMany({
      orderBy: { code: "asc" },
      include: {
        endpoints: { select: { id: true, isEnabled: true, consecutiveFailures: true } },
        runs: { orderBy: { startedAt: "desc" }, take: 20 },
      },
    });

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    return sources.map((source) => {
      const recentRuns = source.runs;
      const finishedRuns = recentRuns.filter((r) => r.finishedAt);
      const succeeded = finishedRuns.filter((r) => r.status === "SUCCEEDED").length;
      const failed = finishedRuns.filter((r) => r.status === "FAILED").length;
      const successRate = finishedRuns.length > 0 ? succeeded / finishedRuns.length : null;
      const failureRate = finishedRuns.length > 0 ? failed / finishedRuns.length : null;
      const durationsMs = finishedRuns
        .filter((r) => r.finishedAt)
        .map((r) => (r.finishedAt as Date).getTime() - r.startedAt.getTime());
      const avgDurationMs =
        durationsMs.length > 0 ? durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length : null;
      const lastRun = recentRuns[0] ?? null;
      const lastError = recentRuns.find((r) => r.errorMessage)?.errorMessage ?? null;
      const costThisMonth = recentRuns
        .filter((r) => r.startedAt >= monthStart && r.costUsd !== null)
        .reduce((sum, r) => sum + Number(r.costUsd ?? 0), 0);
      const rowsCollected = recentRuns.reduce((sum, r) => sum + r.itemsFetched, 0);
      const rowsParsed = recentRuns.reduce((sum, r) => sum + r.itemsParsed, 0);

      return {
        id: source.id,
        code: source.code,
        name: source.name,
        tier: source.tier,
        licenseClass: source.licenseClass,
        isEnabled: source.isEnabled,
        robotsAllowed: source.robotsAllowed,
        tosReviewedAt: source.tosReviewedAt,
        publicDisplayAllowed: source.publicDisplayAllowed,
        cronExpression: source.cronExpression,
        endpointCount: source.endpoints.length,
        enabledEndpointCount: source.endpoints.filter((e) => e.isEnabled).length,
        lastRunAt: lastRun?.startedAt ?? null,
        lastRunStatus: lastRun?.status ?? null,
        averageDurationMs: avgDurationMs,
        successRate,
        failureRate,
        lastError,
        costThisMonth,
        projectedCost: costThisMonth > 0 && now().getUTCDate() > 0 ? projectMonthlyCost(costThisMonth) : 0,
        rowsCollected,
        rowsParsed,
        rowsPublished: rowsParsed, // no separate "published" counter on PricingScrapeRun yet
        configComplete: Boolean(source.baseUrl && source.apifyActorId),
      };
    });

    function now() {
      return new Date();
    }
    function projectMonthlyCost(costSoFar: number) {
      const day = new Date().getUTCDate();
      const daysInMonth = new Date(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0).getUTCDate();
      return day > 0 ? (costSoFar / day) * daysInMonth : costSoFar;
    }
  }

  async updateSourceStatus(id: string, action: SourceStatusAction, reason: string | undefined, actorId: string) {
    const source = await this.prisma.pricingSource.findUnique({ where: { id } });
    if (!source) throw new NotFoundException("Source not found");

    if (action === "enable" || action === "resume") {
      if (!source.tosReviewedAt) {
        throw new BadRequestException("Cannot enable source: ToS has not been reviewed for this source.");
      }
      if (!source.robotsAllowed) {
        throw new BadRequestException("Cannot enable source: robots.txt does not allow scraping this source.");
      }
      if (!source.baseUrl || !source.apifyActorId) {
        throw new BadRequestException("Cannot enable source: configuration is incomplete (baseUrl/apifyActorId).");
      }
    }

    const isEnabled = action === "enable" || action === "resume";
    const updated = await this.prisma.pricingSource.update({
      where: { id },
      data: { isEnabled },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: `PRICING_SOURCE_${action.toUpperCase()}`,
        entityType: "PricingSource",
        entityId: id,
        metadata: { code: source.code, reason: reason ?? null },
      },
    });

    return { id: updated.id, code: updated.code, isEnabled: updated.isEnabled };
  }

  async testSourceConnection(id: string, actorId: string) {
    const source = await this.prisma.pricingSource.findUnique({ where: { id } });
    if (!source) throw new NotFoundException("Source not found");
    if (!source.baseUrl) {
      throw new BadRequestException("Source has no baseUrl configured — cannot test connection.");
    }

    let ok = false;
    let statusCode: number | null = null;
    let errorMessage: string | null = null;
    const startedAt = Date.now();

    try {
      const response = await fetch(source.baseUrl, { method: "GET", redirect: "follow" });
      statusCode = response.status;
      ok = response.ok;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    const durationMs = Date.now() - startedAt;

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: "PRICING_SOURCE_TEST_CONNECTION",
        entityType: "PricingSource",
        entityId: id,
        metadata: { code: source.code, ok, statusCode, errorMessage, durationMs },
      },
    });

    return { ok, statusCode, errorMessage, durationMs };
  }

  // ───────────────────────── Endpoint Health ─────────────────────────

  async listEndpoints(sourceId?: string) {
    const endpoints = await this.prisma.pricingSourceEndpoint.findMany({
      where: sourceId ? { sourceId } : undefined,
      orderBy: { updatedAt: "desc" },
      include: {
        source: { select: { id: true, code: true, name: true } },
        district: { select: { id: true, code: true, name: true } },
        materialCategory: { select: { id: true, code: true, name: true } },
      },
    });

    return endpoints.map((endpoint) => ({
      id: endpoint.id,
      url: endpoint.url,
      district: endpoint.district ? { code: endpoint.district.code, name: endpoint.district.name } : null,
      category: endpoint.materialCategory
        ? { code: endpoint.materialCategory.code, name: endpoint.materialCategory.name }
        : null,
      source: { id: endpoint.source.id, code: endpoint.source.code, name: endpoint.source.name },
      isEnabled: endpoint.isEnabled,
      lastStatus: endpoint.lastStatus,
      lastFetchedAt: endpoint.lastFetchedAt,
      consecutiveFailures: endpoint.consecutiveFailures,
      disabledReason: endpoint.disabledReason,
      autoDisabled: !endpoint.isEnabled && endpoint.consecutiveFailures >= 3,
    }));
  }

  async updateEndpointStatus(id: string, action: EndpointStatusAction, reason: string | undefined, actorId: string) {
    const endpoint = await this.prisma.pricingSourceEndpoint.findUnique({ where: { id } });
    if (!endpoint) throw new NotFoundException("Endpoint not found");

    const isEnabled = action === "enable" || action === "resume";
    const updated = await this.prisma.pricingSourceEndpoint.update({
      where: { id },
      data: isEnabled
        ? { isEnabled: true, disabledReason: null, consecutiveFailures: 0 }
        : { isEnabled: false, disabledReason: reason ?? `${action}_by_admin` },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: `PRICING_ENDPOINT_${action.toUpperCase()}`,
        entityType: "PricingSourceEndpoint",
        entityId: id,
        metadata: { url: endpoint.url, reason: reason ?? null },
      },
    });

    return { id: updated.id, isEnabled: updated.isEnabled, disabledReason: updated.disabledReason };
  }

  async retryEndpoint(id: string, actorId: string) {
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: "PRICING_ENDPOINT_RETRY",
        entityType: "PricingSourceEndpoint",
        entityId: id,
        metadata: {},
      },
    });
    return this.ingestion.ingestEndpoint(id, `admin:${actorId}`);
  }

  // ───────────────────────── Scheduler Dashboard ─────────────────────────

  async getSchedulerStatus() {
    const jobs = this.schedulerRegistry.getCronJobs();
    const jobList = Array.from(jobs.entries()).map(([name, job]) => {
      let nextExecution: string | null = null;
      try {
        nextExecution = job.nextDate ? job.nextDate().toJSDate().toISOString() : null;
      } catch {
        nextExecution = null;
      }
      return {
        name,
        running: (job as any).running ?? true,
        nextExecution,
      };
    });

    const recentRuns = await this.prisma.pricingScrapeRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 25,
      include: { source: { select: { code: true, name: true } } },
    });

    return {
      jobs: jobList,
      recentRuns: recentRuns.map((run) => ({
        id: run.id,
        sourceCode: run.source.code,
        sourceName: run.source.name,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        durationMs: run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null,
        triggeredBy: run.triggeredBy,
        errorMessage: run.errorMessage,
        itemsFetched: run.itemsFetched,
      })),
    };
  }

  async pauseSchedulerJob(name: string, actorId: string) {
    const jobs = this.schedulerRegistry.getCronJobs();
    const job = jobs.get(name);
    if (!job) throw new NotFoundException(`Scheduler job "${name}" not found`);
    job.stop();

    await this.prisma.auditLog.create({
      data: { actorId, action: "PRICING_SCHEDULER_JOB_PAUSED", entityType: "SchedulerJob", entityId: name, metadata: {} },
    });
    return { name, running: false };
  }

  async resumeSchedulerJob(name: string, actorId: string) {
    const jobs = this.schedulerRegistry.getCronJobs();
    const job = jobs.get(name);
    if (!job) throw new NotFoundException(`Scheduler job "${name}" not found`);
    job.start();

    await this.prisma.auditLog.create({
      data: { actorId, action: "PRICING_SCHEDULER_JOB_RESUMED", entityType: "SchedulerJob", entityId: name, metadata: {} },
    });
    return { name, running: true };
  }

  // ───────────────────────── Rollup Administration ─────────────────────────

  async getRollupStatus() {
    const [lastDaily, lastMonthly, dailyCount, monthlyCount] = await Promise.all([
      this.prisma.pricingDistrictPriceDaily.findFirst({ orderBy: { priceDate: "desc" } }),
      this.prisma.pricingTrendMonthly.findFirst({ orderBy: { monthStart: "desc" } }),
      this.prisma.pricingDistrictPriceDaily.count(),
      this.prisma.pricingTrendMonthly.count(),
    ]);

    return {
      lastDailyRollupDate: lastDaily?.priceDate ?? null,
      lastMonthlyRollupMonth: lastMonthly?.monthStart ?? null,
      totalDailyRows: dailyCount,
      totalMonthlyRows: monthlyCount,
    };
  }

  /**
   * Dry-run preview for a daily rollup: reports how many non-excluded
   * observations exist for the date (i.e. what a real rollup run would
   * process) without calling PricingDailyRollupService at all — so this
   * never touches aggregation logic.
   */
  async previewDailyRollup(priceDate: Date) {
    const startOfDay = new Date(priceDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

    const [observationCount, distinctSkuDistrict] = await Promise.all([
      this.prisma.pricingObservation.count({
        where: { isExcluded: false, fetchedAt: { gte: startOfDay, lt: endOfDay } },
      }),
      this.prisma.pricingObservation.findMany({
        where: { isExcluded: false, fetchedAt: { gte: startOfDay, lt: endOfDay } },
        select: { canonicalSkuId: true, districtId: true },
        distinct: ["canonicalSkuId", "districtId"],
      }),
    ]);

    return {
      priceDate: startOfDay.toISOString().slice(0, 10),
      observationsToProcess: observationCount,
      distinctSkuDistrictPairs: distinctSkuDistrict.length,
      dryRun: true,
    };
  }

  // ───────────────────────── Batch C: Canonical SKU Management ─────────────────────────

  async listCanonicalSkus(search?: string) {
    const skus = await this.prisma.pricingCanonicalSku.findMany({
      where: search
        ? {
            OR: [
              { code: { contains: search, mode: "insensitive" } },
              { grade: { contains: search, mode: "insensitive" } },
              { aliases: { some: { rawLabel: { contains: search, mode: "insensitive" } } } },
            ],
          }
        : undefined,
      orderBy: { code: "asc" },
      take: 200,
      include: {
        materialCategory: { select: { code: true, name: true } },
        brand: { select: { name: true } },
        aliases: { select: { id: true, rawLabel: true, matchType: true, occurrenceCount: true } },
        _count: { select: { observations: true } },
      },
    });

    const ids = skus.map((s) => s.id);
    const [districtGroups, lastSeenGroups, unmappedCounts] = await Promise.all([
      this.prisma.pricingObservation.groupBy({
        by: ["canonicalSkuId", "districtId"],
        where: { canonicalSkuId: { in: ids } },
      }),
      this.prisma.pricingObservation.groupBy({
        by: ["canonicalSkuId"],
        where: { canonicalSkuId: { in: ids } },
        _max: { fetchedAt: true },
      }),
      this.prisma.pricingSkuAlias.groupBy({
        by: ["canonicalSkuId"],
        where: { canonicalSkuId: { in: ids } },
        _count: { _all: true },
      }),
    ]);

    const districtCountBySku = new Map<string, number>();
    for (const row of districtGroups) {
      districtCountBySku.set(row.canonicalSkuId, (districtCountBySku.get(row.canonicalSkuId) ?? 0) + 1);
    }
    const lastSeenBySku = new Map(lastSeenGroups.map((row) => [row.canonicalSkuId, row._max.fetchedAt]));

    const totalUnmapped = await this.prisma.pricingSkuAlias.count({ where: { canonicalSkuId: null } });

    return skus.map((sku) => ({
      id: sku.id,
      code: sku.code,
      grade: sku.grade,
      sizeLabel: sku.sizeLabel,
      isActive: sku.isActive,
      materialCategory: sku.materialCategory ? { code: sku.materialCategory.code, name: sku.materialCategory.name } : null,
      brandName: sku.brand?.name ?? null,
      aliases: sku.aliases.map((a) => ({ id: a.id, rawLabel: a.rawLabel, matchType: a.matchType, occurrenceCount: a.occurrenceCount })),
      productsLinked: sku.matsrcListingId ? 1 : 0,
      districtCoverage: districtCountBySku.get(sku.id) ?? 0,
      observationCount: sku._count.observations,
      lastSeen: lastSeenBySku.get(sku.id) ?? null,
      confidence: sku._count.observations > 0 ? "HIGH" : "LOW",
      unmappedCount: totalUnmapped,
    }));
  }

  async mergeCanonicalSku(id: string, targetSkuId: string, actorId: string) {
    if (id === targetSkuId) throw new BadRequestException("Cannot merge a SKU into itself");
    const [source, target] = await Promise.all([
      this.prisma.pricingCanonicalSku.findUnique({ where: { id } }),
      this.prisma.pricingCanonicalSku.findUnique({ where: { id: targetSkuId } }),
    ]);
    if (!source) throw new NotFoundException("Source SKU not found");
    if (!target) throw new NotFoundException("Target SKU not found");

    await this.prisma.$transaction([
      this.prisma.pricingSkuAlias.updateMany({ where: { canonicalSkuId: id }, data: { canonicalSkuId: targetSkuId } }),
      this.prisma.pricingObservation.updateMany({ where: { canonicalSkuId: id }, data: { canonicalSkuId: targetSkuId } }),
      this.prisma.pricingDistrictPriceDaily.updateMany({ where: { canonicalSkuId: id }, data: { canonicalSkuId: targetSkuId } }),
      // Soft-deactivate the merged-away SKU rather than hard-deleting it (preserves FK/audit history).
      this.prisma.pricingCanonicalSku.update({ where: { id }, data: { isActive: false } }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          action: "PRICING_SKU_MERGE",
          entityType: "PricingCanonicalSku",
          entityId: id,
          metadata: { sourceCode: source.code, targetSkuId, targetCode: target.code },
        },
      }),
    ]);

    return { mergedId: id, targetSkuId };
  }

  async renameCanonicalSku(id: string, code: string, grade: string | undefined, actorId: string) {
    const sku = await this.prisma.pricingCanonicalSku.findUnique({ where: { id } });
    if (!sku) throw new NotFoundException("Canonical SKU not found");

    const updated = await this.prisma.pricingCanonicalSku.update({
      where: { id },
      data: { code, ...(grade !== undefined ? { grade } : {}) },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: "PRICING_SKU_RENAME",
        entityType: "PricingCanonicalSku",
        entityId: id,
        metadata: { previousCode: sku.code, newCode: code, grade: grade ?? null },
      },
    });

    return { id: updated.id, code: updated.code, grade: updated.grade };
  }

  async getCanonicalSkuHistory(id: string) {
    return this.prisma.auditLog.findMany({
      where: { entityType: "PricingCanonicalSku", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  /**
   * Alias review action. Per spec: fuzzy matches are NEVER auto-approved —
   * "approve" requires the admin to explicitly pass canonicalSkuId, which is
   * then written as a MANUAL match (never silently promoting FUZZY -> higher trust).
   */
  async aliasAction(
    id: string,
    action: "approve" | "reject" | "block",
    canonicalSkuId: string | undefined,
    note: string | undefined,
    actorId: string
  ) {
    const alias = await this.prisma.pricingSkuAlias.findUnique({ where: { id } });
    if (!alias) throw new NotFoundException("Alias not found");

    let data: Record<string, unknown>;
    if (action === "approve") {
      if (!canonicalSkuId) throw new BadRequestException("canonicalSkuId is required to approve an alias");
      const target = await this.prisma.pricingCanonicalSku.findUnique({ where: { id: canonicalSkuId } });
      if (!target) throw new NotFoundException("Target canonical SKU not found");
      data = { canonicalSkuId, matchType: "MANUAL", reviewedByAdminId: actorId, reviewedAt: new Date() };
    } else if (action === "reject") {
      data = { canonicalSkuId: null, reviewedByAdminId: actorId, reviewedAt: new Date() };
    } else {
      data = { matchType: "BLOCKED", canonicalSkuId: null, reviewedByAdminId: actorId, reviewedAt: new Date() };
    }

    const updated = await this.prisma.pricingSkuAlias.update({ where: { id }, data });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: `PRICING_ALIAS_${action.toUpperCase()}`,
        entityType: "PricingSkuAlias",
        entityId: id,
        metadata: { rawLabel: alias.rawLabel, canonicalSkuId: canonicalSkuId ?? null, note: note ?? null },
      },
    });

    return { id: updated.id, rawLabel: updated.rawLabel, matchType: updated.matchType, canonicalSkuId: updated.canonicalSkuId };
  }

  async bulkAssignAlias(aliasIds: string[], canonicalSkuId: string, note: string | undefined, actorId: string) {
    const target = await this.prisma.pricingCanonicalSku.findUnique({ where: { id: canonicalSkuId } });
    if (!target) throw new NotFoundException("Target canonical SKU not found");

    await this.prisma.$transaction([
      this.prisma.pricingSkuAlias.updateMany({
        where: { id: { in: aliasIds } },
        data: { canonicalSkuId, matchType: "MANUAL", reviewedByAdminId: actorId, reviewedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          action: "PRICING_ALIAS_BULK_ASSIGN",
          entityType: "PricingSkuAlias",
          entityId: aliasIds.join(","),
          metadata: { aliasIds, canonicalSkuId, note: note ?? null },
        },
      }),
    ]);

    return { updated: aliasIds.length, canonicalSkuId };
  }

  // ───────────────────────── Batch C: Unmapped Queue ─────────────────────────

  async listUnmappedQueue() {
    const aliases = await this.prisma.pricingSkuAlias.findMany({
      where: { canonicalSkuId: null, matchType: { not: "BLOCKED" } },
      orderBy: [{ occurrenceCount: "desc" }],
      take: 200,
      include: { source: { select: { code: true, name: true } } },
    });

    return aliases.map((alias) => ({
      id: alias.id,
      rawLabel: alias.rawLabel,
      normalizedLabel: alias.normalizedLabel,
      occurrenceCount: alias.occurrenceCount,
      source: alias.source ? { code: alias.source.code, name: alias.source.name } : null,
      matchType: alias.matchType,
      matchScore: alias.matchScore ? Number(alias.matchScore) : null,
      firstSeen: alias.createdAt,
      lastSeen: alias.updatedAt,
    }));
  }

  async unmappedQueueAction(
    id: string,
    action: "assign" | "merge" | "ignore" | "block" | "create_new_sku",
    opts: { canonicalSkuId?: string; newSkuCode?: string; materialCategoryId?: string; note?: string },
    actorId: string
  ) {
    const alias = await this.prisma.pricingSkuAlias.findUnique({ where: { id } });
    if (!alias) throw new NotFoundException("Alias not found");

    let resultCanonicalSkuId: string | null = null;

    if (action === "assign" || action === "merge") {
      if (!opts.canonicalSkuId) throw new BadRequestException("canonicalSkuId is required for this action");
      const target = await this.prisma.pricingCanonicalSku.findUnique({ where: { id: opts.canonicalSkuId } });
      if (!target) throw new NotFoundException("Target canonical SKU not found");
      resultCanonicalSkuId = opts.canonicalSkuId;
      await this.prisma.pricingSkuAlias.update({
        where: { id },
        data: { canonicalSkuId: resultCanonicalSkuId, matchType: "MANUAL", reviewedByAdminId: actorId, reviewedAt: new Date() },
      });
    } else if (action === "ignore") {
      await this.prisma.pricingSkuAlias.update({
        where: { id },
        data: { reviewedByAdminId: actorId, reviewedAt: new Date() },
      });
    } else if (action === "block") {
      await this.prisma.pricingSkuAlias.update({
        where: { id },
        data: { matchType: "BLOCKED", reviewedByAdminId: actorId, reviewedAt: new Date() },
      });
    } else if (action === "create_new_sku") {
      if (!opts.newSkuCode) throw new BadRequestException("newSkuCode is required to create a new canonical SKU");
      if (!opts.materialCategoryId) throw new BadRequestException("materialCategoryId is required to create a new canonical SKU");
      const category = await this.prisma.pricingMaterialCategory.findUnique({ where: { id: opts.materialCategoryId } });
      if (!category) throw new NotFoundException("Material category not found");
      const created = await this.prisma.pricingCanonicalSku.create({
        data: {
          code: opts.newSkuCode,
          materialCategoryId: opts.materialCategoryId,
          baseUnit: category.baseUnit,
          fingerprint: `manual:${opts.newSkuCode}:${Date.now()}`,
        },
      });
      resultCanonicalSkuId = created.id;
      await this.prisma.pricingSkuAlias.update({
        where: { id },
        data: { canonicalSkuId: created.id, matchType: "MANUAL", reviewedByAdminId: actorId, reviewedAt: new Date() },
      });
    }

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: `PRICING_UNMAPPED_${action.toUpperCase()}`,
        entityType: "PricingSkuAlias",
        entityId: id,
        metadata: { rawLabel: alias.rawLabel, canonicalSkuId: resultCanonicalSkuId, note: opts.note ?? null },
      },
    });

    return { id, action, canonicalSkuId: resultCanonicalSkuId };
  }

  async bulkUnmappedQueueAction(
    aliasIds: string[],
    action: "assign" | "merge" | "ignore" | "block" | "create_new_sku",
    opts: { canonicalSkuId?: string; newSkuCode?: string; materialCategoryId?: string; note?: string },
    actorId: string
  ) {
    const results = [];
    for (const aliasId of aliasIds) {
      results.push(await this.unmappedQueueAction(aliasId, action, opts, actorId));
    }
    return { processed: results.length, results };
  }

  // ───────────────────────── Batch C: Enhanced Anomaly Board ─────────────────────────

  async bulkResolveAnomalies(anomalyIds: string[], action: string, note: string | undefined, actorId: string) {
    const results = [];
    for (const anomalyId of anomalyIds) {
      const anomaly = await this.prisma.pricingAnomaly.findUnique({ where: { id: anomalyId } });
      if (!anomaly || anomaly.resolvedAt) continue;

      const updates: Promise<unknown>[] = [
        this.prisma.pricingAnomaly.update({
          where: { id: anomalyId },
          data: {
            resolvedByAdminId: actorId,
            resolvedAt: new Date(),
            resolutionAction: note ? `${action}: ${note}` : action,
          },
        }),
      ];
      if (action === "accepted" && anomaly.observationId) {
        updates.push(
          this.prisma.pricingObservation.update({
            where: { id: anomaly.observationId },
            data: { isExcluded: false, exclusionReason: null },
          })
        );
      }
      await this.prisma.$transaction(updates as any);
      results.push(anomalyId);
    }

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: "PRICING_ANOMALY_BULK_RESOLVE",
        entityType: "PricingAnomaly",
        entityId: anomalyIds.join(","),
        metadata: { anomalyIds: results, action, note: note ?? null },
      },
    });

    return { resolved: results.length, anomalyIds: results };
  }

  async commentOnAnomaly(id: string, note: string, actorId: string) {
    const anomaly = await this.prisma.pricingAnomaly.findUnique({ where: { id } });
    if (!anomaly) throw new NotFoundException("Anomaly not found");

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: "PRICING_ANOMALY_COMMENT",
        entityType: "PricingAnomaly",
        entityId: id,
        metadata: { note },
      },
    });

    return { id, commentAdded: true };
  }

  // ───────────────────────── Batch C: Global Search ─────────────────────────

  async globalSearch(q: string) {
    if (!q || q.trim().length < 2) return { districts: [], categories: [], skus: [], aliases: [], sources: [], anomalies: [] };
    const term = q.trim();

    const [districts, categories, skus, aliases, sources, anomalies] = await Promise.all([
      this.prisma.pricingDistrict.findMany({
        where: { OR: [{ code: { contains: term, mode: "insensitive" } }, { name: { contains: term, mode: "insensitive" } }] },
        take: 10,
        select: { id: true, code: true, name: true },
      }),
      this.prisma.pricingMaterialCategory.findMany({
        where: { OR: [{ code: { contains: term, mode: "insensitive" } }, { name: { contains: term, mode: "insensitive" } }] },
        take: 10,
        select: { id: true, code: true, name: true },
      }),
      this.prisma.pricingCanonicalSku.findMany({
        where: { code: { contains: term, mode: "insensitive" } },
        take: 10,
        select: { id: true, code: true },
      }),
      this.prisma.pricingSkuAlias.findMany({
        where: { rawLabel: { contains: term, mode: "insensitive" } },
        take: 10,
        select: { id: true, rawLabel: true, canonicalSkuId: true },
      }),
      this.prisma.pricingSource.findMany({
        where: { OR: [{ code: { contains: term, mode: "insensitive" } }, { name: { contains: term, mode: "insensitive" } }] },
        take: 10,
        select: { id: true, code: true, name: true },
      }),
      this.prisma.pricingAnomaly.findMany({
        where: { OR: [{ reason: term.toUpperCase() as any }, { detail: { contains: term, mode: "insensitive" } }] },
        take: 10,
        select: { id: true, reason: true, detail: true },
      }),
    ]);

    return { districts, categories, skus, aliases, sources, anomalies };
  }
}

