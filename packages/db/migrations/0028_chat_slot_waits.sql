ALTER TABLE "chat_turns" ADD COLUMN "machine_wait" text;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_machine_wait_check" CHECK ("chat_turns"."machine_wait" in ('stopped', 'slots'));--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_machine_wait_at_check" CHECK ("chat_turns"."machine_wait" is null or "chat_turns"."machine_wait_at" is not null);--> statement-breakpoint
-- custom: the data step, which drizzle-kit does not write. Until now a turn waited for its machine only while the
-- machine started (`machine_wait_at`); now it also waits for a free slot, and `machine_wait` says which. Every turn
-- that waited before this migration waited for its stopped machine.
UPDATE "chat_turns" SET "machine_wait" = 'stopped' WHERE "machine_wait_at" IS NOT NULL;
