import { Injectable } from "@nestjs/common";
import { CreditStatus, Role } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";

@Injectable()
export class BuilderContextService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateBuilder(
    userId: string,
    email: string,
    name?: string
  ): Promise<{
    user: { id: string; email: string | null; name: string | null };
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

    const user = await this.prisma.user.upsert({
      where: { email },
      update: { role: Role.BUILDER, name: displayName },
      create: {
        id: userId,
        email,
        name: displayName,
        role: Role.BUILDER,
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

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
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
}
