/**
 * Alarms.
 *
 * The set is chosen so that every way this job can fail *quietly* is covered:
 * it crashed, it refused its own diff, its parsers degraded, or it stopped
 * running altogether. A job that simply stops is the failure mode most likely
 * to go unnoticed, which is why `no successful sync in N hours` exists.
 */

resource "aws_sns_topic" "alarms" {
  name = "${local.name_prefix}-alarms"
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count = var.alarm_email != "" ? 1 : 0

  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  metric_namespace = "CoffeeCatalogSync"
  metric_dimensions = {
    SourceSite = "kafezona"
    Job        = "sync"
  }
}

# 1. The function itself threw.
resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "${local.name_prefix}-lambda-errors"
  alarm_description   = "The catalog sync Lambda raised an unhandled error."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.sync.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
}

# 2. The function ran out of time.
resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  alarm_name          = "${local.name_prefix}-lambda-throttles"
  alarm_description   = "The catalog sync Lambda was throttled."
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { FunctionName = aws_lambda_function.sync.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms.arn]
}

# 3. The sync deliberately refused to apply its diff.
resource "aws_cloudwatch_metric_alarm" "circuit_breaker" {
  alarm_name          = "${local.name_prefix}-circuit-breaker-open"
  alarm_description   = <<-EOT
    Mass-removal protection refused a catalog diff. The catalog was preserved,
    but the source looked wrong: investigate before the next scheduled run.
  EOT
  namespace           = local.metric_namespace
  metric_name         = "CircuitBreakerOpen"
  dimensions          = local.metric_dimensions
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms.arn]
}

# 4. Parsers are degrading — the early warning before a breaker trip.
resource "aws_cloudwatch_metric_alarm" "parser_confidence" {
  alarm_name          = "${local.name_prefix}-parser-confidence-low"
  alarm_description   = "Catalog parser confidence dropped, which usually means the source's HTML changed."
  namespace           = local.metric_namespace
  metric_name         = "ParserConfidence"
  dimensions          = local.metric_dimensions
  statistic           = "Minimum"
  period              = 3600
  evaluation_periods  = 2
  threshold           = 0.8
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms.arn]
}

# 5. The job stopped running at all. The quietest failure of them all.
resource "aws_cloudwatch_metric_alarm" "no_successful_sync" {
  alarm_name          = "${local.name_prefix}-no-successful-sync"
  alarm_description   = "No successful catalog sync was recorded within the expected window."
  namespace           = local.metric_namespace
  metric_name         = "SyncSuccess"
  dimensions          = local.metric_dimensions
  statistic           = "Sum"
  period              = var.no_successful_sync_hours * 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  # `breaching` is the point: absent data means the job never ran.
  treat_missing_data = "breaching"

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]
}

# 6. Image mirroring is failing, which would leave the storefront with gaps.
resource "aws_cloudwatch_metric_alarm" "image_failures" {
  alarm_name          = "${local.name_prefix}-image-failures"
  alarm_description   = "Product image mirroring failed repeatedly."
  namespace           = local.metric_namespace
  metric_name         = "ImagesFailed"
  dimensions          = local.metric_dimensions
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 2
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms.arn]
}

# 7. The scheduler could not deliver an invocation.
resource "aws_cloudwatch_metric_alarm" "scheduler_dlq" {
  alarm_name          = "${local.name_prefix}-scheduler-dlq-not-empty"
  alarm_description   = "The scheduler failed to invoke the sync Lambda and dead-lettered the event."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.scheduler_dlq.name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms.arn]
}

/**
 * A metric filter catches repeated parser errors in the logs, which the
 * structured EMF metrics do not cover on their own.
 */
resource "aws_cloudwatch_log_metric_filter" "parser_errors" {
  name           = "${local.name_prefix}-parser-errors"
  log_group_name = aws_cloudwatch_log_group.lambda.name
  pattern        = "{ $.level = \"warn\" && $.msg = \"catalog.invalid_product\" }"

  metric_transformation {
    name          = "ParserErrors"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "parser_errors" {
  alarm_name          = "${local.name_prefix}-parser-errors"
  alarm_description   = "Repeated product records failed validation."
  namespace           = local.metric_namespace
  metric_name         = "ParserErrors"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alarms.arn]

  depends_on = [aws_cloudwatch_log_metric_filter.parser_errors]
}
