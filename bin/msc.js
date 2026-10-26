#!/usr/bin/env node
// msc — command line front end for the MuseScore studio pipeline.
import fs from 'node:fs/promises';
import path from 'node:path';
import * as ops from '../lib/ops.js';
import { DSL_REFERENCE } from '../lib/reference.js';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const [key, inline] = k.split('=');
      if (inline !== undefined) out[key] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
      else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

const fmtList = (v) => String(v || 'pdf,png').split(',').map((s) => s.trim()).filter(Boolean);

function printFiles(files) {
  for (const [k, v] of Object.entries(files)) {
    if (Array.isArray(v)) v.forEach((p) => console.log(`  ${k.padEnd(8)} ${p}`));
    else console.log(`  ${k.padEnd(8)} ${v}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(`
msc — write real MuseScore files from a compact text notation

  msc doctor                                   check MuseScore CLI availability
  msc ref                                      print the notation cheat sheet
  msc compose <file.msc|-> [options]           build a score from DSL text
  msc render  <file>       [options]           export an existing score
  msc inspect <file> [--json]                  read score metadata
  msc transpose <file> --semitones N [opts]    transpose a score
  msc parts   <file>       [opts]              extract parts
  msc open    <file>                           open the score in MuseScore

editing an existing score (works on .mscz/.musicxml/.mid/...):
  msc set    <file> [--title T] [--subtitle S] [--composer C] [--lyricist L]
                    [--tempo N] [--key G] [--time 3/4] [--at-measure N]
  msc cut    <file> --measures 5-8             delete measures
  msc dup    <file> --measures 1-4 [--times 2] copy a passage after itself
  msc pad    <file> --count 4                  append empty measures
  msc lyrics <file> --text "一 闪 一 闪" [--staff 1] [--verse 1] [--part 1]
  msc instr  <file> --instrument violin [--part 1]
  msc systems <file> --per-line 4              re-space systems (0 = auto)
  msc join   <a> <b> [<c> ...]                 join scores end to end
  msc edit   <file> --ops '[{"op":"set_tempo","tempo":120}]'

common options:
  --out <dir>          output directory (default: ./out next to the source)
  --formats a,b,c      pdf,png,svg,mscz,midi,mp3,musicxml (default pdf,png)
  --name <slug>        output basename
  --res <dpi>          raster resolution for png/svg (default 130)
  --page <n>           export a single page (png/pdf/svg)
  --style <file.mss>   apply a MuseScore style file
  --json               machine readable output
`);
    return 0;
  }

  if (cmd === 'doctor') {
    const d = await ops.doctor();
    if (args.json) console.log(JSON.stringify(d, null, 2));
    else {
      console.log(`MuseScore binary : ${d.binary || 'NOT FOUND'}`);
      console.log(`version          : ${d.version || '-'}`);
      console.log(`status           : ${d.ok ? 'ready' : 'unavailable'}`);
      if (!d.ok) console.log('hint             : set MSCORE_BIN to the MuseScore executable');
    }
    return d.ok ? 0 : 1;
  }

  if (cmd === 'ref') { console.log(DSL_REFERENCE); return 0; }

  if (cmd === 'compose') {
    const src = args._[1];
    if (!src) throw new Error('compose needs a source file (or - for stdin)');
    const text = src === '-' ? await readStdin() : await fs.readFile(path.resolve(src), 'utf8');
    const res = await ops.compose({
      source: text,
      name: args.name || (src === '-' ? 'score' : path.basename(src, path.extname(src))),
      outDir: args.out || (src === '-' ? 'out' : path.join(path.dirname(path.resolve(src)), '..', 'out')),
      formats: fmtList(args.formats || 'pdf,png'),
      resolution: parseInt(args.res || 130, 10),
      trim: args.trim === undefined ? null : parseInt(args.trim, 10),
      style: args.style || null,
    });
    if (args.json) console.log(JSON.stringify(res, null, 2));
    else {
      console.log(`✔ ${res.summary.title} — ${res.summary.measures} measures, ${res.summary.notes} notes, ${res.summary.parts.length} part(s)`);
      printFiles(res.files);
      if (res.warnings.length) { console.log('! warnings:'); res.warnings.forEach((w) => console.log('  - ' + w)); }
    }
    return res.ok ? 0 : 1;
  }

  if (cmd === 'render') {
    const input = args._[1];
    if (!input) throw new Error('render needs a score file');
    const res = await ops.render({
      input, formats: fmtList(args.formats || 'pdf,png'),
      outDir: args.out, resolution: parseInt(args.res || 130, 10), page: args.page, baseName: args.name,
      trim: args.trim === undefined ? null : parseInt(args.trim, 10),
      style: args.style || null,
    });
    if (args.json) console.log(JSON.stringify(res, null, 2));
    else { console.log('✔ exported'); printFiles(res.files); res.warnings.forEach((w) => console.log('  - ' + w)); }
    return res.ok ? 0 : 1;
  }

  if (cmd === 'inspect') {
    const r = await ops.inspect({ input: args._[1] });
    console.log(JSON.stringify(r, null, 2));
    return r.ok ? 0 : 1;
  }

  if (cmd === 'transpose') {
    const input = args._[1];
    const semis = parseInt(args.semitones || args.semi || args.n, 10);
    if (!Number.isFinite(semis)) throw new Error('transpose needs --semitones N');
    const res = await ops.transpose({ input, semitones: semis, outDir: args.out, name: args.name, formats: fmtList(args.formats || 'mscz,pdf,png') });
    console.log('✔ transposed');
    printFiles(res.files);
    return 0;
  }

  if (cmd === 'parts') {
    const res = await ops.extractParts({ input: args._[1], outDir: args.out });
    console.log(res.ok ? '✔ parts extracted' : '✘ no parts produced');
    res.files.forEach((f) => console.log('  ' + f));
    return res.ok ? 0 : 1;
  }

  const range = (v) => {
    const m = /^(\d+)(?:\s*[-~]\s*(\d+))?$/.exec(String(v || ''));
    if (!m) throw new Error(`bad measure range "${v}" (expected 5 or 5-8)`);
    return { from: parseInt(m[1], 10), to: parseInt(m[2] || m[1], 10) };
  };

  const editAndReport = async (file, operations, label) => {
    if (!file) throw new Error(`${label} needs a score file`);
    const res = await ops.editScore({
      input: file, operations,
      outDir: args.out, name: args.name,
      formats: fmtList(args.formats || 'mscz,pdf,png'),
      resolution: parseInt(args.res || 130, 10),
      style: args.style || null,
    });
    if (args.json) { console.log(JSON.stringify(res, null, 2)); return res.ok ? 0 : 1; }
    console.log(`✔ ${label}`);
    printFiles(res.files);
    res.warnings.forEach((w) => console.log('  ! ' + w));
    return res.ok ? 0 : 1;
  };

  if (cmd === 'set') {
    const ops = [];
    const meta = {};
    for (const k of ['title', 'subtitle', 'composer', 'lyricist']) if (args[k] !== undefined) meta[k] = args[k];
    if (Object.keys(meta).length) ops.push({ op: 'set_metadata', ...meta });
    const at = parseInt(args['at-measure'] || args.at || 1, 10);
    if (args.tempo !== undefined) ops.push({ op: 'set_tempo', tempo: parseInt(args.tempo, 10), measure: at });
    if (args.key !== undefined) ops.push({ op: 'set_key', key: args.key, measure: at });
    if (args.time !== undefined) ops.push({ op: 'set_time', time: args.time, measure: at });
    if (!ops.length) throw new Error('set needs at least one of --title/--subtitle/--composer/--lyricist/--tempo/--key/--time');
    return editAndReport(args._[1], ops, 'metadata updated');
  }

  if (cmd === 'cut') {
    const r = range(args.measures);
    return editAndReport(args._[1], [{ op: 'delete_measures', ...r }], `cut measures ${r.from}-${r.to}`);
  }

  if (cmd === 'dup') {
    const r = range(args.measures);
    const times = parseInt(args.times || 1, 10);
    return editAndReport(args._[1], [{ op: 'duplicate_measures', ...r, times }], `duplicated measures ${r.from}-${r.to} x${times}`);
  }

  if (cmd === 'pad') {
    return editAndReport(args._[1], [{ op: 'append_measures', count: parseInt(args.count || 1, 10) }], 'measures appended');
  }

  if (cmd === 'lyrics') {
    if (!args.text) throw new Error('lyrics needs --text "syllable syllable ..."');
    return editAndReport(args._[1], [{
      op: 'add_lyrics', text: args.text,
      staff: parseInt(args.staff || 1, 10), verse: parseInt(args.verse || 1, 10),
      part: parseInt(args.part || 1, 10),
    }], 'lyrics added');
  }

  if (cmd === 'instr' || cmd === 'instrument') {
    if (!args.instrument) throw new Error('instr needs --instrument <name>');
    return editAndReport(args._[1], [{ op: 'set_instrument', instrument: args.instrument, part: parseInt(args.part || 1, 10) }], 'instrument changed');
  }

  if (cmd === 'systems') {
    return editAndReport(args._[1], [{ op: 'set_systems', measures: parseInt(args['per-line'] || args.n || 0, 10) }], 'systems re-spaced');
  }

  if (cmd === 'join') {
    const inputs = args._.slice(1);
    if (inputs.length < 2) throw new Error('join needs at least two score files');
    const res = await ops.joinScores({
      inputs, outDir: args.out, name: args.name,
      formats: fmtList(args.formats || 'mscz,pdf,png'),
      resolution: parseInt(args.res || 130, 10), style: args.style || null,
    });
    if (args.json) { console.log(JSON.stringify(res, null, 2)); return res.ok ? 0 : 1; }
    console.log('✔ joined');
    printFiles(res.files);
    res.warnings.forEach((w) => console.log('  ! ' + w));
    return res.ok ? 0 : 1;
  }

  if (cmd === 'edit') {
    if (!args.ops) throw new Error('edit needs --ops <json array>');
    let operations;
    try { operations = JSON.parse(args.ops); } catch (e) { throw new Error(`--ops is not valid JSON: ${e.message}`); }
    if (!Array.isArray(operations)) throw new Error('--ops must be a JSON array of operations');
    return editAndReport(args._[1], operations, `${operations.length} operation(s) applied`);
  }

  if (cmd === 'open') { console.log(JSON.stringify(await ops.openInMuseScore({ input: args._[1] }), null, 2)); return 0; }

  console.error(`unknown command "${cmd}" — run: msc help`);
  return 2;
}

function readStdin() {
  return new Promise((resolve) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { s += d; });
    process.stdin.on('end', () => resolve(s));
  });
}

main().then((c) => process.exit(c)).catch((e) => { console.error('✘ ' + (e.message || e)); process.exit(1); });
