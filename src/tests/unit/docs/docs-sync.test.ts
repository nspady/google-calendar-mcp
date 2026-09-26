/**
 * Docs sync: every registered tool must be documented.
 *
 * Adding a tool to ToolRegistry without updating the README tools table,
 * the README ENABLED_TOOLS name list, and docs/architecture.md fails here, as does
 * adding a setting to CONFIG_ENV_VARS without a README Configuration table row.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { ToolRegistry } from '../../../tools/registry.js';
import { CONFIG_ENV_VARS } from '../../../config/AppConfig.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const readDoc = (relativePath: string) => readFileSync(resolve(repoRoot, relativePath), 'utf-8');

// manage-accounts is registered separately from ToolRegistry but is always exposed
const allToolNames = [...ToolRegistry.getAvailableToolNames(), 'manage-accounts'];

function sectionAfter(content: string, heading: string): string {
  const start = content.indexOf(heading);
  expect(start, `heading "${heading}" not found`).toBeGreaterThanOrEqual(0);
  const nextHeading = content.indexOf('\n## ', start + heading.length);
  return content.slice(start, nextHeading === -1 ? undefined : nextHeading);
}

describe('Docs sync', () => {
  const readme = readDoc('README.md');

  it('README "Available Tools" table lists every tool', () => {
    const table = sectionAfter(readme, '## Available Tools');
    const missing = allToolNames.filter(name => !table.includes(`| \`${name}\` |`));
    expect(missing).toEqual([]);
  });

  it('README "Available tool names" list for ENABLED_TOOLS includes every tool', () => {
    const line = readme.split('\n').find(l => l.startsWith('**Available tool names:**'));
    expect(line, 'README "**Available tool names:**" line not found').toBeDefined();
    const missing = allToolNames.filter(name => !line!.includes(`\`${name}\``));
    expect(missing).toEqual([]);
  });

  it('docs/architecture.md lists every tool', () => {
    const tools = sectionAfter(readDoc('docs/architecture.md'), '### Available Tools');
    const missing = allToolNames.filter(name => !tools.includes(`- \`${name}\``));
    expect(missing).toEqual([]);
  });

  it('README "Configuration" table lists every environment variable in AppConfig', () => {
    const configuration = sectionAfter(readme, '## Configuration');
    const missing = CONFIG_ENV_VARS.map(v => v.name).filter(name => !configuration.includes(`| \`${name}\` |`));
    expect(missing).toEqual([]);
  });
});
