import { readFileSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

// C16 + C23 regression guards (source-based — no jsdom/testing-library
// harness configured in this repo, see lib/product-card-price-render.spec.ts
// for the same pattern).

describe("C16 — BuildOHub logo uses Poppins, scoped to the shared logo component only", () => {
  const logoSource = readFileSync(
    path.resolve(__dirname, "../components/shared/BuildOHubLogo.tsx"),
    "utf-8"
  );
  const globalsCss = readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf-8");

  it("globals.css loads Poppins and scopes it to .brand-wordmark only", () => {
    expect(globalsCss).toMatch(/family=Poppins/);
    expect(globalsCss).toMatch(/\.brand-wordmark\s*\{[^}]*Poppins/);
  });

  it("BuildOHubLogo applies the brand-wordmark class", () => {
    expect(logoSource).toMatch(/brand-wordmark/);
  });

  it("does not redefine Poppins on the shared .posh-heading class (no global font change)", () => {
    const poshHeadingBlockMatch = globalsCss.match(/\.posh-heading\s*\{[^}]*\}/);
    expect(poshHeadingBlockMatch).not.toBeNull();
    expect(poshHeadingBlockMatch![0]).not.toMatch(/Poppins/);
  });
});

describe("C23 — Google logo shared between Sign In and Create Account", () => {
  const googleIconSource = readFileSync(
    path.resolve(__dirname, "../components/shared/GoogleIcon.tsx"),
    "utf-8"
  );
  const loginSource = readFileSync(
    path.resolve(__dirname, "../app/(auth)/auth/login/page.tsx"),
    "utf-8"
  );
  const registerSource = readFileSync(
    path.resolve(__dirname, "../app/(auth)/auth/register/page.tsx"),
    "utf-8"
  );

  it("GoogleIcon renders the real Google 4-colour mark", () => {
    expect(googleIconSource).toMatch(/#4285F4/);
    expect(googleIconSource).toMatch(/#34A853/);
    expect(googleIconSource).toMatch(/#FBBC05/);
    expect(googleIconSource).toMatch(/#EA4335/);
  });

  it("both Sign In and Create Account render the shared GoogleIcon", () => {
    expect(loginSource).toMatch(/<GoogleIcon \/>/);
    expect(registerSource).toMatch(/<GoogleIcon \/>/);
  });
});
