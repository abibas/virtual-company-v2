CREATE TABLE "chat_participants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"principal_id" uuid,
	"contact_id" uuid,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_participants_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "chat_participants_principal_unique" UNIQUE("company_id","chat_id","principal_id"),
	CONSTRAINT "chat_participants_contact_unique" UNIQUE("company_id","chat_id","contact_id"),
	CONSTRAINT "chat_participants_who_check" CHECK (("chat_participants"."principal_id" is null) <> ("chat_participants"."contact_id" is null))
);
--> statement-breakpoint
ALTER TABLE "chat_turns" DROP CONSTRAINT "chat_turns_visible_text_check";--> statement-breakpoint
ALTER TABLE "chat_turns" DROP CONSTRAINT "chat_turns_kind_check";--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_chat_fk" FOREIGN KEY ("company_id","chat_id") REFERENCES "public"."chats"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_principal_fk" FOREIGN KEY ("company_id","principal_id") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_contact_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "public"."contacts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_added_by_fk" FOREIGN KEY ("company_id","added_by") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_participants_principal_idx" ON "chat_participants" USING btree ("company_id","principal_id");--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_note_check" CHECK ("chat_turns"."kind" not in ('people', 'slack') or ("chat_turns"."status" = 'done' and "chat_turns"."credential_id" is null));--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_visible_text_check" CHECK ("chat_turns"."visible_text" is null or ("chat_turns"."kind" = 'message' and char_length("chat_turns"."visible_text") <= 20000));--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_kind_check" CHECK ("chat_turns"."kind" in ('message', 'compact', 'clear', 'people', 'slack'));--> statement-breakpoint
-- custom: the data steps, which drizzle-kit does not write (docs/harness.md "Who is in a chat"). They fill who is in
-- each message chat so far (neither a task's conversation nor a flow's team chat), as Most Wanted (`added_by` null),
-- added when the chat began. First, its creator, when a person made it (a Slack conversation's chat was made by Most
-- Wanted, its creator the agent).
INSERT INTO "chat_participants" ("id", "company_id", "chat_id", "principal_id", "added_at")
SELECT gen_random_uuid(), "c"."company_id", "c"."id", "c"."created_by", "c"."created_at"
FROM "chats" "c"
JOIN "principals" "p" ON "p"."company_id" = "c"."company_id" AND "p"."id" = "c"."created_by"
WHERE "c"."task_id" IS NULL AND "c"."flow_id" IS NULL AND "p"."kind" = 'person';
--> statement-breakpoint
-- custom: second, a Slack conversation's chat: the contact who started it and every contact whose message is one of its
-- turns (a channel's thread may have several), then the Slack connection's owner (the bot sign-in's owner, by their
-- membership of the chat's company), unless already in.
INSERT INTO "chat_participants" ("id", "company_id", "chat_id", "contact_id", "added_at")
SELECT gen_random_uuid(), "x"."company_id", "x"."chat_id", "x"."contact_id", min("x"."at")
FROM (
	SELECT "s"."company_id", "s"."chat_id", "s"."contact_id", "s"."created_at" AS "at"
	FROM "slack_threads" "s" WHERE "s"."contact_id" IS NOT NULL
	UNION ALL
	SELECT "t"."company_id", "t"."chat_id", "t"."contact_id", "t"."created_at" AS "at"
	FROM "chat_turns" "t" WHERE "t"."contact_id" IS NOT NULL
) "x"
JOIN "chats" "c" ON "c"."company_id" = "x"."company_id" AND "c"."id" = "x"."chat_id"
WHERE "c"."task_id" IS NULL AND "c"."flow_id" IS NULL
GROUP BY "x"."company_id", "x"."chat_id", "x"."contact_id";
--> statement-breakpoint
INSERT INTO "chat_participants" ("id", "company_id", "chat_id", "principal_id", "added_at")
SELECT gen_random_uuid(), "s"."company_id", "s"."chat_id", "m"."principal_id", "s"."created_at"
FROM "slack_threads" "s"
JOIN "credentials" "k" ON "k"."id" = "s"."credential_id"
JOIN "memberships" "m" ON "m"."company_id" = "s"."company_id" AND "m"."user_id" = "k"."owner_user_id"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- custom: last, a message chat with no member in it yet (a Slack conversation's chat whose sign-in or owner is gone, or
-- one its Slack row no longer names) gets the agent's manager: the principal its place on the chart reports to, when
-- that is a person of the company; else every active owner of the company, so somebody can still open it.
INSERT INTO "chat_participants" ("id", "company_id", "chat_id", "principal_id", "added_at")
SELECT gen_random_uuid(), "c"."company_id", "c"."id", coalesce("boss"."principal_id", "o"."principal_id"), "c"."created_at"
FROM "chats" "c"
JOIN "agents" "a" ON "a"."company_id" = "c"."company_id" AND "a"."id" = "c"."agent_id"
LEFT JOIN LATERAL (
	SELECT "m"."principal_id" FROM "org_positions" "op"
	JOIN "memberships" "m" ON "m"."company_id" = "op"."company_id" AND "m"."principal_id" = "op"."reports_to_principal_id"
	WHERE "op"."company_id" = "a"."company_id" AND "op"."principal_id" = "a"."principal_id"
) "boss" ON true
LEFT JOIN "memberships" "o" ON "boss"."principal_id" IS NULL AND "o"."company_id" = "c"."company_id"
	AND "o"."role" = 'owner' AND "o"."status" = 'active'
WHERE "c"."task_id" IS NULL AND "c"."flow_id" IS NULL
	AND coalesce("boss"."principal_id", "o"."principal_id") IS NOT NULL
	AND NOT EXISTS (
		SELECT 1 FROM "chat_participants" "cp"
		WHERE "cp"."company_id" = "c"."company_id" AND "cp"."chat_id" = "c"."id" AND "cp"."principal_id" IS NOT NULL
	);
