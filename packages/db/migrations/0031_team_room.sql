CREATE TABLE "room_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"author_principal_id" uuid,
	"body" text NOT NULL,
	"task_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"asked" integer,
	"chat_id" uuid,
	"turn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_messages_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "room_messages_kind_check" CHECK ("room_messages"."kind" in ('message', 'step_end', 'reply', 'notice')),
	CONSTRAINT "room_messages_author_check" CHECK (("room_messages"."kind" = 'notice') = ("room_messages"."author_principal_id" is null)),
	CONSTRAINT "room_messages_body_check" CHECK (char_length("room_messages"."body") between 1 and 20000),
	CONSTRAINT "room_messages_step_end_check" CHECK ("room_messages"."kind" <> 'step_end' or "room_messages"."task_id" is not null),
	CONSTRAINT "room_messages_asked_check" CHECK ("room_messages"."asked" is null or ("room_messages"."kind" = 'message' and "room_messages"."asked" >= 0)),
	CONSTRAINT "room_messages_details_check" CHECK (jsonb_typeof("room_messages"."details") = 'object'),
	CONSTRAINT "room_messages_turn_check" CHECK ("room_messages"."turn_id" is null or "room_messages"."chat_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "chat_turns" ADD COLUMN "room_message_id" uuid;--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "room_max_per_hour" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_flow_fk" FOREIGN KEY ("company_id","flow_id") REFERENCES "public"."flows"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_author_fk" FOREIGN KEY ("company_id","author_principal_id") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_task_fk" FOREIGN KEY ("company_id","task_id") REFERENCES "public"."tasks"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_messages_flow_idx" ON "room_messages" USING btree ("company_id","flow_id","created_at","id");--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_room_message_fk" FOREIGN KEY ("company_id","room_message_id") REFERENCES "public"."room_messages"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_room_message_check" CHECK ("chat_turns"."room_message_id" is null or "chat_turns"."system");--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_room_per_hour_check" CHECK ("flows"."room_max_per_hour" between 1 and 200);--> statement-breakpoint
-- custom: the data steps, which drizzle-kit does not write. First, each flow's team chat so far (its Lead's chat, S6c)
-- becomes the start of its team room: every message turn's prompt, by its writer (a person's message) or by Most
-- Wanted (a wake-up or a check-in it queued, a notice with its turn), and each reply that ended done, by the chat's
-- agent, at the times they were written and ended. The new rows' ids are random (the feed is read by its time, then
-- its id).
INSERT INTO "room_messages" ("id", "company_id", "flow_id", "kind", "author_principal_id", "body", "chat_id", "turn_id", "created_at")
SELECT gen_random_uuid(), "t"."company_id", "c"."flow_id",
	CASE WHEN "t"."system" THEN 'notice' ELSE 'message' END,
	CASE WHEN "t"."system" THEN NULL ELSE "t"."created_by" END,
	"t"."prompt", "c"."id", "t"."id", "t"."created_at"
FROM "chat_turns" "t"
JOIN "chats" "c" ON "c"."company_id" = "t"."company_id" AND "c"."id" = "t"."chat_id"
WHERE "c"."flow_id" IS NOT NULL AND "t"."kind" = 'message'
UNION ALL
SELECT gen_random_uuid(), "t"."company_id", "c"."flow_id", 'reply', "a"."principal_id",
	left(btrim("t"."result_text"), 20000), "c"."id", "t"."id", coalesce("t"."ended_at", "t"."started_at", "t"."created_at")
FROM "chat_turns" "t"
JOIN "chats" "c" ON "c"."company_id" = "t"."company_id" AND "c"."id" = "t"."chat_id"
JOIN "agents" "a" ON "a"."company_id" = "c"."company_id" AND "a"."id" = "c"."agent_id"
WHERE "c"."flow_id" IS NOT NULL AND "t"."kind" = 'message' AND "t"."status" = 'done'
	AND coalesce(btrim("t"."result_text"), '') <> '';
--> statement-breakpoint
-- custom: second, a task step's own prompts (a new conversation's "# T-12 · …", a continued one's "Task T-12 is back at
-- your step …" or "Continue task T-12 at your step …") were written by Most Wanted but kept as the person whose move
-- started the turn; they become Most Wanted's (`system`), still naming that person as the turn's sender.
UPDATE "chat_turns" SET "system" = true
FROM "chats"
WHERE "chats"."company_id" = "chat_turns"."company_id" AND "chats"."id" = "chat_turns"."chat_id"
	AND "chats"."task_id" IS NOT NULL AND "chat_turns"."kind" = 'message' AND NOT "chat_turns"."system"
	AND "chat_turns"."prompt" ~ '^(# T-[0-9]+ · |Task T-[0-9]+ is back at your step |Continue task T-[0-9]+ at your step )';
