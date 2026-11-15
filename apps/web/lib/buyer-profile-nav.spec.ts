import { readFileSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";
import { PROFILE_NAV_OPTIONS } from "@/components/profile/ProfileNavOptions";

describe("Buyer Navigation - Move Sites, Watchlist, Purchase orders, Disputes to view profile section as persistent tabs", () => {
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
  const sitesPageSource = readFileSync(
    path.resolve(__dirname, "../app/(builder)/sites/page.tsx"),
    "utf-8"
  );
  const watchlistPageSource = readFileSync(
    path.resolve(__dirname, "../app/(builder)/watchlist/page.tsx"),
    "utf-8"
  );
  const purchaseOrdersPageSource = readFileSync(
    path.resolve(__dirname, "../app/(builder)/purchase-orders/page.tsx"),
    "utf-8"
  );
  const disputesPageSource = readFileSync(
    path.resolve(__dirname, "../app/(builder)/disputes/page.tsx"),
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

  it("defines the clickable options in PROFILE_NAV_OPTIONS (Profile, Sites, Watchlist, Purchase orders, Disputes)", () => {
    expect(PROFILE_NAV_OPTIONS).toHaveLength(5);
    expect(PROFILE_NAV_OPTIONS.map((o) => o.href)).toEqual([
      "/profile",
      "/sites",
      "/watchlist",
      "/purchase-orders",
      "/disputes",
    ]);
    expect(PROFILE_NAV_OPTIONS.map((o) => o.label)).toEqual([
      "Profile",
      "Sites",
      "Watchlist",
      "Purchase orders",
      "Disputes",
    ]);
  });

  it("aligns the options in ProfileNavOptions component with active tab highlighting", () => {
    expect(profileNavOptionsSource).toMatch(/grid-cols-5/);
    expect(profileNavOptionsSource).toMatch(/usePathname/);
    expect(profileNavOptionsSource).toMatch(/aria-current/);
  });

  it("mounts ProfileNavOptions across all view profile and related section pages", () => {
    expect(profilePageSource).toMatch(/<ProfileNavOptions\s*\/>/);
    expect(sitesPageSource).toMatch(/<ProfileNavOptions\s*\/>/);
    expect(watchlistPageSource).toMatch(/<ProfileNavOptions\s*\/>/);
    expect(purchaseOrdersPageSource).toMatch(/<ProfileNavOptions\s*\/>/);
    expect(disputesPageSource).toMatch(/<ProfileNavOptions\s*\/>/);
  });
});
