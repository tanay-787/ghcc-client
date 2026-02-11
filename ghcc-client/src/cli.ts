#!/usr/bin/env node

import { program } from 'commander';
import { SessionManager } from './session-manager';
import { spawn } from 'child_process';
import type { StartOptions, StopOptions, StatusOptions, UrlOptions } from './types';

const manager = new SessionManager();

program
  .name('ghcc-client')
  .description('GitHub Copilot CLI Remote Client - Access Copilot from anywhere')
  .version('1.0.0');

program
  .command('start')
  .description('Start remote Copilot session')
  .option('-p, --port <port>', 'Port for remote access', '7681')
  .option('-s, --session <name>', 'tmux session name', 'copilot-remote')
  .action(async (options: StartOptions) => {
    await manager.start(options);
  });

program
  .command('stop')
  .description('Stop remote session')
  .option('-s, --session <name>', 'tmux session name', 'copilot-remote')
  .action(async (options: StopOptions) => {
    await manager.stop(options);
  });

program
  .command('status')
  .description('Check session status')
  .option('-s, --session <name>', 'tmux session name', 'copilot-remote')
  .action(async (options: StatusOptions) => {
    await manager.status(options);
  });

program
  .command('url')
  .description('Show access URLs')
  .option('-p, --port <port>', 'Port number', '7681')
  .action((options: UrlOptions) => {
    manager.showUrls(options.port);
  });

program.parse();
