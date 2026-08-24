import { describe, expect, it } from "vitest";
import { getFirstName, getInitials } from "./user-display";

describe("getFirstName", () => {
  it("returns only the first name from a full name", () => {
    expect(getFirstName("Dheeran Kumarasamy")).toBe("Dheeran");
    expect(getFirstName("John Smith")).toBe("John");
    expect(getFirstName("Priya R")).toBe("Priya");
  });

  it("never returns the full name", () => {
    const first = getFirstName("Dheeran Kumarasamy");
    expect(first).not.toContain("Kumarasamy");
  });

  it("normalizes irregular/extra whitespace", () => {
    expect(getFirstName("  Dheeran   Kumarasamy  ")).toBe("Dheeran");
  });

  it("falls back to the email local-part when there is no name", () => {
    expect(getFirstName(null, "dheeran@example.com")).toBe("dheeran");
    expect(getFirstName(undefined, "dheeran@example.com")).toBe("dheeran");
  });

  it("falls back to the provided fallback when neither name nor email exist", () => {
    expect(getFirstName(null, null, "there")).toBe("there");
    expect(getFirstName("", "", "there")).toBe("there");
  });

  it("handles a single-word name", () => {
    expect(getFirstName("Cher")).toBe("Cher");
  });
});

describe("getInitials", () => {
  it("derives two-letter initials from first + last name", () => {
    expect(getInitials("Dheeran Kumarasamy")).toBe("DK");
    expect(getInitials("John Smith")).toBe("JS");
    expect(getInitials("Priya R")).toBe("PR");
  });

  it("is dynamic, not hardcoded, for arbitrary names", () => {
    expect(getInitials("Alex Johnson")).toBe("AJ");
    expect(getInitials("Zara Ng")).toBe("ZN");
  });

  it("handles a missing last name by using the single word's own letters", () => {
    expect(getInitials("Cher")).toBe("CH");
    expect(getInitials("X")).toBe("X");
  });

  it("normalizes irregular/extra whitespace before deriving initials", () => {
    expect(getInitials("  Dheeran    Kumarasamy  ")).toBe("DK");
  });

  it("uses the middle/last-most name for the second initial with 3+ words", () => {
    expect(getInitials("Dheeran Kumar Kumarasamy")).toBe("DK");
  });

  it("falls back to the email local-part when there is no name", () => {
    expect(getInitials(null, "dheeran@example.com")).toBe("DH");
  });

  it("falls back to the provided fallback when neither name nor email exist", () => {
    expect(getInitials(null, null, "U")).toBe("U");
    expect(getInitials("", "", "U")).toBe("U");
  });
});
