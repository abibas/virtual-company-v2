CREATE TABLE "flow_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"assignee_principal_id" uuid NOT NULL,
	"starts" text DEFAULT 'manual' NOT NULL,
	"on_return" text DEFAULT 'keep' NOT NULL,
	"sends_back_to_step_id" uuid,
	"send_back_limit" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flow_steps_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "flow_steps_position_unique" UNIQUE("company_id","flow_id","position"),
	CONSTRAINT "flow_steps_kind_check" CHECK ("flow_steps"."kind" in ('work', 'check', 'signoff')),
	CONSTRAINT "flow_steps_starts_check" CHECK ("flow_steps"."starts" in ('auto', 'manual')),
	CONSTRAINT "flow_steps_on_return_check" CHECK ("flow_steps"."on_return" in ('keep', 'fresh')),
	CONSTRAINT "flow_steps_position_check" CHECK ("flow_steps"."position" >= 1),
	CONSTRAINT "flow_steps_name_check" CHECK (char_length("flow_steps"."name") between 1 and 60),
	CONSTRAINT "flow_steps_send_back_check" CHECK ("flow_steps"."sends_back_to_step_id" is null or ("flow_steps"."kind" <> 'work' and "flow_steps"."sends_back_to_step_id" <> "flow_steps"."id")),
	CONSTRAINT "flow_steps_limit_check" CHECK ("flow_steps"."send_back_limit" is null or ("flow_steps"."kind" <> 'work' and "flow_steps"."send_back_limit" between 1 and 99))
);
--> statement-breakpoint
CREATE TABLE "flows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"lead_principal_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flows_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "flows_lead_unique" UNIQUE("company_id","lead_principal_id"),
	CONSTRAINT "flows_name_check" CHECK (char_length("flows"."name") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_principal_id" uuid,
	"from_step_id" uuid,
	"from_step_name" text,
	"to_step_id" uuid,
	"to_step_name" text,
	"round" integer,
	"reason" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_events_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "task_events_kind_check" CHECK ("task_events"."kind" in ('created', 'entered', 'started', 'handed_on', 'passed', 'sent_back', 'escalated', 'signed_off', 'routed', 'retried', 'done', 'cancelled', 'edited')),
	CONSTRAINT "task_events_round_check" CHECK ("task_events"."round" >= 1),
	CONSTRAINT "task_events_reason_check" CHECK (char_length("task_events"."reason") between 1 and 2000),
	CONSTRAINT "task_events_details_check" CHECK (jsonb_typeof("task_events"."details") = 'object')
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"flow_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"current_step_id" uuid,
	"step_state" text,
	"rounds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"escalation_reason" text,
	"escalation_target_step_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "tasks_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "tasks_number_unique" UNIQUE("company_id","number"),
	CONSTRAINT "tasks_number_check" CHECK ("tasks"."number" >= 1),
	CONSTRAINT "tasks_title_check" CHECK (char_length("tasks"."title") between 1 and 200),
	CONSTRAINT "tasks_description_check" CHECK (char_length("tasks"."description") <= 50000),
	CONSTRAINT "tasks_priority_check" CHECK ("tasks"."priority" in ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "tasks_state_check" CHECK ("tasks"."state" in ('queued', 'active', 'escalated', 'done', 'cancelled')),
	CONSTRAINT "tasks_step_state_check" CHECK ("tasks"."step_state" in ('waiting', 'working', 'needs_person', 'blocked', 'ended_without_handoff')),
	CONSTRAINT "tasks_rounds_check" CHECK (jsonb_typeof("tasks"."rounds") = 'object'),
	CONSTRAINT "tasks_step_check" CHECK (("tasks"."state" in ('active', 'escalated')) = ("tasks"."current_step_id" is not null)),
	CONSTRAINT "tasks_step_state_presence_check" CHECK (("tasks"."state" = 'active') = ("tasks"."step_state" is not null)),
	CONSTRAINT "tasks_escalation_check" CHECK (("tasks"."state" = 'escalated') = ("tasks"."escalation_reason" is not null) and ("tasks"."escalation_target_step_id" is null or "tasks"."state" = 'escalated')),
	CONSTRAINT "tasks_escalation_reason_check" CHECK (char_length("tasks"."escalation_reason") between 1 and 2000),
	CONSTRAINT "tasks_closed_check" CHECK (("tasks"."state" in ('done', 'cancelled')) = ("tasks"."closed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE "flow_steps" ADD CONSTRAINT "flow_steps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_steps" ADD CONSTRAINT "flow_steps_flow_fk" FOREIGN KEY ("company_id","flow_id") REFERENCES "public"."flows"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_steps" ADD CONSTRAINT "flow_steps_assignee_fk" FOREIGN KEY ("company_id","assignee_principal_id") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow_steps" ADD CONSTRAINT "flow_steps_sends_back_to_fk" FOREIGN KEY ("company_id","sends_back_to_step_id") REFERENCES "public"."flow_steps"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_lead_fk" FOREIGN KEY ("company_id","lead_principal_id") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flows" ADD CONSTRAINT "flows_created_by_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_fk" FOREIGN KEY ("company_id","task_id") REFERENCES "public"."tasks"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_actor_fk" FOREIGN KEY ("company_id","actor_principal_id") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_flow_fk" FOREIGN KEY ("company_id","flow_id") REFERENCES "public"."flows"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_current_step_fk" FOREIGN KEY ("company_id","current_step_id") REFERENCES "public"."flow_steps"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_escalation_target_fk" FOREIGN KEY ("company_id","escalation_target_step_id") REFERENCES "public"."flow_steps"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flow_steps_assignee_idx" ON "flow_steps" USING btree ("company_id","assignee_principal_id");--> statement-breakpoint
CREATE INDEX "task_events_task_idx" ON "task_events" USING btree ("company_id","task_id","id");--> statement-breakpoint
CREATE INDEX "tasks_flow_state_idx" ON "tasks" USING btree ("company_id","flow_id","state");--> statement-breakpoint
CREATE INDEX "tasks_current_step_idx" ON "tasks" USING btree ("company_id","current_step_id");--> statement-breakpoint
CREATE INDEX "tasks_escalation_target_idx" ON "tasks" USING btree ("company_id","escalation_target_step_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("notifications"."kind" in ('manager_changed', 'report_added', 'report_removed', 'role_changed', 'membership_suspended', 'membership_reactivated', 'membership_removed', 'agent_paused', 'agent_resumed', 'agent_archived', 'invitation_accepted', 'task_at_step', 'task_signoff', 'task_escalated', 'task_done'));