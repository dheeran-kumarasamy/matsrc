import { readFileSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

// Advance Payment page — Advance Balance amount input improvements.
// Regression guard for components/advance/AddAdvanceForm.tsx (the Buyer
// Portal's Add Advance form rendered on /advance): the Amount input must
// (1) start blank / never be prefilled with a suggested or default amount,
// and (2) display Indian-style comma grouping while typing, while the
// underlying submitted value (via builderApiUpload's FormData) stays the
// raw, unformatted numeric string. The repo has no React component-test
// harness configured (no testing-library/jsdom wired into
// vitest.config.ts — see lib/product-card-price-render.spec.ts for the
// same pattern), so this asserts against the actual component source
// rather than introducing a new test framework/dependency.
const formSource = readFileSync(
  path.resolve(__dirname, "../components/advance/AddAdvanceForm.tsx"),
  "utf-8"
);

describe("AddAdvanceForm amount input (source regression guard)", () => {
  it("initializes the amount state blank, with no default/suggested value", () => {
    expect(formSource).toMatch(/const \[amount, setAmount\] = useState\(""\)/);
  });

  it("never prefills the amount from an available-balance/suggested value", () => {
    expect(formSource).not.toMatch(/setAmount\(.*availableBalance/);
    expect(formSource).not.toMatch(/useState\(.*availableBalance/);
  });

  it("formats the displayed amount using the shared Indian-grouping utility", () => {
    expect(formSource).toMatch(/formatAmountIndian\(amount\)/);
  });

  it("strips formatting back to a raw value on every edit via the shared utility", () => {
    expect(formSource).toMatch(/stripAmountFormatting\(input\.value\)/);
  });

  it("submits the raw amount (Number(amount)), never the comma-formatted display string", () => {
    expect(formSource).toMatch(/const amountNum = Number\(amount\)/);
    expect(formSource).not.toMatch(/formData\.append\("amount", formatAmountIndian/);
  });
});
