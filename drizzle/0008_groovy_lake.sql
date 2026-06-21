CREATE TABLE "activity_reaction" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"member_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"completion_id" text NOT NULL,
	"provider" text DEFAULT 'openai' NOT NULL,
	"model" text NOT NULL,
	"confidence_score" integer NOT NULL,
	"reference_match_score" integer,
	"reasoning" text NOT NULL,
	"reference_comparison" text,
	"decision" text NOT NULL,
	"before_analysis" text,
	"after_analysis" text,
	"raw_response" jsonb,
	"cost_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcement" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"author_member_id" text,
	"title" text NOT NULL,
	"body" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"pinned" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"assignment_id" text NOT NULL,
	"member_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bonus_challenge" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"challenge_type" text NOT NULL,
	"target_value" integer,
	"bonus_points" integer DEFAULT 0 NOT NULL,
	"points_multiplier_x10" integer DEFAULT 10 NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competition" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"challenger_member_id" text NOT NULL,
	"opponent_member_id" text NOT NULL,
	"title" text NOT NULL,
	"competition_type" text NOT NULL,
	"target_value" integer,
	"chore_id" text,
	"stakes_points" integer DEFAULT 0 NOT NULL,
	"stakes_description" text,
	"challenger_progress" integer DEFAULT 0 NOT NULL,
	"opponent_progress" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"winner_member_id" text,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_badge" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"icon" text DEFAULT 'award' NOT NULL,
	"color" text DEFAULT 'amber' NOT NULL,
	"criteria_type" text NOT NULL,
	"criteria_target" integer,
	"criteria_category_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_badge_award" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"badge_id" text NOT NULL,
	"member_id" text NOT NULL,
	"awarded_by_member_id" text,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"member_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"icon" text DEFAULT 'target' NOT NULL,
	"target_points" integer NOT NULL,
	"current_points" integer DEFAULT 0 NOT NULL,
	"monetary_value_cents" integer,
	"auto_contribute_enabled" boolean DEFAULT false NOT NULL,
	"auto_contribute_percentage" integer DEFAULT 25 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_target_positive" CHECK ("goal"."target_points" > 0)
);
--> statement-breakpoint
CREATE TABLE "goal_contribution" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"goal_id" text NOT NULL,
	"member_id" text NOT NULL,
	"points" integer NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_contribution_positive" CHECK ("goal_contribution"."points" > 0)
);
--> statement-breakpoint
CREATE TABLE "household_milestone" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"milestone_key" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_poll" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"question" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allow_multiple" boolean DEFAULT false NOT NULL,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"closes_at" timestamp with time zone,
	"is_closed" boolean DEFAULT false NOT NULL,
	"created_by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_plan_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"date" text NOT NULL,
	"meal_type" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"recipe_url" text,
	"ingredients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"added_by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "point_gift" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"from_member_id" text NOT NULL,
	"to_member_id" text NOT NULL,
	"points" integer NOT NULL,
	"note" text,
	"gift_type" text DEFAULT 'general' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_gift_positive" CHECK ("point_gift"."points" > 0)
);
--> statement-breakpoint
CREATE TABLE "poll_vote" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"poll_id" text NOT NULL,
	"option_id" text NOT NULL,
	"member_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quick_task" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"assigned_to_member_id" text,
	"due_date" text,
	"due_time" text,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_by_member_id" text,
	"completed_at" timestamp with time zone,
	"created_by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text DEFAULT 'gift' NOT NULL,
	"points_cost" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_cost_positive" CHECK ("reward"."points_cost" > 0)
);
--> statement-breakpoint
CREATE TABLE "reward_redemption" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"reward_id" text NOT NULL,
	"member_id" text NOT NULL,
	"points_spent" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approved_by_member_id" text,
	"approved_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"from_member_id" text NOT NULL,
	"to_member_id" text NOT NULL,
	"payout_type" text DEFAULT 'money' NOT NULL,
	"amount_cents" integer,
	"payout_description" text,
	"description" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"settled_at" timestamp with time zone,
	"settled_via" text,
	"settled_note" text,
	"created_by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_item" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"list_id" text NOT NULL,
	"name" text NOT NULL,
	"quantity" text,
	"category" text,
	"note" text,
	"is_checked" boolean DEFAULT false NOT NULL,
	"checked_by_member_id" text,
	"checked_at" timestamp with time zone,
	"assigned_to_member_id" text,
	"added_by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_list" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text DEFAULT 'Groceries' NOT NULL,
	"icon" text DEFAULT 'shopping-cart' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"recurring_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snooze_request" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"assignment_id" text NOT NULL,
	"requested_by_member_id" text NOT NULL,
	"reason" text NOT NULL,
	"new_due_date" text NOT NULL,
	"new_due_time" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_member_id" text,
	"reviewed_at" timestamp with time zone,
	"denial_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swap_request" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"requester_assignment_id" text NOT NULL,
	"target_assignment_id" text,
	"requester_member_id" text NOT NULL,
	"target_member_id" text NOT NULL,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "weekly_report" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"week_start" text NOT NULL,
	"week_end" text NOT NULL,
	"report_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_suggestions" jsonb,
	"mvp_member_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_reaction" ADD CONSTRAINT "activity_reaction_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_reaction" ADD CONSTRAINT "activity_reaction_activity_id_activity_log_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activity_log"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_reaction" ADD CONSTRAINT "activity_reaction_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_verification" ADD CONSTRAINT "ai_verification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_verification" ADD CONSTRAINT "ai_verification_completion_id_completion_id_fk" FOREIGN KEY ("completion_id") REFERENCES "public"."completion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_author_member_id_member_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_comment" ADD CONSTRAINT "assignment_comment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_comment" ADD CONSTRAINT "assignment_comment_assignment_id_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_comment" ADD CONSTRAINT "assignment_comment_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_challenge" ADD CONSTRAINT "bonus_challenge_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_challenge" ADD CONSTRAINT "bonus_challenge_created_by_member_id_member_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition" ADD CONSTRAINT "competition_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition" ADD CONSTRAINT "competition_challenger_member_id_member_id_fk" FOREIGN KEY ("challenger_member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition" ADD CONSTRAINT "competition_opponent_member_id_member_id_fk" FOREIGN KEY ("opponent_member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition" ADD CONSTRAINT "competition_chore_id_chore_id_fk" FOREIGN KEY ("chore_id") REFERENCES "public"."chore"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition" ADD CONSTRAINT "competition_winner_member_id_member_id_fk" FOREIGN KEY ("winner_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_badge" ADD CONSTRAINT "custom_badge_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_badge" ADD CONSTRAINT "custom_badge_criteria_category_id_chore_category_id_fk" FOREIGN KEY ("criteria_category_id") REFERENCES "public"."chore_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_badge" ADD CONSTRAINT "custom_badge_created_by_member_id_member_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_badge_award" ADD CONSTRAINT "custom_badge_award_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_badge_award" ADD CONSTRAINT "custom_badge_award_badge_id_custom_badge_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."custom_badge"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_badge_award" ADD CONSTRAINT "custom_badge_award_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_badge_award" ADD CONSTRAINT "custom_badge_award_awarded_by_member_id_member_id_fk" FOREIGN KEY ("awarded_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_created_by_member_id_member_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contribution" ADD CONSTRAINT "goal_contribution_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contribution" ADD CONSTRAINT "goal_contribution_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contribution" ADD CONSTRAINT "goal_contribution_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_milestone" ADD CONSTRAINT "household_milestone_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_poll" ADD CONSTRAINT "household_poll_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_poll" ADD CONSTRAINT "household_poll_created_by_member_id_member_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_entry" ADD CONSTRAINT "meal_plan_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_entry" ADD CONSTRAINT "meal_plan_entry_added_by_member_id_member_id_fk" FOREIGN KEY ("added_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_gift" ADD CONSTRAINT "point_gift_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_gift" ADD CONSTRAINT "point_gift_from_member_id_member_id_fk" FOREIGN KEY ("from_member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_gift" ADD CONSTRAINT "point_gift_to_member_id_member_id_fk" FOREIGN KEY ("to_member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_vote" ADD CONSTRAINT "poll_vote_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_vote" ADD CONSTRAINT "poll_vote_poll_id_household_poll_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."household_poll"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_vote" ADD CONSTRAINT "poll_vote_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_task" ADD CONSTRAINT "quick_task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_task" ADD CONSTRAINT "quick_task_assigned_to_member_id_member_id_fk" FOREIGN KEY ("assigned_to_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_task" ADD CONSTRAINT "quick_task_completed_by_member_id_member_id_fk" FOREIGN KEY ("completed_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quick_task" ADD CONSTRAINT "quick_task_created_by_member_id_member_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward" ADD CONSTRAINT "reward_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward" ADD CONSTRAINT "reward_created_by_member_id_member_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_redemption" ADD CONSTRAINT "reward_redemption_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_redemption" ADD CONSTRAINT "reward_redemption_reward_id_reward_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."reward"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_redemption" ADD CONSTRAINT "reward_redemption_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_redemption" ADD CONSTRAINT "reward_redemption_approved_by_member_id_member_id_fk" FOREIGN KEY ("approved_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_from_member_id_member_id_fk" FOREIGN KEY ("from_member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_to_member_id_member_id_fk" FOREIGN KEY ("to_member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_created_by_member_id_member_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_item" ADD CONSTRAINT "shopping_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_item" ADD CONSTRAINT "shopping_item_list_id_shopping_list_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."shopping_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_item" ADD CONSTRAINT "shopping_item_checked_by_member_id_member_id_fk" FOREIGN KEY ("checked_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_item" ADD CONSTRAINT "shopping_item_assigned_to_member_id_member_id_fk" FOREIGN KEY ("assigned_to_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_item" ADD CONSTRAINT "shopping_item_added_by_member_id_member_id_fk" FOREIGN KEY ("added_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list" ADD CONSTRAINT "shopping_list_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list" ADD CONSTRAINT "shopping_list_created_by_member_id_member_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snooze_request" ADD CONSTRAINT "snooze_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snooze_request" ADD CONSTRAINT "snooze_request_assignment_id_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snooze_request" ADD CONSTRAINT "snooze_request_requested_by_member_id_member_id_fk" FOREIGN KEY ("requested_by_member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snooze_request" ADD CONSTRAINT "snooze_request_reviewed_by_member_id_member_id_fk" FOREIGN KEY ("reviewed_by_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_request" ADD CONSTRAINT "swap_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_request" ADD CONSTRAINT "swap_request_requester_assignment_id_assignment_id_fk" FOREIGN KEY ("requester_assignment_id") REFERENCES "public"."assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_request" ADD CONSTRAINT "swap_request_target_assignment_id_assignment_id_fk" FOREIGN KEY ("target_assignment_id") REFERENCES "public"."assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_request" ADD CONSTRAINT "swap_request_requester_member_id_member_id_fk" FOREIGN KEY ("requester_member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swap_request" ADD CONSTRAINT "swap_request_target_member_id_member_id_fk" FOREIGN KEY ("target_member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_report" ADD CONSTRAINT "weekly_report_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_report" ADD CONSTRAINT "weekly_report_mvp_member_id_member_id_fk" FOREIGN KEY ("mvp_member_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_reaction_unique_idx" ON "activity_reaction" USING btree ("activity_id","member_id","emoji");--> statement-breakpoint
CREATE INDEX "ai_verification_completion_idx" ON "ai_verification" USING btree ("completion_id");--> statement-breakpoint
CREATE INDEX "ai_verification_org_idx" ON "ai_verification" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "announcement_org_idx" ON "announcement" USING btree ("organization_id","pinned");--> statement-breakpoint
CREATE INDEX "assignment_comment_idx" ON "assignment_comment" USING btree ("assignment_id","created_at");--> statement-breakpoint
CREATE INDEX "bonus_challenge_org_idx" ON "bonus_challenge" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "competition_org_idx" ON "competition" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "custom_badge_org_idx" ON "custom_badge" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_badge_award_unique_idx" ON "custom_badge_award" USING btree ("badge_id","member_id");--> statement-breakpoint
CREATE INDEX "goal_org_idx" ON "goal" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "goal_member_idx" ON "goal" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "goal_contribution_goal_idx" ON "goal_contribution" USING btree ("goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "household_milestone_unique_idx" ON "household_milestone" USING btree ("organization_id","milestone_key");--> statement-breakpoint
CREATE INDEX "household_poll_org_idx" ON "household_poll" USING btree ("organization_id","is_closed");--> statement-breakpoint
CREATE INDEX "meal_plan_entry_org_date_idx" ON "meal_plan_entry" USING btree ("organization_id","date");--> statement-breakpoint
CREATE INDEX "point_gift_org_idx" ON "point_gift" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "poll_vote_unique_idx" ON "poll_vote" USING btree ("poll_id","member_id","option_id");--> statement-breakpoint
CREATE INDEX "poll_vote_poll_idx" ON "poll_vote" USING btree ("poll_id");--> statement-breakpoint
CREATE INDEX "quick_task_org_idx" ON "quick_task" USING btree ("organization_id","is_completed");--> statement-breakpoint
CREATE INDEX "reward_org_idx" ON "reward" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE INDEX "reward_redemption_org_idx" ON "reward_redemption" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "reward_redemption_member_idx" ON "reward_redemption" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "settlement_org_idx" ON "settlement" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "shopping_item_list_idx" ON "shopping_item" USING btree ("list_id","is_checked");--> statement-breakpoint
CREATE INDEX "shopping_list_org_idx" ON "shopping_list" USING btree ("organization_id","is_archived");--> statement-breakpoint
CREATE INDEX "snooze_request_assignment_idx" ON "snooze_request" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "snooze_request_org_idx" ON "snooze_request" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "swap_request_org_idx" ON "swap_request" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_report_unique_idx" ON "weekly_report" USING btree ("organization_id","week_start");