import { create } from "zustand";

// UF-02/UF-03 — Single-page overlay ordering architecture (spec section 5A).
// This store coordinates the two overlay surfaces that sit on top of the
// persistent PLP shell: the product quick-view Dialog and the cart Sheet
// (which also renders the stepped checkout wizard). Keeping this state in
// Zustand (rather than local component state) lets ANY part of the app —
// product cards, the nav cart icon, the quick-view panel — open/advance the
// same drawer without prop drilling or unmounting the PLP.

export type CheckoutStep = "review" | "delivery" | "confirm" | "success";

interface OverlayState {
  // Quick-view product dialog
  quickViewProductId: string | null;
  openQuickView: (productId: string) => void;
  closeQuickView: () => void;

  // Cart drawer + inline stepped checkout
  isCartOpen: boolean;
  checkoutStep: CheckoutStep;
  lastOrderReference: string | null;
  openCart: (step?: CheckoutStep) => void;
  closeCart: () => void;
  setCheckoutStep: (step: CheckoutStep) => void;
  goToNextStep: () => void;
  goToPreviousStep: () => void;
  completeCheckout: (orderReference: string) => void;
  resetCheckout: () => void;
}

const STEP_ORDER: CheckoutStep[] = ["review", "delivery", "confirm", "success"];

export const useOverlayStore = create<OverlayState>((set, get) => ({
  quickViewProductId: null,
  openQuickView: (productId) => set({ quickViewProductId: productId }),
  closeQuickView: () => set({ quickViewProductId: null }),

  isCartOpen: false,
  checkoutStep: "review",
  lastOrderReference: null,
  openCart: (step = "review") => set({ isCartOpen: true, checkoutStep: step }),
  closeCart: () => set({ isCartOpen: false }),
  setCheckoutStep: (step) => set({ checkoutStep: step }),
  goToNextStep: () => {
    const currentIndex = STEP_ORDER.indexOf(get().checkoutStep);
    const next = STEP_ORDER[Math.min(currentIndex + 1, STEP_ORDER.length - 1)];
    set({ checkoutStep: next });
  },
  goToPreviousStep: () => {
    const currentIndex = STEP_ORDER.indexOf(get().checkoutStep);
    const previous = STEP_ORDER[Math.max(currentIndex - 1, 0)];
    set({ checkoutStep: previous });
  },
  completeCheckout: (orderReference) => set({ checkoutStep: "success", lastOrderReference: orderReference }),
  resetCheckout: () => set({ checkoutStep: "review", lastOrderReference: null }),
}));
