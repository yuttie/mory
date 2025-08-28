import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as mdi from '@mdi/js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Route to icon and color mapping - enhanced with Material Design Icons
const ROUTE_CONFIG = {
  'home': {
    icon: mdi.mdiHome,
    color: '#66dbe1',
    description: 'Home page'
  },
  'calendar': {
    icon: mdi.mdiCalendar,
    color: '#4CAF50',
    description: 'Calendar view'
  },
  'tasks': {
    icon: mdi.mdiCheckCircle,
    color: '#FF9800',
    description: 'Tasks list'
  },
  'tasks-next': {
    icon: mdi.mdiClockFast,
    color: '#FF5722',
    description: 'Next tasks'
  },
  'files': {
    icon: mdi.mdiFolderOpen,
    color: '#9C27B0',
    description: 'File browser'
  },
  'search': {
    icon: mdi.mdiMagnify,
    color: '#2196F3',
    description: 'Search functionality'
  },
  'note': {
    icon: mdi.mdiNoteText,
    color: '#FFC107',
    description: 'Note editor'
  },
  'media': {
    icon: mdi.mdiImageMultiple,
    color: '#E91E63',
    description: 'Media gallery'
  },
  'config': {
    icon: mdi.mdiCog,
    color: '#607D8B',
    description: 'Configuration'
  },
  'about': {
    icon: mdi.mdiInformation,
    color: '#795548',
    description: 'About page'
  },
};

// Create route-favicons directory if it doesn't exist
const outputDir = path.join(__dirname, '../public/img/route-favicons');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

/**
 * Convert MDI path data to SVG path element
 */
function createIconPath(pathData, size = 16, x = 104, y = 8, color = '#ffffff') {
  // MDI icons are designed on a 24x24 viewBox
  // We scale them down and position them in the top-right corner
  const scale = size / 24;
  
  return `  <g transform="translate(${x}, ${y}) scale(${scale})">
    <path d="${pathData}" fill="${color}" stroke="#333" stroke-width="0.5" opacity="0.95"/>
  </g>`;
}

/**
 * Create modified SVG with icon overlay
 */
function createRouteSVG(route, config) {
  const logoPath = path.join(__dirname, '../logo.svg');
  const logoContent = fs.readFileSync(logoPath, 'utf8');
  
  // Create the icon overlay
  const iconOverlay = createIconPath(config.icon, 18, 102, 6, config.color);
  
  // Also add a subtle background circle for the icon to make it more visible
  const iconBackground = `  <circle cx="111" cy="15" r="13" fill="#ffffff" opacity="0.9" stroke="${config.color}" stroke-width="1"/>`;
  
  // Insert both the background and icon before the closing </g> tag
  const modifiedSVG = logoContent.replace('</g>', `${iconBackground}\n${iconOverlay}\n</g>`);
  
  // Save the modified SVG
  const svgPath = path.join(outputDir, `favicon-${route}.svg`);
  fs.writeFileSync(svgPath, modifiedSVG);
  
  console.log(`✓ Generated SVG for ${route}: ${config.description} (${config.color})`);
  return svgPath;
}

// Generate favicons for each route
console.log('🎨 Generating route-specific favicons with Material Design Icons...\n');

Object.entries(ROUTE_CONFIG).forEach(([route, config]) => {
  createRouteSVG(route, config);
});

console.log('\n🎉 Route-specific favicon SVGs with icons generated successfully!');
console.log('\n📝 Generated favicons for routes:');
Object.entries(ROUTE_CONFIG).forEach(([route, config]) => {
  console.log(`   • ${route.padEnd(12)} → ${config.description}`);
});

console.log('\n💡 The favicons now include semantic icons from Material Design Icons library');
console.log('   instead of simple colored circles, making them more intuitive for users.');
console.log('\n📦 Note: Generated SVG files. For production, convert these to PNG using a proper SVG-to-PNG converter.');
console.log('   You can use tools like Inkscape, ImageMagick, or online converters to create PNG versions.');