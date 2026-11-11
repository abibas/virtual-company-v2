CREATE TABLE "task_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"step_name" text NOT NULL,
	"round" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"content_type" text,
	"size" integer DEFAULT 0 NOT NULL,
	"sha256" text,
	"bytes" "bytea",
	"note" text,
	"chat_id" uuid,
	"turn_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_artifacts_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "task_artifacts_name_unique" UNIQUE("company_id","task_id","step_id","round","name"),
	CONSTRAINT "task_artifacts_kind_check" CHECK ("task_artifacts"."kind" in ('file', 'note', 'link', 'skipped')),
	CONSTRAINT "task_artifacts_round_check" CHECK ("task_artifacts"."round" >= 1),
	CONSTRAINT "task_artifacts_step_name_check" CHECK (char_length("task_artifacts"."step_name") between 1 and 60),
	CONSTRAINT "task_artifacts_name_check" CHECK (char_length("task_artifacts"."name") between 1 and 255),
	CONSTRAINT "task_artifacts_size_check" CHECK ("task_artifacts"."size" >= 0 and ("task_artifacts"."bytes" is null or "task_artifacts"."size" <= 2097152)),
	CONSTRAINT "task_artifacts_sha256_check" CHECK ("task_artifacts"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "task_artifacts_note_check" CHECK (char_length("task_artifacts"."note") between 1 and 2000),
	CONSTRAINT "task_artifacts_content_type_check" CHECK (char_length("task_artifacts"."content_type") between 1 and 100),
	CONSTRAINT "task_artifacts_bytes_check" CHECK (("task_artifacts"."kind" in ('file', 'note')) = ("task_artifacts"."bytes" is not null) and ("task_artifacts"."bytes" is null) = ("task_artifacts"."content_type" is null) and ("task_artifacts"."bytes" is null) = ("task_artifacts"."sha256" is null) and ("task_artifacts"."bytes" is null or octet_length("task_artifacts"."bytes") = "task_artifacts"."size")),
	CONSTRAINT "task_artifacts_note_kind_check" CHECK (("task_artifacts"."kind" in ('link', 'skipped')) = ("task_artifacts"."note" is not null))
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE "task_events" DROP CONSTRAINT "task_events_kind_check";--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "task_step_id" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "task_round" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "task_artifacts" ADD CONSTRAINT "task_artifacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifacts" ADD CONSTRAINT "task_artifacts_task_fk" FOREIGN KEY ("company_id","task_id") REFERENCES "public"."tasks"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifacts" ADD CONSTRAINT "task_artifacts_chat_fk" FOREIGN KEY ("company_id","chat_id") REFERENCES "public"."chats"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifacts" ADD CONSTRAINT "task_artifacts_turn_fk" FOREIGN KEY ("company_id","turn_id") REFERENCES "public"."chat_turns"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_artifacts" ADD CONSTRAINT "task_artifacts_created_by_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_artifacts_task_idx" ON "task_artifacts" USING btree ("company_id","task_id","id");--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_task_fk" FOREIGN KEY ("company_id","task_id") REFERENCES "public"."tasks"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chats_task_idx" ON "chats" USING btree ("company_id","task_id","task_step_id","created_at");--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_task_check" CHECK (("chats"."task_id" is null) = ("chats"."task_step_id" is null) and ("chats"."task_id" is null) = ("chats"."task_round" is null) and ("chats"."task_round" is null or "chats"."task_round" >= 1));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("notifications"."kind" in ('manager_changed', 'report_added', 'report_removed', 'role_changed', 'membership_suspended', 'membership_reactivated', 'membership_removed', 'agent_paused', 'agent_resumed', 'agent_archived', 'invitation_accepted', 'task_at_step', 'task_signoff', 'task_escalated', 'task_done', 'task_turn_ended', 'task_blocked'));--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_kind_check" CHECK ("task_events"."kind" in ('created', 'entered', 'started', 'handed_on', 'passed', 'sent_back', 'escalated', 'signed_off', 'routed', 'retried', 'done', 'cancelled', 'edited', 'blocked', 'turn_ended'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_blocked_reason_check" CHECK ("tasks"."blocked_reason" is null or ("tasks"."step_state" = 'blocked' and char_length("tasks"."blocked_reason") between 1 and 2000));