// Thin wrapper around the MuseScore CLI (headless converter mode).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const CANDIDATES = [
  process.env.MSCORE_BIN,
  '/Applications/MuseScore 4.app/Contents/MacOS/mscore',
  '/Applications/MuseScore 4.app/Contents/MacOS/MuseScore 4',
  '/Applications/MuseScore 3.app/Contents/MacOS/mscore',
  '/usr/local/bin/mscore', '/usr/local/bin/musescore',
  '/opt/homebrew/bin/mscore', '/usr/bin/mscore', '/usr/bin/musescore',
];

let cached = null;

export function findBinary({ refresh = false } = {}) {
  if (cached && !refresh) return cached;
  for (const c of CANDIDATES) {
    if (!c) continue;
    try {
      if (path.isAbsolute(c)) {
        if (fs.existsSync(c)) { cached = c; return c; }
      } else {
        const p = whichSync(c);
        if (p) { cached = p; return p; }
      }
    } catch { /* keep looking */ }
  }
  cached = null;
  return null;
}

function whichSync(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) {
    const p = path.join(d, name);
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}

export function run(args, { timeout = 180000, cwd } = {}) {
  const bin = findBinary();
  if (!bin) return Promise.reject(new Error('MuseScore binary not found — set MSCORE_BIN'));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, timeout);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

export async function version() {
  const bin = findBinary();
  if (!bin) return null;
  const r = await run(['--version'], { timeout: 30000 });
  const m = /MuseScore\w*\s+([\d.]+)/.exec(r.stdout + r.stderr);
  return m ? m[1] : (r.stdout.trim() || null);
}

// Export `input` to `outPath`; MuseScore appends "-<page>" for image outputs.
export async function exportTo(input, outPath, { resolution, trim, extraArgs = [] } = {}) {
  const ext = path.extname(outPath).toLowerCase().replace('.', '');
  const dir = path.dirname(outPath);
  const base = path.basename(outPath, path.extname(outPath));
  await fsp.mkdir(dir, { recursive: true });
  const started = Date.now();
  const args = ['-o', outPath, '-f'];
  if (['png', 'svg'].includes(ext)) {
    args.push('-r', String(resolution || 130));
    if (trim !== undefined && trim !== null) args.push('-T', String(trim));
  }
  args.push(...extraArgs, input);
  const res = await run(args);
  const produced = await collect(dir, base, ext, started);
  return { ...res, ok: produced.length > 0, files: produced, outPath };
}

async function collect(dir, base, ext, since) {
  let names = [];
  try { names = await fsp.readdir(dir); } catch { return []; }
  const re = new RegExp(`^${escapeRe(base)}(-\\d+)?\\.${escapeRe(ext)}$`, 'i');
  const hits = [];
  for (const n of names) {
    if (!re.test(n)) continue;
    const full = path.join(dir, n);
    try {
      const st = await fsp.stat(full);
      if (st.mtimeMs >= since - 2000 && st.size > 0) hits.push(full);
    } catch { /* ignore */ }
  }
  hits.sort();
  return hits;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Parse JSON printed by --score-meta / --score-elements, ignoring log noise.
export function extractJSON(text) {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          const chunk = text.slice(i, j + 1);
          try { return JSON.parse(chunk); } catch { break; }
        }
      }
    }
  }
  return null;
}

export async function scoreMeta(input) {
  const r = await run(['--score-meta', input]);
  return { meta: extractJSON(r.stdout), raw: r.stdout, stderr: r.stderr, code: r.code };
}

export async function scoreElements(input) {
  const r = await run(['--score-elements', input]);
  return { elements: extractJSON(r.stdout), raw: r.stdout, stderr: r.stderr, code: r.code };
}
