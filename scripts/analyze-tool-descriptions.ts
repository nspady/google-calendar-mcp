#!/usr/bin/env npx tsx
/**
 * Tool Description Analyzer
 *
 * Analyzes MCP tool descriptions for token counts, duplicates, and generates
 * detailed reports for PR comparisons.
 *
 * Usage:
 *   npx tsx scripts/analyze-tool-descriptions.ts [command] [options]
 *
 * Commands:
 *   report          Generate a detailed analysis report (default)
 *   baseline        Generate/update the baseline file
 *   compare         Compare current state with baseline and output diff
 *   json            Output raw JSON analysis data
 *
 * Options:
 *   --baseline-path  Path to baseline file (default: .github/tool-description-baseline.json)
 *   --output         Output format: text, json, markdown (default: text)
 *   --ci             CI mode: exit with error if token count increases significantly
 */

import { getEncoding, Tiktoken } from 'js-tiktoken';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// For ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Types
// ============================================================================

interface PropertyAnalysis {
  name: string;
  description: string;
  descriptionTokens: number;
  type: string;
  hasEnum: boolean;
  enumValues?: string[];
  enumTokens?: number;
  nestedProperties?: PropertyAnalysis[];
  totalTokens: number;
}

interface ToolAnalysis {
  name: string;
  description: string;
  descriptionTokens: number;
  properties: PropertyAnalysis[];
  schemaTokens: number;
  totalTokens: number;
  // Breakdown for clear diffing
  breakdown: {
    toolDescription: number;
    propertyDescriptions: number;
    propertyNames: number;
    typeDefinitions: number;
    enumValues: number;
    structuralOverhead: number;
  };
}

interface DuplicatePattern {
  text: string;
  occurrences: number;
  tools: string[];
  locations: Array<{ tool: string; property: string }>;
  tokenCount: number;
  totalTokensSaved: number;
}

interface AnalysisReport {
  generated: string;
  version: string;
  summary: {
    totalTools: number;
    totalTokens: number;
    duplicatePatterns: number;
    potentialSavings: number;
    savingsPercentage: string;
  };
  tools: ToolAnalysis[];
  duplicates: DuplicatePattern[];
}

interface BaselineComparison {
  before: AnalysisReport;
  after: AnalysisReport;
  diff: {
    totalTokens: { before: number; after: number; diff: number; percentChange: string };
    duplicatePatterns: { before: number; after: number; diff: number };
    potentialSavings: { before: number; after: number; diff: number };
    tools: Array<{
      name: string;
      before: number;
      after: number;
      diff: number;
      status: 'added' | 'removed' | 'changed' | 'unchanged';
      propertyChanges?: Array<{
        property: string;
        before: number;
        after: number;
        diff: number;
      }>;
    }>;
    newDuplicates: DuplicatePattern[];
    removedDuplicates: DuplicatePattern[];
  };
}

// ============================================================================
// Analysis Functions
// ============================================================================

function analyzeProperty(
  name: string,
  schema: any,
  encoder: Tiktoken,
  parentPath: string = ''
): PropertyAnalysis {
  const fullPath = parentPath ? `${parentPath}.${name}` : name;
  const description = schema.description || '';
  const descriptionTokens = encoder.encode(description).length;

  let type = schema.type || 'unknown';
  if (schema.anyOf) type = 'union';
  if (schema.enum) type = 'enum';
  if (schema.$ref) type = 'ref';

  const hasEnum = !!schema.enum;
  const enumValues = schema.enum as string[] | undefined;
  const enumTokens = enumValues
    ? encoder.encode(JSON.stringify(enumValues)).length
    : 0;

  // Analyze nested properties
  let nestedProperties: PropertyAnalysis[] | undefined;
  if (schema.properties) {
    nestedProperties = Object.entries(schema.properties).map(([propName, propSchema]) =>
      analyzeProperty(propName, propSchema, encoder, fullPath)
    );
  } else if (schema.items?.properties) {
    nestedProperties = Object.entries(schema.items.properties).map(([propName, propSchema]) =>
      analyzeProperty(propName, propSchema, encoder, `${fullPath}[]`)
    );
  }

  const nestedTokens = nestedProperties?.reduce((sum, p) => sum + p.totalTokens, 0) || 0;
  const nameTokens = encoder.encode(name).length;
  const typeTokens = encoder.encode(type).length;

  return {
    name,
    description,
    descriptionTokens,
    type,
    hasEnum,
    enumValues,
    enumTokens,
    nestedProperties,
    totalTokens: descriptionTokens + nameTokens + typeTokens + enumTokens + nestedTokens
  };
}

function analyzeToolSchema(
  toolName: string,
  toolDescription: string,
  inputSchema: any,
  encoder: Tiktoken
): ToolAnalysis {
  const descriptionTokens = encoder.encode(toolDescription).length;

  const properties: PropertyAnalysis[] = [];
  if (inputSchema.properties) {
    for (const [propName, propSchema] of Object.entries(inputSchema.properties)) {
      properties.push(analyzeProperty(propName, propSchema, encoder));
    }
  }

  // Calculate breakdown
  let propertyDescriptions = 0;
  let propertyNames = 0;
  let enumValues = 0;

  const countPropertyTokens = (props: PropertyAnalysis[]) => {
    for (const prop of props) {
      propertyDescriptions += prop.descriptionTokens;
      propertyNames += encoder.encode(prop.name).length;
      enumValues += prop.enumTokens || 0;
      if (prop.nestedProperties) {
        countPropertyTokens(prop.nestedProperties);
      }
    }
  };
  countPropertyTokens(properties);

  // Calculate full schema tokens
  const schemaJson = JSON.stringify(inputSchema);
  const schemaTokens = encoder.encode(schemaJson).length;

  // Structural overhead is everything else (braces, colons, quotes, type keywords, etc.)
  const typeDefinitions = properties.reduce((sum, p) => sum + encoder.encode(p.type).length, 0);
  const structuralOverhead = schemaTokens - propertyDescriptions - propertyNames - enumValues - typeDefinitions;

  return {
    name: toolName,
    description: toolDescription,
    descriptionTokens,
    properties,
    schemaTokens,
    totalTokens: descriptionTokens + schemaTokens,
    breakdown: {
      toolDescription: descriptionTokens,
      propertyDescriptions,
      propertyNames,
      typeDefinitions,
      enumValues,
      structuralOverhead: Math.max(0, structuralOverhead)
    }
  };
}

function findDuplicatePatterns(
  tools: ToolAnalysis[],
  encoder: Tiktoken,
  minLength: number = 50
): DuplicatePattern[] {
  const descriptionMap = new Map<string, Array<{ tool: string; property: string }>>();

  const collectDescriptions = (
    toolName: string,
    properties: PropertyAnalysis[],
    parentPath: string = ''
  ) => {
    for (const prop of properties) {
      const path = parentPath ? `${parentPath}.${prop.name}` : prop.name;
      if (prop.description && prop.description.length >= minLength) {
        if (!descriptionMap.has(prop.description)) {
          descriptionMap.set(prop.description, []);
        }
        descriptionMap.get(prop.description)!.push({ tool: toolName, property: path });
      }
      if (prop.nestedProperties) {
        collectDescriptions(toolName, prop.nestedProperties, path);
      }
    }
  };

  for (const tool of tools) {
    // Add tool description
    if (tool.description.length >= minLength) {
      if (!descriptionMap.has(tool.description)) {
        descriptionMap.set(tool.description, []);
      }
      descriptionMap.get(tool.description)!.push({ tool: tool.name, property: '(tool description)' });
    }
    collectDescriptions(tool.name, tool.properties);
  }

  const duplicates: DuplicatePattern[] = [];
  for (const [text, locations] of descriptionMap.entries()) {
    if (locations.length >= 2) {
      const tools = [...new Set(locations.map(l => l.tool))];
      const tokenCount = encoder.encode(text).length;
      duplicates.push({
        text,
        occurrences: locations.length,
        tools,
        locations,
        tokenCount,
        totalTokensSaved: tokenCount * (locations.length - 1)
      });
    }
  }

  return duplicates.sort((a, b) => b.totalTokensSaved - a.totalTokensSaved);
}

async function generateReport(): Promise<AnalysisReport> {
  // Dynamic import of the registry from source (tsx handles TypeScript)
  const registryPath = path.join(__dirname, '..', 'src', 'tools', 'registry.ts');
  const { ToolRegistry } = await import(registryPath);
  const tools = ToolRegistry.getToolsWithSchemas();

  const encoder = getEncoding('cl100k_base');

  const toolAnalyses = tools.map((tool: any) =>
    analyzeToolSchema(tool.name, tool.description, tool.inputSchema, encoder)
  );

  const totalTokens = toolAnalyses.reduce((sum: number, t: ToolAnalysis) => sum + t.totalTokens, 0);
  const duplicates = findDuplicatePatterns(toolAnalyses, encoder);
  const potentialSavings = duplicates.reduce((sum, d) => sum + d.totalTokensSaved, 0);

  return {
    generated: new Date().toISOString(),
    version: '1.0.0',
    summary: {
      totalTools: toolAnalyses.length,
      totalTokens,
      duplicatePatterns: duplicates.length,
      potentialSavings,
      savingsPercentage: ((potentialSavings / totalTokens) * 100).toFixed(1) + '%'
    },
    tools: toolAnalyses,
    duplicates
  };
}

// ============================================================================
// Comparison Functions
// ============================================================================

function compareReports(before: AnalysisReport, after: AnalysisReport): BaselineComparison {
  const tokenDiff = after.summary.totalTokens - before.summary.totalTokens;
  const percentChange = ((tokenDiff / before.summary.totalTokens) * 100).toFixed(1);

  // Compare tools
  const beforeToolMap = new Map(before.tools.map(t => [t.name, t]));
  const afterToolMap = new Map(after.tools.map(t => [t.name, t]));

  const allToolNames = new Set([...beforeToolMap.keys(), ...afterToolMap.keys()]);
  const toolDiffs: BaselineComparison['diff']['tools'] = [];

  for (const name of allToolNames) {
    const beforeTool = beforeToolMap.get(name);
    const afterTool = afterToolMap.get(name);

    if (!beforeTool && afterTool) {
      toolDiffs.push({
        name,
        before: 0,
        after: afterTool.totalTokens,
        diff: afterTool.totalTokens,
        status: 'added'
      });
    } else if (beforeTool && !afterTool) {
      toolDiffs.push({
        name,
        before: beforeTool.totalTokens,
        after: 0,
        diff: -beforeTool.totalTokens,
        status: 'removed'
      });
    } else if (beforeTool && afterTool) {
      const diff = afterTool.totalTokens - beforeTool.totalTokens;

      // Detailed property comparison for changed tools
      let propertyChanges: BaselineComparison['diff']['tools'][0]['propertyChanges'];
      if (diff !== 0) {
        propertyChanges = [];
        const beforePropMap = new Map(beforeTool.properties.map(p => [p.name, p]));
        const afterPropMap = new Map(afterTool.properties.map(p => [p.name, p]));
        const allProps = new Set([...beforePropMap.keys(), ...afterPropMap.keys()]);

        for (const propName of allProps) {
          const beforeProp = beforePropMap.get(propName);
          const afterProp = afterPropMap.get(propName);
          const propBefore = beforeProp?.totalTokens || 0;
          const propAfter = afterProp?.totalTokens || 0;
          if (propBefore !== propAfter) {
            propertyChanges.push({
              property: propName,
              before: propBefore,
              after: propAfter,
              diff: propAfter - propBefore
            });
          }
        }
      }

      toolDiffs.push({
        name,
        before: beforeTool.totalTokens,
        after: afterTool.totalTokens,
        diff,
        status: diff === 0 ? 'unchanged' : 'changed',
        propertyChanges
      });
    }
  }

  // Sort by absolute diff (largest changes first)
  toolDiffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  // Find new and removed duplicates
  const beforeDupTexts = new Set(before.duplicates.map(d => d.text));
  const afterDupTexts = new Set(after.duplicates.map(d => d.text));

  const newDuplicates = after.duplicates.filter(d => !beforeDupTexts.has(d.text));
  const removedDuplicates = before.duplicates.filter(d => !afterDupTexts.has(d.text));

  return {
    before,
    after,
    diff: {
      totalTokens: {
        before: before.summary.totalTokens,
        after: after.summary.totalTokens,
        diff: tokenDiff,
        percentChange: (tokenDiff >= 0 ? '+' : '') + percentChange + '%'
      },
      duplicatePatterns: {
        before: before.summary.duplicatePatterns,
        after: after.summary.duplicatePatterns,
        diff: after.summary.duplicatePatterns - before.summary.duplicatePatterns
      },
      potentialSavings: {
        before: before.summary.potentialSavings,
        after: after.summary.potentialSavings,
        diff: after.summary.potentialSavings - before.summary.potentialSavings
      },
      tools: toolDiffs,
      newDuplicates,
      removedDuplicates
    }
  };
}

// ============================================================================
// Formatting Functions
// ============================================================================

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatDiff(n: number): string {
  if (n === 0) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatNumber(n)}`;
}

function formatDiffEmoji(n: number): string {
  if (n === 0) return '';
  if (n > 100) return ' :warning:';
  if (n > 0) return ' :small_red_triangle:';
  if (n < -50) return ' :white_check_mark:';
  return ' :small_red_triangle_down:';
}

function formatReportText(report: AnalysisReport): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════════════════════════════');
  lines.push('                    TOOL DESCRIPTION ANALYSIS REPORT                            ');
  lines.push('═══════════════════════════════════════════════════════════════════════════════');
  lines.push(`Generated: ${report.generated}`);
  lines.push('');

  // Summary
  lines.push('SUMMARY');
  lines.push('───────────────────────────────────────────────────────────────────────────────');
  lines.push(`Total Tools:          ${report.summary.totalTools}`);
  lines.push(`Total Tokens:         ${formatNumber(report.summary.totalTokens)}`);
  lines.push(`Duplicate Patterns:   ${report.summary.duplicatePatterns}`);
  lines.push(`Potential Savings:    ${formatNumber(report.summary.potentialSavings)} (${report.summary.savingsPercentage})`);
  lines.push('');

  // Per-tool breakdown with details
  lines.push('PER-TOOL TOKEN BREAKDOWN');
  lines.push('───────────────────────────────────────────────────────────────────────────────');
  lines.push('');

  const sortedTools = [...report.tools].sort((a, b) => b.totalTokens - a.totalTokens);

  for (const tool of sortedTools) {
    lines.push(`┌─ ${tool.name} ─────────────────────────────────────────────────`);
    lines.push(`│  Total: ${formatNumber(tool.totalTokens)} tokens`);
    lines.push(`│`);
    lines.push(`│  Breakdown:`);
    lines.push(`│    Tool Description:     ${tool.breakdown.toolDescription.toString().padStart(5)} tokens`);
    lines.push(`│    Property Descriptions:${tool.breakdown.propertyDescriptions.toString().padStart(5)} tokens`);
    lines.push(`│    Property Names:       ${tool.breakdown.propertyNames.toString().padStart(5)} tokens`);
    lines.push(`│    Type Definitions:     ${tool.breakdown.typeDefinitions.toString().padStart(5)} tokens`);
    lines.push(`│    Enum Values:          ${tool.breakdown.enumValues.toString().padStart(5)} tokens`);
    lines.push(`│    Structural Overhead:  ${tool.breakdown.structuralOverhead.toString().padStart(5)} tokens`);
    lines.push(`│`);

    // Top 5 largest properties
    const sortedProps = [...tool.properties].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 5);
    if (sortedProps.length > 0) {
      lines.push(`│  Top Properties by Token Count:`);
      for (const prop of sortedProps) {
        const desc = prop.description.length > 40
          ? prop.description.substring(0, 40) + '...'
          : prop.description;
        lines.push(`│    ${prop.name.padEnd(25)} ${prop.totalTokens.toString().padStart(4)} tokens  "${desc}"`);
      }
    }
    lines.push(`└──────────────────────────────────────────────────────────────────`);
    lines.push('');
  }

  // Duplicates
  if (report.duplicates.length > 0) {
    lines.push('DUPLICATE PATTERNS (sorted by potential savings)');
    lines.push('───────────────────────────────────────────────────────────────────────────────');
    lines.push('');

    for (let i = 0; i < Math.min(15, report.duplicates.length); i++) {
      const dup = report.duplicates[i];
      lines.push(`${(i + 1).toString().padStart(2)}. [${dup.occurrences}x occurrences, saves ${dup.totalTokensSaved} tokens]`);
      lines.push(`    Tools: ${dup.tools.join(', ')}`);
      lines.push(`    Locations:`);
      for (const loc of dup.locations.slice(0, 5)) {
        lines.push(`      - ${loc.tool} → ${loc.property}`);
      }
      if (dup.locations.length > 5) {
        lines.push(`      ... and ${dup.locations.length - 5} more`);
      }
      const displayText = dup.text.length > 80 ? dup.text.substring(0, 80) + '...' : dup.text;
      lines.push(`    Text: "${displayText}"`);
      lines.push('');
    }
  }

  lines.push('═══════════════════════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

function formatComparisonMarkdown(comparison: BaselineComparison): string {
  const lines: string[] = [];
  const { diff } = comparison;

  lines.push('## :bar_chart: Tool Description Token Analysis');
  lines.push('');

  // Summary table
  lines.push('### Summary');
  lines.push('');
  lines.push('| Metric | Baseline | Current | Diff |');
  lines.push('|--------|----------|---------|------|');
  lines.push(`| **Total Tokens** | ${formatNumber(diff.totalTokens.before)} | ${formatNumber(diff.totalTokens.after)} | ${formatDiff(diff.totalTokens.diff)}${formatDiffEmoji(diff.totalTokens.diff)} |`);
  lines.push(`| Duplicate Patterns | ${diff.duplicatePatterns.before} | ${diff.duplicatePatterns.after} | ${formatDiff(diff.duplicatePatterns.diff)} |`);
  lines.push(`| Potential Savings | ${formatNumber(diff.potentialSavings.before)} | ${formatNumber(diff.potentialSavings.after)} | ${formatDiff(diff.potentialSavings.diff)} |`);
  lines.push('');

  // Tool changes
  const changedTools = diff.tools.filter(t => t.status !== 'unchanged');
  if (changedTools.length > 0) {
    lines.push('### Tool Changes');
    lines.push('');
    lines.push('| Tool | Baseline | Current | Diff | Status |');
    lines.push('|------|----------|---------|------|--------|');

    for (const tool of changedTools) {
      const statusEmoji = {
        added: ':new:',
        removed: ':x:',
        changed: tool.diff > 0 ? ':arrow_up:' : ':arrow_down:',
        unchanged: '—'
      }[tool.status];

      lines.push(`| \`${tool.name}\` | ${formatNumber(tool.before)} | ${formatNumber(tool.after)} | ${formatDiff(tool.diff)} | ${statusEmoji} |`);
    }
    lines.push('');

    // Detailed property changes for tools with significant changes
    const significantChanges = changedTools.filter(t => t.propertyChanges && t.propertyChanges.length > 0 && Math.abs(t.diff) > 20);
    if (significantChanges.length > 0) {
      lines.push('<details>');
      lines.push('<summary>Property-level changes</summary>');
      lines.push('');

      for (const tool of significantChanges) {
        lines.push(`#### \`${tool.name}\``);
        lines.push('');
        lines.push('| Property | Before | After | Diff |');
        lines.push('|----------|--------|-------|------|');
        for (const prop of tool.propertyChanges!) {
          lines.push(`| \`${prop.property}\` | ${prop.before} | ${prop.after} | ${formatDiff(prop.diff)} |`);
        }
        lines.push('');
      }

      lines.push('</details>');
      lines.push('');
    }
  } else {
    lines.push('_No tool changes detected._');
    lines.push('');
  }

  // Detailed breakdown (collapsible)
  lines.push('<details>');
  lines.push('<summary>Full token breakdown by tool</summary>');
  lines.push('');
  lines.push('| Tool | Description | Props | Names | Types | Enums | Overhead | **Total** |');
  lines.push('|------|-------------|-------|-------|-------|-------|----------|-----------|');

  const sortedTools = [...comparison.after.tools].sort((a, b) => b.totalTokens - a.totalTokens);
  for (const tool of sortedTools) {
    const b = tool.breakdown;
    lines.push(`| \`${tool.name}\` | ${b.toolDescription} | ${b.propertyDescriptions} | ${b.propertyNames} | ${b.typeDefinitions} | ${b.enumValues} | ${b.structuralOverhead} | **${tool.totalTokens}** |`);
  }
  lines.push('');
  lines.push('</details>');
  lines.push('');

  lines.push('---');
  lines.push(`_Generated at ${comparison.after.generated}_`);

  return lines.join('\n');
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'report';

  const baselinePathIndex = args.indexOf('--baseline-path');
  const baselinePath = baselinePathIndex >= 0
    ? args[baselinePathIndex + 1]
    : path.join(process.cwd(), '.github', 'tool-description-baseline.json');

  const outputIndex = args.indexOf('--output');
  const outputFormat = outputIndex >= 0 ? args[outputIndex + 1] : 'text';

  const ciMode = args.includes('--ci');

  try {
    switch (command) {
      case 'report': {
        const report = await generateReport();
        if (outputFormat === 'json') {
          console.log(JSON.stringify(report, null, 2));
        } else {
          console.log(formatReportText(report));
        }
        break;
      }

      case 'baseline': {
        const report = await generateReport();
        const dir = path.dirname(baselinePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(baselinePath, JSON.stringify(report, null, 2));
        console.log(`Baseline saved to ${baselinePath}`);
        console.log(`Total tokens: ${formatNumber(report.summary.totalTokens)}`);
        break;
      }

      case 'compare': {
        if (!fs.existsSync(baselinePath)) {
          console.error(`Baseline file not found: ${baselinePath}`);
          console.error('Run "npx tsx scripts/analyze-tool-descriptions.ts baseline" first.');
          process.exit(1);
        }

        const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8')) as AnalysisReport;
        const current = await generateReport();
        const comparison = compareReports(baseline, current);

        if (outputFormat === 'markdown') {
          console.log(formatComparisonMarkdown(comparison));
        } else if (outputFormat === 'json') {
          console.log(JSON.stringify(comparison, null, 2));
        } else {
          // Text format
          console.log('');
          console.log('COMPARISON WITH BASELINE');
          console.log('========================');
          console.log('');
          console.log(`Total Tokens: ${formatNumber(comparison.diff.totalTokens.before)} → ${formatNumber(comparison.diff.totalTokens.after)} (${comparison.diff.totalTokens.percentChange})`);
          console.log('');

          if (comparison.diff.tools.some(t => t.status !== 'unchanged')) {
            console.log('Changed Tools:');
            for (const tool of comparison.diff.tools.filter(t => t.status !== 'unchanged')) {
              console.log(`  ${tool.name}: ${formatNumber(tool.before)} → ${formatNumber(tool.after)} (${formatDiff(tool.diff)})`);
            }
          }
        }

        // CI mode: fail if token count increased significantly
        if (ciMode && comparison.diff.totalTokens.diff > 500) {
          console.error(`\nCI Check Failed: Token count increased by ${comparison.diff.totalTokens.diff} (threshold: 500)`);
          process.exit(1);
        }
        break;
      }

      case 'json': {
        const report = await generateReport();
        console.log(JSON.stringify(report, null, 2));
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Usage: npx tsx scripts/analyze-tool-descriptions.ts [report|baseline|compare|json]');
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
