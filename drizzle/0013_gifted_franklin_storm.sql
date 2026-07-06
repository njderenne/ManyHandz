CREATE TABLE "access_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"subject_id" text,
	"grantee_name" text NOT NULL,
	"grantee_email" text,
	"code" text NOT NULL,
	"scopes" text[] NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_grant_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "access_grant_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"grant_id" text NOT NULL,
	"subject_id" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_item" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"kind" text NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"data" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escalation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"subject_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"current_stage" text DEFAULT 'reminder' NOT NULL,
	"stage_timestamps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"snoozed_until" timestamp with time zone,
	"sms_sent_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_report" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"subject_id" text,
	"kind" text NOT NULL,
	"range_start" timestamp with time zone NOT NULL,
	"range_end" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL,
	"summary" text,
	"created_by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_state" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"subject_id" text,
	"served_prompt_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cadence" text DEFAULT 'weekly' NOT NULL,
	"pack_keys" jsonb DEFAULT '["core"]'::jsonb NOT NULL,
	"last_served_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subject" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text DEFAULT 'person' NOT NULL,
	"display_name" text NOT NULL,
	"self_user_id" text,
	"avatar_media_id" text,
	"timezone" text,
	"birth_date" text,
	"notes" text,
	"profile" jsonb,
	"archived_at" timestamp with time zone,
	"created_by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "kind" SET DEFAULT 'family';--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "access_grant" ADD CONSTRAINT "access_grant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grant" ADD CONSTRAINT "access_grant_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grant" ADD CONSTRAINT "access_grant_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grant_activity" ADD CONSTRAINT "access_grant_activity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grant_activity" ADD CONSTRAINT "access_grant_activity_grant_id_access_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."access_grant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grant_activity" ADD CONSTRAINT "access_grant_activity_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_item" ADD CONSTRAINT "catalog_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation" ADD CONSTRAINT "escalation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation" ADD CONSTRAINT "escalation_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_report" ADD CONSTRAINT "generated_report_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_report" ADD CONSTRAINT "generated_report_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_report" ADD CONSTRAINT "generated_report_created_by_member_id_member_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_state" ADD CONSTRAINT "prompt_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_state" ADD CONSTRAINT "prompt_state_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_self_user_id_user_id_fk" FOREIGN KEY ("self_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_avatar_media_id_media_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_created_by_member_id_member_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_grant_org_idx" ON "access_grant" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "access_grant_expires_idx" ON "access_grant" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "access_grant_subject_idx" ON "access_grant" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "access_grant_activity_grant_idx" ON "access_grant_activity" USING btree ("grant_id","created_at");--> statement-breakpoint
CREATE INDEX "access_grant_activity_org_idx" ON "access_grant_activity" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "catalog_item_kind_idx" ON "catalog_item" USING btree ("kind","parent_id");--> statement-breakpoint
CREATE INDEX "catalog_item_org_idx" ON "catalog_item" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "escalation_slot_idx" ON "escalation" USING btree ("organization_id","entity_type","entity_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "escalation_unresolved_idx" ON "escalation" USING btree ("current_stage") WHERE resolved_at IS NULL;--> statement-breakpoint
CREATE INDEX "escalation_subject_idx" ON "escalation" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "generated_report_org_idx" ON "generated_report" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "generated_report_subject_idx" ON "generated_report" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_state_subject_idx" ON "prompt_state" USING btree ("organization_id","subject_id") WHERE subject_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_state_org_idx" ON "prompt_state" USING btree ("organization_id") WHERE subject_id IS NULL;--> statement-breakpoint
CREATE INDEX "subject_org_idx" ON "subject" USING btree ("organization_id","kind");--> statement-breakpoint
CREATE INDEX "subject_self_user_idx" ON "subject" USING btree ("self_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_org_self_unique_idx" ON "subject" USING btree ("organization_id","self_user_id") WHERE self_user_id IS NOT NULL;