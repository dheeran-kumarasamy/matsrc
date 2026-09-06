// packages/db/scripts/seed-notification-templates.js
//
// Phase 15 — Template Registry seed for the Buildohub Notification Engine +
// WhatsApp Alerting System. Creates/updates NotificationEventPolicy rows
// (the Admin-editable "is this eventType/channel combination allowed to
// fire" registry) and ensures a single NotificationGlobalSettings row
// exists.
//
// Idempotent: upserts on the [eventType, channel] unique key, so re-running
// this script never creates duplicates and never clobbers an admin's prior
// enabled/disabled/limit decision on subsequent runs. `templateName` (the
// Meta-side mapping) IS kept in sync on every run, since it is never an
// admin-editable field (see UpdateNotificationPolicyDto) — this is what
// lets a Meta template rename (e.g. supplier_quote_reminder ->
// supplier_rfq_reminder) be rolled out by re-running this script.
//
// IMPORTANT: `templateName` here must match an ALREADY Meta-approved
// WhatsApp template name once WHATSAPP_MODE=live — this script does NOT
// assume Meta has approved any of these; it only seeds Buildohub's own
// business-enable/disable registry (see NotificationEventPolicy schema
// comment). Update `templateName` to the real approved template name before
// going live if it differs from the placeholder below.
//
// Usage (from repo root):
//   node packages/db/scripts/seed-notification-templates.js

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const POLICIES = [
  { eventType: "SUPPLIER_RFQ_RECEIVED", channel: "WHATSAPP", templateName: "supplier_quote_alert", displayName: "New RFQ Received", description: "Notifies a supplier that a new RFQ/enquiry has been submitted for their listing.", priority: "P1", cooldownMinutes: null, maxPerDay: null, businessHoursOnly: false },
  // Meta template mapping updated: the original "supplier_quote_reminder" template was
  // accidentally created under the Marketing category and deleted. Meta imposes a 4-week
  // restriction preventing the same template name from being recreated under Utility, so
  // a new Utility template "supplier_rfq_reminder" was created and approved instead. The
  // business event (SUPPLIER_RFQ_REMINDER) is unchanged — only the Meta template name
  // this event maps to has changed. Do NOT reintroduce "supplier_quote_reminder" here.
  { eventType: "SUPPLIER_RFQ_REMINDER", channel: "WHATSAPP", templateName: "supplier_rfq_reminder", displayName: "RFQ Response Reminder", description: "Reminds a supplier of a pending RFQ they have not yet responded to.", priority: "P1", cooldownMinutes: 240, maxPerDay: 1, businessHoursOnly: true },
  { eventType: "SUPPLIER_PO_RECEIVED", channel: "WHATSAPP", templateName: "supplier_po_alert", displayName: "Purchase Order Received", description: "Notifies a supplier that a new Purchase Order has been issued to them.", priority: "P0", cooldownMinutes: null, maxPerDay: null, businessHoursOnly: false },
  { eventType: "SUPPLIER_PO_ACCEPTANCE_REQUIRED", channel: "WHATSAPP", templateName: "po_acceptance_reminder", displayName: "PO Acceptance Required", description: "Reminds a supplier that a Purchase Order requires their acceptance.", priority: "P0", cooldownMinutes: 240, maxPerDay: 1, businessHoursOnly: true },
  { eventType: "SUPPLIER_DISPATCH_DUE", channel: "WHATSAPP", templateName: "dispatch_reminder", displayName: "Dispatch Due", description: "Reminds a supplier that a dispatch is due against an accepted PO.", priority: "P1", cooldownMinutes: 240, maxPerDay: 1, businessHoursOnly: true },
];

POLICIES.push(
  { eventType: "SUPPLIER_DISPATCH_OVERDUE", channel: "WHATSAPP", templateName: "dispatch_reminder", displayName: "Dispatch Overdue", description: "Alerts a supplier that a dispatch is overdue against an accepted PO.", priority: "P0", cooldownMinutes: 240, maxPerDay: 1, businessHoursOnly: false },
  { eventType: "SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED", channel: "WHATSAPP", templateName: "supplier_price_update", displayName: "Daily Price Update Required", description: "Reminds a supplier that today's price list update is incomplete for one or more active listings.", priority: "P1", cooldownMinutes: null, maxPerDay: 1, businessHoursOnly: true },
  { eventType: "QUOTE_RECEIVED", channel: "WHATSAPP", templateName: "quote_received", displayName: "Quote Received", description: "Notifies a customer that a supplier has responded to their RFQ with a quote.", priority: "P1", cooldownMinutes: null, maxPerDay: null, businessHoursOnly: false },
  { eventType: "QUOTE_COMPARISON_READY", channel: "WHATSAPP", templateName: "quote_comparison_ready", displayName: "Quote Comparison Ready", description: "Notifies a customer that enough quotes have been received to compare and select.", priority: "P1", cooldownMinutes: null, maxPerDay: 1, businessHoursOnly: false },
  { eventType: "QUOTE_EXPIRY_REMINDER", channel: "WHATSAPP", templateName: "quote_expiry_reminder", displayName: "Quote Expiry Reminder", description: "Reminds a customer that a received quote is about to expire.", priority: "P1", cooldownMinutes: 240, maxPerDay: 1, businessHoursOnly: true },
  { eventType: "PAYMENT_REQUIRED", channel: "WHATSAPP", templateName: "payment_required", displayName: "Payment Required", description: "Notifies a customer that payment is required to proceed with an order.", priority: "P0", cooldownMinutes: null, maxPerDay: null, businessHoursOnly: false },
  { eventType: "PAYMENT_FAILED", channel: "WHATSAPP", templateName: "payment_failed", displayName: "Payment Failed", description: "Notifies a customer that a payment attempt failed.", priority: "P0", cooldownMinutes: null, maxPerDay: null, businessHoursOnly: false },
  { eventType: "ORDER_STATUS_CHANGED", channel: "WHATSAPP", templateName: "customer_order_status", displayName: "Order Status Update", description: "Notifies a customer whenever their order's status changes.", priority: "P1", cooldownMinutes: null, maxPerDay: null, businessHoursOnly: false },
  { eventType: "DELIVERY_EXCEPTION", channel: "WHATSAPP", templateName: "delivery_exception", displayName: "Delivery Exception", description: "Alerts a customer of a delivery exception (delay, damage, failed attempt) on their order.", priority: "P0", cooldownMinutes: null, maxPerDay: null, businessHoursOnly: false },
  { eventType: "ACTION_REQUIRED", channel: "WHATSAPP", templateName: "action_reminder_alert", displayName: "Action Required", description: "Generic action-required nudge for a customer (e.g. confirm delivery slot, upload document).", priority: "P1", cooldownMinutes: 240, maxPerDay: 1, businessHoursOnly: true }
);

async function main() {
  for (const policy of POLICIES) {
    await prisma.notificationEventPolicy.upsert({
      where: { eventType_channel: { eventType: policy.eventType, channel: policy.channel } },
      // templateName is the Meta-side mapping (never an admin-editable business
      // decision — see UpdateNotificationPolicyDto, which deliberately excludes
      // templateName), so it is always kept in sync with this registry on
      // re-run. Admin-owned fields (enabled/priority/maxPerDay/cooldownMinutes/
      // businessHoursOnly) are intentionally left untouched here so a prior
      // admin decision is never clobbered by re-running this seed.
      update: { templateName: policy.templateName },
      create: policy,
    });
    console.log(`  \u2713 ${policy.eventType} / ${policy.channel} -> ${policy.templateName}`);
  }

  await prisma.notificationGlobalSettings.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global", whatsappBusinessEnabled: true },
  });
  console.log("  \u2713 NotificationGlobalSettings singleton row ensured");
}

main()
  .then(() => {
    console.log(`\nSeeded ${POLICIES.length} notification event policies.`);
    return prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
