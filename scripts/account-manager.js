#!/usr/bin/env node

/**
 * Account Manager Script
 * 
 * This script helps manage OAuth tokens for multiple Google accounts:
 * - Normal account: For regular operations
 * - Test account: For integration testing
 * 
 * Usage:
 *   node scripts/account-manager.js list                    # List available accounts
 *   node scripts/account-manager.js auth normal            # Authenticate normal account
 *   node scripts/account-manager.js auth test              # Authenticate test account
 *   node scripts/account-manager.js status                 # Show current account status
 *   node scripts/account-manager.js clear normal           # Clear normal account tokens
 *   node scripts/account-manager.js clear test             # Clear test account tokens
 *   node scripts/account-manager.js test                   # Run tests with test account
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function colorize(color, text) {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function log(message, color = 'reset') {
  console.log(colorize(color, message));
}

function error(message) {
  console.error(colorize('red', `❌ ${message}`));
}

function success(message) {
  console.log(colorize('green', `✅ ${message}`));
}

function info(message) {
  console.log(colorize('blue', `ℹ️  ${message}`));
}

function warning(message) {
  console.log(colorize('yellow', `⚠️  ${message}`));
}

async function runCommand(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const fullEnv = { ...process.env, ...env };
    const proc = spawn(command, args, {
      stdio: 'inherit',
      env: fullEnv,
      cwd: projectRoot
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

// Import shared path utilities
import { getSecureTokenPath } from '../src/auth/paths.js';

async function loadTokens() {
  const tokenPath = getSecureTokenPath();
  try {
    const content = await fs.readFile(tokenPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function listAccounts() {
  log('\n' + colorize('bright', '📋 Available Accounts:'));
  
  try {
    const tokens = await loadTokens();
    
    // Check if this is the old single-account format
    if (tokens.access_token || tokens.refresh_token) {
      log('  ' + colorize('yellow', '⚠️  Old token format detected. Will be migrated on next auth.'));
      
      const hasAccessToken = !!tokens.access_token;
      const hasRefreshToken = !!tokens.refresh_token;
      const isExpired = tokens.expiry_date ? Date.now() >= tokens.expiry_date : true;
      
      const status = hasAccessToken && hasRefreshToken && !isExpired ? 
        colorize('green', '✓ Active') : 
        hasRefreshToken ? 
          colorize('yellow', '⟳ Needs Refresh') : 
          colorize('red', '✗ Invalid');
      
      log(`  ${colorize('cyan', 'normal'.padEnd(10))} ${status} (legacy format)`);
      return;
    }
    
    // New multi-account format
    const accounts = Object.keys(tokens);
    
    if (accounts.length === 0) {
      warning('No accounts found. Use "auth" command to authenticate.');
      return;
    }
    
    for (const account of accounts) {
      const tokenInfo = tokens[account];
      const hasAccessToken = !!tokenInfo.access_token;
      const hasRefreshToken = !!tokenInfo.refresh_token;
      const isExpired = tokenInfo.expiry_date ? Date.now() >= tokenInfo.expiry_date : true;
      
      const status = hasAccessToken && hasRefreshToken && !isExpired ? 
        colorize('green', '✓ Active') : 
        hasRefreshToken ? 
          colorize('yellow', '⟳ Needs Refresh') : 
          colorize('red', '✗ Invalid');
      
      log(`  ${colorize('cyan', account.padEnd(10))} ${status}`);
    }
  } catch (error) {
    error(`Failed to load token information: ${error.message}`);
  }
}

async function authenticateAccount(accountMode) {
  if (!['normal', 'test'].includes(accountMode)) {
    error('Account mode must be "normal" or "test"');
    process.exit(1);
  }
  
  log(`\n🔐 Authenticating ${colorize('cyan', accountMode)} account...`);
  
  try {
    await runCommand('npm', ['run', 'auth'], {
      GOOGLE_ACCOUNT_MODE: accountMode
    });
    success(`Successfully authenticated ${accountMode} account!`);
  } catch (error) {
    error(`Failed to authenticate ${accountMode} account: ${error.message}`);
    process.exit(1);
  }
}

async function showStatus() {
  log('\n' + colorize('bright', '📊 Account Status:'));
  
  const currentMode = process.env.GOOGLE_ACCOUNT_MODE || 'normal';
  log(`  Current Mode: ${colorize('cyan', currentMode)}`);
  
  await listAccounts();
  
  // Show environment variables relevant to testing
  log('\n' + colorize('bright', '🧪 Test Configuration:'));
  const testVars = [
    'TEST_CALENDAR_ID',
    'INVITEE_1', 
    'INVITEE_2',
    'CLAUDE_API_KEY'
  ];
  
  for (const varName of testVars) {
    const value = process.env[varName];
    if (value) {
      const displayValue = varName === 'CLAUDE_API_KEY' ? 
        value.substring(0, 8) + '...' : value;
      log(`  ${varName.padEnd(20)}: ${colorize('green', displayValue)}`);
    } else {
      log(`  ${varName.padEnd(20)}: ${colorize('red', 'Not set')}`);
    }
  }
}

async function clearAccount(accountMode) {
  if (!['normal', 'test'].includes(accountMode)) {
    error('Account mode must be "normal" or "test"');
    process.exit(1);
  }
  
  log(`\n🗑️  Clearing ${colorize('cyan', accountMode)} account tokens...`);
  
  try {
    const tokens = await loadTokens();
    
    if (!tokens[accountMode]) {
      warning(`No tokens found for ${accountMode} account`);
      return;
    }
    
    delete tokens[accountMode];
    
    const tokenPath = getSecureTokenPath();
    
    if (Object.keys(tokens).length === 0) {
      await fs.unlink(tokenPath);
      success('All tokens cleared, file deleted');
    } else {
      await fs.writeFile(tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
      success(`Cleared tokens for ${accountMode} account`);
    }
  } catch (error) {
    error(`Failed to clear ${accountMode} account: ${error.message}`);
    process.exit(1);
  }
}

async function runTests() {
  log('\n🧪 Running integration tests with test account...');
  
  try {
    await runCommand('npm', ['test'], {
      GOOGLE_ACCOUNT_MODE: 'test'
    });
    success('Tests completed successfully!');
  } catch (error) {
    error(`Tests failed: ${error.message}`);
    process.exit(1);
  }
}

function showUsage() {
  log('\n' + colorize('bright', 'Google Calendar Account Manager'));
  log('\nManage OAuth tokens for multiple Google accounts (normal & test)');
  log('\n' + colorize('bright', 'Usage:'));
  log('  node scripts/account-manager.js <command> [args]');
  log('\n' + colorize('bright', 'Commands:'));
  log('  list                    List available accounts and their status');
  log('  auth <normal|test>      Authenticate the specified account');
  log('  status                  Show current account status and configuration');
  log('  clear <normal|test>     Clear tokens for the specified account');
  log('  test                    Run integration tests with test account');
  log('  help                    Show this help message');
  log('\n' + colorize('bright', 'Examples:'));
  log('  node scripts/account-manager.js auth test     # Authenticate test account');
  log('  node scripts/account-manager.js test          # Run tests with test account');
  log('  node scripts/account-manager.js status        # Check account status');
  log('\n' + colorize('bright', 'Environment Variables:'));
  log('  GOOGLE_ACCOUNT_MODE     Set to "test" or "normal" (default: normal)');
  log('  TEST_CALENDAR_ID        Calendar ID to use for testing');
  log('  INVITEE_1, INVITEE_2    Email addresses for testing invitations');
  log('  CLAUDE_API_KEY          API key for Claude integration tests');
}

async function main() {
  const command = process.argv[2];
  const arg = process.argv[3];
  
  switch (command) {
    case 'list':
      await listAccounts();
      break;
    case 'auth':
      if (!arg) {
        error('Please specify account mode: normal or test');
        process.exit(1);
      }
      await authenticateAccount(arg);
      break;
    case 'status':
      await showStatus();
      break;
    case 'clear':
      if (!arg) {
        error('Please specify account mode: normal or test');
        process.exit(1);
      }
      await clearAccount(arg);
      break;
    case 'test':
      await runTests();
      break;
    case 'help':
    case '--help':
    case '-h':
      showUsage();
      break;
    default:
      if (command) {
        error(`Unknown command: ${command}`);
      }
      showUsage();
      process.exit(1);
  }
}

// Handle uncaught errors
process.on('unhandledRejection', (reason, promise) => {
  error(`Unhandled rejection at: ${promise}, reason: ${reason}`);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  error(`Uncaught exception: ${error.message}`);
  process.exit(1);
});

main().catch((error) => {
  error(`Script failed: ${error.message}`);
  process.exit(1);
}); 