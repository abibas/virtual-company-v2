CREATE TABLE "credential_uses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"credential_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credential_uses_purpose_check" CHECK (char_length("credential_uses"."purpose") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"account_email" text,
	"account_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"key_version" integer NOT NULL,
	"iv" "bytea" NOT NULL,
	"auth_tag" "bytea" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "credentials_kind_check" CHECK ("credentials"."kind" in ('claude_oauth', 'claude_setup_token', 'codex_oauth', 'anthropic_api_key', 'openai_api_key', 'gateway')),
	CONSTRAINT "credentials_status_check" CHECK ("credentials"."status" in ('active', 'needs_sign_in', 'revoked')),
	CONSTRAINT "credentials_label_check" CHECK (char_length("credentials"."label") between 1 and 80),
	CONSTRAINT "credentials_key_version_check" CHECK ("credentials"."key_version" >= 1),
	CONSTRAINT "credentials_iv_check" CHECK (octet_length("credentials"."iv") = 12),
	CONSTRAINT "credentials_auth_tag_check" CHECK (octet_length("credentials"."auth_tag") = 16),
	CONSTRAINT "credentials_account_meta_check" CHECK (jsonb_typeof("credentials"."account_meta") = 'object')
);
--> statement-breakpoint
ALTER TABLE "credential_uses" ADD CONSTRAINT "credential_uses_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credential_uses_credential_idx" ON "credential_uses" USING btree ("credential_id","at");--> statement-breakpoint
CREATE INDEX "credentials_owner_idx" ON "credentials" USING btree ("owner_user_id","created_at");