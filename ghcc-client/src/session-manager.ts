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
import type { StartOptions, StopOptions, StatusOptions, UrlOptions } from './types';

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
  private async getAllTtydProcesses(): Promise<Map<string, { pid: string; port: string }>> {
    const processMap = new Map<string, { pid: string; port: string }>();
    
    try {
      // Single pgrep call for all copilot-remote ttyd processes
      const { stdout: pids } = await execAsync('pgrep -f "ttyd.*copilot-remote" 2>/dev/null || true');
      const pidList = pids.trim().split('\n').filter(p => p);
      
      for (const pid of pidList) {
        if (!pid) continue;
        
        try {
          // Get command line to extract session and port
          const { stdout: cmdline } = await execAsync(`ps -p ${pid} -o args= 2>/dev/null`);
          
          // Extract session name
          const sessionMatch = cmdline.match(/attach -t (copilot-remote[^\s]*)/);
          if (!sessionMatch) continue;
          const sessionName = sessionMatch[1];
          
          // Extract port
          const portMatch = cmdline.match(/-p (\d+)/);
          const port = portMatch ? portMatch[1] : '';
          
          processMap.set(sessionName, { pid, port });
        } catch {
          // Skip this process if we can't parse it
        }
      }
    } catch {
      // Return empty map on error
    }
    
    return processMap;
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
      const sessions = tmuxOutput.trim().split('\n').filter(s => s && s.startsWith('copilot-remote'));
      
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
      await execAsync(`tmux new-session -d -s ${session} ${copilotCmd}`);
      
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
    const spinner4: Ora = ora(`Starting ttyd server on port ${finalPort}...`).start();
    
    // SECURITY: Generate strong authentication password for ttyd
    ttydPassword = this.generateSecurePassword(32);
    
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
      }
      
      // Use custom HTML with mobile fixes if available
      if (fs.existsSync(customHtmlPath)) {
        ttydArgs.push('-I', customHtmlPath);
      }
      
      // Add client options for better UX
      ttydArgs.push('-t', 'fontSize=14');
      ttydArgs.push('-t', 'fontFamily=Consolas,Monaco,Courier New,monospace');
      ttydArgs.push('-t', 'theme={"background":"#1e1e1e","foreground":"#d4d4d4","cursor":"#d4d4d4","selection":"#264f78"}');
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
        const subdomain = session.replace('copilot-remote', 'ghcc').replace(/[^a-zA-Z0-9-]/g, '');
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
        
        spinner5.succeed(`Public URL created: ${chalk.cyan(publicUrl)}`);
        
        // Get tunnel password (public IP) for user to share
        try {
          const { stdout: tunnelPassword } = await execAsync('curl -s https://loca.lt/mytunnelpassword');
          const password = tunnelPassword.trim();
          if (password) {
            console.log(chalk.gray(`   Tunnel Password: ${chalk.white(password)} ${chalk.gray('(share with visitors)')}`));
          }
        } catch {
          // Ignore if we can't fetch the password
        }
      } catch (error) {
        spinner5.warn('Failed to create public tunnel');
        console.log(chalk.yellow('   Session is available locally only'));
        console.log(chalk.gray(`   Error: ${error instanceof Error ? error.message : error}`));
        console.log(chalk.gray('   Tip: Check https://loca.lt for service status'));
      }
    } catch (error) {
      spinner4.fail('Failed to spawn ttyd process');
      console.error(chalk.red('\n✗ Error: ' + (error as Error).message));
      console.log(chalk.yellow('\nCleaning up tmux session...'));
      await execAsync(`tmux kill-session -t ${session} 2>/dev/null || true`);
      process.exit(1);
    }

    console.log(chalk.green('\n✅ Remote session is ready!\n'));
    
    // SECURITY: Display authentication credentials
    console.log(chalk.white('🔐 Authentication Credentials:\n'));
    console.log(chalk.gray('   Username: ') + chalk.white('user'));
    console.log(chalk.gray('   Password: ') + chalk.white(ttydPassword));
    console.log(chalk.yellow('\n⚠️  Save this password! You\'ll need it to access the terminal'));
    console.log(chalk.gray('   It will not be shown again for security reasons\n'));
    
    // Show QR code if public URL exists
    if (publicUrl) {
      console.log(chalk.white('📱 Scan QR code to access from mobile:\n'));
      qrcode.generate(publicUrl, { small: true });
      console.log();
      console.log(chalk.yellow('⚠️  Important: Visitors need TWO passwords'));
      console.log(chalk.gray('   1. Tunnel password (shown earlier)'));
      console.log(chalk.gray('   2. Terminal password (shown above)'));
      console.log(chalk.gray('   After tunnel auth, it works for 7 days from their IP'));
      console.log();
    }
    
    this.showUrls(finalPort.toString(), session, publicUrl, ttydPassword);
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

  async status(options: StatusOptions): Promise<void> {
    const { session } = options;
    
    console.log(chalk.cyan('📊 Session Status\n'));
    
    if (session) {
      // Show status for specific session
      await this.showSessionStatus(session);
    } else {
      // Show status for all sessions (optimized with batch discovery)
      try {
        const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}" 2>/dev/null || true');
        const allSessions = stdout.trim().split('\n').filter(s => s && s.startsWith('copilot-remote'));
        
        if (allSessions.length === 0) {
          console.log(chalk.yellow('ℹ  No copilot-remote sessions found\n'));
          return;
        }
        
        // OPTIMIZATION: Single batch call instead of N individual calls
        const processMap = await this.getAllTtydProcesses();
        
        for (const sess of allSessions) {
          await this.showSessionStatusWithCache(sess, processMap);
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
    
    // Show public URL if available
    const publicUrl = await this.getTunnelUrl(session);
    if (publicUrl) {
      console.log(chalk.gray(`   Public URL: ${chalk.cyan(publicUrl)}`));
    }
  }

  // Optimized version using pre-fetched process map
  private async showSessionStatusWithCache(session: string, processMap: Map<string, { pid: string; port: string }>): Promise<void> {
    // Check if tmux session exists
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

    // Lookup from cache instead of calling pgrep
    const processInfo = processMap.get(session);
    if (processInfo && processInfo.port) {
      console.log(chalk.gray(`   Port: ${processInfo.port}`));
    } else if (processInfo) {
      console.log(chalk.gray(`   ttyd: running (port unknown)`));
    } else {
      console.log(chalk.gray(`   ttyd: not running`));
    }
    
    // Show public URL if available
    const publicUrl = await this.getTunnelUrl(session);
    if (publicUrl) {
      console.log(chalk.gray(`   Public URL: ${chalk.cyan(publicUrl)}`));
    }
  }

  showUrls(port: string, session?: string, publicUrl?: string, password?: string): void {
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

    const protocol = 'https'; // Using HTTPS now with self-signed cert
    console.log(chalk.cyan('Access URLs:'));
    console.log(chalk.white(`  Local:      ${chalk.underline(`${protocol}://localhost:${port}`)}`));
    console.log(chalk.white(`  Network:    ${chalk.underline(`${protocol}://${localIp}:${port}`)}`));
    if (publicUrl) {
      console.log(chalk.white(`  Public:     ${chalk.underline(publicUrl)}`));
    }
    if (session) {
      console.log(chalk.white(`  Session:    ${session}`));
    }
    if (password) {
      console.log(chalk.gray(`  Auth:       user:${password}`));
    }
    console.log('');
  }
  
  async url(options: UrlOptions): Promise<void> {
    const { session } = options;
    
    // Case 1: No session provided - show help
    if (!session) {
      console.log(chalk.yellow('\n⚠️  Please specify a session name\n'));
      console.log(chalk.white('Usage: ghcc-client url -s <session-name>'));
      console.log('');
      console.log(chalk.gray('💡 Tip: Run "ghcc-client status" to see all sessions'));
      console.log('');
      return;
    }
    
    // Case 2: Show QR code for specific session
    if (!(await this.sessionExists(session))) {
      console.log(chalk.red(`\n❌ Session "${session}" is not running\n`));
      return;
    }
    
    const publicUrl = await this.getTunnelUrl(session);
    if (!publicUrl) {
      console.log(chalk.yellow(`\n⚠️  No public URL found for session "${session}"\n`));
      console.log(chalk.gray('This session may not have a tunnel, or the tunnel failed to start.'));
      console.log('');
      return;
    }
    
    console.log(chalk.cyan(`\n📱 QR Code for session "${session}":\n`));
    console.log(chalk.white(`URL: ${chalk.underline(publicUrl)}\n`));
    qrcode.generate(publicUrl, { small: true });
    console.log('');
  }
}
