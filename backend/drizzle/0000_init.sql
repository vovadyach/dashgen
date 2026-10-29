CREATE TABLE "metrics" (
	"name" text PRIMARY KEY NOT NULL,
	"unit" text NOT NULL,
	"rollup" text NOT NULL,
	CONSTRAINT "metrics_rollup_check" CHECK ("metrics"."rollup" in ('sum', 'avg'))
);
--> statement-breakpoint
CREATE TABLE "points" (
	"metric" text NOT NULL,
	"service" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"value" double precision NOT NULL,
	CONSTRAINT "points_metric_service_recorded_at_pk" PRIMARY KEY("metric","service","recorded_at")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"name" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"question" text NOT NULL,
	"outcome" text NOT NULL,
	"error_code" text,
	"chart" jsonb,
	"steps" jsonb NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd" numeric(10, 6) NOT NULL,
	"latency_ms" integer NOT NULL,
	CONSTRAINT "runs_outcome_check" CHECK ("runs"."outcome" in ('chart', 'clarify', 'decline', 'error'))
);
--> statement-breakpoint
ALTER TABLE "points" ADD CONSTRAINT "points_metric_metrics_name_fk" FOREIGN KEY ("metric") REFERENCES "public"."metrics"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points" ADD CONSTRAINT "points_service_services_name_fk" FOREIGN KEY ("service") REFERENCES "public"."services"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_created_at_idx" ON "runs" USING btree ("created_at");