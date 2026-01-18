#!/usr/bin/env node
/**
 * Checks that all imported packages are declared in package.json dependencies.
 * Catches cases where code imports from transitive dependencies.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Read package.json
const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
const declaredDeps = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  ...Object.keys(pkg.peerDependencies || {})
]);

// Built-in Node.js modules to ignore
const builtins = new Set([
  'fs', 'path', 'url', 'http', 'https', 'crypto', 'os', 'stream',
  'util', 'events', 'buffer', 'querystring', 'net', 'child_process',
  'fs/promises', 'node:fs', 'node:path', 'node:url', 'node:crypto',
  'node:child_process', 'node:http', 'node:https', 'node:os', 'node:stream',
  'node:util', 'node:events', 'node:buffer', 'node:querystring', 'node:net'
]);

// Find all .ts files in src/
function findTsFiles(dir, files = []) {
  for (const file of readdirSync(dir)) {
    const fullPath = join(dir, file);
    if (statSync(fullPath).isDirectory()) {
      if (!file.includes('node_modules') && !file.startsWith('.')) {
        findTsFiles(fullPath, files);
      }
    } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

// Extract imports from a file
function extractImports(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const imports = new Set();

  // Match: import ... from 'package' or import 'package'
  const importRegex = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    // Skip relative imports
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      // Get package name (handle scoped packages like @google-cloud/local-auth)
      const parts = importPath.split('/');
      const pkgName = importPath.startsWith('@')
        ? `${parts[0]}/${parts[1]}`
        : parts[0];
      imports.add(pkgName);
    }
  }
  return imports;
}

// Main
const srcDir = join(rootDir, 'src');
const files = findTsFiles(srcDir);
const allImports = new Map(); // package -> [files]

for (const file of files) {
  const imports = extractImports(file);
  for (const pkg of imports) {
    if (!allImports.has(pkg)) {
      allImports.set(pkg, []);
    }
    allImports.get(pkg).push(file.replace(rootDir + '/', ''));
  }
}

// Check for undeclared dependencies
const undeclared = [];
for (const [pkg, files] of allImports) {
  if (!declaredDeps.has(pkg) && !builtins.has(pkg)) {
    undeclared.push({ pkg, files });
  }
}

if (undeclared.length > 0) {
  console.error('❌ Found imports from undeclared dependencies:\n');
  for (const { pkg, files } of undeclared) {
    console.error(`  📦 ${pkg}`);
    for (const file of files.slice(0, 3)) {
      console.error(`     └─ ${file}`);
    }
    if (files.length > 3) {
      console.error(`     └─ ... and ${files.length - 3} more files`);
    }
  }
  console.error('\n💡 Fix: Add these packages to dependencies in package.json');
  console.error('   npm install ' + undeclared.map(u => u.pkg).join(' '));
  process.exit(1);
} else {
  console.log('✅ All imports are from declared dependencies');
}
