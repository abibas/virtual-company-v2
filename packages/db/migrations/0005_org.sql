CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"role_title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"harness" text DEFAULT 'claude_code' NOT NULL,
	"model" text NOT NULL,
	"effort" text DEFAULT 'high' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"instructions_rev" integer DEFAULT 1 NOT NULL,
	"max_concurrent_runs" integer DEFAULT 1 NOT NULL,
	"face" smallint DEFAULT 0 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "agents_company_id_principal_id_unique" UNIQUE("company_id","principal_id"),
	CONSTRAINT "agents_company_id_slug_unique" UNIQUE("company_id","slug"),
	CONSTRAINT "agents_name_check" CHECK (char_length("agents"."name") between 1 and 80),
	CONSTRAINT "agents_slug_check" CHECK ("agents"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
	CONSTRAINT "agents_role_title_check" CHECK (char_length("agents"."role_title") between 1 and 80),
	CONSTRAINT "agents_status_check" CHECK ("agents"."status" in ('active', 'paused', 'archived')),
	CONSTRAINT "agents_harness_check" CHECK ("agents"."harness" in ('claude_code', 'codex')),
	CONSTRAINT "agents_effort_check" CHECK ("agents"."effort" in ('low', 'medium', 'high', 'xhigh', 'max')),
	CONSTRAINT "agents_instructions_rev_check" CHECK ("agents"."instructions_rev" >= 1),
	CONSTRAINT "agents_max_concurrent_runs_check" CHECK ("agents"."max_concurrent_runs" between 1 and 8),
	CONSTRAINT "agents_face_check" CHECK ("agents"."face" between 0 and 41)
);
--> statement-breakpoint
CREATE TABLE "org_positions" (
	"company_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"reports_to_principal_id" uuid,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_positions_pkey" PRIMARY KEY("company_id","principal_id"),
	CONSTRAINT "org_positions_not_self_check" CHECK ("org_positions"."principal_id" <> "org_positions"."reports_to_principal_id"),
	CONSTRAINT "org_positions_title_check" CHECK (char_length("org_positions"."title") <= 80)
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_principal_fk" FOREIGN KEY ("company_id","principal_id") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_positions" ADD CONSTRAINT "org_positions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_positions" ADD CONSTRAINT "org_positions_principal_fk" FOREIGN KEY ("company_id","principal_id") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_positions" ADD CONSTRAINT "org_positions_reports_to_fk" FOREIGN KEY ("company_id","reports_to_principal_id") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_positions_reports_to_idx" ON "org_positions" USING btree ("company_id","reports_to_principal_id");--> statement-breakpoint
-- custom: a data backfill, which drizzle-kit does not write. Every company's active memberships get a position:
-- an owner at the root, everyone else reporting to the company's earliest active owner (by membership created_at,
-- then id), at the root too when the company has no active owner. Titles stay null. Invited, suspended and removed
-- memberships get none.
WITH "first_owner" AS (
	SELECT DISTINCT ON ("company_id") "company_id", "principal_id"
	FROM "memberships"
	WHERE "role" = 'owner' AND "status" = 'active'
	ORDER BY "company_id", "created_at", "id"
)
INSERT INTO "org_positions" ("company_id", "principal_id", "reports_to_principal_id")
SELECT "m"."company_id", "m"."principal_id",
	CASE WHEN "m"."role" = 'owner' THEN NULL ELSE "first_owner"."principal_id" END
FROM "memberships" "m"
LEFT JOIN "first_owner" ON "first_owner"."company_id" = "m"."company_id"
WHERE "m"."status" = 'active';
