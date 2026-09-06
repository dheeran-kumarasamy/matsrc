import { WhatsAppTestAlertPanel } from "@/components/admin/notifications/WhatsAppTestAlertPanel";
import { adminApiGet } from "@/lib/api";
import { requireMenu } from "@/lib/rbac";

type WhatsAppMessageLog = {
  id: string;
  phoneNumber: string;
  templateName: string;
  direction: string;
  status: string;
  mode: string;
  metaMessageId: string | null;
  errorDetails: string | null;
  createdAt: string;
  updatedAt: string;
};

export default async function WhatsAppAlertsPage() {
  await requireMenu("whatsapp-alerts");

  const [modeResult, logs] = await Promise.all([
    adminApiGet<{ mode: string }>("/admin/whatsapp-alerts/mode").catch(() => ({ mode: "unknown" })),
    adminApiGet<WhatsAppMessageLog[]>("/admin/whatsapp-alerts/logs?limit=50").catch(() => [] as WhatsAppMessageLog[]),
  ]);

  return <WhatsAppTestAlertPanel mode={modeResult.mode} initialLogs={logs} />;
}
