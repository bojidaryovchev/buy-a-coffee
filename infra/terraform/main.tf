/**
 * Core locals and shared data sources.
 *
 * Terraform provisions the runtime around the scraper. It never performs a
 * crawl itself.
 */

locals {
  name_prefix = "${var.project}-${var.environment}"

  common_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
    Component   = "catalog-sync"
  }

  # Reuse a caller-supplied secret when given one; otherwise manage an empty
  # secret here so the deployment is self-contained. Either way the connection
  # string itself is supplied out of band and never enters Terraform state.
  database_secret_arn = (
    var.database_url_secret_arn != ""
    ? var.database_url_secret_arn
    : aws_secretsmanager_secret.database_url[0].arn
  )
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

resource "aws_secretsmanager_secret" "database_url" {
  count = var.database_url_secret_arn == "" ? 1 : 0

  name        = "${local.name_prefix}/database-url"
  description = "PostgreSQL connection string for the catalog sync Lambda. Populate manually; never commit this value."

  # A short window keeps re-creating the stack from tripping over a
  # still-scheduled deletion of the same name.
  recovery_window_in_days = 7
}

/**
 * A placeholder version so the Lambda can start before a real value is set.
 * `ignore_changes` means Terraform will never overwrite the real secret that
 * an operator writes afterwards.
 */
resource "aws_secretsmanager_secret_version" "database_url_placeholder" {
  count = var.database_url_secret_arn == "" ? 1 : 0

  secret_id     = aws_secretsmanager_secret.database_url[0].id
  secret_string = "REPLACE_ME_WITH_A_REAL_DATABASE_URL"

  lifecycle {
    ignore_changes = [secret_string]
  }
}
