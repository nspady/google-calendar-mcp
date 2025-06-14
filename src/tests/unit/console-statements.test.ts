/**
 * Test to ensure no console.log statements exist in the source code
 * This helps maintain MCP compliance since console statements are not supported in MCP clients
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

// Files and directories that are allowed to have console statements
const ALLOWED_CONSOLE_FILES = [
  // Example files are allowed to have console statements
  'examples/',
  // Build scripts are allowed to have console statements  
  'scripts/',
  // Test files can have console statements for debugging
  '.test.ts',
  '.test.js',
  // Documentation files
  '.md',
  // Config files
  'vitest.config.ts',
  'tsconfig.json'
];

// Console methods that should not be present in source code
const FORBIDDEN_CONSOLE_METHODS = [
  'console.log',
  'console.warn',
  'console.info',
  'console.debug',
  'console.trace',
  'console.time',
  'console.timeEnd',
  'console.table',
  'console.assert',
  'console.clear',
  'console.count',
  'console.countReset',
  'console.dir',
  'console.dirxml',
  'console.group',
  'console.groupCollapsed',
  'console.groupEnd'
];

interface ConsoleFinding {
  file: string;
  line: number;
  content: string;
  method: string;
}

/**
 * Recursively get all TypeScript and JavaScript files in a directory
 */
function getSourceFiles(dir: string, basePath: string = ''): string[] {
  const files: string[] = [];
  const items = readdirSync(dir);

  for (const item of items) {
    const fullPath = join(dir, item);
    const relativePath = join(basePath, item);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip node_modules and other non-source directories
      if (!['node_modules', '.git', 'build', 'dist', 'coverage'].includes(item)) {
        files.push(...getSourceFiles(fullPath, relativePath));
      }
    } else if (stat.isFile()) {
      const ext = extname(item);
      if (['.ts', '.js', '.mjs', '.cjs'].includes(ext)) {
        files.push(relativePath);
      }
    }
  }

  return files;
}

/**
 * Check if a file should be excluded from console statement checking
 */
function isFileAllowed(filePath: string): boolean {
  return ALLOWED_CONSOLE_FILES.some(allowedPath => 
    filePath.includes(allowedPath) || filePath.endsWith(allowedPath)
  );
}

/**
 * Find console statements in a file
 */
function findConsoleStatements(filePath: string, content: string): ConsoleFinding[] {
  const findings: ConsoleFinding[] = [];
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    
    // Skip comments
    if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*') || trimmedLine.startsWith('/*')) {
      return;
    }

    // Check for console statements
    for (const method of FORBIDDEN_CONSOLE_METHODS) {
      if (line.includes(method)) {
        // Make sure it's not in a string literal or comment
        const methodIndex = line.indexOf(method);
        const beforeMethod = line.substring(0, methodIndex);
        
        // Simple check to avoid false positives in strings
        const singleQuotes = (beforeMethod.match(/'/g) || []).length;
        const doubleQuotes = (beforeMethod.match(/"/g) || []).length;
        const backticks = (beforeMethod.match(/`/g) || []).length;
        
        // If we're inside quotes, skip this match
        if (singleQuotes % 2 === 1 || doubleQuotes % 2 === 1 || backticks % 2 === 1) {
          continue;
        }

        findings.push({
          file: filePath,
          line: index + 1,
          content: line.trim(),
          method
        });
      }
    }
  });

  return findings;
}

describe('Console Statement Detection', () => {
  it('should not contain any console.log statements in source code', () => {
    const sourceFiles = getSourceFiles('./src');
    const allFindings: ConsoleFinding[] = [];

    for (const file of sourceFiles) {
      // Skip files that are allowed to have console statements
      if (isFileAllowed(file)) {
        continue;
      }

      try {
        const fullPath = join('./src', file);
        const content = readFileSync(fullPath, 'utf-8');
        const findings = findConsoleStatements(file, content);
        allFindings.push(...findings);
      } catch (error) {
        // Skip files that can't be read
        continue;
      }
    }

    // Create a detailed error message if console statements are found
    if (allFindings.length > 0) {
      const errorMessage = [
        `Found ${allFindings.length} console statement(s) in source code:`,
        '',
        ...allFindings.map(finding => 
          `  ${finding.file}:${finding.line} - ${finding.method} in: ${finding.content}`
        ),
        '',
        'Console statements are not supported in MCP clients.',
        'Use process.stderr.write() for error logging instead.',
        'For debugging, consider using a proper logging library or remove before committing.'
      ].join('\n');

      expect(allFindings).toEqual([]);
      throw new Error(errorMessage);
    }

    expect(allFindings).toEqual([]);
  });

  it('should properly detect console statements in test content', () => {
    // Test the detection logic itself with some sample content
    const testContent = `
      function test() {
        console.log("This should be detected");
        const x = "console.log in string should be ignored";
        // console.warn("This is a comment, should be ignored");
        console.warn("This should be detected");
        console.error("This is now allowed and should not be detected");
        process.stderr.write("This is allowed\\n");
      }
    `;

    const findings = findConsoleStatements('test-file.ts', testContent);
    
    expect(findings).toHaveLength(2);
    expect(findings[0].method).toBe('console.log');
    expect(findings[1].method).toBe('console.warn');
  });

  it('should ignore console statements in strings and comments', () => {
    const testContent = `
      // This console.log is in a comment
      const message = "Use console.log for debugging";
      const template = \`Don't use console.error here\`;
      /* console.warn in block comment */
    `;

    const findings = findConsoleStatements('test-file.ts', testContent);
    
    // Should not find any console statements since they're all in comments or strings
    expect(findings).toHaveLength(0);
  });
}); 