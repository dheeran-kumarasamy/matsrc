import { describe, expect, it } from "vitest";
import { isIciciUatAvailable, getBuildohubEnvironment, __detectEnvironmentForTests } from "./environment";

describe("isIciciUatAvailable fail-closed matrix", () => {
  it("Combination 1: Generic preview without UAT branch/site is strictly false", () => {
    expect(
      isIciciUatAvailable({
        VERCEL_ENV: "preview",
        BUILDOHUB_ENV: "uat",
        DATABASE_ENV: "uat",
        ICICI_PG_ENABLED: "true",
      } as any)
    ).toBe(false);
  });

  it("Combination 2: Preview on UAT branch is strictly true", () => {
    expect(
      isIciciUatAvailable({
        VERCEL_ENV: "preview",
        BUILDOHUB_ENV: "preview",
        DATABASE_ENV: "uat",
        ICICI_PG_ENABLED: "true",
        VERCEL_GIT_COMMIT_REF: "uat",
      } as any)
    ).toBe(true);
  });

  it("Combination 3: Preview on UAT domain is strictly true", () => {
    expect(
      isIciciUatAvailable({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SITE_URL: "https://uat.buildohub.in",
      } as any)
    ).toBe(true);
  });

  it("Combination 4: Production + uat/uat is strictly false", () => {
    expect(
      isIciciUatAvailable({
        VERCEL_ENV: "production",
        BUILDOHUB_ENV: "uat",
        DATABASE_ENV: "uat",
        ICICI_PG_ENABLED: "true",
      } as any)
    ).toBe(false);
  });

  it("Combination 5: Production + production/uat is strictly false", () => {
    expect(
      isIciciUatAvailable({
        VERCEL_ENV: "production",
        BUILDOHUB_ENV: "production",
        DATABASE_ENV: "uat",
        ICICI_PG_ENABLED: "true",
      } as any)
    ).toBe(false);
  });

  it("Combination 6: Development + uat is strictly false (DATABASE_ENV cannot independently authorize)", () => {
    expect(
      isIciciUatAvailable({
        BUILDOHUB_ENV: "development",
        DATABASE_ENV: "uat",
        ICICI_PG_ENABLED: "true",
      } as any)
    ).toBe(false);
  });

  it("Combination 7: Development + development is strictly false", () => {
    expect(
      isIciciUatAvailable({
        BUILDOHUB_ENV: "development",
        DATABASE_ENV: "development",
        ICICI_PG_ENABLED: "true",
      } as any)
    ).toBe(false);
  });

  it("Combination 8: Authorized UAT with explicit switch is strictly true", () => {
    expect(
      isIciciUatAvailable({
        BUILDOHUB_ENV: "uat",
        DATABASE_ENV: "uat",
        ICICI_PG_ENABLED: "true",
      } as any)
    ).toBe(true);
  });

  it("Combination 9: Authorized UAT with explicit false is strictly false", () => {
    expect(
      isIciciUatAvailable({
        ICICI_PG_ENABLED: "false",
        VERCEL_GIT_COMMIT_REF: "uat",
      } as any)
    ).toBe(false);
  });

  it("Combination 10: Conflicting config (DATABASE_ENV=production) fails closed to false", () => {
    expect(
      isIciciUatAvailable({
        BUILDOHUB_ENV: "uat",
        DATABASE_ENV: "production",
        ICICI_PG_ENABLED: "true",
      } as any)
    ).toBe(false);
  });
});

describe("detectEnvironment", () => {
  it("enforces VERCEL_ENV=preview without UAT as staging", () => {
    expect(__detectEnvironmentForTests({ VERCEL_ENV: "preview" } as any)).toBe("staging");
  });

  it("detects uat when VERCEL_GIT_COMMIT_REF=uat on preview", () => {
    expect(__detectEnvironmentForTests({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "uat" } as any)).toBe("uat");
  });

  it("enforces VERCEL_ENV=production as production", () => {
    expect(__detectEnvironmentForTests({ VERCEL_ENV: "production", BUILDOHUB_ENV: "uat" } as any)).toBe("production");
  });

  it("enforces DATABASE_ENV=production as production", () => {
    expect(__detectEnvironmentForTests({ DATABASE_ENV: "production", BUILDOHUB_ENV: "uat" } as any)).toBe("production");
  });

  it("detects uat when BUILDOHUB_ENV=uat and DATABASE_ENV is matching", () => {
    expect(__detectEnvironmentForTests({ BUILDOHUB_ENV: "uat", DATABASE_ENV: "uat" } as any)).toBe("uat");
  });

  it("fails closed when BUILDOHUB_ENV=uat but DATABASE_ENV conflicts", () => {
    expect(__detectEnvironmentForTests({ BUILDOHUB_ENV: "uat", DATABASE_ENV: "production" } as any)).toBe("production");
    expect(__detectEnvironmentForTests({ BUILDOHUB_ENV: "uat", DATABASE_ENV: "staging" } as any)).toBe("development");
  });

  it("defaults to development when nothing is set", () => {
    expect(getBuildohubEnvironment({} as any)).toBe("development");
  });
});
