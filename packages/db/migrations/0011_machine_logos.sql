CREATE TABLE "machine_logos" (
	"company_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"updated_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "machine_logos_pkey" PRIMARY KEY("company_id","machine_id"),
	CONSTRAINT "machine_logos_content_type_check" CHECK ("machine_logos"."content_type" in ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "machine_logos_size_check" CHECK ("machine_logos"."size" between 1 and 1048576),
	CONSTRAINT "machine_logos_sha256_check" CHECK ("machine_logos"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "machine_logos" ADD CONSTRAINT "machine_logos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_logos" ADD CONSTRAINT "machine_logos_machine_fk" FOREIGN KEY ("company_id","machine_id") REFERENCES "public"."machines"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_logos" ADD CONSTRAINT "machine_logos_updated_by_principal_fk" FOREIGN KEY ("company_id","updated_by_principal_id") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;