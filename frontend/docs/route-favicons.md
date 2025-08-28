# Route-Specific Favicons

This feature automatically changes the favicon based on the current route, providing visual feedback to users about which section of the application they are currently viewing.

## Features

- **Dynamic Favicon Updates**: Favicon automatically changes when navigating between routes
- **Route-Specific Colors**: Each route has a unique colored accent on the base logo
- **Automatic Generation**: Favicons are automatically generated from the base logo with colored indicators
- **SVG Support**: Uses SVG favicons for better scalability and quality

## Route Color Mapping

| Route | Color | Description |
|-------|-------|-------------|
| Home | #66dbe1 | Light blue (matches app theme) |
| Calendar | #4CAF50 | Green |
| Tasks | #FF9800 | Orange |
| Tasks (New) | #FF5722 | Red-orange |
| Files | #9C27B0 | Purple |
| Search | #2196F3 | Blue |
| Note | #FFC107 | Amber/Yellow |
| Media | #E91E63 | Pink |
| Config | #607D8B | Blue-grey |
| About | #795548 | Brown |

## Implementation

### Files Modified/Added

1. **`src/services/faviconService.ts`** - Service to manage dynamic favicon updates
2. **`src/router/index.ts`** - Router integration to update favicon on route changes  
3. **`src/main.ts`** - Initialize favicon service on app startup
4. **`tools/generate-route-favicons.js`** - Node.js script to generate route-specific favicons
5. **`tools/generate-route-favicons.sh`** - Shell script for favicon generation (legacy)
6. **`public/img/route-favicons/`** - Directory containing generated route-specific favicons

### How It Works

1. **Favicon Service**: Manages favicon updates by dynamically modifying the document head
2. **Router Integration**: Uses Vue Router's `afterEach` navigation guard to detect route changes
3. **Automatic Generation**: Scripts generate colored variants of the base logo for each route
4. **Fallback Handling**: Falls back to default favicon for unknown routes

## Generation Scripts

### Node.js Script (Recommended)
```bash
node tools/generate-route-favicons.js
```

This script:
- Reads the base `logo.svg` file
- Adds a colored accent circle for each route
- Generates route-specific SVG favicons
- Uses the same colors as defined in the favicon service

### Shell Script (Alternative)
```bash
./tools/generate-route-favicons.sh
```

## Technical Details

- Uses SVG favicons with `image/svg+xml` MIME type for better quality
- Removes existing favicon links before adding new ones to avoid conflicts
- Minimal performance impact - only updates when route actually changes
- Compatible with all modern browsers that support SVG favicons

## Browser Support

- Chrome/Chromium: Full support
- Firefox: Full support  
- Safari: Full support
- Edge: Full support

## Future Enhancements

- Could be extended to include additional visual indicators (badges, animation)
- Could support user-customizable colors per route
- Could integrate with PWA manifest for app icon variations