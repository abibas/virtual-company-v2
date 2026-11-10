CREATE TABLE "notification_settings" (
	"company_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_company_id_principal_id_pk" PRIMARY KEY("company_id","principal_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"recipient_principal_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"email_status" text DEFAULT 'pending' NOT NULL,
	"email_queued_at" timestamp with time zone,
	"email_next_at" timestamp with time zone,
	"email_attempts" integer DEFAULT 0 NOT NULL,
	"emailed_at" timestamp with time zone,
	"email_error" text,
	CONSTRAINT "notifications_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "notifications_kind_check" CHECK ("notifications"."kind" in ('manager_changed', 'report_added', 'report_removed', 'role_changed', 'membership_suspended', 'membership_reactivated', 'membership_removed', 'agent_paused', 'agent_resumed', 'agent_archived', 'invitation_accepted')),
	CONSTRAINT "notifications_email_status_check" CHECK ("notifications"."email_status" in ('pending', 'sent', 'failed', 'skipped')),
	CONSTRAINT "notifications_payload_check" CHECK (jsonb_typeof("notifications"."payload") = 'object'),
	CONSTRAINT "notifications_email_attempts_check" CHECK ("notifications"."email_attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_principal_fk" FOREIGN KEY ("company_id","principal_id") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_fk" FOREIGN KEY ("company_id","recipient_principal_id") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_fk" FOREIGN KEY ("company_id","actor_principal_id") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("company_id","recipient_principal_id","id");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("company_id","recipient_principal_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_email_pending_idx" ON "notifications" USING btree ("company_id","recipient_principal_id") WHERE "notifications"."email_status" = 'pending';