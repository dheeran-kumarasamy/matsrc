import { readFileSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

// C22 regression guard: the Create Account page must never present a
// "Select Role" control again, and Google registration (C02/C23) must keep
// working unmodified. The repo has no React component-test harness
// configured (no testing-library/jsdom wired into vitest.config.ts — see
// lib/product-card-price-render.spec.ts for the same pattern), so this
// asserts against the actual rendered register page source.
const registerPageSource = readFileSync(
  path.resolve(__dirname, "../app/(auth)/auth/register/page.tsx"),
  "utf-8"
);

describe("Create Account page — C22 Select Role removal (source regression guard)", () => {
  it("no longer renders a role-selection step", () => {
    expect(registerPageSource).not.toMatch(/step === "role"/);
    expect(registerPageSource).not.toMatch(/How will you use Buildohub/);
  });

  it("no longer has client-selectable role state", () => {
    expect(registerPageSource).not.toMatch(/useState<"BUILDER" \| "SUPPLIER"/);
    expect(registerPageSource).not.toMatch(/handleRoleSelect/);
  });

  it("still submits a fixed, non-user-controlled role to the backend", () => {
    expect(registerPageSource).toMatch(/CUSTOMER_PORTAL_ROLE = "BUILDER"/);
    expect(registerPageSource).toMatch(/role: CUSTOMER_PORTAL_ROLE/);
  });

  it("the OTP step transitions directly to the contact step (no intermediate role step)", () => {
    expect(registerPageSource).toMatch(/setStep\("contact"\)/);
  });

  it("still wires up Google sign-in (C02) with the shared GoogleIcon (C23)", () => {
    expect(registerPageSource).toMatch(/signIn\("google"/);
    expect(registerPageSource).toMatch(/<GoogleIcon \/>/);
    expect(registerPageSource).toMatch(/from "@\/components\/shared\/GoogleIcon"/);
  });
});
