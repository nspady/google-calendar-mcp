#!/usr/bin/env node

/**
 * Account Manager Script
 *
 * This script helps manage OAuth tokens for multiple Google accounts.
 * Supports arbitrary account IDs (e.g., "work", "personal", "family", "test").
 * Each account ID must be 1-64 characters: lowercase letters, numbers, dashes, underscores.
 *
 * Usage:
 *   node scripts/account-manager.js list                    # List all authenticated accounts
 *   node scripts/account-manager.js auth work              # Authenticate work account
 *   node scripts/account-manager.js auth personal          # Authenticate personal account
 *   node scripts/account-manager.js status                 # Show current account status
 *   node scripts/account-manager.js clear work             # Clear work account tokens
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

async function authenticateAccount(accountId) {
  // Validate account ID format (same as src/auth/paths.js)
  if (!/^[a-z0-9_-]{1,64}$/.test(accountId)) {
    error('Invalid account ID. Must be 1-64 characters: lowercase letters, numbers, dashes, underscores only.');
    process.exit(1);
  }
  
  const isReserved = ['.', '..', 'con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4', 'lpt1', 'lpt2', 'lpt3'].includes(accountId);
  if (isReserved) {
    error(`Account ID "${accountId}" is reserved and cannot be used.`);
    process.exit(1);
  }
  
  log(`\n🔐 Authenticating ${colorize('cyan', accountId)} account...`);
  
  try {
    await runCommand('npm', ['run', 'auth'], {
      GOOGLE_ACCOUNT_MODE: accountId
    });
    success(`Successfully authenticated ${accountId} account!`);
  } catch (error) {
    error(`Failed to authenticate ${accountId} account: ${error.message}`);
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

async function clearAccount(accountId) {
  // Validate account ID format
  if (!/^[a-z0-9_-]{1,64}$/.test(accountId)) {
    error('Invalid account ID. Must be 1-64 characters: lowercase letters, numbers, dashes, underscores only.');
    process.exit(1);
  }
  
  log(`\n🗑️  Clearing ${colorize('cyan', accountId)} account tokens...`);
  
  try {
    const tokens = await loadTokens();
    
    if (!tokens[accountId]) {
      warning(`No tokens found for ${accountId} account`);
      return;
    }
    
    delete tokens[accountId];
    
    const tokenPath = getSecureTokenPath();
    
    if (Object.keys(tokens).length === 0) {
      await fs.unlink(tokenPath);
      success('All tokens cleared, file deleted');
    } else {
      await fs.writeFile(tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
      success(`Cleared tokens for ${accountId} account`);
    }
  } catch (error) {
    error(`Failed to clear ${accountId} account: ${error.message}`);
    process.exit(1);
  }
}

function showUsage() {
  log('\n' + colorize('bright', 'Google Calendar Account Manager'));
  log('\nManage OAuth tokens for multiple Google accounts');
  log('\n' + colorize('bright', 'Usage:'));
  log('  npm run account <command> [args]');
  log('\n' + colorize('bright', 'Commands:'));
  log('  list                    List available accounts and their status');
  log('  auth <account_id>       Authenticate the specified account (e.g., work, personal)');
  log('  status                  Show current account status and configuration');
  log('  clear <account_id>      Clear tokens for the specified account');
  log('  help                    Show this help message');
  log('\n' + colorize('bright', 'Examples:'));
  log('  npm run account auth work      # Authenticate work account');
  log('  npm run account auth personal  # Authenticate personal account');
  log('  npm run account list           # List all accounts');
  log('  npm run account status         # Check account status');
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
        error('Please specify account ID (e.g., work, personal)');
        process.exit(1);
      }
      await authenticateAccount(arg);
      break;
    case 'status':
      await showStatus();
      break;
    case 'clear':
      if (!arg) {
        error('Please specify account ID (e.g., work, personal)');
        process.exit(1);
      }
      await clearAccount(arg);
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