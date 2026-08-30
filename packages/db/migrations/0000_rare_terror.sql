CREATE TYPE "public"."availability" AS ENUM('in_stock', 'out_of_stock', 'preorder', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."change_type" AS ENUM('created', 'updated', 'marked_missing', 'removed', 'restored');--> statement-breakpoint
CREATE TYPE "public"."crawl_run_type" AS ENUM('discovery', 'catalog');--> statement-breakpoint
CREATE TYPE "public"."entity_status" AS ENUM('active', 'missing', 'removed');--> statement-breakpoint
CREATE TYPE "public"."image_status" AS ENUM('active', 'orphaned', 'failed');--> statement-breakpoint
CREATE TYPE "public"."page_type" AS ENUM('home', 'category', 'subcategory', 'product', 'brand', 'brand_index', 'promotion', 'search', 'blog_index', 'blog_article', 'contact', 'legal', 'soft_404', 'asset', 'other');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('active', 'missing', 'removed');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'succeeded', 'partial', 'failed', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."snapshot_reason" AS ENUM('parser_error', 'page_type_change', 'circuit_breaker', 'new_page_shape', 'manual');--> statement-breakpoint
CREATE TABLE "crawl_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_site_id" uuid NOT NULL,
	"type" "crawl_run_type" NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"pages_attempted" integer DEFAULT 0 NOT NULL,
	"pages_succeeded" integer DEFAULT 0 NOT NULL,
	"pages_failed" integer DEFAULT 0 NOT NULL,
	"pages_soft_404" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_summary" text
);
--> statement-breakpoint
CREATE TABLE "discovered_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_site_id" uuid NOT NULL,
	"canonical_url" text NOT NULL,
	"discovered_url" text NOT NULL,
	"final_url" text NOT NULL,
	"path" text NOT NULL,
	"status_code" smallint,
	"content_type" text,
	"is_soft_404" boolean DEFAULT false NOT NULL,
	"redirected_from" text,
	"title" text,
	"meta_description" text,
	"canonical_tag" text,
	"robots_meta" text,
	"page_type" "page_type" DEFAULT 'other' NOT NULL,
	"page_type_confidence" text,
	"page_type_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"headings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"forms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"structured_data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"byte_size" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latest_crawl_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "page_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_run_id" uuid NOT NULL,
	"from_page_id" uuid NOT NULL,
	"to_canonical_url" text NOT NULL,
	"to_page_id" uuid,
	"anchor_text" text,
	"rel" text,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_site_id" uuid NOT NULL,
	"crawl_run_id" uuid,
	"sync_run_id" uuid,
	"canonical_url" text NOT NULL,
	"content_hash" text NOT NULL,
	"reason" "snapshot_reason" NOT NULL,
	"object_key" text NOT NULL,
	"byte_size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_site_id" uuid,
	"crawl_run_id" uuid,
	"sync_run_id" uuid,
	"url" text,
	"stage" text NOT NULL,
	"error_class" text NOT NULL,
	"error_message" text NOT NULL,
	"status_code" smallint,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"canonical_host" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_site_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"source_id" text,
	"source_url" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"tagline" text,
	"description" text,
	"source_product_count" integer,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_site_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"source_id" text,
	"source_url" text,
	"parent_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"source_product_count" integer,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"product_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_categories_product_id_category_id_pk" PRIMARY KEY("product_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"source_content_hash" text,
	"object_key" text,
	"public_url" text,
	"mime_type" text,
	"width" integer,
	"height" integer,
	"byte_size" integer,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"alt" text,
	"status" "image_status" DEFAULT 'active' NOT NULL,
	"last_error" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mirrored_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_site_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"source_url" text NOT NULL,
	"source_path" text NOT NULL,
	"source_variant_key" text,
	"has_url_collision" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"current_price" numeric(12, 2),
	"old_price" numeric(12, 2),
	"currency" text,
	"availability" "availability" DEFAULT 'unknown' NOT NULL,
	"brand_id" uuid,
	"description_html" text,
	"description_text" text,
	"weight" text,
	"weight_value" numeric(14, 4),
	"weight_unit" text,
	"sku" text,
	"gtin" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"semantic_hash" text NOT NULL,
	"status" "product_status" DEFAULT 'active' NOT NULL,
	"consecutive_missing_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"latest_sync_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "catalog_baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_site_id" uuid NOT NULL,
	"sync_run_id" uuid,
	"active_product_count" integer NOT NULL,
	"discovered_product_count" integer NOT NULL,
	"category_count" integer DEFAULT 0 NOT NULL,
	"brand_count" integer DEFAULT 0 NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"product_id" uuid,
	"source_key" text NOT NULL,
	"change_type" "change_type" NOT NULL,
	"changed_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_site_id" uuid NOT NULL,
	"crawl_run_id" uuid,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"discovered_count" integer DEFAULT 0 NOT NULL,
	"discovered_raw_count" integer DEFAULT 0 NOT NULL,
	"products_before" integer DEFAULT 0 NOT NULL,
	"products_after" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"unchanged_count" integer DEFAULT 0 NOT NULL,
	"missing_count" integer DEFAULT 0 NOT NULL,
	"removed_count" integer DEFAULT 0 NOT NULL,
	"restored_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"images_mirrored" integer DEFAULT 0 NOT NULL,
	"images_skipped" integer DEFAULT 0 NOT NULL,
	"images_failed" integer DEFAULT 0 NOT NULL,
	"circuit_breaker_tripped" boolean DEFAULT false NOT NULL,
	"circuit_breaker_reason" text,
	"circuit_breaker_detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"catalog_source" text,
	"parser_confidence" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_summary" text
);
--> statement-breakpoint
CREATE TABLE "observed_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_site_id" uuid NOT NULL,
	"crawl_run_id" uuid,
	"feature_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"evidence_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"page_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"implementation_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observed_filters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_site_id" uuid NOT NULL,
	"crawl_run_id" uuid,
	"filter_key" text NOT NULL,
	"name" text NOT NULL,
	"url_param" text,
	"multi_value" boolean DEFAULT false NOT NULL,
	"values" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"page_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"applies_to_page_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observed_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_site_id" uuid NOT NULL,
	"crawl_run_id" uuid,
	"form_key" text NOT NULL,
	"name" text NOT NULL,
	"purpose" text,
	"page_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action" text,
	"method" text,
	"external_endpoint" boolean DEFAULT false NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted" boolean DEFAULT false NOT NULL,
	"side_effect_warning" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observed_route_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_site_id" uuid NOT NULL,
	"crawl_run_id" uuid,
	"pattern" text NOT NULL,
	"page_type" text NOT NULL,
	"example_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"match_count" jsonb DEFAULT '0'::jsonb NOT NULL,
	"notes" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_source_site_id_source_sites_id_fk" FOREIGN KEY ("source_site_id") REFERENCES "public"."source_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovered_pages" ADD CONSTRAINT "discovered_pages_source_site_id_source_sites_id_fk" FOREIGN KEY ("source_site_id") REFERENCES "public"."source_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovered_pages" ADD CONSTRAINT "discovered_pages_latest_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("latest_crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_from_page_id_discovered_pages_id_fk" FOREIGN KEY ("from_page_id") REFERENCES "public"."discovered_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_to_page_id_discovered_pages_id_fk" FOREIGN KEY ("to_page_id") REFERENCES "public"."discovered_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_snapshots" ADD CONSTRAINT "page_snapshots_source_site_id_source_sites_id_fk" FOREIGN KEY ("source_site_id") REFERENCES "public"."source_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_snapshots" ADD CONSTRAINT "page_snapshots_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_errors" ADD CONSTRAINT "scrape_errors_source_site_id_source_sites_id_fk" FOREIGN KEY ("source_site_id") REFERENCES "public"."source_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_errors" ADD CONSTRAINT "scrape_errors_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_source_site_id_source_sites_id_fk" FOREIGN KEY ("source_site_id") REFERENCES "public"."source_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_source_site_id_source_sites_id_fk" FOREIGN KEY ("source_site_id") REFERENCES "public"."source_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_source_site_id_source_sites_id_fk" FOREIGN KEY ("source_site_id") REFERENCES "public"."source_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_baselines" ADD CONSTRAINT "catalog_baselines_source_site_id_source_sites_id_fk" FOREIGN KEY ("source_site_id") REFERENCES "public"."source_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_baselines" ADD CONSTRAINT "catalog_baselines_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_source_site_id_source_sites_id_fk" FOREIGN KEY ("source_site_id") REFERENCES "public"."source_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observed_features" ADD CONSTRAINT "observed_features_source_site_id_source_sites_id_fk" FOREIGN KEY ("source_site_id") REFERENCES "public"."source_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observed_features" ADD CONSTRAINT "observed_features_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observed_filters" ADD CONSTRAINT "observed_filters_source_site_id_source_sites_id_fk" FOREIGN KEY ("source_site_id") REFERENCES "public"."source_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observed_filters" ADD CONSTRAINT "observed_filters_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observed_forms" ADD CONSTRAINT "observed_forms_source_site_id_source_sites_id_fk" FOREIGN KEY ("source_site_id") REFERENCES "public"."source_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observed_forms" ADD CONSTRAINT "observed_forms_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observed_route_patterns" ADD CONSTRAINT "observed_route_patterns_source_site_id_source_sites_id_fk" FOREIGN KEY ("source_site_id") REFERENCES "public"."source_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observed_route_patterns" ADD CONSTRAINT "observed_route_patterns_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_runs_site_started_idx" ON "crawl_runs" USING btree ("source_site_id","started_at");--> statement-breakpoint
CREATE INDEX "crawl_runs_status_idx" ON "crawl_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "discovered_pages_canonical_url_idx" ON "discovered_pages" USING btree ("source_site_id","canonical_url");--> statement-breakpoint
CREATE INDEX "discovered_pages_page_type_idx" ON "discovered_pages" USING btree ("page_type");--> statement-breakpoint
CREATE INDEX "discovered_pages_last_seen_idx" ON "discovered_pages" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "discovered_pages_soft404_idx" ON "discovered_pages" USING btree ("is_soft_404");--> statement-breakpoint
CREATE INDEX "page_links_run_idx" ON "page_links" USING btree ("crawl_run_id");--> statement-breakpoint
CREATE INDEX "page_links_from_idx" ON "page_links" USING btree ("from_page_id");--> statement-breakpoint
CREATE INDEX "page_links_to_url_idx" ON "page_links" USING btree ("to_canonical_url");--> statement-breakpoint
CREATE UNIQUE INDEX "page_links_unique_edge_idx" ON "page_links" USING btree ("crawl_run_id","from_page_id","to_canonical_url");--> statement-breakpoint
CREATE UNIQUE INDEX "page_snapshots_hash_reason_idx" ON "page_snapshots" USING btree ("content_hash","reason");--> statement-breakpoint
CREATE INDEX "page_snapshots_url_idx" ON "page_snapshots" USING btree ("canonical_url");--> statement-breakpoint
CREATE INDEX "page_snapshots_created_idx" ON "page_snapshots" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "scrape_errors_crawl_run_idx" ON "scrape_errors" USING btree ("crawl_run_id");--> statement-breakpoint
CREATE INDEX "scrape_errors_sync_run_idx" ON "scrape_errors" USING btree ("sync_run_id");--> statement-breakpoint
CREATE INDEX "scrape_errors_created_idx" ON "scrape_errors" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "scrape_errors_stage_idx" ON "scrape_errors" USING btree ("stage");--> statement-breakpoint
CREATE UNIQUE INDEX "source_sites_key_idx" ON "source_sites" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_source_key_idx" ON "brands" USING btree ("source_site_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_slug_idx" ON "brands" USING btree ("source_site_id","slug");--> statement-breakpoint
CREATE INDEX "brands_status_idx" ON "brands" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_source_key_idx" ON "categories" USING btree ("source_site_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_idx" ON "categories" USING btree ("source_site_id","slug");--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "categories_status_idx" ON "categories" USING btree ("status");--> statement-breakpoint
CREATE INDEX "product_categories_category_idx" ON "product_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "product_categories_primary_idx" ON "product_categories" USING btree ("product_id","is_primary");--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_product_source_idx" ON "product_images" USING btree ("product_id","source_url");--> statement-breakpoint
CREATE INDEX "product_images_hash_idx" ON "product_images" USING btree ("source_content_hash");--> statement-breakpoint
CREATE INDEX "product_images_product_ordinal_idx" ON "product_images" USING btree ("product_id","ordinal");--> statement-breakpoint
CREATE INDEX "product_images_object_key_idx" ON "product_images" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "products_source_key_idx" ON "products" USING btree ("source_site_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_idx" ON "products" USING btree ("source_site_id","slug");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "products_brand_idx" ON "products" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "products_semantic_hash_idx" ON "products" USING btree ("semantic_hash");--> statement-breakpoint
CREATE INDEX "products_last_seen_idx" ON "products" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "products_source_path_idx" ON "products" USING btree ("source_path");--> statement-breakpoint
CREATE INDEX "products_status_price_idx" ON "products" USING btree ("status","current_price");--> statement-breakpoint
CREATE INDEX "products_old_price_idx" ON "products" USING btree ("old_price");--> statement-breakpoint
CREATE INDEX "catalog_baselines_site_recorded_idx" ON "catalog_baselines" USING btree ("source_site_id","recorded_at");--> statement-breakpoint
CREATE INDEX "sync_changes_run_idx" ON "sync_changes" USING btree ("sync_run_id");--> statement-breakpoint
CREATE INDEX "sync_changes_product_idx" ON "sync_changes" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sync_changes_source_key_idx" ON "sync_changes" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "sync_changes_type_idx" ON "sync_changes" USING btree ("change_type");--> statement-breakpoint
CREATE INDEX "sync_changes_created_idx" ON "sync_changes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sync_runs_site_started_idx" ON "sync_runs" USING btree ("source_site_id","started_at");--> statement-breakpoint
CREATE INDEX "sync_runs_status_idx" ON "sync_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sync_runs_breaker_idx" ON "sync_runs" USING btree ("circuit_breaker_tripped");--> statement-breakpoint
CREATE UNIQUE INDEX "observed_features_key_idx" ON "observed_features" USING btree ("source_site_id","feature_key");--> statement-breakpoint
CREATE UNIQUE INDEX "observed_filters_key_idx" ON "observed_filters" USING btree ("source_site_id","filter_key");--> statement-breakpoint
CREATE UNIQUE INDEX "observed_forms_key_idx" ON "observed_forms" USING btree ("source_site_id","form_key");--> statement-breakpoint
CREATE UNIQUE INDEX "observed_route_patterns_idx" ON "observed_route_patterns" USING btree ("source_site_id","pattern","page_type");--> statement-breakpoint
CREATE INDEX "observed_route_patterns_type_idx" ON "observed_route_patterns" USING btree ("page_type");