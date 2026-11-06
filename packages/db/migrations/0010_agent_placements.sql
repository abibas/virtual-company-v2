CREATE TABLE "agent_placements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"home" text NOT NULL,
	"config_dir" text,
	"worktree_root" text,
	"permission_policy" text DEFAULT 'ask' NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_placements_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "agent_placements_mode_check" CHECK ("agent_placements"."mode" in ('host', 'container')),
	CONSTRAINT "agent_placements_permission_policy_check" CHECK ("agent_placements"."permission_policy" in ('ask', 'bypass')),
	CONSTRAINT "agent_placements_home_check" CHECK (char_length("agent_placements"."home") between 1 and 500 and left("agent_placements"."home", 1) = '/'),
	CONSTRAINT "agent_placements_config_dir_check" CHECK (char_length("agent_placements"."config_dir") between 1 and 500 and left("agent_placements"."config_dir", 1) = '/'),
	CONSTRAINT "agent_placements_worktree_root_check" CHECK (char_length("agent_placements"."worktree_root") between 1 and 500 and left("agent_placements"."worktree_root", 1) = '/')
);
--> statement-breakpoint
ALTER TABLE "agent_placements" ADD CONSTRAINT "agent_placements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_placements" ADD CONSTRAINT "agent_placements_agent_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_placements" ADD CONSTRAINT "agent_placements_machine_fk" FOREIGN KEY ("company_id","machine_id") REFERENCES "public"."machines"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_placements_one_default_idx" ON "agent_placements" USING btree ("company_id","agent_id") WHERE "agent_placements"."is_default";--> statement-breakpoint
CREATE INDEX "agent_placements_machine_idx" ON "agent_placements" USING btree ("company_id","machine_id");