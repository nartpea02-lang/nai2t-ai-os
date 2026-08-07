// Sandbox: every file/command operation is confined to a single workspace root.
// Nothing here can read, write, or execute outside that directory tree.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';

const ROOT = config.workspaceDir;

// Ensure the workspace exists and has a tiny bit of seed content so demos aren't empty.
export async function ensureWorkspace() {
  await fsp.mkdir(ROOT, { recursive: true });
  const readme = path.join(ROOT, 'README.md');
  if (!fs.existsSync(readme)) {
    await fsp.writeFile(readme,
      '# NAI2T Workspace\n\nนี่คือพื้นที่ทำงานที่ปลอดภัยของ Luzy — ทุกคำสั่งและไฟล์อยู่ในโฟลเดอร์นี้เท่านั้น\n');
  }
}

// Resolve a user/model-supplied path and confine it to ROOT. Throws on escape.
export function resolveInside(p = '.') {
  const abs = path.resolve(ROOT, p);
  const rel = path.relative(ROOT, abs);
  if (rel === '' ) return ROOT;
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`เส้นทางออกนอกพื้นที่ทำงานที่อนุญาต: ${p}`);
  }
  return abs;
}

const IGNORE = new Set(['node_modules', '.git', '.cache', 'dist', 'build']);

export async function listFiles(p = '.') {
  const abs = resolveInside(p);
  const st = await fsp.stat(abs);
  if (!st.isDirectory()) return { path: p, entries: [{ name: path.basename(abs), type: 'file', size: st.size }] };
  const items = await fsp.readdir(abs, { withFileTypes: true });
  const entries = items.map(d => ({
    name: d.name,
    type: d.isDirectory() ? 'dir' : 'file',
  })).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return { path: path.relative(ROOT, abs) || '.', entries };
}

export async function readFile(p) {
  const abs = resolveInside(p);
  const st = await fsp.stat(abs);
  if (st.isDirectory()) throw new Error(`${p} เป็นโฟลเดอร์ ไม่ใช่ไฟล์`);
  if (st.size > config.maxOutputBytes) {
    const fd = await fsp.open(abs, 'r');
    const buf = Buffer.alloc(config.maxOutputBytes);
    await fd.read(buf, 0, config.maxOutputBytes, 0);
    await fd.close();
    return buf.toString('utf8') + `\n… (ตัดที่ ${config.maxOutputBytes} bytes)`;
  }
  return fsp.readFile(abs, 'utf8');
}

// Recursive regex search, capped, ignoring vendor dirs.
export async function searchFiles(query, p = '.', maxResults = 60) {
  let re;
  try { re = new RegExp(query, 'i'); } catch { re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
  const start = resolveInside(p);
  const results = [];
  async function walk(dir) {
    if (results.length >= maxResults) return;
    let items;
    try { items = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const d of items) {
      if (results.length >= maxResults) return;
      if (IGNORE.has(d.name)) continue;
      const abs = path.join(dir, d.name);
      if (d.isDirectory()) { await walk(abs); continue; }
      let text;
      try {
        const st = await fsp.stat(abs);
        if (st.size > 512 * 1024) continue;
        text = await fsp.readFile(abs, 'utf8');
      } catch { continue; }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length && results.length < maxResults; i++) {
        if (re.test(lines[i])) {
          results.push({ file: path.relative(ROOT, abs), line: i + 1, text: lines[i].slice(0, 200).trim() });
        }
      }
    }
  }
  const st = await fsp.stat(start);
  if (st.isDirectory()) await walk(start); else await walk(path.dirname(start));
  return results;
}

// Patterns that require explicit user confirmation before running.
const DESTRUCTIVE = [
  /\brm\b/, /\brmdir\b/, /\bmv\b/, /\bdd\b/, /\bmkfs/, /\bshred\b/, /\btruncate\b/,
  />\s*\/dev\//, /\bchmod\s+-R/, /\bchown\s+-R/, /\bgit\s+(push|reset\s+--hard|clean)/,
  /\bnpm\s+(publish|unpublish)/, /\bcurl\b[^|]*\|\s*(sh|bash)/, /\bwget\b[^|]*\|\s*(sh|bash)/,
  /\bshutdown\b/, /\breboot\b/, /\bkill(all)?\b/, /:\(\)\s*\{/,
];
// Patterns we refuse outright, even with confirmation (irrecoverable / host-level).
const FORBIDDEN = [/\bmkfs/, /:\(\)\s*\{.*\|.*&\s*\}/, /\bdd\b[^\n]*of=\/dev\//, /\bshutdown\b/, /\breboot\b/];

export function classifyCommand(cmd) {
  const c = cmd || '';
  if (FORBIDDEN.some(re => re.test(c))) return 'forbidden';
  if (DESTRUCTIVE.some(re => re.test(c))) return 'destructive';
  return 'safe';
}

// Run a command in the workspace, streaming stdout/stderr via onChunk. Confined cwd, timed out, capped.
export function runCommand(cmd, { onChunk, signal } = {}) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', cmd], {
      cwd: ROOT,
      env: { ...process.env, ANTHROPIC_API_KEY: '', HOME: ROOT },
      timeout: config.cmdTimeoutMs,
    });
    let bytes = 0, out = '';
    let killedForSize = false;
    const feed = (buf) => {
      if (killedForSize) return;
      bytes += buf.length;
      const chunk = buf.toString('utf8');
      out += chunk;
      onChunk?.(chunk);
      if (bytes > config.maxOutputBytes) {
        killedForSize = true;
        onChunk?.('\n… (เอาต์พุตเกินขนาดที่กำหนด หยุดคำสั่ง)\n');
        child.kill('SIGKILL');
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener?.('abort', onAbort, { once: true });
    child.on('error', (e) => resolve({ ok: false, code: -1, output: out + `\n[error] ${e.message}` }));
    child.on('close', (code) => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve({ ok: code === 0, code: code ?? -1, output: out || '(ไม่มีเอาต์พุต)', truncated: killedForSize });
    });
  });
}

export const workspaceRoot = ROOT;
