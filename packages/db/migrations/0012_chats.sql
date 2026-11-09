CREATE TABLE "chat_events" (
	"company_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"event" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_events_company_id_turn_id_seq_pk" PRIMARY KEY("company_id","turn_id","seq"),
	CONSTRAINT "chat_events_seq_check" CHECK ("chat_events"."seq" >= 1),
	CONSTRAINT "chat_events_event_check" CHECK (jsonb_typeof("chat_events"."event") = 'object')
);
--> statement-breakpoint
CREATE TABLE "chat_turns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"prompt" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"profile_id" uuid,
	"credential_id" uuid,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"result_text" text,
	"error" text,
	"usage" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_turns_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "chat_turns_chat_seq_unique" UNIQUE("company_id","chat_id","seq"),
	CONSTRAINT "chat_turns_status_check" CHECK ("chat_turns"."status" in ('queued', 'running', 'done', 'failed', 'stopped')),
	CONSTRAINT "chat_turns_seq_check" CHECK ("chat_turns"."seq" >= 1),
	CONSTRAINT "chat_turns_prompt_check" CHECK (char_length("chat_turns"."prompt") between 1 and 20000),
	CONSTRAINT "chat_turns_usage_check" CHECK ("chat_turns"."usage" is null or jsonb_typeof("chat_turns"."usage") = 'object')
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"harness" text NOT NULL,
	"machine_id" uuid NOT NULL,
	"profile_id" uuid,
	"profile_set_by" uuid,
	"session_id" text,
	"title" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "chats_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "chats_harness_check" CHECK ("chats"."harness" in ('claude_code', 'codex')),
	CONSTRAINT "chats_title_check" CHECK (char_length("chats"."title") between 1 and 80),
	CONSTRAINT "chats_session_id_check" CHECK (char_length("chats"."session_id") between 1 and 200),
	CONSTRAINT "chats_profile_set_by_check" CHECK ("chats"."profile_id" is null or "chats"."profile_set_by" is not null)
);
--> statement-breakpoint
ALTER TABLE "credential_uses" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "credential_uses" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "credential_uses" ADD COLUMN "chat_id" uuid;--> statement-breakpoint
ALTER TABLE "credential_uses" ADD COLUMN "principal_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_events" ADD CONSTRAINT "chat_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_events" ADD CONSTRAINT "chat_events_turn_fk" FOREIGN KEY ("company_id","turn_id") REFERENCES "public"."chat_turns"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_chat_fk" FOREIGN KEY ("company_id","chat_id") REFERENCES "public"."chats"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_created_by_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_profile_id_access_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."access_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_profile_set_by_users_id_fk" FOREIGN KEY ("profile_set_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_agent_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_machine_fk" FOREIGN KEY ("company_id","machine_id") REFERENCES "public"."machines"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_created_by_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_turns_one_live_idx" ON "chat_turns" USING btree ("company_id","chat_id") WHERE "chat_turns"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "chat_turns_status_idx" ON "chat_turns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "chats_agent_idx" ON "chats" USING btree ("company_id","agent_id","updated_at");--> statement-breakpoint
CREATE INDEX "chats_profile_idx" ON "chats" USING btree ("profile_id");--> statement-breakpoint
ALTER TABLE "credential_uses" ADD CONSTRAINT "credential_uses_company_check" CHECK ("credential_uses"."company_id" is not null or ("credential_uses"."agent_id" is null and "credential_uses"."chat_id" is null and "credential_uses"."principal_id" is null));