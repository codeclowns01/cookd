#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string };

const program = new Command();

program
  .name('cookd')
  .description('the antisocial network — field reporter CLI')
  .version(pkg.version, '-v, --version');

program
  .command('init')
  .description('link this machine to your cookd account')
  .action(async () => {
    const { runInit } = await import('./commands/init.js');
    await runInit();
  });

program
  .command('status')
  .description('current rolling window usage')
  .action(async () => {
    const { runStatus } = await import('./commands/status.js');
    await runStatus();
  });

program
  .command('watch')
  .description('start background sync loop')
  .action(async () => {
    const { runWatch } = await import('./commands/watch.js');
    await runWatch();
  });

program
  .command('wrapped')
  .description('full usage anatomy for the current window')
  .action(async () => {
    const { runWrapped } = await import('./commands/wrapped.js');
    await runWrapped();
  });

program.parseAsync(process.argv).catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
