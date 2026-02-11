import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs';
import chalk from 'chalk';
import ora, { Ora } from 'ora';
import type { StartOptions, StopOptions, StatusOptions } from './types';

const execAsync = promisify(exec);

export class SessionManager {
  private ttydPath: string;

  constructor() {
    const platform = os.platform();
    const arch = os.arch();
    
    let binaryName: string;
    if (platform === 'linux') {
      binaryName = arch === 'arm64' ? 'ttyd-linux-arm64' : 'ttyd-linux-x64';
    } else if (platform === 'darwin') {
      binaryName = arch === 'arm64' ? 'ttyd-darwin-arm64' : 'ttyd-darwin-x64';
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    
    this.ttydPath = path.join(__dirname, '..', 'binaries', binaryName);
    
    if (!fs.existsSync(this.ttydPath)) {
      console.error(chalk.red(`✗ ttyd binary not found: ${this.ttydPath}`));
      console.log(chalk.yellow('This should not happen. Please reinstall: npm install -g ghcc-client'));
      process.exit(1);
    }
  }

  private async sessionExists(sessionName: string): Promise<boolean> {
    try {
      await execAsync(`tmux has-session -t ${sessionName} 2>/dev/null`);
      return true;
    } catch {
      return false;
    }
  }

  // Find ttyd PID for a session by searching running processes
  private async findTtydPid(sessionName: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`pgrep -f "ttyd.*attach -t ${sessionName}$" 2>/dev/null || true`);
      const pid = stdout.trim();
      return pid || null;
    } catch {
      return null;
    }
  }

  // Get port number from ttyd process
  private async getTtydPort(pid: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`ps -p ${pid} -o args= 2>/dev/null`);
      const match = stdout.match(/-p (\d+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  private async isPortInUse(port: number): Promise<boolean> {
    try {
      await execAsync(`lsof -i :${port} 2>/dev/null`);
      return true;
    } catch {
      return false;
    }
  }

  private async cleanupOrphanedProcesses(): Promise<void> {
    try {
      // Strategy: Use actual running processes as source of truth
      
      // 1. Find all running ttyd processes for copilot-remote
      const { stdout: ttydOutput } = await execAsync('pgrep -f "ttyd.*copilot-remote" 2>/dev/null || true');
      const ttydPids = ttydOutput.trim().split('\n').filter(p => p);
      
      for (const pid of ttydPids) {
        if (!pid) continue;
        
        try {
          // Get session name from command line
          const { stdout: cmdline } = await execAsync(`ps -p ${pid} -o args= 2>/dev/null`);
          const match = cmdline.match(/attach -t (copilot-remote[^\s]*)/);
          
          if (match) {
            const sessionName = match[1];
            
            // Check if tmux session exists
            if (!(await this.sessionExists(sessionName))) {
              // ttyd running but tmux session gone - kill orphaned ttyd
              await execAsync(`kill ${pid} 2>/dev/null || true`);
            }
          }
        } catch {
          // Can't get command line, skip this process
        }
      }
      
      // 2. Find all tmux sessions and check if they have ttyd
      const { stdout: tmuxOutput } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null || true');
      const sessions = tmuxOutput.trim().split('\n').filter(s => s && s.startsWith('copilot-remote'));
      
      for (const sessionName of sessions) {
        // Check if there's a ttyd for this session
        const ttydPid = await this.findTtydPid(sessionName);
        
        if (!ttydPid) {
          // Tmux session exists but no ttyd - kill orphaned session
          await execAsync(`tmux kill-session -t ${sessionName} 2>/dev/null || true`);
        }
      }
      
      // 3. Clean up any stale PID files (best effort, not critical)
      try {
        const { stdout: pidFiles } = await execAsync('ls /tmp/ghcc-*-ttyd.pid 2>/dev/null || true');
        const files = pidFiles.trim().split('\n').filter(f => f);
        
        for (const file of files) {
          if (!file) continue;
          
          const sessionName = file.replace('/tmp/ghcc-', '').replace('-ttyd.pid', '');
          
          // Remove PID file if session doesn't exist
          if (!(await this.sessionExists(sessionName))) {
            await execAsync(`rm -f ${file} 2>/dev/null || true`);
          }
        }
      } catch {
        // Ignore PID file cleanup errors
      }
    } catch {
      // Error during cleanup, continue anyway
    }
  }

  async start(options: StartOptions): Promise<void> {
    let { port, session } = options;
    const isDefaultSession = session === 'copilot-remote';
    
    console.log(chalk.cyan('🚀 Starting GitHub Copilot Remote Session...\n'));
    
    const spinner1: Ora = ora('Checking for Copilot CLI...').start();
    try {
      await execAsync('which copilot');
      spinner1.succeed('Copilot CLI found');
    } catch (error) {
      spinner1.fail('Copilot CLI not found');
      console.log(chalk.yellow('\nPlease install GitHub Copilot CLI first:'));
      console.log(chalk.white('  npm install -g @github/copilot'));
      process.exit(1);
    }

    // Clean up ALL orphaned processes before starting
    await this.cleanupOrphanedProcesses();

    // Auto-increment session name and port if default name is in use
    let finalSession = session;
    let finalPort = parseInt(port);
    
    if (isDefaultSession && await this.sessionExists(session)) {
      let counter = 2;
      while (await this.sessionExists(`${session}-${counter}`)) {
        counter++;
      }
      finalSession = `${session}-${counter}`;
      
      // Find first available port starting from default
      finalPort = parseInt(port);
      while (await this.isPortInUse(finalPort)) {
        finalPort++;
      }
      
      if (finalPort !== parseInt(port)) {
        console.log(chalk.yellow(`Port ${port} in use, using port ${finalPort}\n`));
      }
    } else if (!isDefaultSession && await this.sessionExists(session)) {
      // Custom session name - don't auto-increment, show error
      console.log(chalk.red(`✗ Session "${session}" already exists!\n`));
      console.log(chalk.yellow('Options:'));
      console.log(chalk.white(`  • Stop it:     ghcc-client stop -s ${session}`));
      console.log(chalk.white(`  • Use another: ghcc-client start -s different-name`));
      process.exit(1);
    }

    // Note: --continue doesn't work reliably in detached tmux sessions
    // Users can use /resume command inside Copilot to switch sessions
    const copilotCmd = 'copilot';
    
    const spinner3: Ora = ora('Starting Copilot in tmux...').start();
    try {
      await execAsync(`tmux new-session -d -s ${finalSession} ${copilotCmd}`);
      
      // Wait and verify session is still alive
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check if session still exists
      try {
        await execAsync(`tmux has-session -t ${finalSession} 2>/dev/null`);
        spinner3.succeed(`Copilot started in tmux session "${finalSession}"`);
      } catch {
        spinner3.fail(`Session "${finalSession}" exited immediately`);
        console.log(chalk.yellow('\n⚠️  Copilot session closed right after starting.'));
        console.log(chalk.yellow('This might happen if:'));
        console.log(chalk.white('  • You haven\'t logged in: Run "copilot login" first'));
        console.log(chalk.white('  • Copilot crashed or had an error'));
        process.exit(1);
      }
    } catch (error) {
      spinner3.fail('Failed to start tmux session');
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    }

    const spinner4: Ora = ora(`Starting ttyd server on port ${finalPort}...`).start();
    try {
      const ttyd = spawn(this.ttydPath, [
        '-p', finalPort.toString(),
        '-W',
        'tmux', 'attach', '-t', finalSession
      ], {
        detached: true,
        stdio: 'ignore'
      });
      
      const ttydPid = ttyd.pid!;
      ttyd.unref();
      
      // Wait for ttyd to start
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Verify ttyd process is still running
      try {
        await execAsync(`kill -0 ${ttydPid}`);
      } catch {
        spinner4.fail('ttyd server failed to start');
        console.log(chalk.red(`\n✗ ttyd process (PID ${ttydPid}) exited immediately\n`));
        console.log(chalk.yellow('Possible causes:'));
        console.log(chalk.white(`  • Port ${finalPort} is already in use`));
        console.log(chalk.white('  • tmux session is inaccessible'));
        console.log(chalk.white('  • ttyd binary is corrupted'));
        console.log(chalk.yellow('\nCleaning up tmux session...'));
        await execAsync(`tmux kill-session -t ${finalSession} 2>/dev/null || true`);
        process.exit(1);
      }
      
      // Verify port is actually listening
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
        await execAsync(`lsof -i :${finalPort} 2>/dev/null | grep -q LISTEN`);
      } catch {
        spinner4.fail('ttyd server not listening on port');
        console.log(chalk.red(`\n✗ ttyd started but is not listening on port ${finalPort}\n`));
        console.log(chalk.yellow('Cleaning up...'));
        await execAsync(`kill ${ttydPid} 2>/dev/null || true`);
        await execAsync(`tmux kill-session -t ${finalSession} 2>/dev/null || true`);
        process.exit(1);
      }
      
      spinner4.succeed(`ttyd server started on port ${finalPort}`);
      
      // Set up tmux hook for automatic cleanup (process-based)
      try {
        // Hook command: find ttyd process for this session and kill it
        const hookCmd = `run-shell "kill \\$(pgrep -f 'ttyd.*attach -t ${finalSession}\\$' 2>/dev/null) 2>/dev/null || true"`;
        await execAsync(`tmux set-hook -t ${finalSession} session-closed "${hookCmd}"`);
      } catch (error) {
        console.log(chalk.yellow('\n⚠️  Warning: Failed to set up automatic cleanup hook'));
        console.log(chalk.gray('   (You may need to manually stop the session later)'));
      }
      
      // FINAL verification - check once more before declaring success
      try {
        await execAsync(`kill -0 ${ttydPid}`);
      } catch {
        console.log(chalk.red('\n✗ ttyd process died after initial startup\n'));
        console.log(chalk.yellow('Cleaning up...'));
        await execAsync(`tmux kill-session -t ${finalSession} 2>/dev/null || true`);
        process.exit(1);
      }
    } catch (error) {
      spinner4.fail('Failed to spawn ttyd process');
      console.error(chalk.red('\n✗ Error: ' + (error as Error).message));
      console.log(chalk.yellow('\nCleaning up tmux session...'));
      await execAsync(`tmux kill-session -t ${finalSession} 2>/dev/null || true`);
      process.exit(1);
    }

    console.log(chalk.green('\n✅ Remote session is ready!\n'));
    this.showUrls(finalPort.toString(), finalSession);
  }

  async stop(options: StopOptions): Promise<void> {
    const { session, all } = options;
    
    // Case 1: No flags - show help
    if (!session && !all) {
      console.log(chalk.yellow('⚠️  No session specified\n'));
      console.log(chalk.white('To stop a session, you need to specify which one:\n'));
      console.log(chalk.cyan('  ghcc-client status') + chalk.gray('           # List all running sessions'));
      console.log(chalk.cyan('  ghcc-client stop -s <name>') + chalk.gray('  # Stop a specific session'));
      console.log(chalk.cyan('  ghcc-client stop --all') + chalk.gray('        # Stop all sessions\n'));
      return;
    }
    
    // Case 2: Stop all sessions
    if (all) {
      console.log(chalk.cyan('🛑 Stopping all sessions...\n'));
      
      try {
        const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null || true');
        const allSessions = stdout.trim().split('\n').filter(s => s && s.startsWith('copilot-remote'));
        
        if (allSessions.length === 0) {
          console.log(chalk.yellow('ℹ  No copilot-remote sessions found\n'));
          return;
        }
        
        let stoppedCount = 0;
        for (const sess of allSessions) {
          // Find and kill ttyd (process-based)
          const ttydPid = await this.findTtydPid(sess);
          if (ttydPid) {
            try {
              await execAsync(`kill ${ttydPid} 2>/dev/null || true`);
            } catch {
              // Already dead
            }
          }
          
          // Kill tmux session
          try {
            await execAsync(`tmux kill-session -t ${sess} 2>/dev/null || true`);
          } catch {
            // Already dead
          }
          
          console.log(chalk.green(`✔ ${sess} stopped`));
          stoppedCount++;
        }
        
        console.log(chalk.green(`\n✅ Stopped ${stoppedCount} session(s)\n`));
      } catch {
        console.log(chalk.red('✗ Error listing sessions\n'));
      }
      return;
    }
    
    // Case 3: Stop specific session (TypeScript knows session is defined here)
    const sessionName = session!;
    let ttydStopped = false;
    let sessionStopped = false;
    
    // Find and kill ttyd process (process-based)
    const ttydPid = await this.findTtydPid(sessionName);
    if (ttydPid) {
      try {
        await execAsync(`kill ${ttydPid} 2>/dev/null || true`);
        ttydStopped = true;
      } catch {
        // Already dead
      }
    }

    // Kill tmux session if it exists
    if (await this.sessionExists(sessionName)) {
      try {
        await execAsync(`tmux kill-session -t ${sessionName} 2>/dev/null`);
        sessionStopped = true;
      } catch {
        // Failed to kill
      }
    }
    
    if (!ttydStopped && !sessionStopped) {
      console.log(chalk.yellow(`\nℹ  Session "${sessionName}" was not running\n`));
    } else {
      console.log(chalk.green(`\n✅ Session "${sessionName}" stopped\n`));
    }
  }

  async status(options: StatusOptions): Promise<void> {
    const { session } = options;
    
    console.log(chalk.cyan('📊 Session Status\n'));
    
    if (session) {
      // Show status for specific session
      await this.showSessionStatus(session);
    } else {
      // Show status for all sessions
      try {
        const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null || true');
        const allSessions = stdout.trim().split('\n').filter(s => s && s.startsWith('copilot-remote'));
        
        if (allSessions.length === 0) {
          console.log(chalk.yellow('ℹ  No copilot-remote sessions found\n'));
          return;
        }
        
        for (const sess of allSessions) {
          await this.showSessionStatus(sess);
          console.log('');
        }
      } catch (error) {
        console.log(chalk.yellow('ℹ  No copilot-remote sessions found\n'));
      }
    }
  }

  private async showSessionStatus(session: string): Promise<void> {
    // Check if tmux session exists (source of truth)
    if (!(await this.sessionExists(session))) {
      console.log(chalk.red(`❌ ${session} (not running)`));
      return;
    }
    
    // Session exists, show details
    console.log(chalk.green(`✅ ${session}`));
    
    // Get creation time
    try {
      const { stdout } = await execAsync(`tmux display-message -t ${session} -p "#{session_created}"`);
      const created = new Date(parseInt(stdout.trim()) * 1000);
      console.log(chalk.gray(`   Started: ${created.toLocaleString()}`));
    } catch {
      // Can't get creation time
    }

    // Find ttyd process (using pgrep, not PID file)
    const ttydPid = await this.findTtydPid(session);
    if (ttydPid) {
      const port = await this.getTtydPort(ttydPid);
      if (port) {
        console.log(chalk.gray(`   Port: ${port}`));
      } else {
        console.log(chalk.gray(`   ttyd: running (port unknown)`));
      }
    } else {
      console.log(chalk.gray(`   ttyd: not running`));
    }
  }

  showUrls(port: string, session?: string): void {
    const interfaces = os.networkInterfaces();
    let localIp = 'localhost';
    
    for (const name of Object.keys(interfaces)) {
      const ifaces = interfaces[name];
      if (!ifaces) continue;
      
      for (const iface of ifaces) {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIp = iface.address;
          break;
        }
      }
    }

    console.log(chalk.cyan('Access URLs:'));
    console.log(chalk.white(`  Desktop Browser: ${chalk.underline(`http://localhost:${port}`)}`));
    console.log(chalk.white(`  Mobile Browser:  ${chalk.underline(`http://${localIp}:${port}`)}`));
    if (session) {
      console.log(chalk.white(`  Session Name:    ${session}`));
    }
    console.log('');
    console.log(chalk.gray('💡 Tip: Use "ghcc-client url" to see these URLs again'));
    console.log('');
  }
}
