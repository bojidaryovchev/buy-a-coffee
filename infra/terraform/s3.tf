/**
 * Object storage for mirrored product images, crawl artifacts and diagnostic
 * snapshots.
 *
 * The bucket is private. The storefront reads images through a CDN or a signed
 * URL rather than by making the bucket public, so a misconfigured ACL cannot
 * expose the whole catalog store.
 */

resource "aws_s3_bucket" "assets" {
  bucket = "${local.name_prefix}-assets-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id

  # Versioning is the cheap insurance against a bad GC run deleting live images.
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  # Depends on versioning so the noncurrent-version rules are valid at apply time.
  depends_on = [aws_s3_bucket_versioning.assets]

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }

  rule {
    id     = "expire-diagnostic-snapshots"
    status = "Enabled"

    filter {
      prefix = "snapshots/"
    }

    # Snapshots exist to debug a recent parser failure, not as an archive.
    expiration {
      days = 30
    }
  }

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "assets" {
  count  = var.image_public_base_url != "" ? 1 : 0
  bucket = aws_s3_bucket.assets.id

  cors_rule {
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = [var.image_public_base_url]
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}
