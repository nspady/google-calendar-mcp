import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getCredentialsProjectId } from '../../../auth/utils.js';

describe('getCredentialsProjectId', () => {
  const originalCredentials = process.env.GOOGLE_OAUTH_CREDENTIALS;
  const dir = mkdtempSync(join(tmpdir(), 'gcal-mcp-creds-'));

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    if (originalCredentials === undefined) {
      delete process.env.GOOGLE_OAUTH_CREDENTIALS;
    } else {
      process.env.GOOGLE_OAUTH_CREDENTIALS = originalCredentials;
    }
  });

  it('reads project_id from installed-format credentials', () => {
    const file = join(dir, 'installed.json');
    writeFileSync(file, JSON.stringify({ installed: { project_id: 'proj-installed' } }));
    process.env.GOOGLE_OAUTH_CREDENTIALS = file;
    expect(getCredentialsProjectId()).toBe('proj-installed');
  });

  it('reads the credentials file once per path', () => {
    const file = join(dir, 'cached.json');
    writeFileSync(file, JSON.stringify({ project_id: 'proj-a' }));
    process.env.GOOGLE_OAUTH_CREDENTIALS = file;
    expect(getCredentialsProjectId()).toBe('proj-a');

    writeFileSync(file, JSON.stringify({ project_id: 'proj-b' }));
    expect(getCredentialsProjectId()).toBe('proj-a');
  });

  it('returns undefined when the file is missing, without caching the miss', () => {
    const file = join(dir, 'late.json');
    process.env.GOOGLE_OAUTH_CREDENTIALS = file;
    expect(getCredentialsProjectId()).toBeUndefined();

    writeFileSync(file, JSON.stringify({ project_id: 'proj-late' }));
    expect(getCredentialsProjectId()).toBe('proj-late');
  });
});
