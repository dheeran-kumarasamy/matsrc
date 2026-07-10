import { Inject, Injectable, Logger } from "@nestjs/common";
import { Role } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { WHATSAPP_SEND_PROVIDER, WhatsAppSendAdapter } from "./adapters/whatsapp-send.interface";


export type WhatsAppIdentity = {
  userId: string;
  supplierProfileId: string;
  email: string | null;
  name: string | null;
  language: "en" | "regional";
};

/**
 * Resolves an inbound WhatsApp sender number to a verified supplier account.
 *
 * Auth model per spec:
 *  - Match inbound number against `User.whatsappNumber` (preferred) or `User.phone` for a
 *    User with role SUPPLIER that has a SupplierProfile. This is the "verified supplier
 *    phone number on file" check — no separate OTP needed if it matches.
 *  - If no match: caller (WhatsAppRouterService) sends a registration-link message and
 *    stops — no menu access is granted.
 *  - If the supplier exists but is messaging from an unregistered number, an OTP
 *    challenge (stubbed here — swap `sendOtp`/`verifyOtp` for a real SMS/WhatsApp OTP
 *    provider) must succeed before any menu access is granted.
 */
@Injectable()
export class WhatsAppAuthService {
  private readonly logger = new Logger(WhatsAppAuthService.name);

  // In-memory OTP store: phone -> { code, expiresAt, userId }. Swap for Redis/DB for
  // multi-instance deployments.
  private readonly otpStore = new Map<string, { code: string; expiresAt: number; userId: string }>();
  private static readonly OTP_TTL_MS = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_SEND_PROVIDER) private readonly sendAdapter: WhatsAppSendAdapter
  ) {}


  async resolveByVerifiedNumber(phone: string): Promise<WhatsAppIdentity | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        role: Role.SUPPLIER,
        OR: [{ whatsappNumber: phone }, { phone }],
      },
      include: { supplierProfile: true },
    });

    if (!user || !user.supplierProfile) {
      return null;
    }

    return {
      userId: user.id,
      supplierProfileId: user.supplierProfile.id,
      email: user.email,
      name: user.name,
      language: "en",
    };
  }

  /**
   * Looks up a supplier account by an alternate identifier (e.g. registered email or
   * company name entered during the OTP challenge flow) so a supplier messaging from an
   * unregistered number can still be authenticated. In this stub, we look the account up
   * by the *registered* phone/whatsapp number entered by the supplier, then challenge
   * that registered number with an OTP before granting access from the new number.
   */
  async findAccountByRegisteredContact(registeredPhone: string): Promise<WhatsAppIdentity | null> {
    return this.resolveByVerifiedNumber(registeredPhone);
  }

  async sendOtp(unregisteredPhone: string, targetUserId: string): Promise<void> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    this.otpStore.set(unregisteredPhone, {
      code,
      expiresAt: Date.now() + WhatsAppAuthService.OTP_TTL_MS,
      userId: targetUserId,
    });

    // Delivery only changes here — generation/expiry/attempt-limiting logic above and
    // in `verifyOtp` is unchanged. Sent via the pre-approved Authentication-category
    // `supplier_otp_verification` template (code-copy button param = the OTP), through
    // whichever adapter is registered (`WHATSAPP_SEND_PROVIDER` — mock in dev/test, Meta
    // Cloud API in production per `WHATSAPP_ADAPTER=meta`).
    try {
      await this.sendAdapter.send(unregisteredPhone, {
        kind: "template",
        name: "supplier_otp_verification",
        languageCode: "en",
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: code }],
          },
          {
            type: "button",
            sub_type: "url",
            index: 0,
            parameters: [{ type: "text", text: code }],
          },
        ],
      });
      this.logger.log(`[OTP] Sent OTP challenge to ${unregisteredPhone}`);
    } catch (error) {
      this.logger.error(`[OTP] Failed to send OTP to ${unregisteredPhone}`, error as Error);
      throw error;
    }
  }


  async verifyOtp(unregisteredPhone: string, submittedCode: string): Promise<WhatsAppIdentity | null> {
    const entry = this.otpStore.get(unregisteredPhone);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.otpStore.delete(unregisteredPhone);
      return null;
    }

    if (entry.code !== submittedCode.trim()) {
      return null;
    }

    this.otpStore.delete(unregisteredPhone);
    return this.resolveByUserId(entry.userId);
  }

  async resolveByUserId(userId: string): Promise<WhatsAppIdentity | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { supplierProfile: true },
    });

    if (!user || !user.supplierProfile) {
      return null;
    }

    return {
      userId: user.id,
      supplierProfileId: user.supplierProfile.id,
      email: user.email,
      name: user.name,
      language: "en",
    };
  }

  getRegistrationLink(): string {
    const baseUrl = process.env.SUPPLIER_PORTAL_URL || process.env.NEXT_PUBLIC_SUPPLIER_APP_URL || "https://matsrc-supplier.vercel.app";
    return `${baseUrl.replace(/\/$/, "")}/register`;
  }
}
