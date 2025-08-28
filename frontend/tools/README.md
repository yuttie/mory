# Dynamic Route Favicons with Material Design Icons

This directory contains the enhanced favicon generation system that creates route-specific favicons by composing Material Design Icons onto the base logo.

## Features

- **Semantic Icons**: Each route gets a meaningful icon from the Material Design Icons library instead of just colored circles
- **Visual Hierarchy**: Icons are overlaid on a subtle white background circle for better visibility
- **Color Coding**: Each route maintains its unique color scheme for additional visual differentiation
- **Scalable SVGs**: All favicons are generated as SVG for crisp display at any size

## Icon Mapping

| Route | Icon | Color | Description |
|-------|------|-------|-------------|
| Home | `mdiHome` | `#66dbe1` | House icon for home page |
| Calendar | `mdiCalendar` | `#4CAF50` | Calendar icon for date views |
| Tasks | `mdiCheckCircle` | `#FF9800` | Check circle for task management |
| Tasks Next | `mdiClockFast` | `#FF5722` | Fast clock for urgent tasks |
| Files | `mdiFolderOpen` | `#9C27B0` | Open folder for file browser |
| Search | `mdiMagnify` | `#2196F3` | Magnifying glass for search |
| Note | `mdiNoteText` | `#FFC107` | Note with text for editor |
| Media | `mdiImageMultiple` | `#E91E63` | Multiple images for gallery |
| Config | `mdiCog` | `#607D8B` | Gear icon for settings |
| About | `mdiInformation` | `#795548` | Info icon for about page |

## Usage

To regenerate favicons (e.g., after adding new routes or changing icons):

```bash
cd frontend
node tools/generate-route-favicons.js
```

## Customization

To add a new route or modify existing icons:

1. Edit the `ROUTE_CONFIG` object in `generate-route-favicons.js`
2. Choose an appropriate icon from the Material Design Icons library (`@mdi/js`)
3. Set the desired color and description
4. Run the generation script

## Technical Details

- **Base Logo**: Uses the main `logo.svg` as the foundation
- **Icon Overlay**: Scales MDI icons to 18x18px and positions them in the top-right corner
- **Background Circle**: Adds a white circle behind the icon for contrast
- **Output Format**: Generates SVG files for optimal quality and browser support