import { spawn, exec, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import chalk from 'chalk';
import ora, { Ora } from 'ora';
import localtunnel from 'localtunnel';
import qrcode from 'qrcode-terminal';
import type { StartOptions, StopOptions } from './types';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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

  // Security helper: Validate session name format
  private validateSessionName(session: string): boolean {
    // Only allow: letters, numbers, hyphens, and underscores
    // Must start with letter or number
    // Length: 3-64 characters
    const sessionRegex = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$/;
    return sessionRegex.test(session);
  }

  // Security helper: Validate port number
  private validatePort(port: number): boolean {
    // Only allow non-privileged ports (1024-65535)
    return Number.isInteger(port) && port >= 1024 && port <= 65535;
  }

  // Security helper: Generate secure random password
  private generateSecurePassword(length: number = 32): string {
    return crypto.randomBytes(length).toString('base64').slice(0, length);
  }

  // Security helper: Create secure temp file with restricted permissions
  private createSecureTempFile(prefix: string, extension: string = '.tmp'): string {
    // Create unique temp directory with 0700 permissions
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
    fs.chmodSync(tmpDir, 0o700); // Only owner can read/write/execute
    
    // Create file path
    const filePath = path.join(tmpDir, `file${extension}`);
    return filePath;
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

  // Batch method: Get all ttyd processes at once (performance optimization)

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

  // Find tunnel process PID for a session
  private async findTunnelPid(sessionName: string): Promise<string | null> {
    try {
      // Look for localtunnel process with session name in args
      const { stdout } = await execAsync(`pgrep -f "node.*localtunnel.*${sessionName}" 2>/dev/null || true`);
      const pid = stdout.trim();
      return pid || null;
    } catch {
      return null;
    }
  }

  // Extract public URL from tunnel process
  private async getTunnelUrl(sessionName: string): Promise<string | null> {
    try {
      // Check if tunnel PID file exists (we'll store URL there)
      const urlFile = `/tmp/ghcc-${sessionName}-tunnel-url`;
      if (fs.existsSync(urlFile)) {
        const url = fs.readFileSync(urlFile, 'utf-8').trim();
        return url || null;
      }
      return null;
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

  private async findAvailablePort(startPort: number = 7681): Promise<number> {
    let port = startPort;
    while (await this.isPortInUse(port)) {
      port++;
      if (port > 65535) {
        throw new Error('No available ports found');
      }
    }
    return port;
  }

  private async cleanupOrphanedProcesses(): Promise<void> {
    try {
      // OPTIMIZATION: Skip cleanup if run recently (within 5 minutes)
      const cleanupMarker = '/tmp/ghcc-last-cleanup';
      try {
        const { stdout } = await execAsync(`stat -c %Y ${cleanupMarker} 2>/dev/null || echo 0`);
        const lastCleanup = parseInt(stdout.trim());
        const now = Math.floor(Date.now() / 1000);
        const timeSinceCleanup = now - lastCleanup;
        
        if (timeSinceCleanup < 300) { // 5 minutes = 300 seconds
          // Skip cleanup, too recent
          return;
        }
      } catch {
        // No marker file, proceed with cleanup
      }
      
      // Strategy: Use actual running processes as source of truth
      
      // 1. Find all running ttyd processes for ghcc-session
      const { stdout: ttydOutput } = await execAsync('pgrep -f "ttyd.*ghcc-session" 2>/dev/null || true');
      const ttydPids = ttydOutput.trim().split('\n').filter(p => p);
      
      for (const pid of ttydPids) {
        if (!pid) continue;
        
        try {
          // Get session name from command line
          const { stdout: cmdline } = await execAsync(`ps -p ${pid} -o args= 2>/dev/null`);
          const match = cmdline.match(/attach -t (ghcc-session[^\s]*)/);
          
          if (match) {
            const sessionName = match[1];
            
            // Check if tmux session exists
            if (!(await this.sessionExists(sessionName))) {
              // ttyd running but tmux session gone - kill orphaned ttyd
              await execAsync(`kill ${pid} 2>/dev/null || true`);
              
              // Also kill associated tunnel
              const tunnelPid = await this.findTunnelPid(sessionName);
              if (tunnelPid) {
                await execAsync(`kill ${tunnelPid} 2>/dev/null || true`);
              }
              
              // Clean up tunnel URL file
              const urlFile = `/tmp/ghcc-${sessionName}-tunnel-url`;
              if (fs.existsSync(urlFile)) {
                fs.unlinkSync(urlFile);
              }
              
              // Clean up custom HTML file
              const htmlFile = `/tmp/ghcc-${sessionName}.html`;
              if (fs.existsSync(htmlFile)) {
                fs.unlinkSync(htmlFile);
              }
            }
          }
        } catch {
          // Can't get command line, skip this process
        }
      }
      
      // 2. Find all tmux sessions and check if they have ttyd
      const { stdout: tmuxOutput } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null || true');
      const sessions = tmuxOutput.trim().split('\n').filter(s => s && s.startsWith('ghcc-session'));
      
      for (const sessionName of sessions) {
        // Check if there's a ttyd for this session
        const ttydPid = await this.findTtydPid(sessionName);
        
        if (!ttydPid) {
          // Tmux session exists but no ttyd - kill orphaned session and tunnel
          await execAsync(`tmux kill-session -t ${sessionName} 2>/dev/null || true`);
          
          const tunnelPid = await this.findTunnelPid(sessionName);
          if (tunnelPid) {
            await execAsync(`kill ${tunnelPid} 2>/dev/null || true`);
          }
          
          const urlFile = `/tmp/ghcc-${sessionName}-tunnel-url`;
          if (fs.existsSync(urlFile)) {
            fs.unlinkSync(urlFile);
          }
          
          const htmlFile = `/tmp/ghcc-${sessionName}.html`;
          if (fs.existsSync(htmlFile)) {
            fs.unlinkSync(htmlFile);
          }
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
      
      // Update cleanup marker
      await execAsync(`touch ${cleanupMarker} 2>/dev/null || true`);
    } catch {
      // Error during cleanup, continue anyway
    }
  }

  async start(options: StartOptions): Promise<void> {
    let { port, session } = options;
    
    console.log(chalk.cyan('🚀 Starting GitHub Copilot Remote Session...\n'));
    
    // SECURITY: Validate session name format
    if (!this.validateSessionName(session)) {
      console.log(chalk.red('✗ Invalid session name format!\n'));
      console.log(chalk.yellow('Session names must:'));
      console.log(chalk.white('  • Be 3-64 characters long'));
      console.log(chalk.white('  • Start with letter or number'));
      console.log(chalk.white('  • Contain only: letters, numbers, hyphens, underscores'));
      process.exit(1);
    }
    
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

    // Check if session name already exists
    if (await this.sessionExists(session)) {
      console.log(chalk.red(`✗ Session "${session}" already exists!\n`));
      console.log(chalk.yellow('This should not happen with auto-generated names.'));
      console.log(chalk.yellow('Try running the command again.'));
      process.exit(1);
    }
    
    // Auto-assign port if not specified
    let finalPort: number;
    if (port) {
      finalPort = parseInt(port);
      
      // SECURITY: Validate port number
      if (!this.validatePort(finalPort)) {
        console.log(chalk.red('✗ Invalid port number!\n'));
        console.log(chalk.yellow('Port must be between 1024-65535 (non-privileged range)'));
        process.exit(1);
      }
      
      // Check if specified port is available
      if (await this.isPortInUse(finalPort)) {
        console.log(chalk.red(`✗ Port ${finalPort} is already in use!\n`));
        console.log(chalk.yellow('Try a different port or omit -p to auto-assign.'));
        process.exit(1);
      }
    } else {
      finalPort = await this.findAvailablePort();
    }

    // Note: --continue doesn't work reliably in detached tmux sessions
    // Users can use /resume command inside Copilot to switch sessions
    const copilotCmd = 'copilot';
    
    const spinner3: Ora = ora('Starting Copilot in tmux...').start();
    try {
      // Create tmux session
      await execAsync(`tmux new-session -d -s ${session}`);
      
      // Set history limit on this specific session (50,000 lines)
      // This MUST match the xterm.js scrollback for full scroll history
      await execAsync(`tmux set-option -t ${session} history-limit 50000`);
      
      // Start Copilot CLI in the session
      await execAsync(`tmux send-keys -t ${session} '${copilotCmd}' Enter`);
      
      // Wait and verify session is still alive
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check if session still exists
      try {
        await execAsync(`tmux has-session -t ${session} 2>/dev/null`);
        spinner3.succeed(`Copilot started in tmux session "${session}"`);
      } catch {
        spinner3.fail(`Session "${session}" exited immediately`);
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

    let publicUrl = ''; // Declare here for scope across ttyd and tunnel blocks
    let ttydPassword = ''; // Store password for display
    let tunnelPassword = ''; // Store tunnel password for display
    let httpsEnabled = false; // Track if HTTPS is actually available
    const spinner4: Ora = ora(`Starting ttyd server on port ${finalPort}...`).start();
    
    // SECURITY: Generate strong authentication password for ttyd
    ttydPassword = this.generateSecurePassword(6);
    
    // SECURITY: Create temp files with restricted permissions
    const customHtmlPath = this.createSecureTempFile(`ghcc-${session}`, '.html');
    const basePath = path.join(__dirname, '..', 'assets', 'ttyd-base.html');
    
    try {
      let html = fs.readFileSync(basePath, 'utf-8');
      
      // Replace title
      html = html.replace(/<title>.*?<\/title>/, `<title>GitHub Copilot - ${session}</title>`);
      
      // Add viewport meta tag if not present (critical for mobile)
      if (!html.includes('<meta name="viewport"')) {
        html = html.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover">');
      }
      
      // Note: Keyboard sheet is now an overlay, no DOM manipulation needed
      // SECURITY: Write with restricted permissions (0600 - owner read/write only)
      fs.writeFileSync(customHtmlPath, html, { mode: 0o600 });
    } catch (error) {
      console.log(chalk.yellow('Warning: Could not create mobile HTML, mobile portrait may not work'));
    }
    
    try {
      // SECURITY: Generate self-signed certificate for HTTPS
      const certDir = path.join(os.homedir(), '.ghcc-client', 'certs');
      const certPath = path.join(certDir, 'cert.pem');
      const keyPath = path.join(certDir, 'key.pem');
      
      // Create cert directory if it doesn't exist
      if (!fs.existsSync(certDir)) {
        fs.mkdirSync(certDir, { recursive: true, mode: 0o700 });
      }
      
      // Generate self-signed cert if it doesn't exist
      if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
        spinner4.text = 'Generating HTTPS certificate (first-time only)...';
        try {
          await execAsync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout "${keyPath}" -out "${certPath}" -days 365 -subj "/CN=ghcc-client" 2>/dev/null`);
          fs.chmodSync(certPath, 0o600);
          fs.chmodSync(keyPath, 0o600);
        } catch (certError) {
          console.log(chalk.yellow('\n⚠️  Could not generate HTTPS certificate, falling back to HTTP'));
          console.log(chalk.gray('   Install openssl for secure HTTPS connections'));
        }
      }
      
      const ttydArgs = [
        '-p', finalPort.toString(),
        '-W',  // Allow clients to write
        '-c', `user:${ttydPassword}`,  // SECURITY: Basic authentication
      ];
      
      // SECURITY: Add HTTPS if certificate exists
      if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        ttydArgs.push('-S', '-C', certPath, '-K', keyPath);
        httpsEnabled = true;
      }
      
      // Use custom HTML with mobile fixes if available
      if (fs.existsSync(customHtmlPath)) {
        ttydArgs.push('-I', customHtmlPath);
      }
      
      // Add client options for better UX
      ttydArgs.push('-t', 'fontSize=14');
      ttydArgs.push('-t', 'fontFamily=Consolas,Monaco,Courier New,monospace');
      ttydArgs.push('-t', 'scrollback=50000');  // Large scrollback for long Copilot conversations
      // ttydArgs.push('-t', 'theme={"background":"#1e1e1e","foreground":"#d4d4d4","cursor":"#d4d4d4","selection":"#264f78"}');
      ttydArgs.push('-t', `titleFixed=GitHub Copilot - ${session}`);
      ttydArgs.push('-t', 'disableLeaveAlert=true');
      ttydArgs.push('-t', 'disableResizeOverlay=true');
      
      // Add tmux command
      ttydArgs.push('tmux', 'attach', '-t', session);
      
      const ttyd = spawn(this.ttydPath, ttydArgs, {
        detached: true,
        stdio: 'ignore'
      });
      
      const ttydPid = ttyd.pid!;
      // Note: Don't call ttyd.unref() - we want this process to keep the event loop alive
      
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
        await execAsync(`tmux kill-session -t ${session} 2>/dev/null || true`);
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
        await execAsync(`tmux kill-session -t ${session} 2>/dev/null || true`);
        process.exit(1);
      }
      
      spinner4.succeed(`ttyd server started on port ${finalPort}`);
      
      // Set up tmux hook for automatic cleanup
      // Note: Hook uses PID for simplicity (edge case cleanup only)
      // Main architecture remains process-based
      try {
        const hookCmd = `run-shell "kill ${ttydPid} 2>/dev/null || true"`;
        await execAsync(`tmux set-hook -t ${session} session-closed "${hookCmd}"`);
      } catch (error) {
        // Log error for debugging but don't fail the start
        console.log(chalk.yellow('\n⚠️  Warning: Failed to set up automatic cleanup hook'));
        console.log(chalk.gray(`   Error: ${error instanceof Error ? error.message : error}`));
        console.log(chalk.gray('   (You may need to manually stop the session later)'));
      }
      
      // FINAL verification - check once more before declaring success
      try {
        await execAsync(`kill -0 ${ttydPid}`);
      } catch {
        console.log(chalk.red('\n✗ ttyd process died after initial startup\n'));
        console.log(chalk.yellow('Cleaning up...'));
        await execAsync(`tmux kill-session -t ${session} 2>/dev/null || true`);
        process.exit(1);
      }
      
      // Create public tunnel ONLY if --public flag is provided
      if (options.public) {
        // Create public tunnel with timeout and retry logic
        // Based on localtunnel GitHub issues: https://github.com/localtunnel/localtunnel/issues
        // Common issue: Promise hangs when tunnel server is slow/unavailable
        // Solution: Promise.race() with timeout + retry
        const spinner5: Ora = ora('Creating public URL tunnel...').start();
        
        const createTunnelWithTimeout = async (port: number, subdomain: string, timeoutMs: number = 15000): Promise<any> => {
          const tunnelPromise = localtunnel({ 
            port,
            subdomain
          });
          
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Tunnel connection timeout after ' + (timeoutMs/1000) + 's')), timeoutMs);
          });
          
          return Promise.race([tunnelPromise, timeoutPromise]);
        };
        
        try {
          const subdomain = session.replace('ghcc-session', 'ghcc').replace(/[^a-zA-Z0-9-]/g, '');
          const port = parseInt(finalPort.toString());
          
          // Retry logic: Try up to 2 times
          let tunnel;
          let lastError;
          
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              tunnel = await createTunnelWithTimeout(port, subdomain, 15000);
              break; // Success, exit retry loop
            } catch (error) {
              lastError = error;
              if (attempt < 2) {
                spinner5.text = `Retrying tunnel connection (${attempt}/2)...`;
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s between retries
              }
            }
          }
          
          if (!tunnel) {
            throw lastError;
          }
          
          publicUrl = tunnel.url;
          
          // SECURITY: Store URL in secure file with restricted permissions
          const urlFile = this.createSecureTempFile(`ghcc-${session}-tunnel-url`, '.txt');
          fs.writeFileSync(urlFile, publicUrl, { mode: 0o600 });
          
          // Set up tunnel error handler
          tunnel.on('error', (err: Error) => {
            console.log(chalk.yellow(`\n⚠️  Tunnel error: ${err.message}`));
          });
          
          tunnel.on('close', () => {
            // Clean up URL file when tunnel closes
            const urlDir = path.dirname(urlFile);
            if (fs.existsSync(urlFile)) {
              fs.unlinkSync(urlFile);
            }
            if (fs.existsSync(urlDir)) {
              fs.rmdirSync(urlDir);
            }
          });
          
          spinner5.succeed(`Public URL created`);
          
          // Get tunnel password (public IP) for user to share
          try {
            const { stdout: password } = await execAsync('curl -s https://loca.lt/mytunnelpassword');
            tunnelPassword = password.trim();
          } catch {
            // Ignore if we can't fetch the password
          }
        } catch (error) {
          spinner5.warn('Failed to create public tunnel');
          console.log(chalk.yellow('   Session is available locally only'));
          console.log(chalk.gray(`   Error: ${error instanceof Error ? error.message : error}`));
          console.log(chalk.gray('   Tip: Check https://loca.lt for service status'));
        }
      } else {
        // Local-only mode: show helpful tip
        console.log(chalk.dim('💡 Tip: Run with --public flag to enable internet access via QR code'));
      }
    } catch (error) {
      spinner4.fail('Failed to spawn ttyd process');
      console.error(chalk.red('\n✗ Error: ' + (error as Error).message));
      console.log(chalk.yellow('\nCleaning up tmux session...'));
      await execAsync(`tmux kill-session -t ${session} 2>/dev/null || true`);
      process.exit(1);
    }

    console.log(chalk.green('\n✅ Remote session is ready!\n'));
    
    
    // Show QR code if public URL exists
    if (publicUrl) {
      console.log(chalk.white('📱 Scan QR code to access from mobile:\n'));
      qrcode.generate(publicUrl, { small: true });
      console.log();
      console.log(chalk.yellow('⚠️  Important: Visitors need TWO credentials'));
      console.log(chalk.gray(`   1. Tunnel password: ${chalk.white(tunnelPassword)}`));
      console.log(chalk.gray('   2. Terminal credentials (shown below)'));
      console.log(chalk.gray('   After tunnel auth, it works for 7 days from their IP'));
      console.log();
    }

    // SECURITY: Display authentication credentials
    console.log(chalk.white('🔐 Terminal Session Credentials:\n'));
    console.log(chalk.gray('   Username: ') + chalk.white('user'));
    console.log(chalk.gray('   Password: ') + chalk.white(ttydPassword));
    console.log();
    
    this.showUrls(finalPort.toString(), session, publicUrl, httpsEnabled);
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
        const allSessions = stdout.trim().split('\n').filter(s => s && s.startsWith('ghcc-session'));
        
        if (allSessions.length === 0) {
          console.log(chalk.yellow('ℹ  No ghcc-session sessions found\n'));
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
          
          // Find and kill tunnel (process-based)
          const tunnelPid = await this.findTunnelPid(sess);
          if (tunnelPid) {
            try {
              await execAsync(`kill ${tunnelPid} 2>/dev/null || true`);
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
          
          // Clean up temp files
          try {
            await execAsync(`rm -f /tmp/ghcc-${sess}-tunnel-url /tmp/ghcc-${sess}.html`);
          } catch {
            // Ignore cleanup errors
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
    
    // Find and kill tunnel process
    const tunnelPid = await this.findTunnelPid(sessionName);
    if (tunnelPid) {
      try {
        await execAsync(`kill ${tunnelPid} 2>/dev/null || true`);
      } catch {
        // Already dead
      }
    }
    
    // Clean up tunnel URL file
    const urlFile = `/tmp/ghcc-${sessionName}-tunnel-url`;
    if (fs.existsSync(urlFile)) {
      fs.unlinkSync(urlFile);
    }
    
    // Clean up custom HTML file
    const htmlFile = `/tmp/ghcc-${sessionName}.html`;
    if (fs.existsSync(htmlFile)) {
      fs.unlinkSync(htmlFile);
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

  showUrls(port: string, session?: string, publicUrl?: string, httpsEnabled: boolean = false): void {
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

    const protocol = httpsEnabled ? 'https' : 'http';
    console.log(chalk.cyan('Access URLs:'));
    console.log(chalk.white(`  Local:      ${chalk.underline(`${protocol}://localhost:${port}`)}`));
    console.log(chalk.white(`  Network:    ${chalk.underline(`${protocol}://${localIp}:${port}`)}`));
    if (publicUrl) {
      console.log(chalk.white(`  Public:     ${chalk.underline(publicUrl)}`));
    }
    if (session) {
      console.log(chalk.white(`  Session:    ${session}`));
    }
    console.log('');
  }
  
}
