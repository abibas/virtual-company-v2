CREATE TABLE "company_logos" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"updated_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_logos_content_type_check" CHECK ("company_logos"."content_type" in ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "company_logos_size_check" CHECK ("company_logos"."size" between 1 and 1048576),
	CONSTRAINT "company_logos_sha256_check" CHECK ("company_logos"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "company_logos" ADD CONSTRAINT "company_logos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_logos" ADD CONSTRAINT "company_logos_updated_by_principal_fk" FOREIGN KEY ("company_id","updated_by_principal_id") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;