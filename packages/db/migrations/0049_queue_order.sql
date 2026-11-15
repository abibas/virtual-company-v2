CREATE TABLE "task_waits" (
	"company_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"waits_for_task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_waits_pk" PRIMARY KEY("company_id","task_id","waits_for_task_id"),
	CONSTRAINT "task_waits_not_itself_check" CHECK ("task_waits"."task_id" <> "task_waits"."waits_for_task_id")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "queue_position" integer;--> statement-breakpoint
-- The queue as it was: in each flow, the oldest first (Autotake went by priority, then the oldest).
UPDATE "tasks" SET "queue_position" = "ordered"."n" FROM (
  SELECT "id", row_number() OVER (PARTITION BY "company_id", "flow_id" ORDER BY "created_at", "number")::integer AS "n"
  FROM "tasks"
) AS "ordered" WHERE "ordered"."id" = "tasks"."id";--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "queue_position" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "task_waits" ADD CONSTRAINT "task_waits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_waits" ADD CONSTRAINT "task_waits_task_fk" FOREIGN KEY ("company_id","task_id") REFERENCES "public"."tasks"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_waits" ADD CONSTRAINT "task_waits_waits_for_fk" FOREIGN KEY ("company_id","waits_for_task_id") REFERENCES "public"."tasks"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_waits_waits_for_idx" ON "task_waits" USING btree ("company_id","waits_for_task_id");--> statement-breakpoint
CREATE INDEX "tasks_flow_queue_idx" ON "tasks" USING btree ("company_id","flow_id","queue_position");--> statement-breakpoint
-- A task inserted without a place goes to the end of its flow's queue (after every task of the flow).
CREATE FUNCTION "tasks_queue_at_end"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."queue_position" IS NULL THEN
    SELECT coalesce(max("queue_position"), 0) + 1 INTO NEW."queue_position" FROM "tasks"
      WHERE "company_id" = NEW."company_id" AND "flow_id" = NEW."flow_id";
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "tasks_queue_at_end" BEFORE INSERT ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION "tasks_queue_at_end"();
