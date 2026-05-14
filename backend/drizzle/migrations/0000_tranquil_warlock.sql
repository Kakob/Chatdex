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
	"auth_key_hash" "bytea" NOT NULL,
	"auth_key_server_salt" "bytea" NOT NULL,
	"kdf_salt_auth" "bytea" NOT NULL,
	"kdf_salt_enc" "bytea" NOT NULL,
	"kdf_params" jsonb NOT NULL,
	"wrapped_by_passphrase_iv" "bytea" NOT NULL,
	"wrapped_by_passphrase_ct" "bytea" NOT NULL,
	"wrapped_by_recovery_iv" "bytea" NOT NULL,
	"wrapped_by_recovery_ct" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "sync_records" ADD CONSTRAINT "sync_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_records_user_updated_idx" ON "sync_records" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "sync_records_user_kind_updated_idx" ON "sync_records" USING btree ("user_id","kind","updated_at");--> statement-breakpoint
CREATE INDEX "sync_records_user_parent_idx" ON "sync_records" USING btree ("user_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");