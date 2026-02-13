#!/usr/bin/env node

import { program } from 'commander';
import { SessionManager } from './session-manager';
import chalk from 'chalk';
import { randomBytes } from 'crypto';

const manager = new SessionManager();

// Generate unique session name
function generateSessionName(): string {
  const id = randomBytes(4).toString('hex');
  return `ghcc-session-${id}`;
}

// Cleanup handler
let isCleaningUp = false;
async function cleanup(sessionName: string) {
  if (isCleaningUp) return;
  isCleaningUp = true;
  
  console.log('\n\n' + chalk.yellow('🛑 Shutting down...'));
  
  try {
    await manager.stop({ session: sessionName });
  } catch (error) {
    console.error(chalk.red('Error during cleanup:'), error);
  }
  
  process.exit(0);
}

program
  .name('ghcc-client')
  .description('GitHub Copilot CLI Remote Client - Access Copilot from anywhere')
  .version('1.0.0')
  .option('-p, --port <port>', 'Port for remote access (auto-assigned if not specified)')
  .allowExcessArguments(false)
  .showHelpAfterError('(use --help for usage information)')
  .action(async (options) => {
    const sessionName = generateSessionName();
    
    // Setup signal handlers for cleanup
    const cleanupHandler = () => cleanup(sessionName);
    process.on('SIGINT', cleanupHandler);
    process.on('SIGTERM', cleanupHandler);
    
    try {
      // Start session (blocking call)
      await manager.start({
        port: options.port || undefined,
        session: sessionName
      });
      
      // Keep process alive
      console.log(chalk.gray('\nPress Ctrl+C to stop the session\n'));
      
      // Block forever until signal
      await new Promise(() => {});
    } catch (error) {
      console.error(chalk.red('Error starting session:'), error);
      await cleanup(sessionName);
      process.exit(1);
    }
  });

// Show helpful information in --help
program.on('--help', () => {
  console.log('');
  console.log('Usage:');
  console.log('  $ ghcc-client              Start a new session (auto-assigned port)');
  console.log('  $ ghcc-client -p 8080      Start on specific port');
  console.log('');
  console.log('Controls:');
  console.log('  Ctrl+C                     Stop the session and cleanup');
  console.log('');
  console.log('Multiple Sessions:');
  console.log('  Open another terminal and run ghcc-client again to start');
  console.log('  a second session. Each session gets a unique name and port.');
  console.log('');
});

program.parse();
