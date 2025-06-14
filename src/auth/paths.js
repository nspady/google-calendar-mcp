#!/usr/bin/env node

/**
 * Shared path utilities for token management
 * This module provides consistent token path resolution across all scripts
 */

import path from 'path';
import { homedir } from 'os';

/**
 * Get the secure token storage path
 * Uses XDG Base Directory specification on Unix-like systems
 */
export function getSecureTokenPath() {
  const configDir = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(configDir, 'google-calendar-mcp', 'tokens.json');
}

/**
 * Get the legacy token path (for migration purposes)
 */
export function getLegacyTokenPath() {
  return path.join(process.cwd(), '.gcp-saved-tokens.json');
}

/**
 * Get current account mode from environment
 * Uses same logic as utils.ts but compatible with both JS and TS
 */
export function getAccountMode() {
  // If set explicitly via environment variable use that instead
  const explicitMode = process.env.GOOGLE_ACCOUNT_MODE?.toLowerCase();
  if (explicitMode === 'test' || explicitMode === 'normal') {
    return explicitMode;
  }
  
  // Auto-detect test environment
  if (process.env.NODE_ENV === 'test') {
    return 'test';
  }
  
  // Default to normal for regular app usage
  return 'normal';
}