/**
 * EventBridge Scheduler drives the recurring sync.
 *
 * Chosen over an EventBridge rule because it supports a timezone, a
 * flexible-window, and a per-target retry policy with a dead-letter queue —
 * all of which a plain rule would need extra plumbing to achieve.
 */

resource "aws_scheduler_schedule" "catalog_sync" {
  name        = "${local.name_prefix}-catalog-sync"
  description = "Recurring catalog synchronisation."
  group_name  = "default"
  state       = var.schedule_enabled ? "ENABLED" : "DISABLED"

  schedule_expression          = var.schedule_expression
  schedule_expression_timezone = var.schedule_timezone

  # Nothing depends on the sync starting at an exact second, and spreading the
  # start avoids hitting the source at the same instant every cycle.
  flexible_time_window {
    mode                      = "FLEXIBLE"
    maximum_window_in_minutes = 5
  }

  target {
    arn      = aws_lambda_function.sync.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ job = "sync" })

    retry_policy {
      # The sync is idempotent, so a retry is safe. Two attempts is enough:
      # a persistent source outage should wait for the next cycle rather than
      # hammer a site that is already struggling.
      maximum_retry_attempts       = 2
      maximum_event_age_in_seconds = 3600
    }

    dead_letter_config {
      arn = aws_sqs_queue.scheduler_dlq.arn
    }
  }
}

/**
 * A weekly full discovery crawl, kept separate from the frequent catalog sync.
 *
 * Discovery walks the whole public surface and regenerates the reference
 * artifacts; it is far heavier than a catalog sync and does not need to run
 * every few hours. Disabled by default.
 */
resource "aws_scheduler_schedule" "discovery" {
  name        = "${local.name_prefix}-discovery"
  description = "Weekly full-surface discovery crawl and reference artifact refresh."
  group_name  = "default"
  state       = "DISABLED"

  schedule_expression          = "cron(0 3 ? * SUN *)"
  schedule_expression_timezone = var.schedule_timezone

  flexible_time_window {
    mode                      = "FLEXIBLE"
    maximum_window_in_minutes = 30
  }

  target {
    arn      = aws_lambda_function.sync.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ job = "discovery" })

    retry_policy {
      maximum_retry_attempts       = 1
      maximum_event_age_in_seconds = 3600
    }

    dead_letter_config {
      arn = aws_sqs_queue.scheduler_dlq.arn
    }
  }
}
