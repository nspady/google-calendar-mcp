#!/usr/bin/env node

/**
 * Development and Advanced Features Helper
 * Provides access to advanced scripts without cluttering package.json
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Command definitions
const commands = {
  // HTTP Transport
  'http': {
    description: 'Start HTTP server on localhost:3000',
    cmd: 'node',
    args: ['build/index.js', '--transport', 'http', '--port', '3000']
  },
  'http:public': {
    description: 'Start HTTP server accessible from any host',
    cmd: 'node', 
    args: ['build/index.js', '--transport', 'http', '--port', '3000', '--host', '0.0.0.0']
  },

  // Authentication Management
  'auth': {
    description: 'Manually authenticate normal account',
    cmd: 'node',
    args: ['build/auth-server.js'],
    env: { GOOGLE_ACCOUNT_MODE: 'normal' }
  },
  'auth:test': {
    description: 'Authenticate test account',
    cmd: 'node',
    args: ['build/auth-server.js'],
    env: { GOOGLE_ACCOUNT_MODE: 'test' }
  },
  'account:status': {
    description: 'Check account status and configuration',
    cmd: 'node',
    args: ['scripts/account-manager.js', 'status']
  },
  'account:clear:normal': {
    description: 'Clear normal account tokens',
    cmd: 'node',
    args: ['scripts/account-manager.js', 'clear', 'normal']
  },
  'account:clear:test': {
    description: 'Clear test account tokens',
    cmd: 'node',
    args: ['scripts/account-manager.js', 'clear', 'test']
  },

  // Unit Testing
  'test': {
    description: 'Run unit tests (excludes integration tests)',
    cmd: 'npm',
    args: ['test']
  },
  'test:integration:direct': {
    description: 'Run core integration tests (recommended for development)',
    cmd: 'npx',
    args: ['vitest', 'run', 'src/tests/integration/direct-integration.test.ts']
  },
  'test:integration:claude': {
    description: 'Run Claude + MCP integration tests',
    cmd: 'npx',
    args: ['vitest', 'run', 'src/tests/integration/claude-mcp-integration.test.ts']
  },
  'test:integration:openai': {
    description: 'Run OpenAI + MCP integration tests',
    cmd: 'npx',
    args: ['vitest', 'run', 'src/tests/integration/openai-mcp-integration.test.ts']
  },
  'test:integration:all': {
    description: 'Run complete integration test suite',
    cmd: 'npm',
    args: ['run', 'test:integration']
  },
  'test:watch:all': {
    description: 'Run all tests in watch mode',
    cmd: 'npx',
    args: ['vitest']
  },

  // Coverage and Analysis
  'coverage': {
    description: 'Generate test coverage report',
    cmd: 'npm',
    args: ['run', 'test:coverage']
  },

  // Docker Operations
  'docker:build': {
    description: 'Build Docker image',
    cmd: 'docker',
    args: ['compose', 'build']
  },
  'docker:up': {
    description: 'Start Docker container (stdio mode)',
    cmd: 'docker',
    args: ['compose', 'up']
  },
  'docker:up:http': {
    description: 'Start Docker container in HTTP mode (edit docker-compose.yml first)',
    cmd: 'docker',
    args: ['compose', 'up']
  },
  'docker:down': {
    description: 'Stop and remove Docker container',
    cmd: 'docker',
    args: ['compose', 'down']
  },
  'docker:logs': {
    description: 'View Docker container logs',
    cmd: 'docker',
    args: ['compose', 'logs', '-f']
  },
  'docker:exec': {
    description: 'Execute commands in running Docker container',
    cmd: 'docker',
    args: ['compose', 'exec', 'calendar-mcp', 'sh']
  },
  'docker:auth': {
    description: 'Authenticate OAuth in Docker container',
    cmd: 'docker',
    args: ['compose', 'exec', 'calendar-mcp', 'npm', 'run', 'auth']
  },
  'docker:test:quick': {
    description: 'Run quick Docker tests (no OAuth required)',
    cmd: 'bash',
    args: ['scripts/test-docker.sh', '--quick']
  },

};

function showHelp() {
  console.log('🛠️  Google Calendar MCP - Development Helper\n');
  console.log('Usage: npm run dev <command>\n');
  console.log('Available commands:\n');

  const categories = {
    'HTTP Transport': ['http', 'http:public'],
    'Authentication': ['auth', 'auth:test', 'account:status', 'account:clear:normal', 'account:clear:test'],
    'Unit Testing': ['test'],
    'Integration Testing': ['test:integration:direct', 'test:integration:claude', 'test:integration:openai', 'test:integration:all', 'test:watch:all'],
    'Docker Operations': ['docker:build', 'docker:up', 'docker:up:http', 'docker:auth', 'docker:logs', 'docker:down', 'docker:exec', 'docker:test:quick'],
    'Coverage & Analysis': ['coverage']
  };

  for (const [category, cmdList] of Object.entries(categories)) {
    console.log(`\x1b[1m${category}:\x1b[0m`);
    for (const cmd of cmdList) {
      if (commands[cmd]) {
        console.log(`  ${cmd.padEnd(25)} ${commands[cmd].description}`);
      }
    }
    console.log('');
  }

  console.log('Examples:');
  console.log('  npm run dev http                  # Start HTTP server');
  console.log('  npm run dev docker:up             # Start Docker container');
  console.log('  npm run dev docker:auth           # Authenticate in Docker');
  console.log('  npm run dev test:integration:direct # Run core integration tests');
}

async function runCommand(commandName) {
  const command = commands[commandName];
  if (!command) {
    console.error(`❌ Unknown command: ${commandName}`);
    console.log('\nRun "npm run dev" to see available commands.');
    process.exit(1);
  }

  // Handle preBuild flag
  if (command.preBuild) {
    console.log(`📦 Building project first...`);
    await new Promise((resolve, reject) => {
      const buildChild = spawn('npm', ['run', 'build'], {
        stdio: 'inherit',
        cwd: rootDir
      });
      
      buildChild.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Build failed with exit code ${code}`));
        } else {
          resolve();
        }
      });
      
      buildChild.on('error', reject);
    }).catch(error => {
      console.error(`\n❌ Build failed: ${error.message}`);
      process.exit(1);
    });
    console.log(`✅ Build complete\n`);
  }

  console.log(`🚀 Running: ${commandName}`);
  console.log(`   Command: ${command.cmd} ${command.args.join(' ')}\n`);

  const env = { 
    ...process.env, 
    ...(command.env || {}) 
  };

  const child = spawn(command.cmd, command.args, {
    stdio: 'inherit',
    cwd: rootDir,
    env
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`\n❌ Command failed with exit code ${code}`);
      process.exit(code);
    }
  });

  child.on('error', (error) => {
    console.error(`❌ Failed to run command: ${error.message}`);
    process.exit(1);
  });
}

// Main execution
const [,, commandName] = process.argv;

if (!commandName || commandName === 'help' || commandName === '--help') {
  showHelp();
} else {
  runCommand(commandName);
}