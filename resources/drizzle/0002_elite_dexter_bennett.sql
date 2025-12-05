CREATE TABLE "stream_url_cache" (
	"video_id" varchar(32) PRIMARY KEY NOT NULL,
	"audio_formats" json NOT NULL,
	"cached_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"title" varchar(500),
	"duration" integer
);
--> statement-breakpoint
CREATE INDEX "idx_stream_cache_expires_at" ON "stream_url_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_stream_cache_cached_at" ON "stream_url_cache" USING btree ("cached_at" DESC NULLS LAST);