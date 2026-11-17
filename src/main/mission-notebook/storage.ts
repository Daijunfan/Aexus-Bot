import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Page, Workspace } from '../../shared/mission-notebook/types';

export type VersionEntry = { id: string; at: number; page: Page };

export function folderDataDirectory(root: string): string {
  return path.join(root, '.mininotion');
}

export function validateWorkspace(data: any): Workspace {
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.pages) ||
    !data.settings ||
    typeof data.name !== 'string' ||
    !Array.isArray(data.expanded) ||
    !Array.isArray(data.recent)
  ) {
    throw new Error('这不是有效的 Mission 笔记本工作空间。');
  }
  const ids = new Set<string>();
  for (const page of data.pages) {
    if (
      typeof page.id !== 'string' ||
      !page.id ||
      ids.has(page.id) ||
      typeof page.title !== 'string' ||
      !Array.isArray(page.blocks) ||
      !page.values
    ) {
      throw new Error('工作空间中的页面数据无效。');
    }
    ids.add(page.id);
  }
  const pagesById = new Map<string, Page>(data.pages.map((page: Page) => [page.id, page]));
  const validated = new Set<string>();
  for (const page of data.pages) {
    if (validated.has(page.id)) continue;
    let parentId = page.parentId;
    if (!parentId) {
      validated.add(page.id);
      continue;
    }
    const seen = new Set<string>([page.id]);
    while (parentId && !validated.has(parentId)) {
      if (seen.has(parentId) || !ids.has(parentId)) throw new Error('工作空间的页面层级无效。');
      seen.add(parentId);
      parentId = pagesById.get(parentId)?.parentId ?? null;
    }
    for (const id of seen) validated.add(id);
  }
  return data as Workspace;
}

export function atomicWrite(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeFileSync(fd, typeof value === 'string' ? value : JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, file);
}

export class Storage {
  readonly directory: string;
  readonly file: string;
  readonly assets: string;
  readonly versionDirectory: string;
  readonly spacesDirectory: string;
  readonly agentsDirectory: string;
  current: Workspace | null = null;
  private lastSnapshot = new Map<string, number>();
  private backupDay: string | null = null;

  constructor(directory: string) {
    this.directory = directory;
    this.file = path.join(directory, 'workspace.json');
    this.assets = path.join(directory, 'attachments');
    this.versionDirectory = path.join(directory, 'history');
    this.spacesDirectory = path.join(directory, 'spaces');
    this.agentsDirectory = path.join(directory, 'agents');
    fs.mkdirSync(this.assets, { recursive: true });
  }

  load(): Workspace | null {
    if (!fs.existsSync(this.file)) return null;
    this.current = validateWorkspace(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    return this.current;
  }

  save(workspace: Workspace): number {
    validateWorkspace(workspace);
    const now = Date.now();
    if (this.current) {
      const day = new Date().toISOString().slice(0, 10);
      if (this.backupDay !== day) {
        atomicWrite(path.join(this.directory, 'backups', `${day}.json`), this.current);
        this.backupDay = day;
        const backups = fs
          .readdirSync(path.join(this.directory, 'backups'))
          .filter((n) => n.endsWith('.json'))
          .sort()
          .reverse();
        for (const file of backups.slice(30)) fs.unlinkSync(path.join(this.directory, 'backups', file));
      }
      const nextById = new Map(workspace.pages.map((p) => [p.id, p]));
      for (const old of this.current.pages) {
        const next = nextById.get(old.id);
        if (
          next &&
          next.updatedAt !== old.updatedAt &&
          now - (this.lastSnapshot.get(old.id) || 0) > 5 * 60_000
        ) {
          this.snapshot(old);
        }
      }
    }
    this.persist(workspace);
    this.current = workspace;
    return now;
  }

  persist(workspace: Workspace): void {
    atomicWrite(this.file, workspace);
  }

  historyFile(id: string): string {
    return path.join(this.versionDirectory, `${Buffer.from(id).toString('hex')}.json`);
  }

  versions(id: string): VersionEntry[] {
    const file = this.historyFile(id);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  }

  snapshot(page: Page): void {
    const now = Date.now();
    const entries = this.versions(page.id);
    if (!entries[0] || JSON.stringify(entries[0].page) !== JSON.stringify(page)) {
      entries.unshift({ id: randomUUID(), at: now, page });
      atomicWrite(this.historyFile(page.id), entries.slice(0, 60));
    }
    this.lastSnapshot.set(page.id, now);
  }

  saveAsset(name: string, bytes: Uint8Array | Buffer): string {
    const extension = path
      .extname(name)
      .replace(/[^.a-zA-Z0-9]/g, '')
      .slice(0, 16);
    const filename = randomUUID() + extension;
    fs.mkdirSync(this.assets, { recursive: true });
    fs.writeFileSync(path.join(this.assets, filename), Buffer.from(bytes), { mode: 0o600 });
    return `asset://local/${filename}`;
  }

  assetPath(url: string, workspaceRoot?: string): string {
    return assetPath(this.directory, url, workspaceRoot);
  }

  spaceRoot(pageId: string): string {
    if (typeof pageId !== 'string' || !/^[0-9a-zA-Z_-]{1,64}$/.test(pageId)) {
      throw new Error('无效的空间页面 ID');
    }
    return path.join(this.spacesDirectory, pageId);
  }

  spaceDirectory(pageId: string, folderId?: string | null): string {
    const root = this.spaceRoot(pageId);
    if (folderId === null || folderId === undefined) return root;
    if (typeof folderId !== 'string' || !/^[0-9a-zA-Z_-]{1,64}$/.test(folderId)) {
      throw new Error('无效的文件夹 ID');
    }
    const folder = this.current?.pages
      .find((page) => page.id === pageId)
      ?.folders?.find((item) => item.id === folderId);
    const directory = path.join(root, folder?.path || folderId);
    const resolved = path.resolve(directory);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('无效的空间路径');
    return resolved;
  }

  saveSpaceFile(pageId: string, folderId: string | null | undefined, name: string, bytes: Uint8Array | Buffer) {
    const directory = this.spaceDirectory(pageId, folderId);
    const real = this.resolveWithinSpace(pageId, directory);
    fs.mkdirSync(real, { recursive: true, mode: 0o700 });
    const extension = path
      .extname(name)
      .replace(/[^.a-zA-Z0-9]/g, '')
      .slice(0, 16);
    const filename = randomUUID() + extension;
    fs.writeFileSync(path.join(real, filename), Buffer.from(bytes), { mode: 0o600 });
    return {
      filename,
      path: path.join(real, filename),
      url: `asset://local/spaces/${pageId}/${folderId ? `${folderId}/` : ''}${filename}`,
    };
  }

  resolveWithinSpace(pageId: string, target: string): string {
    const root = this.spaceRoot(pageId);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const base = fs.realpathSync(root);
    const absolute = path.resolve(target);
    if (
      ![path.resolve(root), base].some(
        (directory) => absolute === directory || absolute.startsWith(directory + path.sep),
      )
    ) {
      throw new Error('空间路径越界');
    }
    let ancestor = absolute;
    while (!fs.lstatSync(ancestor, { throwIfNoEntry: false })) ancestor = path.dirname(ancestor);
    const realAncestor = fs.realpathSync(ancestor);
    if (realAncestor !== base && !realAncestor.startsWith(base + path.sep)) throw new Error('空间路径越界');
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    const resolved = fs.realpathSync(target);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error('空间路径越界');
    return resolved;
  }

  removeSpace(pageId: string): void {
    const root = this.spaceRoot(pageId);
    if (root.startsWith(this.spacesDirectory + path.sep)) {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    }
  }

  agentLogFile(pageId: string, conversationId?: string): string {
    if (typeof pageId !== 'string' || !/^[0-9a-zA-Z_-]{1,64}$/.test(pageId)) {
      throw new Error('无效的空间页面 ID');
    }
    if (
      conversationId !== undefined &&
      (typeof conversationId !== 'string' || !/^[0-9a-zA-Z_-]{1,64}$/.test(conversationId))
    ) {
      throw new Error('无效的会话 ID');
    }
    return path.join(this.agentsDirectory, `${pageId}${conversationId ? `.${conversationId}` : ''}.jsonl`);
  }

  removeAgentLog(pageId: string): void {
    fs.rmSync(this.agentLogFile(pageId), { force: true });
    if (!fs.existsSync(this.agentsDirectory)) return;
    for (const name of fs.readdirSync(this.agentsDirectory)) {
      if (name.startsWith(`${pageId}.`) && name.endsWith('.jsonl')) {
        fs.rmSync(path.join(this.agentsDirectory, name), { force: true });
      }
    }
  }
}

export function assetPath(directory: string, url: string, workspaceRoot?: string): string {
  if (workspaceRoot) {
    const own = assetPath(directory, url);
    const allowed = (file: string) => {
      if (!fs.realpathSync(file).startsWith(workspaceRoot + path.sep)) {
        throw new Error('附件指向工作目录外部');
      }
      return file;
    };
    if (fs.existsSync(own)) return allowed(own);
    const find = (folder: string): string | undefined => {
      const metadata = path.join(folder, '.mininotion');
      if (folder !== workspaceRoot && fs.existsSync(metadata) && !fs.lstatSync(metadata).isSymbolicLink()) {
        const candidate = assetPath(metadata, url);
        if (fs.existsSync(candidate)) return allowed(candidate);
      }
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        if (
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          !['node_modules', 'dist', 'target'].includes(entry.name)
        ) {
          const found = find(path.join(folder, entry.name));
          if (found) return found;
        }
      }
      return undefined;
    };
    return find(workspaceRoot) || own;
  }
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.slice(1));
  if (parsed.protocol !== 'asset:' || parsed.hostname !== 'local' || !name) {
    throw new Error('无效的附件路径');
  }
  if (/^spaces\/[0-9a-zA-Z_-]{1,64}\//.test(name)) {
    const parts = name.split('/');
    if (
      parts.some(
        (part) => !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0'),
      ) ||
      parts.includes('.mininotion-runtime')
    ) {
      throw new Error('无效的空间文件路径');
    }
    const root = path.join(directory, 'spaces', parts[1]);
    const target = path.join(directory, name);
    if (fs.existsSync(target) && !fs.realpathSync(target).startsWith(fs.realpathSync(root) + path.sep)) {
      throw new Error('空间文件路径越界');
    }
    return target;
  }
  if (path.basename(name) !== name || name === '.' || name === '..') throw new Error('无效的附件路径');
  return path.join(directory, 'attachments', name);
}
