/**
 * IAM for the sync Lambda and the Scheduler.
 *
 * Every policy is scoped to the specific resources this system owns: no
 * wildcards on S3, no `secretsmanager:*`, no blanket log access.
 */

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${local.name_prefix}-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "lambda" {
  # Logging, scoped to this function's own log group.
  statement {
    sid    = "WriteOwnLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.lambda.arn}:*"]
  }

  # Object access limited to the contents of our own bucket.
  statement {
    sid    = "ReadWriteAssets"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.assets.arn}/*"]
  }

  statement {
    sid       = "ListAssetsBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.assets.arn]
  }

  # Exactly one secret, read-only.
  statement {
    sid       = "ReadDatabaseSecret"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [local.database_secret_arn]
  }

  # Metrics are emitted as embedded-metric log lines, so no cloudwatch:PutMetricData
  # permission is required at all.
}

resource "aws_iam_role_policy" "lambda" {
  name   = "${local.name_prefix}-lambda"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda.json
}

/**
 * Scheduler role: may invoke this one function and nothing else.
 */
data "aws_iam_policy_document" "scheduler_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }

    # Confused-deputy protection: only our own account's schedules may assume it.
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${local.name_prefix}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume_role.json
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    sid       = "InvokeSyncLambda"
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.sync.arn, "${aws_lambda_function.sync.arn}:*"]
  }

  statement {
    sid       = "SendToDeadLetterQueue"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.scheduler_dlq.arn]
  }
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "${local.name_prefix}-scheduler"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler.json
}
