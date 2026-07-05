import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ProductInterestEventType } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { RecordInterestEventDto } from "./dto/record-interest-event.dto";

type RatingsSummaryResponse = {
  avgDeliveryRating: number | null;
  avgQualityRating: number | null;
  totalRatings: number;
  insufficientData: boolean;
};

@Injectable()
export class PublicInsightsService {
  private readonly ratingsSummaryCache = new Map<string, { expiresAt: number; value: RatingsSummaryResponse }>();
  private static readonly RATINGS_SUMMARY_TTL_MS = 5 * 60 * 1000;
  private static readonly INTEREST_WINDOW_HOURS = 24;
  private static readonly MIN_SAMPLE_SIZE = 20;
  private static readonly INTEREST_RATE_LIMIT_MS = 5 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  async getSupplierRatingsSummary(supplierId: string): Promise<RatingsSummaryResponse> {
    const cached = this.ratingsSummaryCache.get(supplierId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const aggregate = await this.prisma.supplierRating.aggregate({
      where: { supplierId },
      _count: { _all: true },
      _avg: {
        deliveryRating: true,
        qualityRating: true,
      },
    });

    const totalRatings = aggregate._count._all;
    const response: RatingsSummaryResponse = {
      avgDeliveryRating: aggregate._avg.deliveryRating ? Number(aggregate._avg.deliveryRating.toFixed(1)) : null,
      avgQualityRating: aggregate._avg.qualityRating ? Number(aggregate._avg.qualityRating.toFixed(1)) : null,
      totalRatings,
      insufficientData: totalRatings < 5,
    };

    this.ratingsSummaryCache.set(supplierId, {
      expiresAt: Date.now() + PublicInsightsService.RATINGS_SUMMARY_TTL_MS,
      value: response,
    });

    return response;
  }

  async recordInterestEvent(listingId: string, dto: RecordInterestEventDto) {
    const listing = await this.prisma.product.findUnique({ where: { id: listingId }, select: { id: true } });
    if (!listing) {
      throw new NotFoundException("Listing not found");
    }

    const sessionId = dto.sessionId.trim();
    if (!sessionId) {
      throw new BadRequestException("sessionId is required");
    }

    const rateLimitFrom = new Date(Date.now() - PublicInsightsService.INTEREST_RATE_LIMIT_MS);
    const existing = await this.prisma.productInterestEvent.findFirst({
      where: {
        listingId,
        eventType: dto.eventType,
        sessionId,
        createdAt: { gte: rateLimitFrom },
      },
      select: { id: true },
    });

    if (existing) {
      return { accepted: true, deduplicated: true };
    }

    await this.prisma.productInterestEvent.create({
      data: {
        listingId,
        eventType: dto.eventType,
        sessionId,
      },
    });

    return { accepted: true, deduplicated: false };
  }

  async getAnchoring(listingId: string) {
    const from = new Date(Date.now() - PublicInsightsService.INTEREST_WINDOW_HOURS * 60 * 60 * 1000);

    const [viewSessions, orderSessions] = await Promise.all([
      this.prisma.productInterestEvent.findMany({
        where: { listingId, eventType: ProductInterestEventType.VIEW, createdAt: { gte: from } },
        distinct: ["sessionId"],
        select: { sessionId: true },
      }),
      this.prisma.productInterestEvent.findMany({
        where: { listingId, eventType: ProductInterestEventType.ORDER_PLACED, createdAt: { gte: from } },
        distinct: ["sessionId"],
        select: { sessionId: true },
      }),
    ]);

    const viewersLast24h = viewSessions.length;
    if (viewersLast24h < PublicInsightsService.MIN_SAMPLE_SIZE) {
      return {
        viewersLast24h,
        lockedPercent: null,
      };
    }

    const viewSet = new Set(viewSessions.map((session) => session.sessionId));
    const lockedSessions = orderSessions.filter((session) => viewSet.has(session.sessionId)).length;
    const lockedPercent = Math.max(0, Math.min(100, Math.round((lockedSessions / viewersLast24h) * 100)));

    return {
      viewersLast24h,
      lockedPercent,
    };
  }
}
