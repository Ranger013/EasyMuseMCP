// High-level score operations: compose, render, inspect, transpose, parts, open.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseDSL } from './dsl.js';
import { toMusicXML, notatedDuration } from './musicxml.js';
import * as ms from './mscore.js';
import { f, add, cmp, $ as fstr, toNumber } from './frac.js';
import { transposeMusicXML } from './transpose.js';
import { applyOperations, concatScores } from './edit.js';

export const FORMATS = ['musicxml', 'mscz', 'pdf', 'png', 'svg', 'midi', 'mp3'];

export async function doctor() {
  const bin = ms.findBinary({ refresh: true });
  const out = { binary: bin, version: null, scoreMeta: false, formats: {}, ok: false };
  if (!bin) return out;
  try { out.version = await ms.version(); } catch (e) { out.error = String(e.message || e); }
  out.ok = Boolean(out.version);
  return out;
}

function slug(s) {
  return String(s || 'score').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'score';
}

function summarize(score) {
  const parts = score.parts.map((p) => ({
    name: p.name, instrument: p.instrument, staves: p.staves,
    measures: Math.max(0, ...p.streams.map((s) => s.measures.length)),
    notes: p.streams.reduce((a, s) => a + s.measures.reduce((b, m) => b + m.filter((e) => e.type === 'note').length, 0), 0),
  }));
  const totalNotes = parts.reduce((a, p) => a + p.notes, 0);
  const measures = Math.max(0, ...parts.map((p) => p.measures));
  const len = f(score.meta.time.beats, score.meta.time.beatType);
  const secs = score.meta.tempo ? (toNumber(len) * measures * 4) / score.meta.tempo * 60 : null;
  return {
    title: score.meta.title, composer: score.meta.composer,
    key: score.meta.key.root + (score.meta.key.minor ? 'm' : ''),
    time: `${score.meta.time.beats}/${score.meta.time.beatType}`,
    tempo: score.meta.tempo, measures, notes: totalNotes, parts,
    durationSeconds: secs ? Math.round(secs) : null,
  };
}

/**
 * compose({source, name, outDir, formats, resolution})
 * source = DSL text (or {file} path already read by caller)
 */
export async function compose({ source, name, outDir, formats = ['mscz', 'pdf'], resolution = 130, trim = null, keepMusicXML = true, style = null }) {
  const notes = [];
  const score = parseDSL(source, { title: name });
  const { xml, warnings: xmlWarn, divisions } = toMusicXML(score);
  const warnings = [...score.warnings, ...xmlWarn];
  const title = score.meta.title || name || 'Untitled';
  const base = slug(name || score.meta.title);
  const dir = path.resolve(outDir || 'out');
  await fsp.mkdir(dir, { recursive: true });
  const xmlPath = path.join(dir, `${base}.musicxml`);
  await fsp.writeFile(xmlPath, xml, 'utf8');
  const result = { ok: true, name: base, outDir: dir, files: {}, warnings, divisions, summary: summarize(score) };
  result.files.musicxml = xmlPath;

  const wanted = formats.filter((x) => x !== 'musicxml');
  for (const fmt of wanted) {
    if (!FORMATS.includes(fmt)) { warnings.push(`unsupported format "${fmt}" skipped`); continue; }
    const target = path.join(dir, `${base}.${fmt}`);
    const styleArg = style || score.meta.style;
    const res = await ms.exportTo(xmlPath, target, { resolution, trim, extraArgs: styleArg ? ['-S', path.resolve(styleArg)] : [] });
    if (!res.ok) {
      result.ok = false;
      warnings.push(`export ${fmt} failed (exit ${res.code}): ${firstLine(res.stderr)}`);
      continue;
    }
    result.files[fmt] = res.files.length === 1 ? res.files[0] : res.files;
  }
  if (!keepMusicXML && result.files.musicxml) {
    try { await fsp.unlink(result.files.musicxml); delete result.files.musicxml; } catch { /* ignore */ }
  }
  return result;
}

function firstLine(s) {
  return String(s || '').split('\n').find((l) => l.trim() && !/WARNING|ERROR directory|Starting local AI/.test(l)) || '';
}

async function ensureMusicXML(input, workDir) {
  const ext = path.extname(input).toLowerCase();
  if (ext === '.musicxml' || ext === '.xml' || ext === '.mxl') return { xml: input, temp: false };
  const base = path.basename(input, ext);
  const target = path.join(workDir, `${base}.musicxml`);
  const res = await ms.exportTo(input, target, { extraArgs: [] });
  if (!res.ok) throw new Error(`could not convert ${path.basename(input)} to MusicXML (exit ${res.code})`);
  return { xml: res.files[0], temp: true };
}

export async function render({ input, formats = ['pdf', 'png'], outDir, resolution = 130, page, baseName, trim = null, style = null }) {
  const abs = path.resolve(input);
  if (!fs.existsSync(abs)) throw new Error(`file not found: ${abs}`);
  const dir = path.resolve(outDir || path.join(path.dirname(abs), 'out'));
  await fsp.mkdir(dir, { recursive: true });
  const base = baseName || path.basename(abs, path.extname(abs));
  const files = {};
  const warnings = [];
  for (const fmt of formats) {
    if (!FORMATS.includes(fmt)) { warnings.push(`unsupported format "${fmt}"`); continue; }
    if (fmt === 'musicxml') { files.musicxml = abs; continue; }
    const target = path.join(dir, `${base}.${fmt}`);
    const extraArgs = page ? ['--page', String(page)] : [];
    if (style) extraArgs.push('-S', path.resolve(style));
    const res = await ms.exportTo(abs, target, { resolution, trim, extraArgs });
    if (!res.ok) { warnings.push(`export ${fmt} failed (exit ${res.code}): ${firstLine(res.stderr)}`); continue; }
    files[fmt] = res.files.length === 1 ? res.files[0] : res.files;
  }
  return { ok: Object.keys(files).length > 0, base, outDir: dir, files, warnings };
}

export async function inspect({ input }) {
  const abs = path.resolve(input);
  if (!fs.existsSync(abs)) throw new Error(`file not found: ${abs}`);
  const { meta } = await ms.scoreMeta(abs);
  if (!meta) return { ok: false, error: 'MuseScore returned no metadata' };
  const m = meta.metadata || meta;
  return {
    ok: true,
    file: abs,
    title: m.title || m.workTitle || '',
    subtitle: m.subtitle || '',
    composer: m.composer || '',
    lyricist: m.poet || '',
    measures: Number(m.measures) || null,
    pages: Number(m.pages) || null,
    durationSeconds: Number(m.duration) || null,
    key: m.keysig,
    timeSignature: m.timesig || '',
    tempo: m.tempo || null,
    parts: (m.parts || []).map((p) => ({ name: p.name || p.trackName || '', instrument: p.instrumentId || p.program || '' })),
    hasLyrics: String(m.hasLyrics) === 'true',
  };
}

export async function transpose({ input, semitones, outDir, name, formats = ['mscz', 'pdf', 'png'] }) {
  const abs = path.resolve(input);
  if (!fs.existsSync(abs)) throw new Error(`file not found: ${abs}`);
  const dir = path.resolve(outDir || path.join(path.dirname(abs), 'out'));
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, '.tmp');
  await fsp.mkdir(tmp, { recursive: true });
  const { xml } = await ensureMusicXML(abs, tmp);
  const raw = await fsp.readFile(xml, 'utf8');
  const shifted = transposeMusicXML(raw, semitones, { fifthsShift: Math.round((semitones * 7) / 12) });
  const base = slug(name || `${path.basename(abs, path.extname(abs))}_transposed${semitones >= 0 ? '+' : ''}${semitones}`);
  const xmlPath = path.join(dir, `${base}.musicxml`);
  await fsp.writeFile(xmlPath, shifted, 'utf8');
  const files = { musicxml: xmlPath };
  const warnings = [];
  for (const fmt of formats.filter((x) => x !== 'musicxml')) {
    const res = await ms.exportTo(xmlPath, path.join(dir, `${base}.${fmt}`), { resolution: 130, trim: null });
    if (res.ok) files[fmt] = res.files.length === 1 ? res.files[0] : res.files;
    else warnings.push(`export ${fmt} failed`);
  }
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  return { ok: true, base, outDir: dir, files, warnings };
}

export async function extractParts({ input, outDir }) {
  const abs = path.resolve(input);
  if (!fs.existsSync(abs)) throw new Error(`file not found: ${abs}`);
  const dir = path.resolve(outDir || path.join(path.dirname(abs), 'parts'));
  await fsp.mkdir(dir, { recursive: true });
  // --score-parts returns the generated part files as base64 inside a JSON blob
  const r = await ms.run(['--score-parts', abs]);
  const json = ms.extractJSON(r.stdout);
  if (!json) return { ok: false, outDir: dir, files: [], error: 'no JSON from --score-parts' };
  // shapes seen: {parts:[name...], partsBin:[base64...], partsMeta:[{partName}]}
  const blobs = Array.isArray(json.partsBin) ? json.partsBin
    : (Array.isArray(json.parts) ? json.parts : []);
  const names = Array.isArray(json.parts) && json.parts.every((x) => typeof x === 'string' && x.length < 200)
    ? json.parts : [];
  const metaList = Array.isArray(json.partsMeta) ? json.partsMeta : [];
  const files = [];
  const used = new Set();
  for (let i = 0; i < blobs.length; i++) {
    const b = blobs[i];
    if (typeof b !== 'string' || b.length < 64) continue;
    let name = names[i] || (metaList[i] && metaList[i].partName) || `part${i + 1}`;
    name = slug(name);
    while (used.has(name)) name = `${name}_${i + 1}`;
    used.add(name);
    const target = path.join(dir, `${name}.mscz`);
    await fsp.writeFile(target, Buffer.from(b, 'base64'));
    files.push(target);
  }
  return { ok: files.length > 0, outDir: dir, files };
}

export async function openInMuseScore({ input }) {
  const abs = path.resolve(input);
  if (!fs.existsSync(abs)) throw new Error(`file not found: ${abs}`);
  if (process.platform === 'darwin') {
    const child = spawn('open', ['-a', 'MuseScore 4', abs], { detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true, opened: abs, via: 'open -a "MuseScore 4"' };
  }
  const bin = ms.findBinary();
  if (!bin) throw new Error('MuseScore binary not found');
  const child = spawn(bin, [abs], { detached: true, stdio: 'ignore' });
  child.unref();
  return { ok: true, opened: abs, via: bin };
}

/**
 * Edit an existing score (any format MuseScore can open) at measure/element level.
 * operations: [{op:'set_tempo', tempo:120}, {op:'add_lyrics', text:'a b c'}, ...]
 */
export async function editScore({ input, operations = [], outDir, name, formats = ['mscz', 'pdf', 'png'], resolution = 130, style = null }) {
  const abs = path.resolve(input);
  if (!fs.existsSync(abs)) throw new Error(`file not found: ${abs}`);
  const dir = path.resolve(outDir || path.join(path.dirname(abs), 'out'));
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, '.tmp');
  await fsp.mkdir(tmp, { recursive: true });
  let xmlPath;
  try {
    const { xml } = await ensureMusicXML(abs, tmp);
    xmlPath = xml;
    const raw = await fsp.readFile(xmlPath, 'utf8');
    const { xml: edited, applied } = applyOperations(raw, operations);
    const base = slug(name || `${path.basename(abs, path.extname(abs))}_edited`);
    const outXml = path.join(dir, `${base}.musicxml`);
    await fsp.writeFile(outXml, edited, 'utf8');
    const files = { musicxml: outXml };
    const warnings = [];
    for (const fmt of formats.filter((x) => x !== 'musicxml')) {
      const extraArgs = style ? ['-S', path.resolve(style)] : [];
      const res = await ms.exportTo(outXml, path.join(dir, `${base}.${fmt}`), { resolution, trim: null, extraArgs });
      if (res.ok) files[fmt] = res.files.length === 1 ? res.files[0] : res.files;
      else warnings.push(`export ${fmt} failed`);
    }
    return { ok: true, base, outDir: dir, files, applied, warnings };
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Join two or more scores end to end (same part layout required). */
export async function joinScores({ inputs = [], outDir, name, formats = ['mscz', 'pdf', 'png'], resolution = 130, style = null }) {
  if (inputs.length < 2) throw new Error('join needs at least two input files');
  const dir = path.resolve(outDir || path.join(path.dirname(path.resolve(inputs[0])), 'out'));
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, '.tmp');
  await fsp.mkdir(tmp, { recursive: true });
  try {
    const texts = [];
    for (const input of inputs) {
      const abs = path.resolve(input);
      if (!fs.existsSync(abs)) throw new Error(`file not found: ${abs}`);
      const { xml } = await ensureMusicXML(abs, tmp);
      texts.push(await fsp.readFile(xml, 'utf8'));
    }
    let acc = texts[0];
    const warnings = [];
    for (let i = 1; i < texts.length; i++) {
      const res = concatScores(acc, texts[i]);
      acc = res.xml;
      warnings.push(...res.warnings.map((w) => `${path.basename(inputs[i])}: ${w}`));
    }
    const base = slug(name || inputs.map((f) => path.basename(f, path.extname(f))).join('_'));
    const outXml = path.join(dir, `${base}.musicxml`);
    await fsp.writeFile(outXml, acc, 'utf8');
    const files = { musicxml: outXml };
    for (const fmt of formats.filter((x) => x !== 'musicxml')) {
      const extraArgs = style ? ['-S', path.resolve(style)] : [];
      const res = await ms.exportTo(outXml, path.join(dir, `${base}.${fmt}`), { resolution, trim: null, extraArgs });
      if (res.ok) files[fmt] = res.files.length === 1 ? res.files[0] : res.files;
      else warnings.push(`export ${fmt} failed`);
    }
    return { ok: true, base, outDir: dir, files, warnings };
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

export { transposeMusicXML, ms };
