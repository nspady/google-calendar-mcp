import { initializeOAuth2Client } from './auth/client.js';
import { AuthServer } from './auth/server.js';
import { setCredentialsPath } from './auth/utils.js';

// Parse CLI arguments for credentials
function parseAuthServerArgs(): { credentialsPath: string | undefined } {
  const args = process.argv.slice(2);
  let credentialsPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    // Check for credentials file option
    if (arg === '--credentials-file') {
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        credentialsPath = args[i + 1];
        i++; // Skip the next argument as it's the value
      } else {
        console.error(`Option ${arg} requires a value`);
        process.exit(1);
      }
    }
  }

  return { credentialsPath };
}

// Main function to run the authentication server
async function runAuthServer() {
  let authServer: AuthServer | null = null; // Keep reference for cleanup
  try {
    // Initialize OAuth client
    const oauth2Client = await initializeOAuth2Client();
    
    // Create and start the auth server
    authServer = new AuthServer(oauth2Client);
    
    // Start with browser opening (true by default)
    const success = await authServer.start(true);
    
    if (!success && !authServer.authCompletedSuccessfully) {
      // Failed to start and tokens weren't already valid
      process.stderr.write('Authentication failed. Could not start server or validate existing tokens. Check port availability (3000-3004) and try again.\n');
      process.exit(1);
    } else if (authServer.authCompletedSuccessfully) {
      // Auth was successful (either existing tokens were valid or flow completed just now)
      process.stderr.write('Authentication successful.\n');
      process.exit(0); // Exit cleanly if auth is already done
    }
    
    // If we reach here, the server started and is waiting for the browser callback
    process.stderr.write('Authentication server started. Please complete the authentication in your browser...\n');
    
    // Poll for completion or handle SIGINT
    const pollInterval = setInterval(async () => {
      if (authServer?.authCompletedSuccessfully) {
        clearInterval(pollInterval);
        await authServer.stop();
        process.stderr.write('Authentication successful. Server stopped.\n');
        process.exit(0);
      }
    }, 1000); // Check every second

    // Handle process termination (SIGINT)
    process.on('SIGINT', async () => {
      clearInterval(pollInterval); // Stop polling
      if (authServer) {
        await authServer.stop();
      }
      process.exit(0);
    });
    
  } catch (error: unknown) {
    process.stderr.write(`Authentication error: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
    if (authServer) await authServer.stop(); // Attempt cleanup
    process.exit(1);
  }
}

// Run the auth server if this file is executed directly
if (import.meta.url.endsWith('auth-server.js')) {
  // Parse CLI arguments and set credentials path if provided
  const { credentialsPath } = parseAuthServerArgs();
  if (credentialsPath) {
    setCredentialsPath(credentialsPath);
  }
  
  runAuthServer().catch((error: unknown) => {
    process.stderr.write(`Unhandled error: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
    process.exit(1);
  });
}