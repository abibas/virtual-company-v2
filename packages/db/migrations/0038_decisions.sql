CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"task_id" uuid,
	"contact_id" uuid,
	"what" text NOT NULL,
	"why" text NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome" text,
	"event_seq" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "decisions_what_check" CHECK (char_length("decisions"."what") between 1 and 200),
	CONSTRAINT "decisions_why_check" CHECK (char_length("decisions"."why") between 1 and 1000),
	CONSTRAINT "decisions_sources_check" CHECK (jsonb_typeof("decisions"."sources") = 'array' and jsonb_array_length("decisions"."sources") <= 20),
	CONSTRAINT "decisions_outcome_check" CHECK ("decisions"."outcome" in ('approved', 'rejected', 'done', 'declined', 'deferred', 'other')),
	CONSTRAINT "decisions_event_seq_check" CHECK ("decisions"."event_seq" is null or "decisions"."event_seq" >= 0)
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_agent_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_chat_fk" FOREIGN KEY ("company_id","chat_id") REFERENCES "public"."chats"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_turn_fk" FOREIGN KEY ("company_id","turn_id") REFERENCES "public"."chat_turns"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_task_fk" FOREIGN KEY ("company_id","task_id") REFERENCES "public"."tasks"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_agent_idx" ON "decisions" USING btree ("company_id","agent_id","created_at");--> statement-breakpoint
CREATE INDEX "decisions_chat_idx" ON "decisions" USING btree ("company_id","chat_id","created_at");--> statement-breakpoint
CREATE INDEX "decisions_task_idx" ON "decisions" USING btree ("company_id","task_id","created_at");--> statement-breakpoint
CREATE INDEX "decisions_contact_idx" ON "decisions" USING btree ("company_id","contact_id","created_at");