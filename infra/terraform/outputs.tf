output "lambda_function_name" {
  description = "Name of the catalog sync Lambda."
  value       = aws_lambda_function.sync.function_name
}

output "lambda_function_arn" {
  description = "ARN of the catalog sync Lambda."
  value       = aws_lambda_function.sync.arn
}

output "assets_bucket" {
  description = "S3 bucket holding mirrored product images and crawl artifacts."
  value       = aws_s3_bucket.assets.id
}

output "assets_bucket_arn" {
  description = "ARN of the assets bucket."
  value       = aws_s3_bucket.assets.arn
}

output "database_url_secret_arn" {
  description = "Secrets Manager secret holding DATABASE_URL. Populate it before the first run."
  value       = local.database_secret_arn
}

output "schedule_name" {
  description = "EventBridge Scheduler schedule driving the recurring sync."
  value       = aws_scheduler_schedule.catalog_sync.name
}

output "discovery_schedule_name" {
  description = "Weekly discovery schedule (disabled by default)."
  value       = aws_scheduler_schedule.discovery.name
}

output "alarm_topic_arn" {
  description = "SNS topic that receives all alarms."
  value       = aws_sns_topic.alarms.arn
}

output "scheduler_dlq_url" {
  description = "Dead-letter queue for undeliverable schedule invocations."
  value       = aws_sqs_queue.scheduler_dlq.url
}

output "log_group_name" {
  description = "CloudWatch log group for the sync Lambda."
  value       = aws_cloudwatch_log_group.lambda.name
}

output "post_apply_checklist" {
  description = "What an operator must do after the first apply."
  value = join("\n", [
    "1. Put the real connection string in the secret:",
    "   aws secretsmanager put-secret-value --secret-id ${local.database_secret_arn} --secret-string 'postgres://...'",
    "2. Apply database migrations from a machine that can reach the database:",
    "   DATABASE_URL='postgres://...' pnpm db:migrate",
    "3. Trigger one run manually and read its output:",
    "   aws lambda invoke --function-name ${aws_lambda_function.sync.function_name} --payload '{\"job\":\"sync\",\"dryRun\":true}' out.json",
    "4. Confirm the SNS email subscription if alarm_email was set.",
  ])
}
