DROP INDEX "chat_turns_one_live_idx";--> statement-breakpoint
ALTER TABLE "chat_turns" ADD COLUMN "delivery" text;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_turns_one_running_idx" ON "chat_turns" USING btree ("company_id","chat_id") WHERE "chat_turns"."status" = 'running';--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_delivery_check" CHECK ("chat_turns"."delivery" in ('now', 'after', 'interrupt'));