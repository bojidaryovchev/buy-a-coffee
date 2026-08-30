variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "eu-central-1"
}

variable "project" {
  description = "Short project identifier used as a name prefix."
  type        = string
  default     = "coffee-catalog"

  validation {
    condition     = can(regex("^[a-z0-9-]{3,32}$", var.project))
    error_message = "project must be 3-32 lowercase alphanumeric or hyphen characters."
  }
}

variable "environment" {
  description = "Deployment environment (prod, staging, ...)."
  type        = string
  default     = "prod"
}

variable "lambda_zip_path" {
  description = "Path to the bundled Lambda artifact produced by `pnpm build:lambda`."
  type        = string
  default     = "build/scraper-lambda.zip"
}

variable "lambda_memory_mb" {
  description = "Lambda memory. Also scales CPU, which matters for HTML parsing."
  type        = number
  default     = 1024

  validation {
    condition     = var.lambda_memory_mb >= 512 && var.lambda_memory_mb <= 10240
    error_message = "lambda_memory_mb must be between 512 and 10240."
  }
}

variable "lambda_timeout_seconds" {
  description = "Lambda timeout. A full sync of ~110 products takes well under a minute; the default leaves generous headroom for a slow source."
  type        = number
  default     = 300

  validation {
    condition     = var.lambda_timeout_seconds >= 60 && var.lambda_timeout_seconds <= 900
    error_message = "lambda_timeout_seconds must be between 60 and 900."
  }
}

variable "schedule_expression" {
  description = "EventBridge Scheduler expression for the recurring sync."
  type        = string
  default     = "rate(6 hours)"
}

variable "schedule_timezone" {
  description = "Timezone for the schedule."
  type        = string
  default     = "Europe/Sofia"
}

variable "schedule_enabled" {
  description = "Whether the recurring schedule is active."
  type        = bool
  default     = true
}

variable "database_url_secret_arn" {
  description = <<-EOT
    ARN of an existing Secrets Manager secret holding DATABASE_URL.
    Leave empty to have Terraform create an empty secret you populate manually.
    The connection string is never stored in Terraform state or in this repo.
  EOT
  type        = string
  default     = ""
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention."
  type        = number
  default     = 30
}

variable "alarm_email" {
  description = "Optional email subscribed to the alarm topic. Requires confirming the subscription by email."
  type        = string
  default     = ""
}

variable "image_public_base_url" {
  description = "Optional CDN base URL in front of the image bucket. Empty means the storefront uses the bucket URL."
  type        = string
  default     = ""
}

variable "scraper_settings" {
  description = "Non-secret scraper configuration passed to the Lambda as environment variables."
  type        = map(string)
  default = {
    CRAWL_CONCURRENCY      = "4"
    CRAWL_MIN_DELAY_MS     = "150"
    CRAWL_TIMEOUT_MS       = "20000"
    CRAWL_MAX_RETRIES      = "3"
    SYNC_MISSING_THRESHOLD = "3"
    IMAGE_CONCURRENCY      = "4"
    IMAGE_MIN_DELAY_MS     = "50"
    LOG_LEVEL              = "info"
  }
}

variable "no_successful_sync_hours" {
  description = "Raise an alarm if no successful sync is recorded within this many hours."
  type        = number
  default     = 24
}
