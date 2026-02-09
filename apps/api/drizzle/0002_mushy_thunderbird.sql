ALTER TABLE "users" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "github_login" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_github_user_id_uniq" ON "users" USING btree ("github_user_id");