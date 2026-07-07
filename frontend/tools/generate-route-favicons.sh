#!/bin/bash

# Generate route-specific favicons with different colors/accents
# This script creates variations of the base favicon for different routes

# Create route-favicons directory if it doesn't exist
mkdir -p public/img/route-favicons

# For now, we'll create a simple implementation that copies the base favicon
# and generates route-specific ones by modifying the SVG with sed
# This provides the basic structure for route-specific favicons

# Define routes and their color indicators
routes=("home" "calendar" "tasks" "tasks-next" "files" "search" "note" "media" "config" "about")
colors=("#66dbe1" "#4CAF50" "#FF9800" "#FF5722" "#9C27B0" "#2196F3" "#FFC107" "#E91E63" "#607D8B" "#795548")

# Function to create a modified SVG with color accent
create_route_svg() {
    local route=$1
    local color=$2
    local temp_svg="temp_${route}.svg"
    
    # Copy base logo
    cp logo.svg "$temp_svg"
    
    # Add a colored accent/indicator to the SVG
    # We'll add a small colored circle in the top-right corner as a route indicator
    sed -i.bak "s|</g>|  <circle cx=\"120\" cy=\"15\" r=\"12\" fill=\"$color\" opacity=\"0.8\" stroke=\"white\" stroke-width=\"1\"/>|g; s|</svg>|</g>\n</svg>|g" "$temp_svg"
    
    echo "Generated SVG for route: $route with color: $color"
    
    # For now, just copy the original favicon as a placeholder
    # In a real implementation, this would use a proper SVG-to-PNG converter
    cp public/favicon.png "public/img/route-favicons/favicon-${route}.png"
    
    # Clean up temp file
    rm "$temp_svg" "$temp_svg.bak" 2>/dev/null || true
}

# Generate favicons for each route
for i in "${!routes[@]}"; do
    create_route_svg "${routes[$i]}" "${colors[$i]}"
done

echo "Route-specific favicon structure created successfully!"
echo "Note: Using placeholder PNGs for now. In production, use proper SVG-to-PNG conversion."