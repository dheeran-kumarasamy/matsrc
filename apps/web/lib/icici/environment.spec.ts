import { describe, expect, it } from "vitest";
import { isIciciUatAvailable, getBuildohubEnvironment, __detectEnvironmentForTests } from "./environment";

describe("isIciciUatAvailable", () => {
  it("is available when BUILDOHUB_ENV=uat and ICICI_PG_ENABLED=true", () => {
    expect(isIciciUatAvailable({ BUILDOHUB_ENV: "uat", ICICI_PG_ENABLED: "true" } as any)).toBe(true);
  });

  it("is unavailable in production even when ICICI_PG_ENABLED=true", () => {
    expect(isIciciUatAvailable({ VERCEL_ENV: "production", ICICI_PG_ENABLED: "true" } as any)).toBe(false);
  });

  it("is unavailable when UAT credentials are accidentally present in production (NODE_ENV wins)", () => {
    expect(
      isIciciUatAvailable({
        NODE_ENV: "production",
        ICICI_PG_ENABLED: "true",
        ICICI_PG_MERCHANT_ID: "uat-merchant",
        ICICI_PG_SECRET_KEY: "uat-secret",
      } as any)
    ).toBe(false);
  });

  it("is unavailable when environment is uat but ICICI_PG_ENABLED is not 'true'", () => {
    expect(isIciciUatAvailable({ BUILDOHUB_ENV: "uat", ICICI_PG_ENABLED: "false" } as any)).toBe(false);
    expect(isIciciUatAvailable({ BUILDOHUB_ENV: "uat" } as any)).toBe(false);
  });

  it("is unavailable when environment is unset/unknown (fails closed to development)", () => {
    expect(isIciciUatAvailable({ ICICI_PG_ENABLED: "true" } as any)).toBe(false);
  });

  it("is unavailable on a staging/preview deployment even when enabled", () => {
    expect(isIciciUatAvailable({ VERCEL_ENV: "preview", ICICI_PG_ENABLED: "true" } as any)).toBe(false);
  });
});

describe("detectEnvironment precedence", () => {
  it("prefers DATABASE_ENV over BUILDOHUB_ENV/VERCEL_ENV/NODE_ENV", () => {
    expect(
      __detectEnvironmentForTests({
        DATABASE_ENV: "production",
        BUILDOHUB_ENV: "uat",
        VERCEL_ENV: "development",
      } as any)
    ).toBe("production");
  });

  it("prefers BUILDOHUB_ENV over VERCEL_ENV/NODE_ENV", () => {
    expect(__detectEnvironmentForTests({ BUILDOHUB_ENV: "uat", VERCEL_ENV: "production" } as any)).toBe("uat");
  });

  it("defaults to development when nothing is set", () => {
    expect(getBuildohubEnvironment({} as any)).toBe("development");
  });
});
