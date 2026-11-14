CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"source" text NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"email" text,
	"title" text,
	"handle" text,
	"slack_team_id" text,
	"slack_user_id" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"note" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "contacts_slack_unique" UNIQUE("company_id","slack_team_id","slack_user_id"),
	CONSTRAINT "contacts_source_check" CHECK ("contacts"."source" in ('slack')),
	CONSTRAINT "contacts_slack_check" CHECK ("contacts"."source" <> 'slack' or ("contacts"."slack_team_id" is not null and "contacts"."slack_user_id" is not null)),
	CONSTRAINT "contacts_slack_team_check" CHECK (char_length("contacts"."slack_team_id") between 1 and 40),
	CONSTRAINT "contacts_slack_user_check" CHECK (char_length("contacts"."slack_user_id") between 1 and 40),
	CONSTRAINT "contacts_name_check" CHECK (char_length("contacts"."name") between 1 and 120),
	CONSTRAINT "contacts_avatar_check" CHECK (char_length("contacts"."avatar_url") between 1 and 500),
	CONSTRAINT "contacts_email_check" CHECK (char_length("contacts"."email") between 3 and 320),
	CONSTRAINT "contacts_title_check" CHECK (char_length("contacts"."title") between 1 and 200),
	CONSTRAINT "contacts_handle_check" CHECK (char_length("contacts"."handle") between 1 and 80),
	CONSTRAINT "contacts_note_check" CHECK (char_length("contacts"."note") between 1 and 2000),
	CONSTRAINT "contacts_seen_check" CHECK ("contacts"."last_seen_at" >= "contacts"."first_seen_at")
);
--> statement-breakpoint
ALTER TABLE "chat_turns" ADD COLUMN "sender" jsonb;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD COLUMN "visible_text" text;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD COLUMN "reply_link" text;--> statement-breakpoint
ALTER TABLE "slack_threads" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_seen_idx" ON "contacts" USING btree ("company_id","last_seen_at");--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_contact_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "public"."contacts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_contact_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "public"."contacts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_threads" ADD CONSTRAINT "slack_threads_contact_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "public"."contacts"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_turns_contact_idx" ON "chat_turns" USING btree ("company_id","contact_id","created_at");--> statement-breakpoint
CREATE INDEX "slack_threads_contact_idx" ON "slack_threads" USING btree ("company_id","contact_id");--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_sender_check" CHECK ("chat_turns"."sender" is null or ("chat_turns"."system" and jsonb_typeof("chat_turns"."sender") = 'object'));--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_contact_check" CHECK ("chat_turns"."contact_id" is null or "chat_turns"."sender" is not null);--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_visible_text_check" CHECK ("chat_turns"."visible_text" is null or ("chat_turns"."system" and char_length("chat_turns"."visible_text") <= 20000));--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_reply_link_check" CHECK (char_length("chat_turns"."reply_link") between 1 and 500);--> statement-breakpoint
-- custom: a decision keeps its row when its contact goes, the contact only let go. drizzle-kit writes a composite
-- foreign key with one ON DELETE for both columns, and SET NULL on both would null the company; Postgres 15+ sets only
-- the columns named (`ON DELETE SET NULL (contact_id)`), which drizzle-kit cannot express. Nothing deletes a contact
-- today (they are archived); this keeps a later removal from failing on its decisions.
ALTER TABLE "decisions" DROP CONSTRAINT "decisions_contact_fk";--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_contact_fk" FOREIGN KEY ("company_id","contact_id") REFERENCES "public"."contacts"("company_id","id") ON DELETE SET NULL ("contact_id") ON UPDATE no action;