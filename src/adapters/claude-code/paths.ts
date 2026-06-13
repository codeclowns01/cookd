import { homedir } from 'os';
import { join } from 'path';
import { readdir, stat } from 'fs/promises';

export function claudeProjectsRoot(): string {
  return join(homedir(), '.claude', 'projects');
}

export async function discoverProjectDirs(): Promise<string[]> {
  const root = claudeProjectsRoot();
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => join(root, e.name));
  } catch {
    return [];
  }
}

export async function jsonlFilesIn(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && e.name.endsWith('.jsonl'))
      .map(e => join(dir, e.name));
  } catch {
    return [];
  }
}

export async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
