import { NotificationPolicyPanel } from "@/components/admin/notifications/NotificationPolicyPanel";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";

type NotificationPolicy = {
  id: string;
  eventType: string;
  channel: string;
  templateName: string;
  displayName: string;
  description: string | null;
  enabled: boolean;
  priority: string;
  maxPerDay: number | null;
  cooldownMinutes: number | null;
  businessHoursOnly: boolean;
};

type GlobalSettings = {
  id: string;
  whatsappBusinessEnabled: boolean;
  whatsappMode: string;
  updatedAt: string;
  updatedBy: string | null;
};

export default async function NotificationsPage() {
  await requireMenu("notifications");

  const [policies, globalSettings] = await Promise.all([
    adminApiGet<NotificationPolicy[]>("/admin/notifications/policies").catch(() => [] as NotificationPolicy[]),
    adminApiGet<GlobalSettings>("/admin/notifications/global-settings").catch(() => null),
  ]);

  return <NotificationPolicyPanel policies={policies} globalSettings={globalSettings} />;
}
