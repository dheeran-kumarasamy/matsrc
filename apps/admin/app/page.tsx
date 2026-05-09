import { redirect } from "next/navigation";
import { firstAllowedHref, getCurrentAdminAccess } from "@/lib/rbac";

export default async function HomePage() {
  const access = await getCurrentAdminAccess();
  if (!access) {
    redirect("/sign-in");
  }

  redirect(firstAllowedHref(access.menus));
}