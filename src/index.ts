#!/usr/bin/env node

/**
 * DBX CLI Entry Point
 */

import { Command } from 'commander';
import { registerInitCommand } from './commands/init.js';
import { registerUpCommand } from './commands/up.js';
import { registerListCommand } from './commands/list.js';
import { registerLogsCommand } from './commands/logs.js';
import { registerSyncCommand } from './commands/sync.js';
import { registerUrlCommand } from './commands/url.js';
import { registerBackupCommand } from './commands/backup.js';
import { registerRestoreCommand } from './commands/restore.js';
import { registerDestroyCommand } from './commands/destroy.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const program = new Command();

program
  .name('dbx')
  .description('CLI tool for provisioning MongoDB instances on remote VPS infrastructure')
  .version(pkg.version);

// Register commands
registerInitCommand(program);
registerListCommand(program);
registerLogsCommand(program);
registerSyncCommand(program);
registerUpCommand(program);
registerUrlCommand(program);
registerBackupCommand(program);
registerRestoreCommand(program);
registerDestroyCommand(program);

// Parse arguments
program.parse();

// Re-export modules for programmatic use
export * from './config/index.js';
export * from './state/index.js';
export * from './ssh/index.js';
