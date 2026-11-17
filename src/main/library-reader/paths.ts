import fs from 'node:fs';
import path from 'node:path';
import { APP_HOME } from '../../shared/core-paths';
import { applicationRoot } from '../resources';

/** Resolve built-in Study Reader runtime & UI directory (unpacked when running from ASAR). */
export function libraryReaderDirectory(): string {
  const root = applicationRoot();
  if (root.endsWith('.asar') || root.includes('.asar' + path.sep)) {
    const unpacked = root.replace(/\.asar(?=$|[\\/])/, '.asar.unpacked');
    const candidate = path.join(unpacked, 'resources', 'library-reader');
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(root, 'resources', 'library-reader');
}

export function libraryReaderPreviewWorkerPath(): string {
  return path.join(libraryReaderDirectory(), 'lib', 'preview-worker.cjs');
}

export function libraryReaderRoot(home = APP_HOME): string {
  return path.join(home, 'library-reader');
}
