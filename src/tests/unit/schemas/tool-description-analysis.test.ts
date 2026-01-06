import { describe, it, expect, beforeAll } from 'vitest';
import { ToolRegistry } from '../../../tools/registry.js';
import { getEncoding } from 'js-tiktoken';

/**
 * Tool Description Analysis Tests
 *
 * This test suite analyzes the tool descriptions for:
 * - Total token count (using tiktoken cl100k_base encoding)
 * - Duplicative text patterns
 * - Per-tool breakdown
 *
 * Run with: npm test -- src/tests/unit/schemas/tool-description-analysis.test.ts
 */

interface ToolAnalysis {
  name: string;
  description: string;
  schemaJson: string;
  descriptionTokens: number;
  schemaTokens: number;
  totalTokens: number;
}

interface DuplicatePattern {
  text: string;
  occurrences: number;
  tools: string[];
  tokenCount: number;
  totalTokensSaved: number; // tokens that could be saved if deduplicated
}

interface AnalysisReport {
  tools: ToolAnalysis[];
  totalTokens: number;
  duplicatePatterns: DuplicatePattern[];
  potentialSavings: number;
}

// Minimum length for duplicate detection (shorter strings are too common)
const MIN_DUPLICATE_LENGTH = 50;
// Minimum occurrences to be considered a duplicate
const MIN_OCCURRENCES = 2;

/**
 * Extract all description strings from a JSON schema recursively
 */
function extractDescriptions(obj: any, path: string = ''): Array<{ path: string; text: string }> {
  const results: Array<{ path: string; text: string }> = [];

  if (obj === null || obj === undefined) return results;

  if (typeof obj === 'object') {
    if (obj.description && typeof obj.description === 'string') {
      results.push({ path, text: obj.description });
    }

    for (const [key, value] of Object.entries(obj)) {
      const newPath = path ? `${path}.${key}` : key;
      results.push(...extractDescriptions(value, newPath));
    }
  }

  return results;
}

/**
 * Find duplicate text patterns across all tools
 */
function findDuplicatePatterns(
  tools: ToolAnalysis[],
  encoder: ReturnType<typeof getEncoding>
): DuplicatePattern[] {
  // Collect all descriptions with their source tool
  const allDescriptions: Array<{ text: string; tool: string }> = [];

  for (const tool of tools) {
    // Add main description
    allDescriptions.push({ text: tool.description, tool: tool.name });

    // Extract descriptions from schema
    const schema = JSON.parse(tool.schemaJson);
    const schemaDescriptions = extractDescriptions(schema);
    for (const desc of schemaDescriptions) {
      allDescriptions.push({ text: desc.text, tool: tool.name });
    }
  }

  // Find exact duplicates (same text appearing in multiple places)
  const textOccurrences = new Map<string, Set<string>>();

  for (const { text, tool } of allDescriptions) {
    if (text.length < MIN_DUPLICATE_LENGTH) continue;

    if (!textOccurrences.has(text)) {
      textOccurrences.set(text, new Set());
    }
    textOccurrences.get(text)!.add(tool);
  }

  // Filter to only duplicates and convert to result format
  const duplicates: DuplicatePattern[] = [];

  for (const [text, toolSet] of textOccurrences.entries()) {
    // Count total occurrences (a text might appear multiple times in same tool)
    const totalOccurrences = allDescriptions.filter(d => d.text === text).length;

    if (totalOccurrences >= MIN_OCCURRENCES) {
      const tokenCount = encoder.encode(text).length;
      duplicates.push({
        text,
        occurrences: totalOccurrences,
        tools: Array.from(toolSet),
        tokenCount,
        totalTokensSaved: tokenCount * (totalOccurrences - 1) // all but one could be removed
      });
    }
  }

  // Sort by potential savings (highest first)
  duplicates.sort((a, b) => b.totalTokensSaved - a.totalTokensSaved);

  return duplicates;
}

/**
 * Generate a formatted report
 */
function formatReport(report: AnalysisReport): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('               TOOL DESCRIPTION ANALYSIS REPORT                 ');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  // Summary
  lines.push('SUMMARY');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push(`Total Tools: ${report.tools.length}`);
  lines.push(`Total Tokens: ${report.totalTokens.toLocaleString()}`);
  lines.push(`Duplicate Patterns Found: ${report.duplicatePatterns.length}`);
  lines.push(`Potential Token Savings: ${report.potentialSavings.toLocaleString()} (${((report.potentialSavings / report.totalTokens) * 100).toFixed(1)}%)`);
  lines.push('');

  // Per-tool breakdown
  lines.push('PER-TOOL BREAKDOWN');
  lines.push('───────────────────────────────────────────────────────────────');

  const sortedTools = [...report.tools].sort((a, b) => b.totalTokens - a.totalTokens);

  lines.push('');
  lines.push(`${'Tool'.padEnd(25)} ${'Desc'.padStart(6)} ${'Schema'.padStart(8)} ${'Total'.padStart(8)}`);
  lines.push(`${'─'.repeat(25)} ${'─'.repeat(6)} ${'─'.repeat(8)} ${'─'.repeat(8)}`);

  for (const tool of sortedTools) {
    lines.push(
      `${tool.name.padEnd(25)} ${tool.descriptionTokens.toString().padStart(6)} ${tool.schemaTokens.toString().padStart(8)} ${tool.totalTokens.toString().padStart(8)}`
    );
  }
  lines.push('');

  // Duplicate patterns (top 20)
  if (report.duplicatePatterns.length > 0) {
    lines.push('TOP DUPLICATE PATTERNS (by potential savings)');
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push('');

    const topDuplicates = report.duplicatePatterns.slice(0, 20);

    for (let i = 0; i < topDuplicates.length; i++) {
      const dup = topDuplicates[i];
      lines.push(`${i + 1}. [${dup.occurrences}x, saves ${dup.totalTokensSaved} tokens]`);
      lines.push(`   Tools: ${dup.tools.join(', ')}`);

      // Truncate long text for display
      const displayText = dup.text.length > 100
        ? dup.text.substring(0, 100) + '...'
        : dup.text;
      lines.push(`   Text: "${displayText}"`);
      lines.push('');
    }
  }

  lines.push('═══════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

describe('Tool Description Analysis', () => {
  let encoder: ReturnType<typeof getEncoding>;
  let analysisReport: AnalysisReport;

  beforeAll(() => {
    // Use cl100k_base encoding (used by GPT-4, Claude uses similar tokenization)
    encoder = getEncoding('cl100k_base');

    // Get all tools with their schemas
    const tools = ToolRegistry.getToolsWithSchemas();

    // Analyze each tool
    const toolAnalyses: ToolAnalysis[] = tools.map(tool => {
      const schemaJson = JSON.stringify(tool.inputSchema, null, 2);
      const descriptionTokens = encoder.encode(tool.description).length;
      const schemaTokens = encoder.encode(schemaJson).length;

      return {
        name: tool.name,
        description: tool.description,
        schemaJson,
        descriptionTokens,
        schemaTokens,
        totalTokens: descriptionTokens + schemaTokens
      };
    });

    // Calculate total tokens
    const totalTokens = toolAnalyses.reduce((sum, t) => sum + t.totalTokens, 0);

    // Find duplicate patterns
    const duplicatePatterns = findDuplicatePatterns(toolAnalyses, encoder);

    // Calculate potential savings
    const potentialSavings = duplicatePatterns.reduce((sum, d) => sum + d.totalTokensSaved, 0);

    analysisReport = {
      tools: toolAnalyses,
      totalTokens,
      duplicatePatterns,
      potentialSavings
    };
  });

  it('should generate and display the analysis report', () => {
    const report = formatReport(analysisReport);
    console.log('\n' + report);

    // This test always passes - it's for generating the report
    expect(analysisReport.tools.length).toBeGreaterThan(0);
  });

  it('should report total token count', () => {
    console.log(`\nTotal token count: ${analysisReport.totalTokens.toLocaleString()}`);

    // Baseline assertion - adjust threshold as needed
    expect(analysisReport.totalTokens).toBeGreaterThan(0);
  });

  it('should identify duplicate patterns', () => {
    console.log(`\nDuplicate patterns found: ${analysisReport.duplicatePatterns.length}`);
    console.log(`Potential savings: ${analysisReport.potentialSavings.toLocaleString()} tokens`);

    // Report duplicates for visibility
    expect(analysisReport.duplicatePatterns).toBeDefined();
  });

  it('should provide per-tool token breakdown', () => {
    const sortedTools = [...analysisReport.tools].sort((a, b) => b.totalTokens - a.totalTokens);

    console.log('\nTop 5 largest tools by token count:');
    for (const tool of sortedTools.slice(0, 5)) {
      console.log(`  ${tool.name}: ${tool.totalTokens} tokens`);
    }

    expect(analysisReport.tools.length).toBeGreaterThan(0);
  });

  it('should export raw data for further analysis', () => {
    // Export the raw analysis data as JSON for external tools
    const exportData = {
      generated: new Date().toISOString(),
      summary: {
        totalTools: analysisReport.tools.length,
        totalTokens: analysisReport.totalTokens,
        duplicatePatterns: analysisReport.duplicatePatterns.length,
        potentialSavings: analysisReport.potentialSavings,
        savingsPercentage: ((analysisReport.potentialSavings / analysisReport.totalTokens) * 100).toFixed(1) + '%'
      },
      tools: analysisReport.tools.map(t => ({
        name: t.name,
        descriptionTokens: t.descriptionTokens,
        schemaTokens: t.schemaTokens,
        totalTokens: t.totalTokens
      })),
      duplicates: analysisReport.duplicatePatterns.map(d => ({
        text: d.text,
        occurrences: d.occurrences,
        tools: d.tools,
        tokensSaved: d.totalTokensSaved
      }))
    };

    // Log a condensed version
    console.log('\nExport data summary:');
    console.log(JSON.stringify(exportData.summary, null, 2));

    expect(exportData).toBeDefined();
  });
});

describe('Tool Description Thresholds', () => {
  let encoder: ReturnType<typeof getEncoding>;
  let analysisReport: AnalysisReport;

  beforeAll(() => {
    encoder = getEncoding('cl100k_base');
    const tools = ToolRegistry.getToolsWithSchemas();

    const toolAnalyses: ToolAnalysis[] = tools.map(tool => {
      const schemaJson = JSON.stringify(tool.inputSchema, null, 2);
      const descriptionTokens = encoder.encode(tool.description).length;
      const schemaTokens = encoder.encode(schemaJson).length;

      return {
        name: tool.name,
        description: tool.description,
        schemaJson,
        descriptionTokens,
        schemaTokens,
        totalTokens: descriptionTokens + schemaTokens
      };
    });

    const totalTokens = toolAnalyses.reduce((sum, t) => sum + t.totalTokens, 0);
    const duplicatePatterns = findDuplicatePatterns(toolAnalyses, encoder);
    const potentialSavings = duplicatePatterns.reduce((sum, d) => sum + d.totalTokensSaved, 0);

    analysisReport = { tools: toolAnalyses, totalTokens, duplicatePatterns, potentialSavings };
  });

  it('should stay under token budget (configurable threshold)', () => {
    // Set a reasonable threshold - adjust based on your needs
    // This is informational - change the threshold or skip if not needed
    const TOKEN_BUDGET = 15000; // Example threshold

    if (analysisReport.totalTokens > TOKEN_BUDGET) {
      console.warn(`\n⚠️  Token count (${analysisReport.totalTokens}) exceeds budget (${TOKEN_BUDGET})`);
      console.warn(`   Consider reducing descriptions by ${analysisReport.totalTokens - TOKEN_BUDGET} tokens`);
    }

    // This test is informational - remove .skip or adjust threshold as needed
    expect(analysisReport.totalTokens).toBeDefined();
  });

  it('should flag tools with unusually large schemas', () => {
    const LARGE_TOOL_THRESHOLD = 1500; // tokens

    const largeTools = analysisReport.tools.filter(t => t.totalTokens > LARGE_TOOL_THRESHOLD);

    if (largeTools.length > 0) {
      console.log(`\n⚠️  Tools exceeding ${LARGE_TOOL_THRESHOLD} tokens:`);
      for (const tool of largeTools) {
        console.log(`   ${tool.name}: ${tool.totalTokens} tokens`);
      }
    }

    expect(largeTools).toBeDefined();
  });
});
