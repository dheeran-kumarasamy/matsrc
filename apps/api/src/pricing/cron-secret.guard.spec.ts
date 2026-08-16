import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UnauthorizedException } from "@nestjs/common";
import { CronSecretGuard } from "./cron-secret.guard";

function makeContext(headers: Record<string, string | undefined>) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as any;
}

describe("CronSecretGuard", () => {
  const ORIGINAL_SECRET = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret-value";
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = ORIGINAL_SECRET;
    }
  });

  it("allows a request with the correct Bearer token", () => {
    const guard = new CronSecretGuard();
    const context = makeContext({ authorization: "Bearer test-cron-secret-value" });
    expect(guard.canActivate(context)).toBe(true);
  });

  it("rejects a request with an incorrect token", () => {
    const guard = new CronSecretGuard();
    const context = makeContext({ authorization: "Bearer wrong-value" });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("rejects a request with no authorization header", () => {
    const guard = new CronSecretGuard();
    const context = makeContext({});
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("fails closed (rejects) when CRON_SECRET is not configured, even with a matching-looking header", () => {
    delete process.env.CRON_SECRET;
    const guard = new CronSecretGuard();
    const context = makeContext({ authorization: "Bearer undefined" });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
