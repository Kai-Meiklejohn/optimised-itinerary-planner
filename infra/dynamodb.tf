resource "aws_dynamodb_table" "users" {
  name         = "itinerary-planner-users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  server_side_encryption {
    enabled = true
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Project = "optimised-itinerary-planner"
    Purpose = "user-profiles"
  }
}

output "users_table_name" {
  description = "DynamoDB table for application user profiles."
  value       = aws_dynamodb_table.users.name
}

output "users_table_arn" {
  description = "ARN of the DynamoDB user profiles table."
  value       = aws_dynamodb_table.users.arn
}

resource "aws_dynamodb_table" "trips" {
  name         = "Trip"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "tripId"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "tripId"
    type = "S"
  }

  tags = {
    Project = "optimised-itinerary-planner"
    Purpose = "trips"
  }
}

output "trips_table_name" {
  description = "DynamoDB table for trips."
  value       = aws_dynamodb_table.trips.name
}

output "trips_table_arn" {
  description = "ARN of the DynamoDB trips table."
  value       = aws_dynamodb_table.trips.arn
}

resource "aws_dynamodb_table" "stops" {
  name         = "Stop"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "tripId"
  range_key    = "stopId"

  attribute {
    name = "tripId"
    type = "S"
  }

  attribute {
    name = "stopId"
    type = "S"
  }

  tags = {
    Project = "optimised-itinerary-planner"
    Purpose = "stops"
  }
}

output "stops_table_name" {
  description = "DynamoDB table for stops."
  value       = aws_dynamodb_table.stops.name
}

output "stops_table_arn" {
  description = "ARN of the DynamoDB stops table."
  value       = aws_dynamodb_table.stops.arn
}

# One row per user per fixed time window, atomically incremented to bound how
# often one user can trigger a billable Amazon Location Places API call via
# stop creation (backend/src/lib/rateLimit.ts). Rows outlive their own window
# briefly so the TTL sweep - which isn't instant - never races the next check.
resource "aws_dynamodb_table" "rate_limit" {
  name         = "itinerary-planner-rate-limit"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "window"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "window"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Project = "optimised-itinerary-planner"
    Purpose = "place-api-rate-limiting"
  }
}

output "rate_limit_table_name" {
  description = "DynamoDB table backing the per-user Place API rate limiter."
  value       = aws_dynamodb_table.rate_limit.name
}

output "rate_limit_table_arn" {
  description = "ARN of the DynamoDB rate-limit table."
  value       = aws_dynamodb_table.rate_limit.arn
}
