ALTER TABLE "flows" ADD COLUMN "auto_take" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "in_progress_limit" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_in_progress_limit_check" CHECK ("flows"."in_progress_limit" between 1 and 20);--> statement-breakpoint
-- T-25: auto-take on, 2 at a time, for the "Company self improvements" flow (a no-op where it does not exist).
UPDATE "flows" SET "auto_take" = true, "in_progress_limit" = 2 WHERE "id" = '01a1db81-8891-704b-928c-2ce54206d909';