output "aws_region" {
  value = var.aws_region
}

output "location_map_name" {
  value = aws_location_map.main.map_name
}

output "location_place_index_name" {
  value = aws_location_place_index.main.index_name
}

output "location_map_arn" {
  value = aws_location_map.main.map_arn
}

output "location_place_index_arn" {
  value = aws_location_place_index.main.index_arn
}
