/**
 * The scheduled catalog-sync Lambda.
 *
 * Deliberately a single function with no SQS or Step Functions in front of it.
 * A measured full sync of the ~110-product catalog completes in roughly seven
 * seconds including image mirroring, and an unchanged re-sync in about one.
 * Fan-out would add moving parts and failure modes to a job that comfortably
 * fits one invocation. If the source ever grows past that, the evidence for
 * splitting will be in the `DurationMs` metric, not in an assumption made now.
 */

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.name_prefix}-sync"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "sync" {
  function_name = "${local.name_prefix}-sync"
  description   = "Recurring catalog synchronisation from the public reference site into PostgreSQL and S3."

  role    = aws_iam_role.lambda.arn
  handler = "handler.handler"
  runtime = "nodejs22.x"

  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)

  memory_size = var.lambda_memory_mb
  timeout     = var.lambda_timeout_seconds

  # One sync at a time. Two concurrent syncs would race on the same rows and
  # double the load we place on the source site for no benefit.
  reserved_concurrent_executions = 1

  environment {
    variables = merge(
      var.scraper_settings,
      {
        NODE_OPTIONS            = "--enable-source-maps"
        STORAGE_DRIVER          = "s3"
        S3_BUCKET               = aws_s3_bucket.assets.id
        STORAGE_PUBLIC_BASE_URL = var.image_public_base_url
        SOURCE_KEY              = "kafezona"

        # The connection string is fetched from Secrets Manager at cold start
        # rather than injected here: Lambda environment variables are visible
        # to anyone with console read access to the function.
        DATABASE_URL_SECRET_ARN = local.database_secret_arn

        # AWS_REGION is reserved and set by the Lambda runtime itself; the
        # scraper reads it for the S3 client, so it must not be set here.
      }
    )
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.lambda.name
  }

  depends_on = [
    aws_iam_role_policy.lambda,
    aws_cloudwatch_log_group.lambda,
  ]
}

/**
 * Dead-letter queue for schedule deliveries the Scheduler could not complete.
 * Its depth is alarmed, so a silently failing schedule cannot go unnoticed.
 */
resource "aws_sqs_queue" "scheduler_dlq" {
  name                      = "${local.name_prefix}-scheduler-dlq"
  message_retention_seconds = 1209600 # 14 days
  sqs_managed_sse_enabled   = true
}
