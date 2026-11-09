import { readFileSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { PROFILE_NAV_OPTIONS } from "@/components/profile/ProfileNavOptions";

describe("Buyer Navigation - Move Sites, Watchlist, Purchase orders, Disputes to view profile section", () => {
  const builderNavSource = readFileSync(
    path.resolve(__dirname, "../components/builder/BuilderNav.tsx"),
    "utf-8"
  );
  const profileNavOptionsSource = readFileSync(
    path.resolve(__dirname, "../components/profile/ProfileNavOptions.tsx"),
    "utf-8"
  );
  const profilePageSource = readFileSync(
    path.resolve(__dirname, "../app/(builder)/profile/page.tsx"),
    "utf-8"
  );

  it("removes Sites, Watchlist, Purchase orders, and Disputes from the left hand panel (BuilderNav)", () => {
    // Extract the links array definition
    const linksMatch = builderNavSource.match(/const links:.*?=\s*\[([\s\S]*?)\];/);
    expect(linksMatch).not.toBeNull();
    const linksContent = linksMatch![1];

    expect(linksContent).not.toMatch(/"\/sites"/);
    expect(linksContent).not.toMatch(/"\/watchlist"/);
    expect(linksContent).not.toMatch(/"\/purchase-orders"/);
    expect(linksContent).not.toMatch(/"\/disputes"/);
  });

  it("keeps core navigation in BuilderNav", () => {
    expect(builderNavSource).toMatch(/"\/newdashboard"/);
    expect(builderNavSource).toMatch(/"\/sourcing"/);
    expect(builderNavSource).toMatch(/"\/orders"/);
    expect(builderNavSource).toMatch(/"\/advance"/);
  });

  it("defines the 4 clickable options in PROFILE_NAV_OPTIONS", () => {
    expect(PROFILE_NAV_OPTIONS).toHaveLength(4);
    expect(PROFILE_NAV_OPTIONS.map((o) => o.href)).toEqual([
      "/sites",
      "/watchlist",
      "/purchase-orders",
      "/disputes",
    ]);
    expect(PROFILE_NAV_OPTIONS.map((o) => o.label)).toEqual([
      "Sites",
      "Watchlist",
      "Purchase orders",
      "Disputes",
    ]);
  });

  it("aligns the 4 options in a single row in ProfileNavOptions component", () => {
    expect(profileNavOptionsSource).toMatch(/grid-cols-4/);
  });

  it("mounts ProfileNavOptions at the top of the buyer view profile section", () => {
    expect(profilePageSource).toMatch(/import ProfileNavOptions from "@/);
    expect(profilePageSource).toMatch(/<ProfileNavOptions\s*\/>/);
  });
});

