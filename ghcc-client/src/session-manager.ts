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

  async start(options: StartOptions): Promise<void> {
    const { port, session } = options;
    
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

    const spinner2: Ora = ora(`Checking for existing session "${session}"...`).start();
    try {
      await execAsync(`tmux has-session -t ${session} 2>/dev/null`);
      spinner2.warn(`Session "${session}" already exists`);
      console.log(chalk.yellow(`Use: tmux attach -t ${session} to connect`));
      console.log(chalk.yellow(`Or: ghcc-client stop to stop it`));
    } catch {
      spinner2.succeed('No existing session found');
      
      const spinner3: Ora = ora('Starting Copilot in tmux...').start();
      try {
        await execAsync(`tmux new-session -d -s ${session} copilot`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        spinner3.succeed(`Copilot started in tmux session "${session}"`);
      } catch (error) {
        spinner3.fail('Failed to start tmux session');
        console.error(chalk.red((error as Error).message));
        process.exit(1);
      }
    }

    const spinner4: Ora = ora(`Starting ttyd server on port ${port}...`).start();
    try {
      const ttyd = spawn(this.ttydPath, [
        '-p', port,
        '-W',
        'tmux', 'attach', '-t', session
      ], {
        detached: true,
        stdio: 'ignore'
      });
      
      ttyd.unref();
      
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      spinner4.succeed(`ttyd server started on port ${port}`);
    } catch (error) {
      spinner4.fail('Failed to start ttyd');
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    }

    console.log(chalk.green('\n✅ Remote session is ready!\n'));
    this.showUrls(port);
  }

  async stop(options: StopOptions): Promise<void> {
    const { session } = options;
    
    console.log(chalk.cyan('🛑 Stopping remote session...\n'));
    
    const spinner1: Ora = ora('Stopping ttyd server...').start();
    try {
      await execAsync('pkill -f ttyd');
      spinner1.succeed('ttyd server stopped');
    } catch {
      spinner1.info('ttyd was not running');
    }

    const spinner2: Ora = ora(`Stopping tmux session "${session}"...`).start();
    try {
      await execAsync(`tmux kill-session -t ${session}`);
      spinner2.succeed(`Session "${session}" stopped`);
    } catch {
      spinner2.info(`Session "${session}" was not running`);
    }

    console.log(chalk.green('\n✅ All stopped\n'));
  }

  async status(options: StatusOptions): Promise<void> {
    const { session } = options;
    
    console.log(chalk.cyan('📊 Session Status\n'));
    
    try {
      await execAsync(`tmux has-session -t ${session}`);
      console.log(chalk.green(`✅ tmux session "${session}" is running`));
      
      const { stdout } = await execAsync(`tmux display-message -t ${session} -p "#{session_created} #{session_windows}"`);
      const parts = stdout.trim().split(' ');
      const created = new Date(parseInt(parts[0]) * 1000);
      console.log(chalk.gray(`   Started: ${created.toLocaleString()}`));
    } catch {
      console.log(chalk.red(`❌ tmux session "${session}" is not running`));
    }

    try {
      await execAsync('pgrep -f ttyd');
      console.log(chalk.green('✅ ttyd server is running'));
      
      const { stdout } = await execAsync('pgrep -af ttyd');
      const match = stdout.match(/-p (\d+)/);
      if (match) {
        console.log(chalk.gray(`   Port: ${match[1]}`));
      }
    } catch {
      console.log(chalk.red('❌ ttyd server is not running'));
    }

    console.log('');
  }

  showUrls(port: string): void {
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
    console.log(chalk.white(`  Terminal:        ${chalk.gray('tmux attach -t copilot-remote')}`));
    console.log('');
    console.log(chalk.gray('💡 Tip: Use "ghcc-client url" to see these URLs again'));
    console.log('');
  }
}
