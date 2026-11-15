CREATE TABLE "sprints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"started_by" uuid NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sprints_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "sprints_number_unique" UNIQUE("company_id","flow_id","number"),
	CONSTRAINT "sprints_number_check" CHECK ("sprints"."number" >= 1),
	CONSTRAINT "sprints_name_check" CHECK (char_length("sprints"."name") between 1 and 80),
	CONSTRAINT "sprints_ended_check" CHECK ("sprints"."ended_by" is null or "sprints"."ended_at" is not null),
	CONSTRAINT "sprints_report_check" CHECK ("sprints"."report" is null or ("sprints"."ended_at" is not null and jsonb_typeof("sprints"."report") = 'object'))
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "sprint_id" uuid;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_flow_fk" FOREIGN KEY ("company_id","flow_id") REFERENCES "public"."flows"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_started_by_fk" FOREIGN KEY ("company_id","started_by") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_ended_by_fk" FOREIGN KEY ("company_id","ended_by") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sprints_one_current_idx" ON "sprints" USING btree ("flow_id") WHERE "sprints"."ended_at" is null;--> statement-breakpoint
-- Sprint 1 of every flow, started when the flow was made, by whoever made it; every task of the flow joins it.
INSERT INTO "sprints" ("id", "company_id", "flow_id", "number", "name", "started_at", "started_by")
SELECT gen_random_uuid(), "company_id", "id", 1, 'Sprint 1', "created_at", "created_by" FROM "flows";--> statement-breakpoint
UPDATE "tasks" SET "sprint_id" = "sprints"."id" FROM "sprints"
WHERE "sprints"."company_id" = "tasks"."company_id" AND "sprints"."flow_id" = "tasks"."flow_id" AND "sprints"."ended_at" IS NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "sprint_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sprint_fk" FOREIGN KEY ("company_id","sprint_id") REFERENCES "public"."sprints"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_sprint_state_idx" ON "tasks" USING btree ("company_id","sprint_id","state");--> statement-breakpoint
-- A task inserted without a sprint joins its flow's current one; a flow without one yet gets its Sprint 1 here.
CREATE FUNCTION "tasks_join_current_sprint"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."sprint_id" IS NULL THEN
    SELECT "id" INTO NEW."sprint_id" FROM "sprints"
      WHERE "company_id" = NEW."company_id" AND "flow_id" = NEW."flow_id" AND "ended_at" IS NULL;
    IF NEW."sprint_id" IS NULL THEN
      INSERT INTO "sprints" ("id", "company_id", "flow_id", "number", "name", "started_at", "started_by")
        SELECT gen_random_uuid(), "company_id", "id", 1, 'Sprint 1', "created_at", "created_by" FROM "flows"
        WHERE "company_id" = NEW."company_id" AND "id" = NEW."flow_id"
        RETURNING "id" INTO NEW."sprint_id";
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "tasks_join_current_sprint" BEFORE INSERT ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION "tasks_join_current_sprint"();
