# Attach this policy to the role used by your local AWS profile. Terraform
# does not grant it to a user or create permanent access keys.
data "aws_iam_policy_document" "local_backend" {
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem"]
    resources = [aws_dynamodb_table.users.arn]
  }
  statement {
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
      "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:TransactWriteItems",
      "dynamodb:ConditionCheckItem",
    ]
    resources = [aws_dynamodb_table.trips.arn, aws_dynamodb_table.stops.arn]
  }
  statement {
    actions   = ["dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.rate_limit.arn]
  }
  statement {
    actions   = ["geo-places:GetPlace", "geo-places:Geocode", "geo-places:Suggest"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "local_backend" {
  name        = "itinerary-planner-local-backend"
  description = "Application access for the local itinerary planner backend."
  policy      = data.aws_iam_policy_document.local_backend.json
}

output "local_backend_policy_arn" {
  value = aws_iam_policy.local_backend.arn
}
