resource "aws_location_map" "main" {
  map_name = "itinerary-planner-map"

  configuration {
    style = "VectorEsriStreets"
  }

  tags = {
    Project = "optimised-itinerary-planner"
    Purpose = "live-map-basemap"
  }
}

resource "aws_location_place_index" "main" {
  index_name  = "itinerary-planner-places"
  data_source = "Esri"

  data_source_configuration {
    intended_use = "SingleUse" # search results are shown live, not stored
  }

  tags = {
    Project = "optimised-itinerary-planner"
    Purpose = "place-search"
  }
}
