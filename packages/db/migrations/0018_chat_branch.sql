ALTER TABLE "chats" ADD COLUMN "branched_from_chat_id" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "branched_from_turn_id" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "fork_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_branched_from_chat_fk" FOREIGN KEY ("company_id","branched_from_chat_id") REFERENCES "public"."chats"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_branched_from_turn_fk" FOREIGN KEY ("company_id","branched_from_turn_id") REFERENCES "public"."chat_turns"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chats_branched_from_idx" ON "chats" USING btree ("company_id","branched_from_chat_id");--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_branch_check" CHECK ("chats"."branched_from_turn_id" is null or "chats"."branched_from_chat_id" is not null);--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_fork_pending_check" CHECK (not "chats"."fork_pending" or "chats"."session_id" is not null);
--> statement-breakpoint
-- custom: the branch's two foreign keys set only their own column to null when the parent chat or turn goes. drizzle-kit
-- writes a composite key's ON DELETE for all its columns, and SET NULL on ("company_id", …) would null the tenant
-- column, which is not null; Postgres 15+ takes the column list (`ON DELETE SET NULL (column)`), so the keys drizzle-kit
-- wrote above are made again with it, under the same names.
ALTER TABLE "chats" DROP CONSTRAINT "chats_branched_from_chat_fk";--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_branched_from_chat_fk" FOREIGN KEY ("company_id","branched_from_chat_id") REFERENCES "public"."chats"("company_id","id") ON DELETE SET NULL ("branched_from_chat_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" DROP CONSTRAINT "chats_branched_from_turn_fk";--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_branched_from_turn_fk" FOREIGN KEY ("company_id","branched_from_turn_id") REFERENCES "public"."chat_turns"("company_id","id") ON DELETE SET NULL ("branched_from_turn_id") ON UPDATE no action;
