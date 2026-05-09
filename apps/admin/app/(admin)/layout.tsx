import { AdminNav } from "@/components/admin/AdminNav";
import { MENU_CONFIG, requireAdminAccess } from "@/lib/rbac";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAdminAccess();
  const links = MENU_CONFIG.filter((menu) => access.menus.includes(menu.key)).map((menu) => ({
    href: menu.href,
    label: menu.label,
  }));

  return (
    <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-4 p-4 lg:grid-cols-[280px_1fr]">
      <AdminNav
        links={links}
        userName={access.name || access.email || "Admin"}
        role={access.role}
      />
      <main className="space-y-4">
        <header className="panel flex items-center justify-between p-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Risk, Compliance, Operations</p>
            <h2 className="text-2xl font-extrabold text-slate-950">Admin Portal</h2>
          </div>
          <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700">7 items need action</span>
        </header>
        {children}
      </main>
    </div>
  );
}