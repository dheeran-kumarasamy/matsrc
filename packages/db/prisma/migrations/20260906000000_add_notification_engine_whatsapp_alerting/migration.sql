-- CreateTable
CREATE TABLE "whatsapp_message_logs" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'outbound',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "parameters" JSONB,
    "mode" TEXT NOT NULL DEFAULT 'live',
    "metaMessageId" TEXT,
    "errorDetails" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_events" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "recipientType" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'P1',
    "channel" TEXT,
    "dedupeKey" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "suppressReason" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_event_policies" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" TEXT NOT NULL DEFAULT 'P1',
    "maxPerDay" INTEGER,
    "cooldownMinutes" INTEGER,
    "businessHoursOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_event_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_policy_audits" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "changedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_policy_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationGlobalSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "whatsappBusinessEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "NotificationGlobalSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_message_logs_metaMessageId_key" ON "whatsapp_message_logs"("metaMessageId");

-- CreateIndex
CREATE INDEX "whatsapp_message_logs_phoneNumber_idx" ON "whatsapp_message_logs"("phoneNumber");

-- CreateIndex
CREATE INDEX "whatsapp_message_logs_templateName_idx" ON "whatsapp_message_logs"("templateName");

-- CreateIndex
CREATE INDEX "whatsapp_message_logs_status_idx" ON "whatsapp_message_logs"("status");

-- CreateIndex
CREATE INDEX "whatsapp_message_logs_createdAt_idx" ON "whatsapp_message_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_events_dedupeKey_key" ON "notification_events"("dedupeKey");

-- CreateIndex
CREATE INDEX "notification_events_eventType_idx" ON "notification_events"("eventType");

-- CreateIndex
CREATE INDEX "notification_events_recipientId_idx" ON "notification_events"("recipientId");

-- CreateIndex
CREATE INDEX "notification_events_priority_idx" ON "notification_events"("priority");

-- CreateIndex
CREATE INDEX "notification_events_status_idx" ON "notification_events"("status");

-- CreateIndex
CREATE INDEX "notification_events_createdAt_idx" ON "notification_events"("createdAt");

-- CreateIndex
CREATE INDEX "notification_event_policies_channel_idx" ON "notification_event_policies"("channel");

-- CreateIndex
CREATE INDEX "notification_event_policies_enabled_idx" ON "notification_event_policies"("enabled");

-- CreateIndex
CREATE INDEX "notification_event_policies_eventType_idx" ON "notification_event_policies"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "notification_event_policies_eventType_channel_key" ON "notification_event_policies"("eventType", "channel");

-- CreateIndex
CREATE INDEX "notification_policy_audits_policyId_idx" ON "notification_policy_audits"("policyId");

-- CreateIndex
CREATE INDEX "notification_policy_audits_createdAt_idx" ON "notification_policy_audits"("createdAt");

