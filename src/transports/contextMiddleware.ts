import { IncomingMessage } from 'http';
import { McpRequestContext } from './http.js';

/**
 * Middleware to store and retrieve request context for multi-tenant support
 * Uses AsyncLocalStorage to maintain context across async operations
 */
import { AsyncLocalStorage } from 'async_hooks';

export class RequestContextStore {
  private static storage = new AsyncLocalStorage<McpRequestContext>();

  /**
   * Run a function with request context
   */
  static run<T>(context: McpRequestContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  /**
   * Get the current request context
   */
  static getContext(): McpRequestContext | undefined {
    return this.storage.getStore();
  }

  /**
   * Check if we're currently in a context
   */
  static hasContext(): boolean {
    return this.storage.getStore() !== undefined;
  }
}

/**
 * Extract request context from HTTP request
 */
export function extractRequestContext(req: IncomingMessage): McpRequestContext {
  return (req as any).mcpContext || {};
}
