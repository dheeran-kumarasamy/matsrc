import { Injectable } from "@nestjs/common";
import { BuilderContextService } from "src/builder/builder-context.service";

@Injectable()
export class CreditService {
  constructor(private readonly builderContext: BuilderContextService) {}

  async getSummary(userCtx: any) {
    const { creditProfile } = await this.builderContext.getOrCreateBuilder(userCtx.userId, userCtx.email, userCtx.name);

    return {
      status: creditProfile.status,
      creditLimit: creditProfile.creditLimit ? Number(creditProfile.creditLimit) : 0,
      usedLimit: Number(creditProfile.usedLimit),
      availableLimit: (creditProfile.creditLimit ? Number(creditProfile.creditLimit) : 0) - Number(creditProfile.usedLimit),
      kfsAcceptedAt: creditProfile.kfsAcceptedAt,
      nbfcRef: creditProfile.nbfcRef,
    };
  }
}
