CREATE TABLE "presets" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"thumbnail_url" text,
	"user_id" text,
	"is_community" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "presets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "presets" ADD CONSTRAINT "presets_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "presets_type_idx" ON "presets" USING btree ("type");--> statement-breakpoint
CREATE INDEX "presets_user_id_idx" ON "presets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "presets_is_community_idx" ON "presets" USING btree ("is_community");