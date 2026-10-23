CREATE TABLE "upload_staging" (
	"user_id" integer NOT NULL,
	"token" text NOT NULL,
	"part" integer NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_staging_user_id_token_part_pk" PRIMARY KEY("user_id","token","part")
);
--> statement-breakpoint
ALTER TABLE "upload_staging" ADD CONSTRAINT "upload_staging_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;