CREATE TABLE "assignment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"chore_id" text NOT NULL,
	"assigned_to_member_id" text NOT NULL,
	"rotation_group_id" text,
	"due_date" text NOT NULL,
	"due_time" text,
	"original_due_date" text,
	"snooze_count" integer DEFAULT 0 NOT NULL,
	"checklist_progress" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chore" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"category_id" text,
	"name" text NOT NULL,
	"description" text,
	"difficulty" integer DEFAULT 3 NOT NULL,
	"estimated_minutes" integer DEFAULT 15 NOT NULL,
	"icon" text DEFAULT 'sparkles' NOT NULL,
	"reference_photo_media_id" text,
	"ai_verification_enabled" boolean DEFAULT false NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chore_category" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT 'home' NOT NULL,
	"color" text DEFAULT 'slate' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "completion" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"assignment_id" text NOT NULL,
	"completed_by_member_id" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"before_photo_media_id" text,
	"after_photo_media_id" text,
	"notes" text,
	"points_earned" integer DEFAULT 0 NOT NULL,
	"speed_bonus" integer DEFAULT 0 NOT NULL,
	"actual_minutes" integer,
	"approved_by_member_id" text,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"needs_approval" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rotation_group" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"chore_id" text NOT NULL,
	"member_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_index" integer DEFAULT 0 NOT NULL,
	"rotation_type" text DEFAULT 'round_robin' NOT NULL,
	"frequency" text DEFAULT 'weekly' NOT NULL,
	"start_date" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "household_role" text DEFAULT 'roommate' NOT NULL;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "birthday" text;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "favorite_color" text DEFAULT 'coral' NOT NULL;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "away_until" text;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "away_reason" text;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "mute_celebrations" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "allowance_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "allowance_payout_type" text DEFAULT 'money' NOT NULL;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "allowance_amount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "allowance_reward_description" text;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "allowance_threshold_pct" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "mode" text DEFAULT 'family' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "invite_code" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "timezone" text DEFAULT 'America/New_York' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "require_photo_proof" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "require_approval" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "leaderboard_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "allow_kid_gifting" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "allow_kid_challenges" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "allow_kid_competitions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "max_kid_competition_stakes" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "ai_verification_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "ai_verification_provider" text DEFAULT 'openai' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "ai_auto_approve_threshold" integer DEFAULT 85 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "ai_auto_reject_threshold" integer DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "ai_monthly_cost_cap_cents" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "health_score" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_chore_id_chore_id_fk" FOREIGN KEY ("chore_id") REFERENCES "public"."chore"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_assigned_to_member_id_member_id_fk" FOREIGN KEY ("assigned_to_member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_rotation_group_id_rotation_group_id_fk" FOREIGN KEY ("rotation_group_id") REFERENCES "public"."rotation_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore" ADD CONSTRAINT "chore_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore" ADD CONSTRAINT "chore_category_id_chore_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."chore_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore" ADD CONSTRAINT "chore_reference_photo_media_id_media_id_fk" FOREIGN KEY ("reference_photo_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore" ADD CONSTRAINT "chore_created_by_member_id_member_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore_category" ADD CONSTRAINT "chore_category_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion" ADD CONSTRAINT "completion_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion" ADD CONSTRAINT "completion_assignment_id_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion" ADD CONSTRAINT "completion_completed_by_member_id_member_id_fk" FOREIGN KEY ("completed_by_member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion" ADD CONSTRAINT "completion_before_photo_media_id_media_id_fk" FOREIGN KEY ("before_photo_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion" ADD CONSTRAINT "completion_after_photo_media_id_media_id_fk" FOREIGN KEY ("after_photo_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion" ADD CONSTRAINT "completion_approved_by_member_id_member_id_fk" FOREIGN KEY ("approved_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotation_group" ADD CONSTRAINT "rotation_group_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotation_group" ADD CONSTRAINT "rotation_group_chore_id_chore_id_fk" FOREIGN KEY ("chore_id") REFERENCES "public"."chore"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_org_status_idx" ON "assignment" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "assignment_assignee_idx" ON "assignment" USING btree ("assigned_to_member_id","due_date");--> statement-breakpoint
CREATE INDEX "assignment_org_due_idx" ON "assignment" USING btree ("organization_id","due_date");--> statement-breakpoint
CREATE INDEX "chore_org_idx" ON "chore" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE INDEX "chore_category_org_idx" ON "chore_category" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "completion_assignment_idx" ON "completion" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "completion_member_idx" ON "completion" USING btree ("completed_by_member_id","status");--> statement-breakpoint
CREATE INDEX "completion_org_idx" ON "completion" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "rotation_group_org_idx" ON "rotation_group" USING btree ("organization_id","is_active");--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_invite_code_unique" UNIQUE("invite_code");