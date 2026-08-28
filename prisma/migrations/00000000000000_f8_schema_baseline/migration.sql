-- F8 formal baseline. Source: schema-only Prisma diff plus pg_catalog functions/triggers from salon_ai_f7_snapshot.
-- Do not execute this SQL on an existing schema: use prisma migrate resolve --applied 00000000000000_f8_schema_baseline.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AccountChargeStatus" AS ENUM ('PENDING', 'PAID', 'BONIFIED');

-- CreateEnum
CREATE TYPE "public"."AppointmentOrigin" AS ENUM ('BOT', 'WEB', 'MANUAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "public"."AppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "public"."BillingOwner" AS ENUM ('CLIENT', 'SALON_AI');

-- CreateEnum
CREATE TYPE "public"."BookingDepositProofKind" AS ENUM ('INITIAL', 'RESUBMISSION', 'LATE');

-- CreateEnum
CREATE TYPE "public"."BookingDepositProofValidationStatus" AS ENUM ('VALID');

-- CreateEnum
CREATE TYPE "public"."BookingDepositSource" AS ENUM ('WHATSAPP', 'WEB');

-- CreateEnum
CREATE TYPE "public"."BookingDepositStatus" AS ENUM ('PENDING_PROOF', 'PROOF_RECEIVED', 'APPROVED', 'REJECTED', 'EXPIRED', 'PENDING_RESUBMISSION');

-- CreateEnum
CREATE TYPE "public"."BookingDepositTtlProvenance" AS ENUM ('BUSINESS_POLICY', 'DEFAULT_120');

-- CreateEnum
CREATE TYPE "public"."BookingFlowOrder" AS ENUM ('PROFESSIONAL_FIRST', 'DATE_TIME_FIRST');

-- CreateEnum
CREATE TYPE "public"."BookingVisitStatus" AS ENUM ('DRAFT', 'HELD', 'PENDING_PAYMENT_REVIEW', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."BotChannel" AS ENUM ('WHATSAPP');

-- CreateEnum
CREATE TYPE "public"."BotDispatchKind" AS ENUM ('PROCESS', 'SEND');

-- CreateEnum
CREATE TYPE "public"."BotDispatchStatus" AS ENUM ('CLAIMED', 'SENDING', 'UNKNOWN', 'DONE');

-- CreateEnum
CREATE TYPE "public"."BotInboxStatus" AS ENUM ('ADMITTED', 'CLAIMED', 'SELECTED', 'DUPLICATE', 'CONFLICT', 'STALE', 'STALE_CUTOVER', 'REJECTED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."BotJobStatus" AS ENUM ('READY', 'LEASED', 'DONE', 'RETRY', 'POISON');

-- CreateEnum
CREATE TYPE "public"."BotOutboxStatus" AS ENUM ('PENDING', 'CLAIMED', 'SENDING', 'UNKNOWN', 'ACCEPTED', 'DELIVERED', 'READ', 'RETRY', 'FAILED', 'POISON', 'SKIPPED');

-- CreateEnum
CREATE TYPE "public"."BotPromptMode" AS ENUM ('FUNCTIONAL', 'NAVIGATION', 'CONFLICT');

-- CreateEnum
CREATE TYPE "public"."BotPromptStatus" AS ENUM ('OPEN', 'STABILIZING', 'RESOLVED', 'INVALIDATED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."BotProviderEventStatus" AS ENUM ('ADMITTED', 'DUPLICATE', 'UNMATCHED', 'PROCESSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."BotProviderEventType" AS ENUM ('MESSAGE', 'STATUS', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "public"."BotSessionStatus" AS ENUM ('ACTIVE', 'HUMAN_QUEUED', 'HUMAN_TAKEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."BusinessAccountStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."BusinessDiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "public"."ConversationOpportunityStatus" AS ENUM ('OPEN', 'CONVERTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."ConversationStep" AS ENUM ('START', 'ASK_SERVICE', 'ASK_PROFESSIONAL', 'ASK_DATE', 'ASK_TIME', 'ASK_CUSTOMER_NAME', 'CONFIRM', 'AWAITING_DEPOSIT', 'COMPLETED', 'CANCEL_SELECT_APPOINTMENT', 'EDIT_SELECT_APPOINTMENT', 'HUMAN_HANDOFF');

-- CreateEnum
CREATE TYPE "public"."MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "public"."ScheduleBlockReason" AS ENUM ('ABSENCE', 'VACATION', 'LATE_ARRIVAL', 'SICK_LEAVE', 'PERSONAL', 'TRAINING', 'MAINTENANCE', 'HOLIDAY', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."ServiceAttentionMode" AS ENUM ('DIRECT_BOOKING', 'QUOTE', 'ADVISOR', 'GUIDED_ESTIMATE');

-- CreateEnum
CREATE TYPE "public"."ServiceCatalogDisplayMode" AS ENUM ('ALL_SERVICES', 'CATEGORIES_FIRST');

-- CreateEnum
CREATE TYPE "public"."ServiceCombinationPolicy" AS ENUM ('ALLOWED', 'REVIEW_REQUIRED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "public"."ServiceDepositMode" AS ENUM ('NONE', 'FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "public"."ServicePriceMode" AS ENUM ('FIXED', 'STARTING_AT');

-- CreateEnum
CREATE TYPE "public"."ServiceVariantSelectionMode" AS ENUM ('ONE_OF', 'MULTIPLE');

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('SUPER_ADMIN', 'ACCOUNT_ADMIN', 'BUSINESS_ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "public"."WhatsAppConnectionMode" AS ENUM ('CLIENT_OWNED', 'INTERNAL_TEST');

-- CreateEnum
CREATE TYPE "public"."WhatsAppConnectionStatus" AS ENUM ('NOT_CONNECTED', 'CONNECTING', 'CONNECTED', 'NEEDS_PAYMENT', 'NEEDS_REVIEW', 'ERROR');

-- CreateTable
CREATE TABLE "public"."AiUsageEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "conversationId" TEXT,
    "appointmentId" TEXT,
    "source" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costNanoUsd" BIGINT,
    "pricingKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Appointment" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "origin" "public"."AppointmentOrigin" NOT NULL DEFAULT 'UNKNOWN',
    "quotedPrice" INTEGER,
    "manualDepositPaid" BOOLEAN NOT NULL DEFAULT false,
    "manualDepositAmount" INTEGER,
    "notes" TEXT,
    "totalDurationMinutes" INTEGER NOT NULL,
    "coordinationGroupId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "visitId" TEXT,
    "status" "public"."AppointmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "googleCalendarEventId" TEXT,
    "googleCalendarAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AppointmentServiceItem" (
    "appointmentId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "price" INTEGER,

    CONSTRAINT "AppointmentServiceItem_pkey" PRIMARY KEY ("appointmentId","serviceId")
);

-- CreateTable
CREATE TABLE "public"."BookingDeposit" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "conversationId" TEXT,
    "source" "public"."BookingDepositSource" NOT NULL DEFAULT 'WHATSAPP',
    "mode" "public"."ServiceDepositMode" NOT NULL,
    "configuredValue" INTEGER NOT NULL,
    "baseAmount" INTEGER,
    "amount" INTEGER NOT NULL,
    "status" "public"."BookingDepositStatus" NOT NULL DEFAULT 'PENDING_PROOF',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "proofMessageId" TEXT,
    "proofData" BYTEA,
    "proofMimeType" TEXT,
    "proofFilename" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "visitId" TEXT,
    "holdTtlMinutes" INTEGER,
    "holdTtlProvenance" "public"."BookingDepositTtlProvenance",
    "snapshotSealedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "expirationReason" TEXT,

    CONSTRAINT "BookingDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BookingDepositExpiryAudit" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "expiredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingDepositExpiryAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BookingDepositLateProofHandoff" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "proofId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingDepositLateProofHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BookingDepositLine" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "serviceName" TEXT NOT NULL,
    "mode" "public"."ServiceDepositMode" NOT NULL,
    "configuredValue" INTEGER NOT NULL,
    "baseAmount" INTEGER,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingDepositLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BookingDepositProof" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "public"."BookingDepositProofKind" NOT NULL,
    "validationStatus" "public"."BookingDepositProofValidationStatus" NOT NULL DEFAULT 'VALID',
    "validatorVersion" TEXT NOT NULL,
    "validatedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "sourceData" BYTEA,
    "sourceMimeType" TEXT NOT NULL,
    "sourceFilename" TEXT NOT NULL,
    "sourceByteSize" INTEGER NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "derivedData" BYTEA,
    "derivedMimeType" TEXT NOT NULL,
    "derivedByteSize" INTEGER NOT NULL,
    "derivedSha256" TEXT NOT NULL,
    "retentionEligibleAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerEventId" TEXT,
    "providerMessageId" TEXT,
    "providerMediaId" TEXT,
    "purgedAt" TIMESTAMP(3),
    "purgeReason" TEXT,

    CONSTRAINT "BookingDepositProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BookingDepositProofPurgeAudit" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "proofId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "purgedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingDepositProofPurgeAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BookingDepositProofPurgeOperation" (
    "id" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "businessId" TEXT,
    "reason" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "selectedCount" INTEGER NOT NULL DEFAULT 0,
    "purgedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BookingDepositProofPurgeOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BookingDepositReviewAudit" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "proofId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingDepositReviewAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BookingDepositReviewOutbox" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingDepositReviewOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BookingVisit" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" "public"."BookingVisitStatus" NOT NULL DEFAULT 'CONFIRMED',
    "scheduledStartAt" TIMESTAMP(3) NOT NULL,
    "totalDurationMinutes" INTEGER NOT NULL,
    "totalPrice" INTEGER,
    "holdExpiresAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "origin" "public"."AppointmentOrigin" NOT NULL DEFAULT 'BOT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BotActionInbox" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "sessionId" TEXT,
    "promptId" TEXT,
    "providerMessageId" TEXT,
    "choiceToken" TEXT,
    "actionType" TEXT,
    "deploymentId" TEXT NOT NULL,
    "deploymentGeneration" INTEGER NOT NULL,
    "entityRef" JSONB,
    "payload" JSONB,
    "expectedRevision" BIGINT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "public"."BotInboxStatus" NOT NULL DEFAULT 'ADMITTED',
    "claimToken" TEXT,
    "claimedUntil" TIMESTAMP(3),
    "operationKey" TEXT,
    "error" TEXT,

    CONSTRAINT "BotActionInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BotChannelDeployment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "channel" "public"."BotChannel" NOT NULL DEFAULT 'WHATSAPP',
    "engineKey" TEXT NOT NULL DEFAULT 'deterministic-options',
    "activeConfigurationId" TEXT,
    "previousConfigurationId" TEXT,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "activatedAt" TIMESTAMP(3),
    "activatedByUserId" TEXT,
    "claimsPausedAt" TIMESTAMP(3),
    "dispatchFenceEpoch" INTEGER NOT NULL DEFAULT 0,
    "legacyDispatchCoverageVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotChannelDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BotDeploymentAudit" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousConfigId" TEXT,
    "newConfigId" TEXT,
    "generation" INTEGER NOT NULL,
    "actorUserId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotDeploymentAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BotDispatchClaim" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "channel" "public"."BotChannel" NOT NULL DEFAULT 'WHATSAPP',
    "sessionId" TEXT,
    "resourceId" TEXT,
    "engineKey" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "fenceEpoch" INTEGER NOT NULL,
    "kind" "public"."BotDispatchKind" NOT NULL,
    "status" "public"."BotDispatchStatus" NOT NULL DEFAULT 'CLAIMED',
    "claimToken" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedUntil" TIMESTAMP(3) NOT NULL,
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotDispatchClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BotJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "deploymentGeneration" INTEGER NOT NULL,
    "expectedRevision" BIGINT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "public"."BotJobStatus" NOT NULL DEFAULT 'READY',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "leaseToken" TEXT,
    "leasedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BotOperation" (
    "id" TEXT NOT NULL,
    "operationKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resultRef" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BotOutbox" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "transitionId" TEXT NOT NULL,
    "deliveryGroupId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "public"."BotOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "dependsOnSequence" INTEGER,
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leasedUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BotOutboxResolution" (
    "id" TEXT NOT NULL,
    "outboxId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotOutboxResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BotPrompt" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "promptToken" TEXT NOT NULL,
    "stateRevision" BIGINT NOT NULL,
    "mode" "public"."BotPromptMode" NOT NULL DEFAULT 'FUNCTIONAL',
    "status" "public"."BotPromptStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstActionAt" TIMESTAMP(3),
    "lastActionAt" TIMESTAMP(3),
    "settleAt" TIMESTAMP(3),
    "absoluteAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "outboxMessageId" TEXT,

    CONSTRAINT "BotPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BotPromptChoice" (
    "id" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "choiceToken" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "payload" JSONB,
    "labelSnapshot" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BotPromptChoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BotProviderEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "eventKey" TEXT NOT NULL,
    "eventType" "public"."BotProviderEventType" NOT NULL,
    "businessId" TEXT NOT NULL,
    "phoneNumberId" TEXT,
    "providerMessageId" TEXT,
    "payload" JSONB,
    "providerOccurredAt" TIMESTAMP(3),
    "admittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "public"."BotProviderEventStatus" NOT NULL DEFAULT 'ADMITTED',
    "traceId" TEXT,

    CONSTRAINT "BotProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BotProviderEventShadow" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "eventKey" TEXT NOT NULL,
    "businessId" TEXT,
    "phoneNumberId" TEXT,
    "eventType" "public"."BotProviderEventType",
    "payloadRedacted" JSONB,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" TEXT NOT NULL,
    "traceId" TEXT,

    CONSTRAINT "BotProviderEventShadow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BotSession" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT,
    "deploymentId" TEXT NOT NULL,
    "deploymentGeneration" INTEGER NOT NULL,
    "channel" "public"."BotChannel" NOT NULL DEFAULT 'WHATSAPP',
    "engineVersion" TEXT NOT NULL DEFAULT 'v1',
    "businessTimezone" TEXT NOT NULL,
    "stateSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "state" JSONB NOT NULL,
    "revision" BIGINT NOT NULL DEFAULT 0,
    "status" "public"."BotSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "fenceToken" TEXT,
    "draftTouchedAt" TIMESTAMP(3),
    "draftExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BotTransitionLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "deploymentGeneration" INTEGER NOT NULL,
    "revisionFrom" BIGINT NOT NULL,
    "revisionTo" BIGINT NOT NULL,
    "actionType" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "promptId" TEXT,
    "providerEventId" TEXT,
    "durationMs" INTEGER,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotTransitionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Business" (
    "id" TEXT NOT NULL,
    "customerCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "demoType" TEXT,
    "slug" TEXT,
    "logoUrl" TEXT,
    "landingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "landingTemplate" TEXT NOT NULL DEFAULT 'classic',
    "landingSubtitle" TEXT,
    "landingFeature" TEXT,
    "landingOpeningYear" INTEGER,
    "landingDescription" TEXT,
    "landingTemplateContent" JSONB,
    "coverImageUrl" TEXT,
    "landingGalleryImages" TEXT,
    "publicWhatsapp" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "publicAddress" TEXT,
    "publicAddressArea" TEXT,
    "publicMapsUrl" TEXT,
    "instagramUrl" TEXT,
    "facebookUrl" TEXT,
    "tiktokUrl" TEXT,
    "botEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "accountAdminId" TEXT,
    "createdByUserId" TEXT,
    "planId" TEXT,
    "accountStatus" "public"."BusinessAccountStatus" NOT NULL DEFAULT 'ONBOARDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BusinessAccountCharge" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "originalDueAt" TIMESTAMP(3) NOT NULL,
    "status" "public"."AccountChargeStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "paymentReference" TEXT,
    "paymentNote" TEXT,
    "paymentRecordedBy" TEXT,
    "bonifiedAt" TIMESTAMP(3),
    "bonificationReason" TEXT,
    "bonifiedBy" TEXT,
    "dueDateChangedBy" TEXT,
    "dueDateChangeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessAccountCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BusinessAccountStatusChange" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "fromStatus" "public"."BusinessAccountStatus" NOT NULL,
    "toStatus" "public"."BusinessAccountStatus" NOT NULL,
    "reason" TEXT,
    "changedById" TEXT NOT NULL,
    "changedByName" TEXT NOT NULL,
    "changedByRole" "public"."UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessAccountStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BusinessBillingSettings" (
    "businessId" TEXT NOT NULL,
    "billingDay" INTEGER NOT NULL DEFAULT 1,
    "activatedAt" TIMESTAMP(3),
    "nextBillingAt" TIMESTAMP(3),
    "discountType" "public"."BusinessDiscountType",
    "discountValue" DECIMAL(12,2),
    "discountUntil" TIMESTAMP(3),
    "discountReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessBillingSettings_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "public"."BusinessBotConfiguration" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "botKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'OPTIONS_ONLY',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "channel" TEXT NOT NULL DEFAULT 'UNASSIGNED',
    "routingMode" TEXT NOT NULL DEFAULT 'EXCLUSIVE',
    "phoneNumberId" TEXT,
    "displayPhoneNumber" TEXT,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessBotConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BusinessBotOptionsSettings" (
    "businessId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "bookingHorizonDays" INTEGER NOT NULL DEFAULT 30,
    "bookingLeadTimeHours" INTEGER NOT NULL DEFAULT 0,
    "morningCutTime" TEXT NOT NULL DEFAULT '12:30',
    "eveningCutTime" TEXT NOT NULL DEFAULT '16:30',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "depositHoldMinutes" INTEGER,

    CONSTRAINT "BusinessBotOptionsSettings_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "public"."BusinessFeatureSettings" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "botEnabled" BOOLEAN NOT NULL DEFAULT true,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "campaignsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT false,
    "realWhatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bookingV2Enabled" BOOLEAN NOT NULL DEFAULT false,
    "serviceCatalogDisplayMode" "public"."ServiceCatalogDisplayMode" NOT NULL DEFAULT 'ALL_SERVICES',
    "bookingFlowOrder" "public"."BookingFlowOrder" NOT NULL DEFAULT 'PROFESSIONAL_FIRST',
    "conversationPauseAfterMinutes" INTEGER NOT NULL DEFAULT 120,
    "conversationExpireAfterMinutes" INTEGER NOT NULL DEFAULT 1440,
    "assistantPersonality" JSONB,
    "billingOwner" "public"."BillingOwner" NOT NULL DEFAULT 'CLIENT',
    "campaignSendingLocked" BOOLEAN NOT NULL DEFAULT true,
    "reminderSendingLocked" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessFeatureSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BusinessHours" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,

    CONSTRAINT "BusinessHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BusinessInstagramConfig" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "apiAccountId" TEXT,
    "username" TEXT,
    "accessToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "connectedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessInstagramConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BusinessOnboardingStatus" (
    "businessId" TEXT NOT NULL,
    "accountCreated" BOOLEAN NOT NULL DEFAULT true,
    "ownerLoggedIn" BOOLEAN NOT NULL DEFAULT false,
    "profileComplete" BOOLEAN NOT NULL DEFAULT false,
    "hasServices" BOOLEAN NOT NULL DEFAULT false,
    "hasProfessionals" BOOLEAN NOT NULL DEFAULT false,
    "hasBusinessHours" BOOLEAN NOT NULL DEFAULT false,
    "whatsappConnected" BOOLEAN NOT NULL DEFAULT false,
    "landingConfigured" BOOLEAN NOT NULL DEFAULT false,
    "completedSteps" INTEGER NOT NULL DEFAULT 1,
    "totalSteps" INTEGER NOT NULL DEFAULT 8,
    "progress" INTEGER NOT NULL DEFAULT 13,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessOnboardingStatus_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "public"."BusinessPaymentSettings" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "transferEnabled" BOOLEAN NOT NULL DEFAULT false,
    "alias" TEXT,
    "cbu" TEXT,
    "cvu" TEXT,
    "accountHolder" TEXT,
    "paymentLinkEnabled" BOOLEAN NOT NULL DEFAULT false,
    "paymentLink" TEXT,
    "instructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessPaymentSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BusinessPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BusinessWhatsAppConfig" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "connectionStatus" "public"."WhatsAppConnectionStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "mode" "public"."WhatsAppConnectionMode" NOT NULL DEFAULT 'CLIENT_OWNED',
    "wabaId" TEXT,
    "phoneNumberId" TEXT,
    "displayPhoneNumber" TEXT,
    "metaAppId" TEXT,
    "accessToken" TEXT,
    "appSecret" TEXT,
    "appSecretPrevious" TEXT,
    "appSecretPreviousValidUntil" TIMESTAMP(3),
    "tokenExpiresAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessWhatsAppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Campaign" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'ONE_TIME',
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "segment" TEXT NOT NULL DEFAULT 'ALL',
    "segmentLabel" TEXT NOT NULL DEFAULT 'Todos los clientes',
    "segmentDays" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 2,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "retryIntervalDays" INTEGER NOT NULL DEFAULT 30,
    "cooldownDays" INTEGER NOT NULL DEFAULT 30,
    "respectCooldown" BOOLEAN NOT NULL DEFAULT true,
    "stopOnBooking" BOOLEAN NOT NULL DEFAULT true,
    "stopOnReply" BOOLEAN NOT NULL DEFAULT true,
    "restartAfterVisit" BOOLEAN NOT NULL DEFAULT true,
    "message" TEXT NOT NULL,
    "imageUrl" TEXT,
    "templateName" TEXT,
    "templateLanguage" TEXT NOT NULL DEFAULT 'es_AR',
    "templateId" TEXT,
    "templateStatus" TEXT NOT NULL DEFAULT 'NOT_CREATED',
    "templateRejectionReason" TEXT,
    "templateLastSyncedAt" TIMESTAMP(3),
    "whatsappTemplateId" TEXT,
    "scheduleMode" TEXT NOT NULL DEFAULT 'IMMEDIATE',
    "scheduledAt" TIMESTAMP(3),
    "budgetLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CampaignDelivery" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "bookedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CampaignJob" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockToken" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CampaignManualRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignManualRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CampaignRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'SIMULATION',
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "exclusionSummary" JSONB NOT NULL,
    "configurationSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CampaignRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CommunicationEvent" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'SYSTEM',
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CommunicationExecution" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "initiatedByUserId" TEXT,
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CommunicationRecipient" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "phoneSnapshot" TEXT NOT NULL,
    "customerNameSnapshot" TEXT NOT NULL,
    "messageSnapshot" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sourceDeliveryId" TEXT,
    "providerMessageId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "bookedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "skipReason" TEXT,
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunicationRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Conversation" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "businessId" TEXT,
    "currentStep" "public"."ConversationStep" NOT NULL DEFAULT 'START',
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "misunderstandingCount" INTEGER NOT NULL DEFAULT 0,
    "selectedServiceId" TEXT,
    "selectedProfessionalId" TEXT,
    "selectedDate" TEXT,
    "selectedTime" TEXT,
    "selectedCustomerName" TEXT,
    "lastAvailability" JSONB,
    "bookingV2State" JSONB,
    "supportBotKey" TEXT,
    "supportBotState" JSONB,
    "lastMessage" TEXT,
    "humanHandoffAt" TIMESTAMP(3),
    "humanHandoffResolvedAt" TIMESTAMP(3),
    "photoQuoteAcknowledgedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "botProcessingToken" TEXT,
    "botProcessingUntil" TIMESTAMP(3),
    "activeInteractivePromptToken" TEXT,
    "opportunityStatus" "public"."ConversationOpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "opportunityOpenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opportunityConvertedAt" TIMESTAMP(3),
    "opportunityClosedAt" TIMESTAMP(3),
    "opportunityCloseReason" TEXT,
    "opportunityCloseNote" TEXT,
    "opportunityAppointmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ConversationOpportunityEvent" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "appointmentId" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationOpportunityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Customer" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "normalizedPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CustomerMarketingPreference" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT NOT NULL DEFAULT 'DEFAULT',
    "optedInAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "optedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerMarketingPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CustomerNote" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InstagramLead" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "instagramUserId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "referralCode" TEXT NOT NULL,
    "lastMessage" TEXT,
    "lastAutoReplyAt" TIMESTAMP(3),
    "whatsappConversationId" TEXT,
    "whatsappLinkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InstagramMessage" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "direction" "public"."MessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstagramMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "direction" "public"."MessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "status" TEXT,
    "providerStatusCode" INTEGER,
    "providerErrorCode" TEXT,
    "providerErrorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PostSaleAutomation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'PAUSED',
    "delayMinutes" INTEGER NOT NULL DEFAULT 120,
    "responseWindowDays" INTEGER NOT NULL DEFAULT 7,
    "lowRatingThreshold" INTEGER NOT NULL DEFAULT 2,
    "templateId" TEXT,
    "positiveResponse" TEXT NOT NULL DEFAULT 'Gracias por tu calificación. Nos alegra que hayas tenido una buena experiencia.',
    "neutralResponse" TEXT NOT NULL DEFAULT 'Gracias por responder. Nos gustaría saber qué podríamos mejorar.',
    "negativeResponse" TEXT NOT NULL DEFAULT 'Lamentamos que tu experiencia no haya sido buena. El equipo va a contactarte por este chat.',
    "reviewUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostSaleAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PostSaleDelivery" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "automationId" TEXT,
    "appointmentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "conversationId" TEXT,
    "visitDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "mode" TEXT NOT NULL DEFAULT 'WHATSAPP_API',
    "messageSnapshot" TEXT,
    "providerMessageId" TEXT,
    "lastError" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "manualNote" TEXT,
    "responseExpiresAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "rating" INTEGER,
    "comment" TEXT,
    "commentRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostSaleDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Professional" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "avatarUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "acceptsBotBookings" BOOLEAN NOT NULL DEFAULT true,
    "botBookingPriority" INTEGER NOT NULL DEFAULT 100,
    "deactivatedAt" TIMESTAMP(3),
    "businessId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Professional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProfessionalHours" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProfessionalService" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionalService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReminderAutomation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "templateId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'PAUSED',
    "sendBeforeMinutes" INTEGER NOT NULL DEFAULT 1440,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReminderDelivery" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "reminderAutomationId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "mode" TEXT NOT NULL DEFAULT 'WHATSAPP_API',
    "messageSnapshot" TEXT,
    "providerMessageId" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "lastError" TEXT,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "manualNote" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ScheduleBlock" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "professionalId" TEXT,
    "reason" "public"."ScheduleBlockReason" NOT NULL,
    "title" TEXT,
    "note" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Service" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "duration" INTEGER NOT NULL,
    "customerDurationMin" INTEGER,
    "customerDurationMax" INTEGER,
    "category" TEXT,
    "price" INTEGER,
    "priceMode" "public"."ServicePriceMode" NOT NULL DEFAULT 'FIXED',
    "imageUrl" TEXT,
    "isBookable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "bookingOrderPriority" INTEGER NOT NULL DEFAULT 20,
    "attentionMode" "public"."ServiceAttentionMode" NOT NULL DEFAULT 'DIRECT_BOOKING',
    "requiresPhoto" BOOLEAN NOT NULL DEFAULT false,
    "estimateExplanation" TEXT,
    "estimateQuestion" TEXT,
    "estimateOptions" JSONB,
    "estimateDisclaimer" TEXT,
    "estimateAllowsBooking" BOOLEAN NOT NULL DEFAULT true,
    "validationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "validationMessage" TEXT,
    "validationQuestion" TEXT,
    "depositMode" "public"."ServiceDepositMode" NOT NULL DEFAULT 'NONE',
    "depositValue" INTEGER,
    "depositHoldMinutes" INTEGER NOT NULL DEFAULT 60,
    "businessId" TEXT NOT NULL,
    "catalogCategoryId" TEXT,
    "parentServiceId" TEXT,
    "variantSelectionMode" "public"."ServiceVariantSelectionMode" NOT NULL DEFAULT 'ONE_OF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ServiceAddon" (
    "sourceServiceId" TEXT NOT NULL,
    "addonServiceId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ServiceAddon_pkey" PRIMARY KEY ("sourceServiceId","addonServiceId")
);

-- CreateTable
CREATE TABLE "public"."ServiceAlias" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "ServiceAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ServiceCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "adviceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "businessId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ServiceCategoryAlias" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceCategoryAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ServiceCombinationRule" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "serviceAId" TEXT NOT NULL,
    "serviceBId" TEXT NOT NULL,
    "policy" "public"."ServiceCombinationPolicy" NOT NULL,
    "note" TEXT,

    CONSTRAINT "ServiceCombinationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StaffAuditLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "public"."UserRole" NOT NULL DEFAULT 'BUSINESS_ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "canCreateBusinesses" BOOLEAN NOT NULL DEFAULT false,
    "firstLoginAt" TIMESTAMP(3),
    "businessId" TEXT,
    "professionalId" TEXT,
    "canCreateAppointments" BOOLEAN NOT NULL DEFAULT true,
    "canEditAppointments" BOOLEAN NOT NULL DEFAULT true,
    "canCancelAppointments" BOOLEAN NOT NULL DEFAULT true,
    "canManageScheduleBlocks" BOOLEAN NOT NULL DEFAULT true,
    "staffProfile" TEXT NOT NULL DEFAULT 'PROFESSIONAL',
    "permissionPreset" TEXT NOT NULL DEFAULT 'PROFESSIONAL_DEFAULT',
    "agendaScope" TEXT NOT NULL DEFAULT 'OWN',
    "canForceAppointments" BOOLEAN NOT NULL DEFAULT false,
    "canViewCustomers" BOOLEAN NOT NULL DEFAULT false,
    "canCreateCustomers" BOOLEAN NOT NULL DEFAULT false,
    "canEditCustomers" BOOLEAN NOT NULL DEFAULT false,
    "canManageCustomerNotes" BOOLEAN NOT NULL DEFAULT false,
    "canManageCustomerMarketing" BOOLEAN NOT NULL DEFAULT false,
    "canViewConversations" BOOLEAN NOT NULL DEFAULT false,
    "canReplyConversations" BOOLEAN NOT NULL DEFAULT false,
    "canManageDeposits" BOOLEAN NOT NULL DEFAULT false,
    "canViewOperationalReports" BOOLEAN NOT NULL DEFAULT false,
    "canViewFinancialAmounts" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WeexAccount" (
    "id" TEXT NOT NULL,
    "googleSub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "phone" TEXT,
    "phoneVerifiedAt" TIMESTAMP(3),
    "googleCalendarAccessToken" TEXT,
    "googleCalendarRefreshToken" TEXT,
    "googleCalendarTokenExpiresAt" TIMESTAMP(3),
    "googleCalendarScope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeexAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WeexAccountSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeexAccountSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WeexCustomerLink" (
    "id" TEXT NOT NULL,
    "weexAccountId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeexCustomerLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WeexLead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "campaign" TEXT NOT NULL DEFAULT 'promocion-weex-agosto-2026',
    "source" TEXT NOT NULL DEFAULT 'directo',
    "medium" TEXT,
    "campaignName" TEXT,
    "content" TEXT,
    "term" TEXT,
    "pageUrl" TEXT,
    "referrer" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NUEVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeexLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "internalName" TEXT NOT NULL,
    "metaName" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'MARKETING',
    "language" TEXT NOT NULL DEFAULT 'es_AR',
    "body" TEXT NOT NULL,
    "exampleJson" TEXT,
    "imageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "metaId" TEXT,
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiUsageEvent_appointmentId_createdAt_idx" ON "public"."AiUsageEvent"("appointmentId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "AiUsageEvent_businessId_createdAt_idx" ON "public"."AiUsageEvent"("businessId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "AiUsageEvent_conversationId_createdAt_idx" ON "public"."AiUsageEvent"("conversationId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageEvent_responseId_key" ON "public"."AiUsageEvent"("responseId" ASC);

-- CreateIndex
CREATE INDEX "AiUsageEvent_source_createdAt_idx" ON "public"."AiUsageEvent"("source" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "Appointment_coordinationGroupId_idx" ON "public"."Appointment"("coordinationGroupId" ASC);

-- CreateIndex
CREATE INDEX "Appointment_professionalId_startAt_idx" ON "public"."Appointment"("professionalId" ASC, "startAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_visitId_key" ON "public"."Appointment"("visitId" ASC);

-- CreateIndex
CREATE INDEX "AppointmentServiceItem_serviceId_idx" ON "public"."AppointmentServiceItem"("serviceId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookingDeposit_appointmentId_key" ON "public"."BookingDeposit"("appointmentId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookingDeposit_businessId_id_key" ON "public"."BookingDeposit"("businessId" ASC, "id" ASC);

-- CreateIndex
CREATE INDEX "BookingDeposit_businessId_status_expiresAt_idx" ON "public"."BookingDeposit"("businessId" ASC, "status" ASC, "expiresAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookingDeposit_businessId_visitId_key" ON "public"."BookingDeposit"("businessId" ASC, "visitId" ASC);

-- CreateIndex
CREATE INDEX "BookingDeposit_conversationId_createdAt_idx" ON "public"."BookingDeposit"("conversationId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookingDepositExpiryAudit_businessId_depositId_key" ON "public"."BookingDepositExpiryAudit"("businessId" ASC, "depositId" ASC);

-- CreateIndex
CREATE INDEX "BookingDepositExpiryAudit_businessId_expiredAt_idx" ON "public"."BookingDepositExpiryAudit"("businessId" ASC, "expiredAt" ASC);

-- CreateIndex
CREATE INDEX "BookingDepositExpiryAudit_businessId_visitId_idx" ON "public"."BookingDepositExpiryAudit"("businessId" ASC, "visitId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookingDepositExpiryAudit_depositId_key" ON "public"."BookingDepositExpiryAudit"("depositId" ASC);

-- CreateIndex
CREATE INDEX "BookingDepositLateProofHandoff_businessId_depositId_createdAt_i" ON "public"."BookingDepositLateProofHandoff"("businessId" ASC, "depositId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookingDepositLateProofHandoff_proofId_key" ON "public"."BookingDepositLateProofHandoff"("proofId" ASC);

-- CreateIndex
CREATE INDEX "BookingDepositLine_businessId_depositId_idx" ON "public"."BookingDepositLine"("businessId" ASC, "depositId" ASC);

-- CreateIndex
CREATE INDEX "BookingDepositLine_businessId_serviceId_idx" ON "public"."BookingDepositLine"("businessId" ASC, "serviceId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookingDepositLine_depositId_serviceId_key" ON "public"."BookingDepositLine"("depositId" ASC, "serviceId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookingDepositLine_depositId_sortOrder_key" ON "public"."BookingDepositLine"("depositId" ASC, "sortOrder" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookingDepositProof_businessId_depositId_providerEventId_key" ON "public"."BookingDepositProof"("businessId" ASC, "depositId" ASC, "providerEventId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookingDepositProof_businessId_depositId_providerMediaId_key" ON "public"."BookingDepositProof"("businessId" ASC, "depositId" ASC, "providerMediaId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookingDepositProof_businessId_depositId_providerMessageId_key" ON "public"."BookingDepositProof"("businessId" ASC, "depositId" ASC, "providerMessageId" ASC);

-- CreateIndex
CREATE INDEX "BookingDepositProof_businessId_depositId_receivedAt_idx" ON "public"."BookingDepositProof"("businessId" ASC, "depositId" ASC, "receivedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookingDepositProof_businessId_depositId_sequence_key" ON "public"."BookingDepositProof"("businessId" ASC, "depositId" ASC, "sequence" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookingDepositProof_businessId_depositId_sourceSha256_key" ON "public"."BookingDepositProof"("businessId" ASC, "depositId" ASC, "sourceSha256" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookingDepositProof_businessId_id_key" ON "public"."BookingDepositProof"("businessId" ASC, "id" ASC);

-- CreateIndex
CREATE INDEX "BookingDepositProof_businessId_retentionEligibleAt_idx" ON "public"."BookingDepositProof"("businessId" ASC, "retentionEligibleAt" ASC);

-- CreateIndex
CREATE INDEX "BookingDepositProof_retentionEligibleAt_idx" ON "public"."BookingDepositProof"("retentionEligibleAt" ASC);

-- CreateIndex
CREATE INDEX "BookingDepositProofPurgeAudit_businessId_proofId_createdAt_idx" ON "public"."BookingDepositProofPurgeAudit"("businessId" ASC, "proofId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookingDepositProofPurgeAudit_operationId_proofId_key" ON "public"."BookingDepositProofPurgeAudit"("operationId" ASC, "proofId" ASC);

-- CreateIndex
CREATE INDEX "BookingDepositProofPurgeOperation_businessId_createdAt_idx" ON "public"."BookingDepositProofPurgeOperation"("businessId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookingDepositProofPurgeOperation_operationKey_key" ON "public"."BookingDepositProofPurgeOperation"("operationKey" ASC);

-- CreateIndex
CREATE INDEX "BookingDepositReviewAudit_businessId_depositId_createdAt_idx" ON "public"."BookingDepositReviewAudit"("businessId" ASC, "depositId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookingDepositReviewAudit_operationKey_key" ON "public"."BookingDepositReviewAudit"("operationKey" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookingDepositReviewOutbox_auditId_key" ON "public"."BookingDepositReviewOutbox"("auditId" ASC);

-- CreateIndex
CREATE INDEX "BookingDepositReviewOutbox_businessId_status_createdAt_idx" ON "public"."BookingDepositReviewOutbox"("businessId" ASC, "status" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BookingVisit_businessId_id_key" ON "public"."BookingVisit"("businessId" ASC, "id" ASC);

-- CreateIndex
CREATE INDEX "BookingVisit_customerId_status_scheduledStartAt_idx" ON "public"."BookingVisit"("customerId" ASC, "status" ASC, "scheduledStartAt" ASC);

-- CreateIndex
CREATE INDEX "BookingVisit_professionalId_status_scheduledStartAt_idx" ON "public"."BookingVisit"("professionalId" ASC, "status" ASC, "scheduledStartAt" ASC);

-- CreateIndex
CREATE INDEX "BookingVisit_sessionId_createdAt_idx" ON "public"."BookingVisit"("sessionId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "BookingVisit_status_holdExpiresAt_idx" ON "public"."BookingVisit"("status" ASC, "holdExpiresAt" ASC);

-- CreateIndex
CREATE INDEX "BotActionInbox_businessId_providerEventId_idx" ON "public"."BotActionInbox"("businessId" ASC, "providerEventId" ASC);

-- CreateIndex (archived F4 invariant; intentionally repairs snapshot drift)
CREATE UNIQUE INDEX "BotActionInbox_promptId_providerMessageId_key" ON "public"."BotActionInbox"("promptId", "providerMessageId") WHERE "promptId" IS NOT NULL AND "providerMessageId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "BotActionInbox_promptId_status_receivedAt_idx" ON "public"."BotActionInbox"("promptId" ASC, "status" ASC, "receivedAt" ASC);

-- CreateIndex
CREATE INDEX "BotActionInbox_sessionId_receivedAt_idx" ON "public"."BotActionInbox"("sessionId" ASC, "receivedAt" ASC);

-- CreateIndex
CREATE INDEX "BotActionInbox_status_claimedUntil_idx" ON "public"."BotActionInbox"("status" ASC, "claimedUntil" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BotChannelDeployment_businessId_channel_key" ON "public"."BotChannelDeployment"("businessId" ASC, "channel" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BotChannelDeployment_businessId_id_key" ON "public"."BotChannelDeployment"("businessId" ASC, "id" ASC);

-- CreateIndex
CREATE INDEX "BotDeploymentAudit_businessId_createdAt_idx" ON "public"."BotDeploymentAudit"("businessId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "BotDispatchClaim_businessId_channel_kind_status_idx" ON "public"."BotDispatchClaim"("businessId" ASC, "channel" ASC, "kind" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BotDispatchClaim_claimToken_key" ON "public"."BotDispatchClaim"("claimToken" ASC);

-- CreateIndex (archived F4 invariant; intentionally repairs snapshot drift)
CREATE UNIQUE INDEX "BotDispatchClaim_active_resource_key" ON "public"."BotDispatchClaim"("kind", "engineKey", "resourceId") WHERE "resourceId" IS NOT NULL AND "status" IN ('CLAIMED', 'SENDING', 'UNKNOWN');

-- CreateIndex
CREATE INDEX "BotDispatchClaim_kind_resourceId_status_idx" ON "public"."BotDispatchClaim"("kind" ASC, "resourceId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "BotDispatchClaim_status_claimedUntil_idx" ON "public"."BotDispatchClaim"("status" ASC, "claimedUntil" ASC);

-- CreateIndex
CREATE INDEX "BotJob_businessId_deploymentId_status_idx" ON "public"."BotJob"("businessId" ASC, "deploymentId" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BotJob_kind_aggregateId_key" ON "public"."BotJob"("kind" ASC, "aggregateId" ASC);

-- CreateIndex
CREATE INDEX "BotJob_status_availableAt_idx" ON "public"."BotJob"("status" ASC, "availableAt" ASC);

-- CreateIndex
CREATE INDEX "BotJob_status_leasedUntil_idx" ON "public"."BotJob"("status" ASC, "leasedUntil" ASC);

-- CreateIndex
CREATE INDEX "BotOperation_businessId_status_idx" ON "public"."BotOperation"("businessId" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BotOperation_operationKey_key" ON "public"."BotOperation"("operationKey" ASC);

-- CreateIndex
CREATE INDEX "BotOperation_sessionId_createdAt_idx" ON "public"."BotOperation"("sessionId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "BotOutbox_deliveryGroupId_sequence_idx" ON "public"."BotOutbox"("deliveryGroupId" ASC, "sequence" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BotOutbox_idempotencyKey_key" ON "public"."BotOutbox"("idempotencyKey" ASC);

-- CreateIndex (archived F4 invariant; intentionally repairs snapshot drift)
CREATE UNIQUE INDEX "BotOutbox_providerMessageId_key" ON "public"."BotOutbox"("providerMessageId") WHERE "providerMessageId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "BotOutbox_sessionId_deliveryGroupId_sequence_key" ON "public"."BotOutbox"("sessionId" ASC, "deliveryGroupId" ASC, "sequence" ASC);

-- CreateIndex
CREATE INDEX "BotOutbox_sessionId_sequence_idx" ON "public"."BotOutbox"("sessionId" ASC, "sequence" ASC);

-- CreateIndex
CREATE INDEX "BotOutbox_status_availableAt_idx" ON "public"."BotOutbox"("status" ASC, "availableAt" ASC);

-- CreateIndex
CREATE INDEX "BotOutbox_status_leasedUntil_idx" ON "public"."BotOutbox"("status" ASC, "leasedUntil" ASC);

-- CreateIndex
CREATE INDEX "BotOutboxResolution_outboxId_createdAt_idx" ON "public"."BotOutboxResolution"("outboxId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BotPrompt_promptToken_key" ON "public"."BotPrompt"("promptToken" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BotPrompt_sessionId_id_key" ON "public"."BotPrompt"("sessionId" ASC, "id" ASC);

-- CreateIndex (archived F4 invariant; intentionally repairs snapshot drift)
CREATE UNIQUE INDEX "BotPrompt_open_functional_per_session_key" ON "public"."BotPrompt"("sessionId") WHERE "status" IN ('OPEN', 'STABILIZING') AND "mode" = 'FUNCTIONAL';

-- CreateIndex
CREATE INDEX "BotPrompt_sessionId_stateRevision_idx" ON "public"."BotPrompt"("sessionId" ASC, "stateRevision" ASC);

-- CreateIndex
CREATE INDEX "BotPrompt_status_settleAt_idx" ON "public"."BotPrompt"("status" ASC, "settleAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BotPromptChoice_promptId_choiceToken_key" ON "public"."BotPromptChoice"("promptId" ASC, "choiceToken" ASC);

-- CreateIndex
CREATE INDEX "BotProviderEvent_businessId_admittedAt_idx" ON "public"."BotProviderEvent"("businessId" ASC, "admittedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BotProviderEvent_businessId_id_key" ON "public"."BotProviderEvent"("businessId" ASC, "id" ASC);

-- CreateIndex
CREATE INDEX "BotProviderEvent_providerMessageId_idx" ON "public"."BotProviderEvent"("providerMessageId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BotProviderEvent_provider_eventKey_key" ON "public"."BotProviderEvent"("provider" ASC, "eventKey" ASC);

-- CreateIndex
CREATE INDEX "BotProviderEventShadow_businessId_observedAt_idx" ON "public"."BotProviderEventShadow"("businessId" ASC, "observedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BotProviderEventShadow_provider_eventKey_key" ON "public"."BotProviderEventShadow"("provider" ASC, "eventKey" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BotSession_businessId_deploymentId_id_key" ON "public"."BotSession"("businessId" ASC, "deploymentId" ASC, "id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BotSession_businessId_id_key" ON "public"."BotSession"("businessId" ASC, "id" ASC);

-- CreateIndex
CREATE INDEX "BotSession_businessId_status_idx" ON "public"."BotSession"("businessId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "BotSession_conversationId_idx" ON "public"."BotSession"("conversationId" ASC);

-- CreateIndex (archived F4 invariant; intentionally repairs snapshot drift)
CREATE UNIQUE INDEX "BotSession_active_deployment_conversation_key" ON "public"."BotSession"("deploymentId", "conversationId") WHERE "status" = 'ACTIVE' AND "conversationId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "BotTransitionLog_businessId_createdAt_idx" ON "public"."BotTransitionLog"("businessId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BotTransitionLog_sessionId_revisionTo_key" ON "public"."BotTransitionLog"("sessionId" ASC, "revisionTo" ASC);

-- CreateIndex
CREATE INDEX "Business_accountAdminId_idx" ON "public"."Business"("accountAdminId" ASC);

-- CreateIndex
CREATE INDEX "Business_accountStatus_idx" ON "public"."Business"("accountStatus" ASC);

-- CreateIndex
CREATE INDEX "Business_createdByUserId_idx" ON "public"."Business"("createdByUserId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Business_customerCode_key" ON "public"."Business"("customerCode" ASC);

-- CreateIndex
CREATE INDEX "Business_isDemo_createdByUserId_idx" ON "public"."Business"("isDemo" ASC, "createdByUserId" ASC);

-- CreateIndex
CREATE INDEX "Business_planId_idx" ON "public"."Business"("planId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Business_slug_key" ON "public"."Business"("slug" ASC);

-- CreateIndex
CREATE INDEX "BusinessAccountCharge_businessId_dueAt_idx" ON "public"."BusinessAccountCharge"("businessId" ASC, "dueAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessAccountCharge_businessId_period_key" ON "public"."BusinessAccountCharge"("businessId" ASC, "period" ASC);

-- CreateIndex
CREATE INDEX "BusinessAccountCharge_status_dueAt_idx" ON "public"."BusinessAccountCharge"("status" ASC, "dueAt" ASC);

-- CreateIndex
CREATE INDEX "BusinessAccountStatusChange_businessId_createdAt_idx" ON "public"."BusinessAccountStatusChange"("businessId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "BusinessBillingSettings_nextBillingAt_idx" ON "public"."BusinessBillingSettings"("nextBillingAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessBotConfiguration_businessId_botKey_key" ON "public"."BusinessBotConfiguration"("businessId" ASC, "botKey" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessBotConfiguration_businessId_id_key" ON "public"."BusinessBotConfiguration"("businessId" ASC, "id" ASC);

-- CreateIndex
CREATE INDEX "BusinessBotConfiguration_businessId_status_idx" ON "public"."BusinessBotConfiguration"("businessId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "BusinessBotConfiguration_phoneNumberId_status_idx" ON "public"."BusinessBotConfiguration"("phoneNumberId" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessFeatureSettings_businessId_key" ON "public"."BusinessFeatureSettings"("businessId" ASC);

-- CreateIndex
CREATE INDEX "BusinessHours_businessId_dayOfWeek_idx" ON "public"."BusinessHours"("businessId" ASC, "dayOfWeek" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessInstagramConfig_apiAccountId_key" ON "public"."BusinessInstagramConfig"("apiAccountId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessInstagramConfig_businessId_key" ON "public"."BusinessInstagramConfig"("businessId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessInstagramConfig_instagramAccountId_key" ON "public"."BusinessInstagramConfig"("instagramAccountId" ASC);

-- CreateIndex
CREATE INDEX "BusinessOnboardingStatus_progress_idx" ON "public"."BusinessOnboardingStatus"("progress" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessPaymentSettings_businessId_key" ON "public"."BusinessPaymentSettings"("businessId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessPlan_name_key" ON "public"."BusinessPlan"("name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessWhatsAppConfig_businessId_key" ON "public"."BusinessWhatsAppConfig"("businessId" ASC);

-- CreateIndex
CREATE INDEX "Campaign_businessId_status_updatedAt_idx" ON "public"."Campaign"("businessId" ASC, "status" ASC, "updatedAt" ASC);

-- CreateIndex
CREATE INDEX "Campaign_whatsappTemplateId_idx" ON "public"."Campaign"("whatsappTemplateId" ASC);

-- CreateIndex
CREATE INDEX "CampaignDelivery_businessId_customerId_sentAt_idx" ON "public"."CampaignDelivery"("businessId" ASC, "customerId" ASC, "sentAt" ASC);

-- CreateIndex
CREATE INDEX "CampaignDelivery_campaignId_customerId_sentAt_idx" ON "public"."CampaignDelivery"("campaignId" ASC, "customerId" ASC, "sentAt" ASC);

-- CreateIndex
CREATE INDEX "CampaignJob_businessId_status_idx" ON "public"."CampaignJob"("businessId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "CampaignJob_campaignId_customerId_idx" ON "public"."CampaignJob"("campaignId" ASC, "customerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignJob_idempotencyKey_key" ON "public"."CampaignJob"("idempotencyKey" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignJob_runId_customerId_key" ON "public"."CampaignJob"("runId" ASC, "customerId" ASC);

-- CreateIndex
CREATE INDEX "CampaignJob_status_nextAttemptAt_idx" ON "public"."CampaignJob"("status" ASC, "nextAttemptAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignManualRecipient_campaignId_customerId_key" ON "public"."CampaignManualRecipient"("campaignId" ASC, "customerId" ASC);

-- CreateIndex
CREATE INDEX "CampaignManualRecipient_customerId_idx" ON "public"."CampaignManualRecipient"("customerId" ASC);

-- CreateIndex
CREATE INDEX "CampaignRun_businessId_createdAt_idx" ON "public"."CampaignRun"("businessId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "CampaignRun_campaignId_createdAt_idx" ON "public"."CampaignRun"("campaignId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "CommunicationEvent_recipientId_createdAt_idx" ON "public"."CommunicationEvent"("recipientId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "CommunicationExecution_businessId_sourceType_sourceId_creat_idx" ON "public"."CommunicationExecution"("businessId" ASC, "sourceType" ASC, "sourceId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "CommunicationExecution_businessId_status_createdAt_idx" ON "public"."CommunicationExecution"("businessId" ASC, "status" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "CommunicationRecipient_businessId_customerId_sentAt_idx" ON "public"."CommunicationRecipient"("businessId" ASC, "customerId" ASC, "sentAt" ASC);

-- CreateIndex
CREATE INDEX "CommunicationRecipient_businessId_status_scheduledAt_idx" ON "public"."CommunicationRecipient"("businessId" ASC, "status" ASC, "scheduledAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationRecipient_executionId_customerId_key" ON "public"."CommunicationRecipient"("executionId" ASC, "customerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationRecipient_sourceDeliveryId_key" ON "public"."CommunicationRecipient"("sourceDeliveryId" ASC);

-- CreateIndex
CREATE INDEX "Conversation_businessId_archivedAt_updatedAt_idx" ON "public"."Conversation"("businessId" ASC, "archivedAt" ASC, "updatedAt" ASC);

-- CreateIndex
CREATE INDEX "Conversation_businessId_opportunityStatus_updatedAt_idx" ON "public"."Conversation"("businessId" ASC, "opportunityStatus" ASC, "updatedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_businessId_phone_key" ON "public"."Conversation"("businessId" ASC, "phone" ASC);

-- CreateIndex
CREATE INDEX "Conversation_currentStep_archivedAt_updatedAt_idx" ON "public"."Conversation"("currentStep" ASC, "archivedAt" ASC, "updatedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_opportunityAppointmentId_key" ON "public"."Conversation"("opportunityAppointmentId" ASC);

-- CreateIndex
CREATE INDEX "Conversation_phone_idx" ON "public"."Conversation"("phone" ASC);

-- CreateIndex
CREATE INDEX "ConversationOpportunityEvent_conversationId_createdAt_idx" ON "public"."ConversationOpportunityEvent"("conversationId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "Customer_businessId_createdAt_idx" ON "public"."Customer"("businessId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_businessId_id_key" ON "public"."Customer"("businessId" ASC, "id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_businessId_normalizedPhone_key" ON "public"."Customer"("businessId" ASC, "normalizedPhone" ASC);

-- CreateIndex
CREATE INDEX "Customer_businessId_phone_idx" ON "public"."Customer"("businessId" ASC, "phone" ASC);

-- CreateIndex
CREATE INDEX "Customer_email_idx" ON "public"."Customer"("email" ASC);

-- CreateIndex
CREATE INDEX "Customer_phone_idx" ON "public"."Customer"("phone" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerMarketingPreference_businessId_customerId_key" ON "public"."CustomerMarketingPreference"("businessId" ASC, "customerId" ASC);

-- CreateIndex
CREATE INDEX "CustomerMarketingPreference_businessId_status_idx" ON "public"."CustomerMarketingPreference"("businessId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "CustomerNote_customerId_createdAt_idx" ON "public"."CustomerNote"("customerId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramLead_businessId_instagramUserId_key" ON "public"."InstagramLead"("businessId" ASC, "instagramUserId" ASC);

-- CreateIndex
CREATE INDEX "InstagramLead_businessId_updatedAt_idx" ON "public"."InstagramLead"("businessId" ASC, "updatedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramLead_referralCode_key" ON "public"."InstagramLead"("referralCode" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramLead_whatsappConversationId_key" ON "public"."InstagramLead"("whatsappConversationId" ASC);

-- CreateIndex
CREATE INDEX "InstagramMessage_leadId_createdAt_idx" ON "public"."InstagramMessage"("leadId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "InstagramMessage_providerMessageId_key" ON "public"."InstagramMessage"("providerMessageId" ASC);

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_id_idx" ON "public"."Message"("conversationId" ASC, "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Message_providerMessageId_key" ON "public"."Message"("providerMessageId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PostSaleAutomation_businessId_key" ON "public"."PostSaleAutomation"("businessId" ASC);

-- CreateIndex
CREATE INDEX "PostSaleAutomation_enabled_businessId_idx" ON "public"."PostSaleAutomation"("enabled" ASC, "businessId" ASC);

-- CreateIndex
CREATE INDEX "PostSaleAutomation_mode_businessId_idx" ON "public"."PostSaleAutomation"("mode" ASC, "businessId" ASC);

-- CreateIndex
CREATE INDEX "PostSaleAutomation_templateId_idx" ON "public"."PostSaleAutomation"("templateId" ASC);

-- CreateIndex
CREATE INDEX "PostSaleDelivery_appointmentId_idx" ON "public"."PostSaleDelivery"("appointmentId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PostSaleDelivery_businessId_customerId_visitDate_key" ON "public"."PostSaleDelivery"("businessId" ASC, "customerId" ASC, "visitDate" ASC);

-- CreateIndex
CREATE INDEX "PostSaleDelivery_businessId_status_scheduledFor_idx" ON "public"."PostSaleDelivery"("businessId" ASC, "status" ASC, "scheduledFor" ASC);

-- CreateIndex
CREATE INDEX "PostSaleDelivery_conversationId_status_responseExpiresAt_idx" ON "public"."PostSaleDelivery"("conversationId" ASC, "status" ASC, "responseExpiresAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Professional_businessId_id_key" ON "public"."Professional"("businessId" ASC, "id" ASC);

-- CreateIndex
CREATE INDEX "ProfessionalHours_professionalId_dayOfWeek_idx" ON "public"."ProfessionalHours"("professionalId" ASC, "dayOfWeek" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalService_professionalId_serviceId_key" ON "public"."ProfessionalService"("professionalId" ASC, "serviceId" ASC);

-- CreateIndex
CREATE INDEX "ProfessionalService_serviceId_idx" ON "public"."ProfessionalService"("serviceId" ASC);

-- CreateIndex
CREATE INDEX "ReminderAutomation_businessId_enabled_idx" ON "public"."ReminderAutomation"("businessId" ASC, "enabled" ASC);

-- CreateIndex
CREATE INDEX "ReminderAutomation_businessId_mode_idx" ON "public"."ReminderAutomation"("businessId" ASC, "mode" ASC);

-- CreateIndex
CREATE INDEX "ReminderAutomation_businessId_sendBeforeMinutes_idx" ON "public"."ReminderAutomation"("businessId" ASC, "sendBeforeMinutes" ASC);

-- CreateIndex
CREATE INDEX "ReminderDelivery_appointmentId_idx" ON "public"."ReminderDelivery"("appointmentId" ASC);

-- CreateIndex
CREATE INDEX "ReminderDelivery_businessId_status_scheduledFor_idx" ON "public"."ReminderDelivery"("businessId" ASC, "status" ASC, "scheduledFor" ASC);

-- CreateIndex
CREATE INDEX "ReminderDelivery_businessId_status_sentAt_idx" ON "public"."ReminderDelivery"("businessId" ASC, "status" ASC, "sentAt" ASC);

-- CreateIndex
CREATE INDEX "ReminderDelivery_customerId_sentAt_idx" ON "public"."ReminderDelivery"("customerId" ASC, "sentAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ReminderDelivery_reminderAutomationId_appointmentId_key" ON "public"."ReminderDelivery"("reminderAutomationId" ASC, "appointmentId" ASC);

-- CreateIndex
CREATE INDEX "ScheduleBlock_businessId_professionalId_startAt_idx" ON "public"."ScheduleBlock"("businessId" ASC, "professionalId" ASC, "startAt" ASC);

-- CreateIndex
CREATE INDEX "Service_businessId_catalogCategoryId_sortOrder_idx" ON "public"."Service"("businessId" ASC, "catalogCategoryId" ASC, "sortOrder" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Service_businessId_id_key" ON "public"."Service"("businessId" ASC, "id" ASC);

-- CreateIndex
CREATE INDEX "Service_parentServiceId_idx" ON "public"."Service"("parentServiceId" ASC);

-- CreateIndex
CREATE INDEX "ServiceAddon_addonServiceId_idx" ON "public"."ServiceAddon"("addonServiceId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategory_businessId_name_key" ON "public"."ServiceCategory"("businessId" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "ServiceCategory_businessId_sortOrder_idx" ON "public"."ServiceCategory"("businessId" ASC, "sortOrder" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategoryAlias_categoryId_normalizedName_key" ON "public"."ServiceCategoryAlias"("categoryId" ASC, "normalizedName" ASC);

-- CreateIndex
CREATE INDEX "ServiceCategoryAlias_normalizedName_idx" ON "public"."ServiceCategoryAlias"("normalizedName" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCombinationRule_businessId_serviceAId_serviceBId_key" ON "public"."ServiceCombinationRule"("businessId" ASC, "serviceAId" ASC, "serviceBId" ASC);

-- CreateIndex
CREATE INDEX "ServiceCombinationRule_serviceAId_idx" ON "public"."ServiceCombinationRule"("serviceAId" ASC);

-- CreateIndex
CREATE INDEX "ServiceCombinationRule_serviceBId_idx" ON "public"."ServiceCombinationRule"("serviceBId" ASC);

-- CreateIndex
CREATE INDEX "StaffAuditLog_businessId_createdAt_idx" ON "public"."StaffAuditLog"("businessId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "StaffAuditLog_userId_createdAt_idx" ON "public"."StaffAuditLog"("userId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "User_businessId_idx" ON "public"."User"("businessId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email" ASC);

-- CreateIndex
CREATE INDEX "User_professionalId_idx" ON "public"."User"("professionalId" ASC);

-- CreateIndex
CREATE INDEX "User_role_idx" ON "public"."User"("role" ASC);

-- CreateIndex
CREATE INDEX "UserSession_expiresAt_idx" ON "public"."UserSession"("expiresAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "public"."UserSession"("tokenHash" ASC);

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "public"."UserSession"("userId" ASC);

-- CreateIndex
CREATE INDEX "WeexAccount_email_idx" ON "public"."WeexAccount"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "WeexAccount_googleSub_key" ON "public"."WeexAccount"("googleSub" ASC);

-- CreateIndex
CREATE INDEX "WeexAccount_phone_idx" ON "public"."WeexAccount"("phone" ASC);

-- CreateIndex
CREATE INDEX "WeexAccountSession_accountId_idx" ON "public"."WeexAccountSession"("accountId" ASC);

-- CreateIndex
CREATE INDEX "WeexAccountSession_expiresAt_idx" ON "public"."WeexAccountSession"("expiresAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "WeexAccountSession_tokenHash_key" ON "public"."WeexAccountSession"("tokenHash" ASC);

-- CreateIndex
CREATE INDEX "WeexCustomerLink_businessId_idx" ON "public"."WeexCustomerLink"("businessId" ASC);

-- CreateIndex
CREATE INDEX "WeexCustomerLink_customerId_idx" ON "public"."WeexCustomerLink"("customerId" ASC);

-- CreateIndex
CREATE INDEX "WeexCustomerLink_phone_idx" ON "public"."WeexCustomerLink"("phone" ASC);

-- CreateIndex
CREATE INDEX "WeexCustomerLink_weexAccountId_businessId_idx" ON "public"."WeexCustomerLink"("weexAccountId" ASC, "businessId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "WeexCustomerLink_weexAccountId_customerId_businessId_key" ON "public"."WeexCustomerLink"("weexAccountId" ASC, "customerId" ASC, "businessId" ASC);

-- CreateIndex
CREATE INDEX "WeexLead_campaign_createdAt_idx" ON "public"."WeexLead"("campaign" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "WeexLead_createdAt_idx" ON "public"."WeexLead"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "WeexLead_status_createdAt_idx" ON "public"."WeexLead"("status" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTemplate_businessId_metaName_language_key" ON "public"."WhatsAppTemplate"("businessId" ASC, "metaName" ASC, "language" ASC);

-- CreateIndex
CREATE INDEX "WhatsAppTemplate_businessId_status_updatedAt_idx" ON "public"."WhatsAppTemplate"("businessId" ASC, "status" ASC, "updatedAt" ASC);

-- AddForeignKey
ALTER TABLE "public"."Appointment" ADD CONSTRAINT "Appointment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Appointment" ADD CONSTRAINT "Appointment_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "public"."Professional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Appointment" ADD CONSTRAINT "Appointment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "public"."Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Appointment" ADD CONSTRAINT "Appointment_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "public"."BookingVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AppointmentServiceItem" ADD CONSTRAINT "AppointmentServiceItem_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "public"."Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AppointmentServiceItem" ADD CONSTRAINT "AppointmentServiceItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "public"."Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingDeposit" ADD CONSTRAINT "BookingDeposit_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "public"."Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingDeposit" ADD CONSTRAINT "BookingDeposit_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingDeposit" ADD CONSTRAINT "BookingDeposit_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingDeposit" ADD CONSTRAINT "BookingDeposit_visitId_fkey" FOREIGN KEY ("businessId", "visitId") REFERENCES "public"."BookingVisit"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingDepositExpiryAudit" ADD CONSTRAINT "BookingDepositExpiryAudit_businessId_depositId_fkey" FOREIGN KEY ("businessId", "depositId") REFERENCES "public"."BookingDeposit"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingDepositLine" ADD CONSTRAINT "BookingDepositLine_businessId_depositId_fkey" FOREIGN KEY ("businessId", "depositId") REFERENCES "public"."BookingDeposit"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingDepositLine" ADD CONSTRAINT "BookingDepositLine_businessId_serviceId_fkey" FOREIGN KEY ("businessId", "serviceId") REFERENCES "public"."Service"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingDepositProof" ADD CONSTRAINT "BookingDepositProof_businessId_depositId_fkey" FOREIGN KEY ("businessId", "depositId") REFERENCES "public"."BookingDeposit"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingDepositProof" ADD CONSTRAINT "BookingDepositProof_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingDepositProofPurgeAudit" ADD CONSTRAINT "BookingDepositProofPurgeAudit_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "public"."BookingDepositProofPurgeOperation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public"."BookingVisit" ADD CONSTRAINT "BookingVisit_businessId_customerId_fkey" FOREIGN KEY ("businessId", "customerId") REFERENCES "public"."Customer"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingVisit" ADD CONSTRAINT "BookingVisit_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingVisit" ADD CONSTRAINT "BookingVisit_businessId_professionalId_fkey" FOREIGN KEY ("businessId", "professionalId") REFERENCES "public"."Professional"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingVisit" ADD CONSTRAINT "BookingVisit_businessId_sessionId_fkey" FOREIGN KEY ("businessId", "sessionId") REFERENCES "public"."BotSession"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BotActionInbox" ADD CONSTRAINT "BotActionInbox_businessId_deploymentId_fkey" FOREIGN KEY ("businessId", "deploymentId") REFERENCES "public"."BotChannelDeployment"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BotActionInbox" ADD CONSTRAINT "BotActionInbox_businessId_deploymentId_sessionId_fkey" FOREIGN KEY ("businessId", "deploymentId", "sessionId") REFERENCES "public"."BotSession"("businessId", "deploymentId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BotActionInbox" ADD CONSTRAINT "BotActionInbox_businessId_providerEventId_fkey" FOREIGN KEY ("businessId", "providerEventId") REFERENCES "public"."BotProviderEvent"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BotActionInbox" ADD CONSTRAINT "BotActionInbox_sessionId_promptId_fkey" FOREIGN KEY ("sessionId", "promptId") REFERENCES "public"."BotPrompt"("sessionId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BotChannelDeployment" ADD CONSTRAINT "BotChannelDeployment_businessId_activeConfigurationId_fkey" FOREIGN KEY ("businessId", "activeConfigurationId") REFERENCES "public"."BusinessBotConfiguration"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BotChannelDeployment" ADD CONSTRAINT "BotChannelDeployment_businessId_previousConfigurationId_fkey" FOREIGN KEY ("businessId", "previousConfigurationId") REFERENCES "public"."BusinessBotConfiguration"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BotDispatchClaim" ADD CONSTRAINT "BotDispatchClaim_businessId_sessionId_fkey" FOREIGN KEY ("businessId", "sessionId") REFERENCES "public"."BotSession"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BotJob" ADD CONSTRAINT "BotJob_businessId_deploymentId_fkey" FOREIGN KEY ("businessId", "deploymentId") REFERENCES "public"."BotChannelDeployment"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BotOutbox" ADD CONSTRAINT "BotOutbox_businessId_sessionId_fkey" FOREIGN KEY ("businessId", "sessionId") REFERENCES "public"."BotSession"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BotOutboxResolution" ADD CONSTRAINT "BotOutboxResolution_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "public"."BotOutbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BotPrompt" ADD CONSTRAINT "BotPrompt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."BotSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BotPromptChoice" ADD CONSTRAINT "BotPromptChoice_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "public"."BotPrompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BotSession" ADD CONSTRAINT "BotSession_businessId_deploymentId_fkey" FOREIGN KEY ("businessId", "deploymentId") REFERENCES "public"."BotChannelDeployment"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Business" ADD CONSTRAINT "Business_accountAdminId_fkey" FOREIGN KEY ("accountAdminId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Business" ADD CONSTRAINT "Business_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Business" ADD CONSTRAINT "Business_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."BusinessPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BusinessAccountCharge" ADD CONSTRAINT "BusinessAccountCharge_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BusinessAccountStatusChange" ADD CONSTRAINT "BusinessAccountStatusChange_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BusinessBillingSettings" ADD CONSTRAINT "BusinessBillingSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BusinessBotConfiguration" ADD CONSTRAINT "BusinessBotConfiguration_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BusinessBotOptionsSettings" ADD CONSTRAINT "BusinessBotOptionsSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BusinessFeatureSettings" ADD CONSTRAINT "BusinessFeatureSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BusinessHours" ADD CONSTRAINT "BusinessHours_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BusinessInstagramConfig" ADD CONSTRAINT "BusinessInstagramConfig_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BusinessOnboardingStatus" ADD CONSTRAINT "BusinessOnboardingStatus_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BusinessPaymentSettings" ADD CONSTRAINT "BusinessPaymentSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BusinessWhatsAppConfig" ADD CONSTRAINT "BusinessWhatsAppConfig_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Campaign" ADD CONSTRAINT "Campaign_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Campaign" ADD CONSTRAINT "Campaign_whatsappTemplateId_fkey" FOREIGN KEY ("whatsappTemplateId") REFERENCES "public"."WhatsAppTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignDelivery" ADD CONSTRAINT "CampaignDelivery_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignDelivery" ADD CONSTRAINT "CampaignDelivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignDelivery" ADD CONSTRAINT "CampaignDelivery_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignJob" ADD CONSTRAINT "CampaignJob_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignJob" ADD CONSTRAINT "CampaignJob_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignJob" ADD CONSTRAINT "CampaignJob_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignJob" ADD CONSTRAINT "CampaignJob_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."CampaignRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignManualRecipient" ADD CONSTRAINT "CampaignManualRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignManualRecipient" ADD CONSTRAINT "CampaignManualRecipient_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignRun" ADD CONSTRAINT "CampaignRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CampaignRun" ADD CONSTRAINT "CampaignRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "public"."Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CommunicationEvent" ADD CONSTRAINT "CommunicationEvent_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "public"."CommunicationRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CommunicationExecution" ADD CONSTRAINT "CommunicationExecution_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CommunicationRecipient" ADD CONSTRAINT "CommunicationRecipient_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CommunicationRecipient" ADD CONSTRAINT "CommunicationRecipient_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CommunicationRecipient" ADD CONSTRAINT "CommunicationRecipient_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "public"."CommunicationExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Conversation" ADD CONSTRAINT "Conversation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Conversation" ADD CONSTRAINT "Conversation_opportunityAppointmentId_fkey" FOREIGN KEY ("opportunityAppointmentId") REFERENCES "public"."Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ConversationOpportunityEvent" ADD CONSTRAINT "ConversationOpportunityEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Customer" ADD CONSTRAINT "Customer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerMarketingPreference" ADD CONSTRAINT "CustomerMarketingPreference_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerMarketingPreference" ADD CONSTRAINT "CustomerMarketingPreference_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CustomerNote" ADD CONSTRAINT "CustomerNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InstagramLead" ADD CONSTRAINT "InstagramLead_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InstagramLead" ADD CONSTRAINT "InstagramLead_whatsappConversationId_fkey" FOREIGN KEY ("whatsappConversationId") REFERENCES "public"."Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InstagramMessage" ADD CONSTRAINT "InstagramMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."InstagramLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PostSaleAutomation" ADD CONSTRAINT "PostSaleAutomation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PostSaleAutomation" ADD CONSTRAINT "PostSaleAutomation_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."WhatsAppTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PostSaleDelivery" ADD CONSTRAINT "PostSaleDelivery_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "public"."Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PostSaleDelivery" ADD CONSTRAINT "PostSaleDelivery_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "public"."PostSaleAutomation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PostSaleDelivery" ADD CONSTRAINT "PostSaleDelivery_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PostSaleDelivery" ADD CONSTRAINT "PostSaleDelivery_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PostSaleDelivery" ADD CONSTRAINT "PostSaleDelivery_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Professional" ADD CONSTRAINT "Professional_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProfessionalHours" ADD CONSTRAINT "ProfessionalHours_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "public"."Professional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProfessionalService" ADD CONSTRAINT "ProfessionalService_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "public"."Professional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProfessionalService" ADD CONSTRAINT "ProfessionalService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "public"."Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReminderAutomation" ADD CONSTRAINT "ReminderAutomation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "public"."Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ReminderDelivery" ADD CONSTRAINT "ReminderDelivery_reminderAutomationId_fkey" FOREIGN KEY ("reminderAutomationId") REFERENCES "public"."ReminderAutomation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "public"."Professional"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Service" ADD CONSTRAINT "Service_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Service" ADD CONSTRAINT "Service_catalogCategoryId_fkey" FOREIGN KEY ("catalogCategoryId") REFERENCES "public"."ServiceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Service" ADD CONSTRAINT "Service_parentServiceId_fkey" FOREIGN KEY ("parentServiceId") REFERENCES "public"."Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceAddon" ADD CONSTRAINT "ServiceAddon_addonServiceId_fkey" FOREIGN KEY ("addonServiceId") REFERENCES "public"."Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceAddon" ADD CONSTRAINT "ServiceAddon_sourceServiceId_fkey" FOREIGN KEY ("sourceServiceId") REFERENCES "public"."Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceAlias" ADD CONSTRAINT "ServiceAlias_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "public"."Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceCategory" ADD CONSTRAINT "ServiceCategory_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceCategoryAlias" ADD CONSTRAINT "ServiceCategoryAlias_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."ServiceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceCombinationRule" ADD CONSTRAINT "ServiceCombinationRule_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceCombinationRule" ADD CONSTRAINT "ServiceCombinationRule_serviceAId_fkey" FOREIGN KEY ("serviceAId") REFERENCES "public"."Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceCombinationRule" ADD CONSTRAINT "ServiceCombinationRule_serviceBId_fkey" FOREIGN KEY ("serviceBId") REFERENCES "public"."Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "public"."Professional"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WeexAccountSession" ADD CONSTRAINT "WeexAccountSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."WeexAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WeexCustomerLink" ADD CONSTRAINT "WeexCustomerLink_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WeexCustomerLink" ADD CONSTRAINT "WeexCustomerLink_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WeexCustomerLink" ADD CONSTRAINT "WeexCustomerLink_weexAccountId_fkey" FOREIGN KEY ("weexAccountId") REFERENCES "public"."WeexAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "public"."Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Custom PostgreSQL objects omitted by Prisma schema diff.
-- Snapshot FUNCTION: assert_booking_deposit_expiry_audit_retained
CREATE OR REPLACE FUNCTION public.assert_booking_deposit_expiry_audit_retained()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "BookingDeposit"
    WHERE "businessId" = OLD."businessId" AND "id" = OLD."depositId"
  ) THEN
    RAISE EXCEPTION 'BookingDepositExpiryAudit is append-only while its deposit exists';
  END IF;
  RETURN NULL;
END;
$function$;

-- Snapshot FUNCTION: assert_booking_deposit_proof_retained
CREATE OR REPLACE FUNCTION public.assert_booking_deposit_proof_retained()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "BookingDeposit"
    WHERE "businessId" = OLD."businessId" AND "id" = OLD."depositId"
  ) THEN
    RAISE EXCEPTION 'BookingDepositProof is immutable while its deposit exists';
  END IF;
  RETURN NULL;
END;
$function$;

-- Snapshot FUNCTION: assert_booking_deposit_proof_sequence
CREATE OR REPLACE FUNCTION public.assert_booking_deposit_proof_sequence()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  last_sequence INTEGER;
BEGIN
  IF NEW."sourceData" IS NULL OR NEW."derivedData" IS NULL OR NEW."purgedAt" IS NOT NULL OR NEW."purgeReason" IS NOT NULL THEN
    RAISE EXCEPTION 'BookingDepositProof must be inserted with retained bytes';
  END IF;
  PERFORM 1 FROM "BookingDeposit"
  WHERE "businessId" = NEW."businessId" AND "id" = NEW."depositId"
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BookingDepositProof must reference an existing tenant-scoped deposit'; END IF;
  SELECT max("sequence") INTO last_sequence FROM "BookingDepositProof"
  WHERE "businessId" = NEW."businessId" AND "depositId" = NEW."depositId";
  IF NEW."sequence" <> COALESCE(last_sequence, 0) + 1 THEN RAISE EXCEPTION 'BookingDepositProof sequence must append contiguously per deposit'; END IF;
  RETURN NEW;
END;
$function$;

-- Snapshot FUNCTION: assert_f8_booking_deposit_aggregate
CREATE OR REPLACE FUNCTION public.assert_f8_booking_deposit_aggregate()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."visitId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "Appointment" a
    JOIN "BookingVisit" v ON v."id" = a."visitId" AND v."businessId" = NEW."businessId"
    WHERE a."id" = NEW."appointmentId" AND a."visitId" = NEW."visitId"
  ) THEN
    RAISE EXCEPTION 'F8 BookingDeposit must reference an appointment in its tenant-scoped visit';
  END IF;
  RETURN NEW;
END;
$function$;

-- Snapshot FUNCTION: assert_f8_deposit_line_membership
CREATE OR REPLACE FUNCTION public.assert_f8_deposit_line_membership()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  target_appointment_id TEXT;
  sealed_at TIMESTAMP(3);
BEGIN
  -- Serialize against a visible unsealed root (for example, a controlled
  -- legacy-to-F8 conversion): a concurrent append waits, then observes the
  -- committed seal and is rejected. An uncommitted new root is fail-closed
  -- as absent because PostgreSQL does not expose it under READ COMMITTED.
  SELECT "appointmentId", "snapshotSealedAt"
  INTO target_appointment_id, sealed_at
  FROM "BookingDeposit"
  WHERE "businessId" = NEW."businessId" AND "id" = NEW."depositId"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BookingDepositLine must reference an existing deposit';
  END IF;
  IF sealed_at IS NOT NULL THEN
    RAISE EXCEPTION 'BookingDepositLine cannot be appended after its snapshot is sealed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "AppointmentServiceItem" i
    WHERE i."appointmentId" = target_appointment_id AND i."serviceId" = NEW."serviceId"
  ) THEN
    RAISE EXCEPTION 'BookingDepositLine service must be selected on the deposit appointment';
  END IF;
  RETURN NEW;
END;
$function$;

-- Snapshot FUNCTION: assert_f8_deposit_line_retained
CREATE OR REPLACE FUNCTION public.assert_f8_deposit_line_retained()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "BookingDeposit"
    WHERE "businessId" = OLD."businessId" AND "id" = OLD."depositId"
  ) THEN
    RAISE EXCEPTION 'BookingDepositLine is immutable while its deposit exists';
  END IF;
  RETURN NULL;
END;
$function$;

-- Snapshot FUNCTION: assert_f8_deposit_line_total
CREATE OR REPLACE FUNCTION public.assert_f8_deposit_line_total()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  target_deposit_id TEXT;
  target_business_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'BookingDeposit' THEN
    target_deposit_id := NEW."id";
    target_business_id := NEW."businessId";
  ELSIF TG_OP = 'DELETE' THEN
    target_deposit_id := OLD."depositId";
    target_business_id := OLD."businessId";
  ELSE
    target_deposit_id := NEW."depositId";
    target_business_id := NEW."businessId";
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "BookingDeposit" d
    WHERE d."id" = target_deposit_id
      AND d."businessId" = target_business_id
      AND d."visitId" IS NOT NULL
      AND d."amount" <> COALESCE((
        SELECT sum(l."amount")::int
        FROM "BookingDepositLine" l
        WHERE l."depositId" = d."id" AND l."businessId" = d."businessId"
      ), 0)
  ) THEN
    RAISE EXCEPTION 'BookingDeposit amount must equal its immutable line total';
  END IF;
  RETURN NULL;
END;
$function$;

-- Snapshot FUNCTION: assert_f8_deposit_snapshot_sealed
CREATE OR REPLACE FUNCTION public.assert_f8_deposit_snapshot_sealed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "BookingDeposit" d
    WHERE d."id" = NEW."id" AND d."businessId" = NEW."businessId"
      AND d."visitId" IS NOT NULL AND d."snapshotSealedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'F8 BookingDeposit snapshot must be sealed before commit';
  END IF;
  RETURN NULL;
END;
$function$;

-- Snapshot FUNCTION: assert_f8_proof_received_evidence
CREATE OR REPLACE FUNCTION public.assert_f8_proof_received_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."visitId" IS NOT NULL AND NEW."snapshotSealedAt" IS NOT NULL
    AND NEW."status" = 'PROOF_RECEIVED'::"BookingDepositStatus"
    AND NOT EXISTS (
      SELECT 1 FROM "BookingDepositProof" p
      WHERE p."businessId" = NEW."businessId" AND p."depositId" = NEW."id"
    ) THEN
    RAISE EXCEPTION 'F8 PROOF_RECEIVED requires retained append-only evidence';
  END IF;
  RETURN NULL;
END;
$function$;

-- Snapshot FUNCTION: reject_booking_deposit_expiry_audit_update
CREATE OR REPLACE FUNCTION public.reject_booking_deposit_expiry_audit_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'BookingDepositExpiryAudit is append-only';
END;
$function$;

-- Snapshot FUNCTION: reject_booking_deposit_line_update
CREATE OR REPLACE FUNCTION public.reject_booking_deposit_line_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'BookingDepositLine is immutable';
END;
$function$;

-- Snapshot FUNCTION: reject_booking_deposit_proof_purge_audit_mutation
CREATE OR REPLACE FUNCTION public.reject_booking_deposit_proof_purge_audit_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN RAISE EXCEPTION 'BookingDepositProofPurgeAudit is append-only'; END;
$function$;

-- Snapshot FUNCTION: reject_booking_deposit_proof_update
CREATE OR REPLACE FUNCTION public.reject_booking_deposit_proof_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD."sourceData" IS NOT NULL
    AND OLD."derivedData" IS NOT NULL
    AND OLD."purgedAt" IS NULL
    AND OLD."purgeReason" IS NULL
    AND OLD."retentionEligibleAt" <= clock_timestamp()
    AND NEW."sourceData" IS NULL
    AND NEW."derivedData" IS NULL
    AND NEW."purgeReason" = 'RETENTION_12_MONTHS'
    AND NEW."id" IS NOT DISTINCT FROM OLD."id"
    AND NEW."businessId" IS NOT DISTINCT FROM OLD."businessId"
    AND NEW."depositId" IS NOT DISTINCT FROM OLD."depositId"
    AND NEW."sequence" IS NOT DISTINCT FROM OLD."sequence"
    AND NEW."kind" IS NOT DISTINCT FROM OLD."kind"
    AND NEW."validationStatus" IS NOT DISTINCT FROM OLD."validationStatus"
    AND NEW."validatorVersion" IS NOT DISTINCT FROM OLD."validatorVersion"
    AND NEW."validatedAt" IS NOT DISTINCT FROM OLD."validatedAt"
    AND NEW."receivedAt" IS NOT DISTINCT FROM OLD."receivedAt"
    AND NEW."providerEventId" IS NOT DISTINCT FROM OLD."providerEventId"
    AND NEW."providerMessageId" IS NOT DISTINCT FROM OLD."providerMessageId"
    AND NEW."providerMediaId" IS NOT DISTINCT FROM OLD."providerMediaId"
    AND NEW."sourceMimeType" IS NOT DISTINCT FROM OLD."sourceMimeType"
    AND NEW."sourceFilename" IS NOT DISTINCT FROM OLD."sourceFilename"
    AND NEW."sourceByteSize" IS NOT DISTINCT FROM OLD."sourceByteSize"
    AND NEW."sourceSha256" IS NOT DISTINCT FROM OLD."sourceSha256"
    AND NEW."derivedMimeType" IS NOT DISTINCT FROM OLD."derivedMimeType"
    AND NEW."derivedByteSize" IS NOT DISTINCT FROM OLD."derivedByteSize"
    AND NEW."derivedSha256" IS NOT DISTINCT FROM OLD."derivedSha256"
    AND NEW."retentionEligibleAt" IS NOT DISTINCT FROM OLD."retentionEligibleAt"
    AND NEW."createdAt" IS NOT DISTINCT FROM OLD."createdAt"
  THEN
    NEW."purgedAt" := clock_timestamp();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'BookingDepositProof permits only one-way due byte purge';
END;
$function$;

-- Snapshot FUNCTION: reject_f8_booking_deposit_terms_update
CREATE OR REPLACE FUNCTION public.reject_f8_booking_deposit_terms_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD."visitId" IS NOT NULL AND OLD."snapshotSealedAt" IS NOT NULL AND NOT (
    NEW."id" IS NOT DISTINCT FROM OLD."id" AND NEW."businessId" IS NOT DISTINCT FROM OLD."businessId"
    AND NEW."appointmentId" IS NOT DISTINCT FROM OLD."appointmentId" AND NEW."conversationId" IS NOT DISTINCT FROM OLD."conversationId"
    AND NEW."visitId" IS NOT DISTINCT FROM OLD."visitId" AND NEW."source" IS NOT DISTINCT FROM OLD."source"
    AND NEW."mode" IS NOT DISTINCT FROM OLD."mode" AND NEW."configuredValue" IS NOT DISTINCT FROM OLD."configuredValue"
    AND NEW."baseAmount" IS NOT DISTINCT FROM OLD."baseAmount" AND NEW."amount" IS NOT DISTINCT FROM OLD."amount"
    AND NEW."holdTtlMinutes" IS NOT DISTINCT FROM OLD."holdTtlMinutes" AND NEW."holdTtlProvenance" IS NOT DISTINCT FROM OLD."holdTtlProvenance"
    AND NEW."snapshotSealedAt" IS NOT DISTINCT FROM OLD."snapshotSealedAt" AND NEW."proofMessageId" IS NOT DISTINCT FROM OLD."proofMessageId"
    AND NEW."proofData" IS NOT DISTINCT FROM OLD."proofData" AND NEW."proofMimeType" IS NOT DISTINCT FROM OLD."proofMimeType"
    AND NEW."proofFilename" IS NOT DISTINCT FROM OLD."proofFilename" AND NEW."createdAt" IS NOT DISTINCT FROM OLD."createdAt"
    AND (
      (OLD."status" = 'PENDING_PROOF'::"BookingDepositStatus" AND NEW."status" = 'PROOF_RECEIVED'::"BookingDepositStatus"
       AND NEW."expiresAt" IS NOT DISTINCT FROM OLD."expiresAt" AND NEW."reviewedAt" IS NOT DISTINCT FROM OLD."reviewedAt"
       AND NEW."reviewedByUserId" IS NOT DISTINCT FROM OLD."reviewedByUserId" AND NEW."rejectionReason" IS NOT DISTINCT FROM OLD."rejectionReason"
       AND NEW."expiredAt" IS NOT DISTINCT FROM OLD."expiredAt" AND NEW."expirationReason" IS NOT DISTINCT FROM OLD."expirationReason")
      OR (OLD."status" = 'PENDING_RESUBMISSION'::"BookingDepositStatus" AND NEW."status" = 'PROOF_RECEIVED'::"BookingDepositStatus"
       AND NEW."expiresAt" IS NOT DISTINCT FROM OLD."expiresAt" AND NEW."expiredAt" IS NOT DISTINCT FROM OLD."expiredAt"
       AND NEW."expirationReason" IS NOT DISTINCT FROM OLD."expirationReason")
      OR (OLD."status" = 'PENDING_PROOF'::"BookingDepositStatus" AND NEW."status" = 'EXPIRED'::"BookingDepositStatus"
       AND NEW."expiredAt" IS NOT NULL AND NEW."expirationReason" = 'HOLD_TTL_EXPIRED')
      OR (OLD."status" = 'PENDING_RESUBMISSION'::"BookingDepositStatus" AND NEW."status" = 'EXPIRED'::"BookingDepositStatus"
       AND NEW."expiredAt" IS NOT NULL AND NEW."expirationReason" = 'HOLD_TTL_EXPIRED')
      OR (OLD."status" = 'PROOF_RECEIVED'::"BookingDepositStatus" AND NEW."status" IN ('APPROVED'::"BookingDepositStatus", 'REJECTED'::"BookingDepositStatus")
       AND NEW."reviewedAt" IS NOT NULL AND NEW."reviewedByUserId" IS NOT NULL)
      OR (OLD."status" = 'PROOF_RECEIVED'::"BookingDepositStatus" AND NEW."status" = 'PENDING_RESUBMISSION'::"BookingDepositStatus"
       AND NEW."expiresAt" > clock_timestamp() AND NEW."expiredAt" IS NULL AND NEW."expirationReason" IS NULL
       AND NEW."reviewedAt" IS NOT NULL AND NEW."reviewedByUserId" IS NOT NULL AND NEW."rejectionReason" IS NOT NULL)
    )
  ) THEN RAISE EXCEPTION 'sealed F8 BookingDeposit terms are immutable'; END IF;
  RETURN NEW;
END;
$function$;

-- Snapshot TRIGGER: BookingDeposit.BookingDeposit_assert_f8_aggregate
CREATE TRIGGER "BookingDeposit_assert_f8_aggregate" BEFORE INSERT OR UPDATE OF "businessId", "appointmentId", "visitId" ON public."BookingDeposit" FOR EACH ROW EXECUTE FUNCTION assert_f8_booking_deposit_aggregate();

-- Snapshot TRIGGER: BookingDeposit.BookingDeposit_assert_line_total
CREATE CONSTRAINT TRIGGER "BookingDeposit_assert_line_total" AFTER INSERT OR UPDATE OF amount, "snapshotSealedAt" ON public."BookingDeposit" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_f8_deposit_line_total();

-- Snapshot TRIGGER: BookingDeposit.BookingDeposit_reject_sealed_terms_update
CREATE TRIGGER "BookingDeposit_reject_sealed_terms_update" BEFORE UPDATE ON public."BookingDeposit" FOR EACH ROW EXECUTE FUNCTION reject_f8_booking_deposit_terms_update();

-- Snapshot TRIGGER: BookingDeposit.BookingDeposit_require_proof_evidence
CREATE CONSTRAINT TRIGGER "BookingDeposit_require_proof_evidence" AFTER UPDATE OF status ON public."BookingDeposit" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_f8_proof_received_evidence();

-- Snapshot TRIGGER: BookingDeposit.BookingDeposit_require_snapshot_seal
CREATE CONSTRAINT TRIGGER "BookingDeposit_require_snapshot_seal" AFTER INSERT OR UPDATE OF "snapshotSealedAt" ON public."BookingDeposit" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_f8_deposit_snapshot_sealed();

-- Snapshot TRIGGER: BookingDepositExpiryAudit.BookingDepositExpiryAudit_reject_reta
CREATE CONSTRAINT TRIGGER "BookingDepositExpiryAudit_reject_retained_delete" AFTER DELETE ON public."BookingDepositExpiryAudit" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_booking_deposit_expiry_audit_retained();

-- Snapshot TRIGGER: BookingDepositExpiryAudit.BookingDepositExpiryAudit_reject_upda
CREATE TRIGGER "BookingDepositExpiryAudit_reject_update" BEFORE UPDATE ON public."BookingDepositExpiryAudit" FOR EACH ROW EXECUTE FUNCTION reject_booking_deposit_expiry_audit_update();

-- Snapshot TRIGGER: BookingDepositLine.BookingDepositLine_assert_membership
CREATE TRIGGER "BookingDepositLine_assert_membership" BEFORE INSERT ON public."BookingDepositLine" FOR EACH ROW EXECUTE FUNCTION assert_f8_deposit_line_membership();

-- Snapshot TRIGGER: BookingDepositLine.BookingDepositLine_assert_total
CREATE CONSTRAINT TRIGGER "BookingDepositLine_assert_total" AFTER INSERT OR DELETE ON public."BookingDepositLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_f8_deposit_line_total();

-- Snapshot TRIGGER: BookingDepositLine.BookingDepositLine_reject_retained_delete
CREATE CONSTRAINT TRIGGER "BookingDepositLine_reject_retained_delete" AFTER DELETE ON public."BookingDepositLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_f8_deposit_line_retained();

-- Snapshot TRIGGER: BookingDepositLine.BookingDepositLine_reject_update
CREATE TRIGGER "BookingDepositLine_reject_update" BEFORE UPDATE ON public."BookingDepositLine" FOR EACH ROW EXECUTE FUNCTION reject_booking_deposit_line_update();

-- Snapshot TRIGGER: BookingDepositProof.BookingDepositProof_assert_sequence
CREATE TRIGGER "BookingDepositProof_assert_sequence" BEFORE INSERT ON public."BookingDepositProof" FOR EACH ROW EXECUTE FUNCTION assert_booking_deposit_proof_sequence();

-- Snapshot TRIGGER: BookingDepositProof.BookingDepositProof_reject_retained_delete
CREATE CONSTRAINT TRIGGER "BookingDepositProof_reject_retained_delete" AFTER DELETE ON public."BookingDepositProof" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_booking_deposit_proof_retained();

-- Snapshot TRIGGER: BookingDepositProof.BookingDepositProof_reject_update
CREATE TRIGGER "BookingDepositProof_reject_update" BEFORE UPDATE ON public."BookingDepositProof" FOR EACH ROW EXECUTE FUNCTION reject_booking_deposit_proof_update();

-- Snapshot TRIGGER: BookingDepositProofPurgeAudit.BookingDepositProofPurgeAudit_rej
CREATE TRIGGER "BookingDepositProofPurgeAudit_reject_mutation" BEFORE DELETE OR UPDATE ON public."BookingDepositProofPurgeAudit" FOR EACH ROW EXECUTE FUNCTION reject_booking_deposit_proof_purge_audit_mutation();
