CREATE TABLE "api_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"user_id" text,
	"provider" text NOT NULL,
	"feature" text NOT NULL,
	"operation" text,
	"input_units" integer,
	"output_units" integer,
	"unit_kind" text,
	"cost_micro_usd" integer,
	"ok" boolean DEFAULT true NOT NULL,
	"error_code" text,
	"latency_ms" integer,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_usage_org_idx" ON "api_usage" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "api_usage_feature_idx" ON "api_usage" USING btree ("feature","created_at");--> statement-breakpoint
CREATE INDEX "api_usage_provider_idx" ON "api_usage" USING btree ("provider","created_at");