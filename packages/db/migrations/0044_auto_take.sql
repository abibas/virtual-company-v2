ALTER TABLE "flows" ADD COLUMN "auto_take" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "in_progress_limit" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_in_progress_limit_check" CHECK ("flows"."in_progress_limit" between 1 and 20);