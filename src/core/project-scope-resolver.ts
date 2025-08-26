import { execSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

function safeSlug(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function hash8(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 8);
}

function getGitTopLevel(cwd: string): string | null {
  try {
    const out = execSync('git rev-parse --show-toplevel', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

function getGitRemoteOrigin(cwd: string): string | null {
  try {
    const out = execSync('git config --get remote.origin.url', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

function parseOwnerRepo(remoteUrl: string): { owner: string; repo: string } | null {
  const sshMatch = remoteUrl.match(/^[^@]+@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2].replace(/\.git$/i, '') };
  }
  try {
    const url = new URL(remoteUrl.replace(/^git\+/, ''));
    const parts = url.pathname.replace(/^\/+/, '').split('/');
    if (parts.length >= 2) {
      const owner = parts[0];
      const repo = parts[1].replace(/\.git$/i, '');
      return { owner, repo };
    }
  } catch {}
  return null;
}

function findNearestProjectMarker(startDir: string, stopDir: string): string | null {
  const markers = ['package.json', 'go.mod', 'pyproject.toml', 'Cargo.toml'];
  let dir = startDir;
  while (true) {
    for (const m of markers) {
      if (fs.existsSync(path.join(dir, m))) return dir;
    }
    if (dir === stopDir) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function resolveProjectKey(cwd: string = process.cwd()): string {
  const override = (process.env.DOTAI_PROJECT_KEY || '').trim();
  if (override) return safeSlug(override);

  const repoRoot = getGitTopLevel(cwd);
  const remote = repoRoot ? getGitRemoteOrigin(repoRoot) : null;
  const parsed = remote ? parseOwnerRepo(remote) : null;

  if (repoRoot && parsed) {
    const ownerRepo = `${safeSlug(parsed.owner)}-${safeSlug(parsed.repo)}`;

    const markerDir = findNearestProjectMarker(cwd, repoRoot);
    let subpathSlug = '';
    if (markerDir && markerDir !== repoRoot) {
      const rel = path.relative(repoRoot, markerDir);
      subpathSlug = '--' + safeSlug(rel);
    } else {
      const relToRoot = path.relative(repoRoot, cwd);
      if (relToRoot && relToRoot !== '' && relToRoot !== '.') {
        const first = relToRoot.split(path.sep)[0];
        if (first) subpathSlug = '--' + safeSlug(first);
      }
    }

    return `${ownerRepo}${subpathSlug}`;
  }

  const base = path.basename(cwd) || 'workspace';
  return `${safeSlug(base)}-${hash8(cwd)}`;
}