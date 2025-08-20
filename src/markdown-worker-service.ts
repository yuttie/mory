import type { VFile } from 'vfile';

/**
 * Service for handling markdown rendering using a Web Worker
 */
class MarkdownWorkerService {
  private worker: Worker | null = null;
  private isInitialized = false;
  private messageId = 0;
  private pendingMessages = new Map<number, { resolve: Function; reject: Function }>();

  constructor() {
    this.initializeWorker();
  }

  private async initializeWorker() {
    try {
      // Create the worker using Vite's worker import syntax
      this.worker = new Worker(
        new URL('./markdown-worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.addEventListener('message', this.handleWorkerMessage.bind(this));
      this.worker.addEventListener('error', this.handleWorkerError.bind(this));

      // Wait for worker to be ready and initialize it
      const apiFilesUrl = new URL('files/', new URL(import.meta.env.VITE_APP_API_URL || '/api/', window.location.href)).href;
      
      await this.sendMessage('init', {
        apiFilesUrl
      });

      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize markdown worker:', error);
      throw error;
    }
  }

  private handleWorkerMessage(event: MessageEvent) {
    const { type, id, result, error } = event.data;

    if (type === 'worker-ready') {
      // Worker is ready, no need to handle pending messages for this
      return;
    }

    if (id !== undefined && this.pendingMessages.has(id)) {
      const { resolve, reject } = this.pendingMessages.get(id)!;
      this.pendingMessages.delete(id);

      if (type === 'error') {
        reject(new Error(error.message));
      } else {
        resolve(result);
      }
    }
  }

  private handleWorkerError(event: ErrorEvent) {
    console.error('Worker error:', event.error, event.message, event.filename, event.lineno, event.colno);
    // Reject all pending messages
    for (const { reject } of this.pendingMessages.values()) {
      reject(new Error('Worker error: ' + (event.error?.message || event.message || 'Unknown error')));
    }
    this.pendingMessages.clear();
  }

  private sendMessage(type: string, data?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not available'));
        return;
      }

      const id = ++this.messageId;
      this.pendingMessages.set(id, { resolve, reject });

      this.worker.postMessage({ type, id, data });

      // Add timeout to prevent hanging
      setTimeout(() => {
        if (this.pendingMessages.has(id)) {
          this.pendingMessages.delete(id);
          reject(new Error('Worker message timeout'));
        }
      }, 30000); // 30 second timeout
    });
  }

  async renderMarkdown(markdown: string): Promise<VFile> {
    if (!this.isInitialized) {
      throw new Error('Markdown worker not initialized');
    }

    const result = await this.sendMessage('render', { markdown });
    
    // Create a VFile-like object with the result
    const vfile = {
      data: result.data,
      toString: () => result.html,
    } as VFile;

    return vfile;
  }

  dispose() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.isInitialized = false;
    this.pendingMessages.clear();
  }
}

// Create a singleton instance
let markdownWorkerService: MarkdownWorkerService | null = null;

export async function getMarkdownWorkerService(): Promise<MarkdownWorkerService> {
  if (!markdownWorkerService) {
    markdownWorkerService = new MarkdownWorkerService();
  }
  return markdownWorkerService;
}

export async function renderMarkdownInWorker(markdown: string): Promise<VFile> {
  const service = await getMarkdownWorkerService();
  return service.renderMarkdown(markdown);
}