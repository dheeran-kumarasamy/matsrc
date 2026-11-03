import { AdminNav } from "@/components/admin/AdminNav";
import { GlobalSearch } from "@/components/admin/GlobalSearch";
import { PendingActionsButton, type PendingActionItem } from "@/components/admin/PendingActionsButton";
import { MENU_CONFIG, requireAdminAccess } from "@/lib/rbac";
import { adminApiGet } from "@/lib/api";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAdminAccess();
  const links = MENU_CONFIG.filter((menu) => access.menus.includes(menu.key)).map((menu) => ({
    href: menu.href,
    label: menu.label,
  }));

  // Real "N items need action" count — replaces the previous hardcoded "7"
  // (see PendingActionsButton.tsx's doc comment). Reuses the exact same
  // AdminDashboardService.getSummary() endpoint the Dashboard page already
  // calls; failure falls back to an empty/zero state rather than ever
  // showing a stale or fabricated count.
  const summary = await adminApiGet<{ pendingActionsCount: number; pendingActions: PendingActionItem[] }>(
    "/admin/dashboard"
  ).catch(() => ({ pendingActionsCount: 0, pendingActions: [] as PendingActionItem[] }));

  return (
    <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-4 p-4 lg:grid-cols-[280px_1fr]">
      <AdminNav
        links={links}
        userName={access.name || access.email || "Admin"}
        role={access.role}
      />
      <main className="space-y-4">
        <header className="panel flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Risk, Compliance, Operations</p>
            <h2 className="text-2xl font-extrabold text-slate-950">Admin Portal</h2>
          </div>
          <div className="flex items-center gap-3">
            <GlobalSearch />
            <PendingActionsButton totalCount={summary.pendingActionsCount} items={summary.pendingActions} />
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}