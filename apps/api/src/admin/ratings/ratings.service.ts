import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";

// Admin-only read access to an order's SupplierRating and its optional
// receipt-copy upload, for operational review. Mirrors
// src/admin/payments/payments.service.ts's getScreenshot pattern exactly —
// receipt bytes are only ever returned to a caller who has already passed
// this module's RoleGuard("ADMIN") check at the controller layer; this
// service never re-exposes bytes through any other (non-admin) response.
@Injectable()
export class AdminRatingsService {
  constructor(private readonly prisma: PrismaService) {}

  // Metadata-only view of a rating + its receipt (never raw bytes) — used
  // by the Admin order-review page to decide whether to render a
  // View/Download Receipt control at all.
  async findByOrderId(orderId: string) {
    const rating = await this.prisma.supplierRating.findUnique({
      where: { orderId },
      select: {
        id: true,
        orderId: true,
        deliveryRating: true,
        qualityRating: true,
        comment: true,
        createdAt: true,
        updatedAt: true,
        receiptFileName: true,
        receiptMimeType: true,
        receiptSize: true,
        receiptUploadedAt: true,
      },
    });

    if (!rating) {
      throw new NotFoundException("No rating found for this order");
    }

    return {
      id: rating.id,
      orderId: rating.orderId,
      deliveryRating: rating.deliveryRating,
      qualityRating: rating.qualityRating,
      comment: rating.comment,
      createdAt: rating.createdAt,
      updatedAt: rating.updatedAt,
      receipt: rating.receiptFileName
        ? {
            fileName: rating.receiptFileName,
            mimeType: rating.receiptMimeType,
            size: rating.receiptSize,
            uploadedAt: rating.receiptUploadedAt,
          }
        : null,
    };
  }

  // Streams the raw receipt bytes to an authorized admin only — never a
  // public/static URL, and never accessible without passing the same
  // OptionalJwtAuthGuard + RoleGuard("ADMIN") checks as every other route
  // on this controller (see payments.controller.ts's getScreenshot).
  async getReceipt(orderId: string) {
    const rating = await this.prisma.supplierRating.findUnique({
      where: { orderId },
      select: { receiptData: true, receiptMimeType: true, receiptFileName: true },
    });

    if (!rating || !rating.receiptData || !rating.receiptMimeType || !rating.receiptFileName) {
      throw new NotFoundException("No receipt found for this order");
    }

    return rating as { receiptData: Buffer; receiptMimeType: string; receiptFileName: string };
  }
}
