CREATE TABLE "lead_wake_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"step_name" text,
	"reason" text,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"seen_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"chat_id" uuid,
	"turn_id" uuid,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_wake_events_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "lead_wake_events_kind_check" CHECK ("lead_wake_events"."kind" in ('escalated', 'blocked', 'turn_ended', 'done', 'signoff_waiting')),
	CONSTRAINT "lead_wake_events_outcome_check" CHECK ("lead_wake_events"."outcome" in ('pending', 'woke', 'capped', 'unreachable', 'dropped')),
	CONSTRAINT "lead_wake_events_step_name_check" CHECK (char_length("lead_wake_events"."step_name") between 1 and 60),
	CONSTRAINT "lead_wake_events_reason_check" CHECK (char_length("lead_wake_events"."reason") <= 300),
	CONSTRAINT "lead_wake_events_detail_check" CHECK (char_length("lead_wake_events"."detail") between 1 and 2000),
	CONSTRAINT "lead_wake_events_delivered_check" CHECK (("lead_wake_events"."outcome" = 'pending') = ("lead_wake_events"."delivered_at" is null)),
	CONSTRAINT "lead_wake_events_woke_check" CHECK (("lead_wake_events"."outcome" = 'woke') = ("lead_wake_events"."turn_id" is not null) and ("lead_wake_events"."turn_id" is null) = ("lead_wake_events"."chat_id" is null))
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE "chat_turns" ADD COLUMN "system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "flow_id" uuid;--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "wake_escalated" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "wake_blocked" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "wake_turn_ended" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "wake_done" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "wake_signoff_hours" integer;--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "wake_window_seconds" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "wake_max_per_hour" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "flows" ADD COLUMN "wake_max_per_day" integer DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_wake_events" ADD CONSTRAINT "lead_wake_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_wake_events" ADD CONSTRAINT "lead_wake_events_flow_fk" FOREIGN KEY ("company_id","flow_id") REFERENCES "public"."flows"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_wake_events" ADD CONSTRAINT "lead_wake_events_task_fk" FOREIGN KEY ("company_id","task_id") REFERENCES "public"."tasks"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_wake_events" ADD CONSTRAINT "lead_wake_events_chat_fk" FOREIGN KEY ("company_id","chat_id") REFERENCES "public"."chats"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_wake_events_pending_idx" ON "lead_wake_events" USING btree ("seen_at") WHERE "lead_wake_events"."outcome" = 'pending';--> statement-breakpoint
CREATE INDEX "lead_wake_events_flow_idx" ON "lead_wake_events" USING btree ("company_id","flow_id","delivered_at");--> statement-breakpoint
CREATE INDEX "lead_wake_events_task_idx" ON "lead_wake_events" USING btree ("company_id","task_id","id");--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_flow_fk" FOREIGN KEY ("company_id","flow_id") REFERENCES "public"."flows"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chats_flow_idx" ON "chats" USING btree ("company_id","flow_id","created_at");--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_flow_check" CHECK ("chats"."flow_id" is null or "chats"."task_id" is null);--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_wake_signoff_hours_check" CHECK ("flows"."wake_signoff_hours" is null or "flows"."wake_signoff_hours" between 1 and 168);--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_wake_window_check" CHECK ("flows"."wake_window_seconds" between 0 and 600);--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_wake_per_hour_check" CHECK ("flows"."wake_max_per_hour" between 1 and 60);--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_wake_per_day_check" CHECK ("flows"."wake_max_per_day" between 1 and 500);--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("notifications"."kind" in ('manager_changed', 'report_added', 'report_removed', 'role_changed', 'membership_suspended', 'membership_reactivated', 'membership_removed', 'agent_paused', 'agent_resumed', 'agent_archived', 'invitation_accepted', 'task_at_step', 'task_signoff', 'task_escalated', 'task_done', 'task_turn_ended', 'task_blocked', 'agent_question', 'lead_not_woken'));