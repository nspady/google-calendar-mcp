import fs from 'fs/promises';
import { dirname } from 'path';
import { getSecureTokenPath } from '../utils.js';

// Token prefixes for MCP OAuth tokens
export const MCP_TOKEN_PREFIX = {
  AUTH_CODE: 'mcp_ac_',
  ACCESS_TOKEN: 'mcp_at_',
  REFRESH_TOKEN: 'mcp_rt_',
  CLIENT_SECRET: 'mcp_cs_',
} as const;

export const MCP_AUTH_STATE_TYPE = 'mcp_auth' as const;

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function getMcpStoragePath(filename: string): string {
  const tokenDir = dirname(getSecureTokenPath());
  return `${tokenDir}/${filename}`;
}

export function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export async function loadJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    const content = await fs.readFile(path, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error: unknown) {
    if (isFileNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function saveJsonFile(path: string, data: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function isSessionExpired(createdAt: number): boolean {
  return Date.now() - createdAt > SESSION_TTL_MS;
}
