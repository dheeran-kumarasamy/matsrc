import Link from "next/link";
import { ShoppingCart, Bell, User, Package, TrendingUp, CreditCard, Star, FileText } from "lucide-react";
import QuickRequestForm from "@/components/cart/QuickRequestForm";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: TrendingUp },
  { href: "/products", label: "Browse Materials", icon: Package },
  { href: "/orders", label: "My Orders", icon: FileText },
  { href: "/watchlist", label: "Watchlist", icon: Star },
  { href: "/credit", label: "Credit / BNPL", icon: CreditCard },
  { href: "/disputes", label: "Disputes", icon: Bell },
];

export default function BuilderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top navbar */}
      <header className="bg-brand-500 text-white h-14 flex items-center px-4 sticky top-0 z-40 shadow-md">
        <Link href="/dashboard" className="text-xl font-bold mr-8">
          Build<span className="text-accent-500">Mart</span>
        </Link>
        <nav className="hidden md:flex items-center gap-6 flex-1">
          {navItems.map(({ href, label }) => (
            <Link key={href} href={href} className="text-sm text-blue-100 hover:text-white transition-colors">
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3 ml-auto">
          <Link href="/cart" className="relative p-2 hover:bg-white/10 rounded-lg transition-colors">
            <ShoppingCart size={20} />
            <span className="absolute -top-1 -right-1 bg-accent-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center">0</span>
          </Link>
          <Link href="/profile" className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <User size={20} />
          </Link>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>

      {/* FR-32: Floating Quick Request Form — always visible */}
      <QuickRequestForm floating />
    </div>
  );
}
