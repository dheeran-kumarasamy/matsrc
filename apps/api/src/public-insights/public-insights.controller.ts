import { Body, Controller, Get, Header, Param, Post } from "@nestjs/common";
import { RecordInterestEventDto } from "./dto/record-interest-event.dto";
import { PublicInsightsService } from "./public-insights.service";

// NOTE: These endpoints must always be served dynamically (no-store).
// This codebase previously shipped a production bug where a public listings
// route regressed to stale/cached rendering. Do not remove these headers.
const NO_STORE_CACHE_CONTROL = "no-store, no-cache, must-revalidate, proxy-revalidate";

@Controller("public")
export class PublicInsightsController {
  constructor(private readonly publicInsightsService: PublicInsightsService) {}

  @Get("suppliers/:supplierId/ratings/summary")
  @Header("Cache-Control", NO_STORE_CACHE_CONTROL)
  getSupplierRatingsSummary(@Param("supplierId") supplierId: string) {
    return this.publicInsightsService.getSupplierRatingsSummary(supplierId);
  }

  @Post("listings/:listingId/interest-event")
  @Header("Cache-Control", NO_STORE_CACHE_CONTROL)
  recordInterestEvent(@Param("listingId") listingId: string, @Body() dto: RecordInterestEventDto) {
    return this.publicInsightsService.recordInterestEvent(listingId, dto);
  }

  @Get("listings/:listingId/anchoring")
  @Header("Cache-Control", NO_STORE_CACHE_CONTROL)
  getAnchoring(@Param("listingId") listingId: string) {
    return this.publicInsightsService.getAnchoring(listingId);
  }
}

