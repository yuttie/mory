import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Route to color mapping - same as in faviconService.ts
const ROUTE_COLORS = {
  'home': '#66dbe1',
  'calendar': '#4CAF50',
  'tasks': '#FF9800',
  'tasks-next': '#FF5722',
  'files': '#9C27B0',
  'search': '#2196F3',
  'note': '#FFC107',
  'media': '#E91E63',
  'config': '#607D8B',
  'about': '#795548',
};

// Create route-favicons directory if it doesn't exist
const outputDir = path.join(__dirname, '../public/img/route-favicons');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Function to create modified SVG with colored accent
function createRouteSVG(route, color) {
  const logoPath = path.join(__dirname, '../logo.svg');
  const logoContent = fs.readFileSync(logoPath, 'utf8');
  
  // Add a colored accent indicator to the SVG
  // We'll add a small colored circle in the top-right corner
  const accentCircle = `  <circle cx="120" cy="15" r="12" fill="${color}" opacity="0.8" stroke="white" stroke-width="1"/>`;
  
  // Insert the accent before the closing </g> tag
  const modifiedSVG = logoContent.replace('</g>', `${accentCircle}\n</g>`);
  
  // Save the modified SVG
  const svgPath = path.join(outputDir, `favicon-${route}.svg`);
  fs.writeFileSync(svgPath, modifiedSVG);
  
  console.log(`Generated SVG for route: ${route} with color: ${color}`);
  return svgPath;
}

// Generate favicons for each route
Object.entries(ROUTE_COLORS).forEach(([route, color]) => {
  createRouteSVG(route, color);
});

console.log('Route-specific favicon SVGs generated successfully!');
console.log('Note: Generated SVG files. For production, convert these to PNG using a proper SVG-to-PNG converter.');
console.log('You can use tools like Inkscape, ImageMagick, or online converters to create PNG versions.');