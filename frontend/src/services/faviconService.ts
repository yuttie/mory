/**
 * Service for managing dynamic favicons based on routes
 */

// Route to favicon mapping
const ROUTE_FAVICONS: Record<string, string> = {
  'Home': '/img/route-favicons/favicon-home.svg',
  'Calendar': '/img/route-favicons/favicon-calendar.svg',
  'CalendarWithDate': '/img/route-favicons/favicon-calendar.svg',
  'Tasks': '/img/route-favicons/favicon-tasks.svg',
  'TasksNext': '/img/route-favicons/favicon-tasks-next.svg',
  'TasksNextWithParams': '/img/route-favicons/favicon-tasks-next.svg',
  'Files': '/img/route-favicons/favicon-files.svg',
  'Search': '/img/route-favicons/favicon-search.svg',
  'Note': '/img/route-favicons/favicon-note.svg',
  'Create': '/img/route-favicons/favicon-note.svg', // Create redirects to Note
  'Media': '/img/route-favicons/favicon-media.svg',
  'Config': '/img/route-favicons/favicon-config.svg',
  'About': '/img/route-favicons/favicon-about.svg',
};

// Default favicon fallback
const DEFAULT_FAVICON = '/favicon.png';

class FaviconService {
  private currentFavicon: string = DEFAULT_FAVICON;

  /**
   * Update favicon based on route name
   */
  updateFavicon(routeName: string): void {
    const faviconPath = ROUTE_FAVICONS[routeName] || DEFAULT_FAVICON;
    
    if (this.currentFavicon === faviconPath) {
      return; // No change needed
    }

    this.setFavicon(faviconPath);
    this.currentFavicon = faviconPath;
  }

  /**
   * Set the favicon to a specific path
   */
  private setFavicon(faviconPath: string): void {
    // Remove existing favicon links
    const existingLinks = document.querySelectorAll('link[rel*="icon"]');
    existingLinks.forEach(link => link.remove());

    // Create new favicon link
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = faviconPath.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
    link.href = faviconPath;
    if (!faviconPath.endsWith('.svg')) {
      link.sizes = '512x512';
    }

    // Add to document head
    document.head.appendChild(link);
  }

  /**
   * Reset to default favicon
   */
  resetToDefault(): void {
    this.setFavicon(DEFAULT_FAVICON);
    this.currentFavicon = DEFAULT_FAVICON;
  }

  /**
   * Get current favicon path
   */
  getCurrentFavicon(): string {
    return this.currentFavicon;
  }

  /**
   * Check if route has a specific favicon
   */
  hasRouteFavicon(routeName: string): boolean {
    return routeName in ROUTE_FAVICONS;
  }
}

// Export singleton instance
export const faviconService = new FaviconService();
export default faviconService;