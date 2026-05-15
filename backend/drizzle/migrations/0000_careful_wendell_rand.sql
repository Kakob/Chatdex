CREATE TABLE "sync_records" (
	"id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" varchar(20) NOT NULL,
	"parent_id" text,
	"iv" "bytea" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "sync_records_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"passkey_credential_id" text NOT NULL,
	"passkey_public_key" "bytea" NOT NULL,
	"passkey_counter" integer DEFAULT 0 NOT NULL,
	"passkey_transports" jsonb,
	"prf_salt" "bytea" NOT NULL,
	"wrapped_by_passkey_iv" "bytea" NOT NULL,
	"wrapped_by_passkey_ct" "bytea" NOT NULL,
	"wrapped_by_recovery_iv" "bytea" NOT NULL,
	"wrapped_by_recovery_ct" "bytea" NOT NULL,
	"recovery_code_hash" "bytea" NOT NULL,
	"recovery_code_server_salt" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "sync_records" ADD CONSTRAINT "sync_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_records_user_updated_idx" ON "sync_records" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "sync_records_user_kind_updated_idx" ON "sync_records" USING btree ("user_id","kind","updated_at");--> statement-breakpoint
CREATE INDEX "sync_records_user_parent_idx" ON "sync_records" USING btree ("user_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_passkey_credential_idx" ON "users" USING btree ("passkey_credential_id");