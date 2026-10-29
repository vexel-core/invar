import fs from 'node:fs';
import path from 'node:path';

export function createDirectoryJunction(targetPath: string, junctionPath: string): boolean {
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  // Ensure parent directory of junction exists
  const parentDir = path.dirname(junctionPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // If junction already exists, remove it first
  if (fs.existsSync(junctionPath)) {
    removeDirectoryJunction(junctionPath);
  }

  try {
    const isWindows = process.platform === 'win32';
    fs.symlinkSync(targetPath, junctionPath, isWindows ? 'junction' : 'dir');
    return true;
  } catch (err: any) {
    console.warn(`[invar-shadow] Warning: Failed to create junction to ${targetPath}: ${err.message}`);
    return false;
  }
}

export function removeDirectoryJunction(junctionPath: string): void {
  if (!fs.existsSync(junctionPath)) {
    return;
  }

  try {
    const stat = fs.lstatSync(junctionPath);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(junctionPath);
    } else if (process.platform === 'win32') {
      // In Windows, junctions might report as directories under some APIs
      fs.rmdirSync(junctionPath);
    }
  } catch (err: any) {
    console.warn(`[invar-shadow] Warning: Failed to remove junction ${junctionPath}: ${err.message}`);
  }
}
