#!/usr/bin/env node

/**
 * Shared path utilities for token management
 * This module provides consistent token path resolution across all scripts
 */

import path from 'path';
import { homedir } from 'os';

/**
 * Get the secure token storage path
 * Priority: GOOGLE_CALENDAR_MCP_TOKEN_PATH > XDG_CONFIG_HOME > ~/.config
 */
export function getSecureTokenPath() {
  // Priority 1: Custom token path from environment variable
  if (process.env.GOOGLE_CALENDAR_MCP_TOKEN_PATH) {
    return path.resolve(process.env.GOOGLE_CALENDAR_MCP_TOKEN_PATH);
  }
  // Priority 2: XDG Base Directory specification
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
 * Reserved account names that cannot be used
 */
const RESERVED_NAMES = ['.', '..', 'con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4',
                        'lpt1', 'lpt2', 'lpt3'];

/**
 * Validate account ID format
 * Must be 1-64 characters: lowercase letters, numbers, dashes, underscores only
 * Cannot be reserved names
 */
export function validateAccountId(accountId) {
  if (!accountId || accountId.length === 0) {
    throw new Error('Invalid account ID. Must be 1-64 characters: lowercase letters, numbers, dashes, underscores only.');
  }

  // Check reserved names first (before regex, since "." and ".." won't match regex)
  if (RESERVED_NAMES.includes(accountId)) {
    throw new Error(`Account ID "${accountId}" is reserved and cannot be used.`);
  }

  // Check format: lowercase alphanumeric, dashes, underscores, 1-64 chars
  if (!/^[a-z0-9_-]{1,64}$/.test(accountId)) {
    throw new Error('Invalid account ID. Must be 1-64 characters: lowercase letters, numbers, dashes, underscores only.');
  }

  return accountId;
}

/**
 * Get current account mode from environment
 * Uses same logic as utils.ts but compatible with both JS and TS
 */
export function getAccountMode() {
  // If set explicitly via environment variable use that instead
  const explicitMode = process.env.GOOGLE_ACCOUNT_MODE;
  if (explicitMode !== undefined && explicitMode !== null) {
    // Validate the account ID (no lowercasing - must be lowercase already)
    return validateAccountId(explicitMode);
  }

  // Auto-detect test environment
  if (process.env.NODE_ENV === 'test') {
    return 'test';
  }

  // Default to normal for regular app usage
  return 'normal';
}