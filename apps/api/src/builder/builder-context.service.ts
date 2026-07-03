import { Injectable } from "@nestjs/common";
import { CreditStatus, Role } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { normalizePhoneNumber } from "src/common/validators/phone.validator";

@Injectable()
export class BuilderContextService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateBuilder(
    userId: string,
    email: string,
    name?: string,
    whatsappNumber?: string | null,
    whatsappConsent?: boolean
  ): Promise<{
    user: { id: string; email: string | null; name: string | null; phone: string | null; whatsappNumber: string | null };
    creditProfile: {
      id: string;
      status: string;
      creditLimit: number | null;
      usedLimit: number;
      kfsAcceptedAt: Date | null;
      nbfcRef: string | null;
    };
  }> {
    const displayName = name?.trim() || email.split("@")[0];
    
    // Normalize whatsappNumber if provided
    let normalizedWhatsappNumber: string | null = null;
    if (whatsappNumber) {
      normalizedWhatsappNumber = normalizePhoneNumber(whatsappNumber);
    }

    const user = await this.prisma.user.upsert({
      where: { email },
      update: { 
        role: Role.BUILDER, 
        name: displayName,
        ...(normalizedWhatsappNumber && { whatsappNumber: normalizedWhatsappNumber }),
      },
      create: {
        id: userId,
        email,
        name: displayName,
        role: Role.BUILDER,
        whatsappNumber: normalizedWhatsappNumber,
      },
      include: { creditProfile: true },
    });

    const creditProfile =
      user.creditProfile ||
      (await this.prisma.creditProfile.create({
        data: {
          userId: user.id,
          status: CreditStatus.NOT_APPLIED,
        },
      }));

    // Create or update NotificationPreference
    const defaultWhatsappEnabled = whatsappConsent !== undefined ? whatsappConsent : true;
    await this.prisma.notificationPreference.upsert({
      where: { userId: user.id },
      update: { whatsappEnabled: defaultWhatsappEnabled },
      create: {
        userId: user.id,
        whatsappEnabled: defaultWhatsappEnabled,
        smsEnabled: true,
        emailEnabled: true,
        pushEnabled: true,
        inAppEnabled: true,
      },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        whatsappNumber: user.whatsappNumber,
      },
      creditProfile: {
        id: creditProfile.id,
        status: creditProfile.status,
        creditLimit: creditProfile.creditLimit ? Number(creditProfile.creditLimit) : null,
        usedLimit: Number(creditProfile.usedLimit),
        kfsAcceptedAt: creditProfile.kfsAcceptedAt,
        nbfcRef: creditProfile.nbfcRef,
      },
    };
  }

  /**
   * Update builder contact information (phone and/or WhatsApp number)
   */
  async updateBuilderContact(
    userId: string,
    data: {
      phone?: string | null;
      whatsappNumber?: string | null;
    }
  ): Promise<any> {
    const updateData: any = {};

    if (data.phone !== undefined) {
      const normalized = data.phone ? normalizePhoneNumber(data.phone) : null;
      if (normalized) {
        updateData.phone = normalized;
      }
    }

    if (data.whatsappNumber !== undefined) {
      const normalized = data.whatsappNumber ? normalizePhoneNumber(data.whatsappNumber) : null;
      updateData.whatsappNumber = normalized;
    }

    if (Object.keys(updateData).length === 0) {
      return null;
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });
  }

  /**
   * Update notification preferences for a builder
   */
  async updateNotificationPreferences(
    userId: string,
    data: {
      whatsappEnabled?: boolean;
      smsEnabled?: boolean;
      emailEnabled?: boolean;
      pushEnabled?: boolean;
      inAppEnabled?: boolean;
    }
  ): Promise<any> {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      update: data,
      create: {
        userId,
        ...data,
      },
    });
  }
}
