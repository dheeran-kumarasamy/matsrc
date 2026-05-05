import { Injectable, NotFoundException } from "@nestjs/common";
import { KycStatus } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";

@Injectable()
export class KycService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllPending() {
    const docs = await this.prisma.kycDocument.findMany({
      where: { verified: false },
      include: { user: true },
      orderBy: { createdAt: "desc" },
    });

    return docs.map((doc) => ({
      id: doc.id,
      userId: doc.userId,
      vendorName: doc.user.name,
      vendorEmail: doc.user.email,
      type: doc.type,
      fileUrl: doc.fileUrl,
      createdAt: doc.createdAt,
    }));
  }

  async review(documentId: string, verified: boolean, actorId: string, note?: string) {
    const document = await this.prisma.kycDocument.findUnique({
      where: { id: documentId },
      include: { user: true },
    });

    if (!document) throw new NotFoundException("KYC document not found");

    const updatedDoc = await this.prisma.kycDocument.update({
      where: { id: documentId },
      data: { verified },
    });

    if (verified) {
      const unverifiedCount = await this.prisma.kycDocument.count({
        where: { userId: document.userId, verified: false },
      });

      await this.prisma.user.update({
        where: { id: document.userId },
        data: { kycStatus: unverifiedCount === 0 ? KycStatus.APPROVED : KycStatus.PENDING },
      });
    } else {
      await this.prisma.user.update({
        where: { id: document.userId },
        data: { kycStatus: KycStatus.REJECTED },
      });
    }

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: "KYC_DOCUMENT_REVIEWED",
        entityType: "KycDocument",
        entityId: documentId,
        metadata: { verified, note: note || null },
      },
    });

    return { id: updatedDoc.id, verified: updatedDoc.verified };
  }
}
