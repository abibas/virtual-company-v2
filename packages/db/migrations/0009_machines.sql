CREATE TABLE "enrollment_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"machine_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_tokens_secret_hash_unique" UNIQUE("secret_hash"),
	CONSTRAINT "enrollment_tokens_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "enrollment_tokens_secret_hash_check" CHECK ("enrollment_tokens"."secret_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "enrollment_tokens_machine_check" CHECK ("enrollment_tokens"."machine_id" is null or "enrollment_tokens"."used_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "machine_power" (
	"company_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_power_pkey" PRIMARY KEY("company_id","machine_id"),
	CONSTRAINT "machine_power_policy_check" CHECK (jsonb_typeof("machine_power"."policy") = 'object'),
	CONSTRAINT "machine_power_state_check" CHECK (jsonb_typeof("machine_power"."state") = 'object')
);
--> statement-breakpoint
CREATE TABLE "machine_power_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"actor" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_power_events_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "machine_power_events_action_check" CHECK ("machine_power_events"."action" in ('started', 'stopped', 'held', 'released', 'kept', 'policy', 'timezone', 'failed')),
	CONSTRAINT "machine_power_events_reason_check" CHECK (char_length("machine_power_events"."reason") between 1 and 500),
	CONSTRAINT "machine_power_events_actor_check" CHECK ("machine_power_events"."actor" ~ '^(user:[0-9a-f-]{36}|schedule|auto|system)$')
);
--> statement-breakpoint
CREATE TABLE "machine_samples" (
	"company_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"load1" double precision NOT NULL,
	"load5" double precision NOT NULL,
	"load15" double precision NOT NULL,
	"cpus" integer NOT NULL,
	"cpu_pct" double precision NOT NULL,
	"mem_pct" double precision NOT NULL,
	"disk_used" bigint NOT NULL,
	"disk_total" bigint NOT NULL,
	"uptime_s" bigint NOT NULL,
	"live_runs" integer NOT NULL,
	CONSTRAINT "machine_samples_pkey" PRIMARY KEY("company_id","machine_id","at"),
	CONSTRAINT "machine_samples_cpus_check" CHECK ("machine_samples"."cpus" >= 1)
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text DEFAULT 'none' NOT NULL,
	"provider_ref" jsonb,
	"controller_machine_id" uuid,
	"os" text NOT NULL,
	"arch" text NOT NULL,
	"hostname" text NOT NULL,
	"unix_user" text NOT NULL,
	"runner_version" text NOT NULL,
	"claude_version" text,
	"slots" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"hourly_cost" numeric(10, 4),
	"hold_until" timestamp with time zone,
	"hold_source" text,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machines_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "machines_name_check" CHECK (char_length("machines"."name") between 1 and 80),
	CONSTRAINT "machines_kind_check" CHECK ("machines"."kind" in ('laptop', 'vm', 'container')),
	CONSTRAINT "machines_provider_check" CHECK ("machines"."provider" in ('none', 'airia_devbox')),
	CONSTRAINT "machines_status_check" CHECK ("machines"."status" in ('online', 'offline', 'draining')),
	CONSTRAINT "machines_hold_source_check" CHECK ("machines"."hold_source" in ('server', 'live_runs')),
	CONSTRAINT "machines_provider_ref_check" CHECK (jsonb_typeof("machines"."provider_ref") = 'object'),
	CONSTRAINT "machines_slots_check" CHECK ("machines"."slots" between 0 and 64),
	CONSTRAINT "machines_hourly_cost_check" CHECK ("machines"."hourly_cost" >= 0),
	CONSTRAINT "machines_controller_check" CHECK ("machines"."controller_machine_id" <> "machines"."id")
);
--> statement-breakpoint
CREATE TABLE "runner_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"version" text NOT NULL,
	"remote_ip" text,
	CONSTRAINT "runner_sessions_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "runner_sessions_span_check" CHECK ("runner_sessions"."disconnected_at" >= "runner_sessions"."connected_at")
);
--> statement-breakpoint
ALTER TABLE "enrollment_tokens" ADD CONSTRAINT "enrollment_tokens_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_tokens" ADD CONSTRAINT "enrollment_tokens_created_by_fk" FOREIGN KEY ("company_id","created_by") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_tokens" ADD CONSTRAINT "enrollment_tokens_machine_fk" FOREIGN KEY ("company_id","machine_id") REFERENCES "public"."machines"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_power" ADD CONSTRAINT "machine_power_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_power" ADD CONSTRAINT "machine_power_machine_fk" FOREIGN KEY ("company_id","machine_id") REFERENCES "public"."machines"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_power" ADD CONSTRAINT "machine_power_updated_by_fk" FOREIGN KEY ("company_id","updated_by") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_power_events" ADD CONSTRAINT "machine_power_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_power_events" ADD CONSTRAINT "machine_power_events_machine_fk" FOREIGN KEY ("company_id","machine_id") REFERENCES "public"."machines"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_samples" ADD CONSTRAINT "machine_samples_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_samples" ADD CONSTRAINT "machine_samples_machine_fk" FOREIGN KEY ("company_id","machine_id") REFERENCES "public"."machines"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_controller_fk" FOREIGN KEY ("company_id","controller_machine_id") REFERENCES "public"."machines"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_sessions" ADD CONSTRAINT "runner_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_sessions" ADD CONSTRAINT "runner_sessions_machine_fk" FOREIGN KEY ("company_id","machine_id") REFERENCES "public"."machines"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "machine_power_events_machine_idx" ON "machine_power_events" USING btree ("company_id","machine_id","at");--> statement-breakpoint
CREATE INDEX "machine_samples_at_idx" ON "machine_samples" USING btree ("at");--> statement-breakpoint
CREATE INDEX "machines_status_idx" ON "machines" USING btree ("status","last_seen_at");--> statement-breakpoint
CREATE INDEX "runner_sessions_machine_idx" ON "runner_sessions" USING btree ("company_id","machine_id","connected_at");--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_machine_fk" FOREIGN KEY ("company_id","machine_id") REFERENCES "public"."machines"("company_id","id") ON DELETE no action ON UPDATE no action;