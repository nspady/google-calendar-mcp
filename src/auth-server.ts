import { initializeOAuth2Client } from './auth/client.js';
import { AuthServer } from './auth/server.js';

async function runAuthServer() {
  let authServer: AuthServer | null = null; // Keep reference for cleanup
  try {
    const oauth2Client = await initializeOAuth2Client();
    
    authServer = new AuthServer(oauth2Client);
    
    const success = await authServer.start(true);
    
    if (!success && !authServer.authCompletedSuccessfully) {
      process.stderr.write('Authentication failed. Could not start server or validate existing tokens. Check port availability (3000-3004) and try again.\n');
      process.exit(1);
    } else if (authServer.authCompletedSuccessfully) {
      process.stderr.write('Authentication successful.\n');
      process.exit(0);
    }
    
    // If we reach here, the server started and is waiting for the browser callback
    process.stderr.write('Authentication server started. Please complete the authentication in your browser...\n');
    

    process.stderr.write(`Waiting for OAuth callback on port ${authServer.getRunningPort()}...\n`);
    
    // Poll for completion or handle SIGINT
    let lastDebugLog = 0;
    const pollInterval = setInterval(async () => {
      try {
        if (authServer?.authCompletedSuccessfully) {
          process.stderr.write('Authentication completed successfully detected. Stopping server...\n');
          clearInterval(pollInterval);
          await authServer.stop();
          process.stderr.write('Authentication successful. Server stopped.\n');
          process.exit(0);
        } else {
          // Add debug logging every 10 seconds to show we're still waiting
          const now = Date.now();
          if (now - lastDebugLog > 10000) {
            process.stderr.write('Still waiting for authentication to complete...\n');
            lastDebugLog = now;
          }
        }
      } catch (error: unknown) {
        process.stderr.write(`Error in polling interval: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
        clearInterval(pollInterval);
        if (authServer) await authServer.stop();
        process.exit(1);
      }
    }, 5000); // Check every second

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
  runAuthServer().catch((error: unknown) => {
    process.stderr.write(`Unhandled error: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
    process.exit(1);
  });
}