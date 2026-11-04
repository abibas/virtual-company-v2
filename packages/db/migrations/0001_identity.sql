CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"machine_id" uuid,
	"prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_secret_hash_unique" UNIQUE("secret_hash"),
	CONSTRAINT "api_keys_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "api_keys_kind_check" CHECK ("api_keys"."kind" in ('personal', 'runner', 'scim')),
	CONSTRAINT "api_keys_secret_hash_check" CHECK ("api_keys"."secret_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "api_keys_runner_machine_check" CHECK ("api_keys"."kind" <> 'runner' or "api_keys"."machine_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "identity_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_events_provider_external_event_id_unique" UNIQUE("provider","external_event_id"),
	CONSTRAINT "identity_events_type_check" CHECK ("identity_events"."type" in ('user.upserted', 'user.deleted', 'org.upserted', 'org.deleted', 'membership.upserted', 'membership.deleted', 'invitation.accepted', 'invitation.revoked')),
	CONSTRAINT "identity_events_status_check" CHECK ("identity_events"."status" in ('pending', 'processed', 'failed')),
	CONSTRAINT "identity_events_attempts_check" CHECK ("identity_events"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "identity_marks" (
	"key" text PRIMARY KEY NOT NULL,
	"provider_updated_at_ms" bigint,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"op" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_outbox_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "identity_outbox_op_check" CHECK ("identity_outbox"."op" in ('create_org', 'invite', 'revoke_invite', 'update_role', 'remove_member', 'delete_org')),
	CONSTRAINT "identity_outbox_status_check" CHECK ("identity_outbox"."status" in ('pending', 'done', 'failed')),
	CONSTRAINT "identity_outbox_attempts_check" CHECK ("identity_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "identity_parked_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"external_event_id" text NOT NULL,
	"event" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_parked_events_key_event_unique" UNIQUE("key","external_event_id")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"email_normalized" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"external_invitation_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"invited_by_principal_id" uuid,
	"accepted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_external_invitation_id_unique" UNIQUE("external_invitation_id"),
	CONSTRAINT "invitations_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "invitations_email_lower_check" CHECK ("invitations"."email_normalized" = lower("invitations"."email_normalized")),
	CONSTRAINT "invitations_role_check" CHECK ("invitations"."role" in ('owner', 'admin', 'member', 'viewer')),
	CONSTRAINT "invitations_status_check" CHECK ("invitations"."status" in ('pending', 'accepted', 'revoked', 'expired', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"external_membership_id" text,
	"provider_role" text,
	"invitation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "memberships_company_id_user_id_unique" UNIQUE("company_id","user_id"),
	CONSTRAINT "memberships_company_id_principal_id_unique" UNIQUE("company_id","principal_id"),
	CONSTRAINT "memberships_role_check" CHECK ("memberships"."role" in ('owner', 'admin', 'member', 'viewer')),
	CONSTRAINT "memberships_granted_role_check" CHECK ("memberships"."granted_role" in ('owner', 'admin', 'member', 'viewer')),
	CONSTRAINT "memberships_status_check" CHECK ("memberships"."status" in ('invited', 'active', 'suspended', 'removed'))
);
--> statement-breakpoint
CREATE TABLE "principals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "principals_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "principals_kind_check" CHECK ("principals"."kind" in ('person', 'agent'))
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_identities_issuer_subject_unique" UNIQUE("issuer","subject")
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_primary_email_unique";--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_principal_fk" FOREIGN KEY ("company_id","principal_id") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_outbox" ADD CONSTRAINT "identity_outbox_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_principal_fk" FOREIGN KEY ("company_id","invited_by_principal_id") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_principal_fk" FOREIGN KEY ("company_id","principal_id") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invitation_fk" FOREIGN KEY ("company_id","invitation_id") REFERENCES "public"."invitations"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principals" ADD CONSTRAINT "principals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_principal_idx" ON "api_keys" USING btree ("company_id","principal_id");--> statement-breakpoint
CREATE INDEX "identity_events_status_idx" ON "identity_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "identity_outbox_due_idx" ON "identity_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_one_pending_per_email" ON "invitations" USING btree ("company_id","email_normalized") WHERE "invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_identities_user_id_idx" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_principal_fk" FOREIGN KEY ("company_id","actor_principal_id") REFERENCES "public"."principals"("company_id","id") ON DELETE no action ON UPDATE no action;