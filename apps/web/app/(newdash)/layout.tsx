// (newdash) route group — minimal pass-through layout.
// No sidebar, no builder header, no search bar.
// The newdashboard page is full-screen and carries its own header.
// CartDrawer is mounted here so openCart() from the page's Cart button works.
import CartDrawer from "@/components/cart/CartDrawer";
import FloatingBrowseLink from "@/components/builder/FloatingBrowseLink";

export default function NewDashLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CartDrawer />
      {/* "Browse Materials" was removed from the (builder) sidebar nav
          since it's a duplicate entry point to the same shortcut already
          shown bottom-right on every builder page. /newdashboard lives in
          its own route group (no sidebar at all), so it needs this same
          floating shortcut mounted directly to keep Browse Materials
          reachable from here too. */}
      <FloatingBrowseLink />
    </>
  );
}
