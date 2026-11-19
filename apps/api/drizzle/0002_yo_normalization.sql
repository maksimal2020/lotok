ALTER TABLE "listings" drop column "search_tsv";--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "search_tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('russian', translate(coalesce(title, ''), 'ёЁ', 'еЕ')), 'A') || setweight(to_tsvector('russian', translate(coalesce(description, ''), 'ёЁ', 'еЕ')), 'B')) STORED;--> statement-breakpoint
ALTER TABLE "messages" drop column "body_tsv";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "body_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('russian', translate(coalesce(body, ''), 'ёЁ', 'еЕ'))) STORED;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_tsv_idx" ON "listings" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_tsv_idx" ON "messages" USING gin ("body_tsv");
