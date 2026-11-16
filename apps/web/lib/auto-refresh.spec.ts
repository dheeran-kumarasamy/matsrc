import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { AutoRefresh } from "@/components/shared/AutoRefresh";

describe("AutoRefresh Component", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("exports AutoRefresh as a function", () => {
    expect(typeof AutoRefresh).toBe("function");
  });
});
