// (newdash) route group — minimal pass-through layout.
// No sidebar, no builder header, no search bar.
// The newdashboard page is full-screen and carries its own header.
// CartDrawer is mounted here so openCart() from the page's Cart button works.
import CartDrawer from "@/components/cart/CartDrawer";

export default function NewDashLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CartDrawer />
    </>
  );
}
