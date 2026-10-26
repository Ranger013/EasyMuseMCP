#!/usr/bin/env node
// stdio MCP server exposing the MuseScore pipeline as tools.
// Protocol: JSON-RPC 2.0 over newline-delimited stdin/stdout (MCP stdio transport).
import fs from 'node:fs/promises';
import path from 'node:path';
import * as ops from './lib/ops.js';
import { DSL_REFERENCE } from './lib/reference.js';

const SERVER_INFO = { name: 'easmuse-mcp', version: '0.1.0' };
const DEFAULT_PROTOCOL = '2025-06-18';

const FORMAT_ENUM = ['pdf', 'png', 'svg', 'mscz', 'midi', 'mp3', 'musicxml'];

const TOOLS = [
  {
    name: 'musescore_doctor',
    title: 'Check the MuseScore toolchain',
    description: 'Report whether the MuseScore CLI binary is available and which version is installed.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const d = await ops.doctor();
      return text(
        d.ok
          ? `MuseScore ${d.version} ready at ${d.binary}`
          : 'MuseScore CLI not found — install MuseScore 4 or set MSCORE_BIN.',
        { structured: d },
      );
    },
  },
  {
    name: 'musescore_notation_reference',
    title: 'Notation syntax reference',
    description: 'Return the compact score-notation cheat sheet. Read this before composing for the first time.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => text(DSL_REFERENCE),
  },
  {
    name: 'musescore_compose',
    title: 'Compose a score from text notation',
    description:
      'Build a real MuseScore score from compact text notation (see musescore_notation_reference). ' +
      'Writes MusicXML, then renders the requested formats with MuseScore. ' +
      'Returns output paths, a musical summary and any measure/notation warnings.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Score source in the notation DSL: header lines (title:, key:, time:, tempo:) followed by part blocks and note tokens such as "C5/4 D5/4 E5/2 |".',
        },
        name: { type: 'string', description: 'Output basename (defaults to a slug of the title).' },
        formats: { type: 'array', items: { type: 'string', enum: FORMAT_ENUM }, description: 'Formats to export. Default: ["mscz","pdf","png"].' },
        outDir: { type: 'string', description: 'Absolute output directory. Default: <workspace>/musescore-studio/out/<name>.' },
        resolution: { type: 'number', description: 'DPI for png/svg export. Default 130.' },
        style: { type: 'string', description: 'Absolute path to a MuseScore .mss style file.' },
      },
      required: ['source'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const res = await ops.compose({
        source: args.source,
        name: args.name,
        outDir: args.outDir,
        formats: args.formats || ['mscz', 'pdf', 'png'],
        resolution: args.resolution || 130,
        style: args.style || null,
      });
      const lines = [
        `${res.ok ? '✔' : '✘'} ${res.summary.title || res.name}`,
        `${res.summary.measures} measures · ${res.summary.notes} notes · ${res.summary.parts.length} part(s) · key ${res.summary.key} · ${res.summary.time}${res.summary.tempo ? ` · ♩=${res.summary.tempo}` : ''}`,
        ...Object.entries(res.files).flatMap(([k, v]) =>
          Array.isArray(v) ? v.map((p) => `  ${k}: ${p}`) : [`  ${k}: ${v}`]),
      ];
      if (res.warnings.length) lines.push('warnings:', ...res.warnings.map((w) => `  - ${w}`));
      return text(lines.join('\n'), { structured: res });
    },
  },
  {
    name: 'musescore_render',
    title: 'Export an existing score',
    description: 'Export any score MuseScore can open (.mscz, .musicxml, .mid, .gp, …) to other formats, optionally a single page.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Absolute path to the score file.' },
        formats: { type: 'array', items: { type: 'string', enum: FORMAT_ENUM }, description: 'Default: ["pdf","png"].' },
        outDir: { type: 'string', description: 'Output directory. Default: <score dir>/out.' },
        page: { type: 'number', description: 'Export just this page (pdf/png/svg/mscz).' },
        resolution: { type: 'number', description: 'DPI for png/svg. Default 130.' },
        style: { type: 'string', description: 'Absolute path to a MuseScore .mss style file.' },
      },
      required: ['input'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const res = await ops.render({
        input: args.input, formats: args.formats || ['pdf', 'png'],
        outDir: args.outDir, page: args.page, resolution: args.resolution || 130,
        style: args.style || null,
      });
      return text([`${res.ok ? '✔ exported' : '✘ failed'} → ${res.outDir}`,
        ...Object.entries(res.files).flatMap(([k, v]) => Array.isArray(v) ? v.map((p) => `  ${k}: ${p}`) : [`  ${k}: ${v}`]),
        ...res.warnings.map((w) => `  ! ${w}`)].join('\n'), { structured: res });
    },
  },
  {
    name: 'musescore_view',
    title: 'Look at a rendered page',
    description: 'Render one page of a score to PNG and return it as an image so you can check the engraving yourself.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Absolute path to the score file.' },
        page: { type: 'number', description: 'Page number, 1-based. Default 1.' },
        resolution: { type: 'number', description: 'DPI, default 110 — raise it only when you need detail.' },
      },
      required: ['input'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const page = args.page || 1;
      const res = await ops.render({
        input: args.input, formats: ['png'], page,
        outDir: path.join(path.dirname(path.resolve(args.input)), 'out'),
        resolution: args.resolution || 110,
        baseName: `${path.basename(args.input, path.extname(args.input))}_p${page}`,
      });
      const file = res.files.png;
      const rel = Array.isArray(file) ? file[0] : file;
      if (!rel) return text('render failed: no png produced', { isError: true });
      const buf = await fs.readFile(rel);
      return {
        content: [
          { type: 'image', data: buf.toString('base64'), mimeType: 'image/png' },
          { type: 'text', text: `page ${page} of ${path.basename(args.input)} → ${rel}` },
        ],
      };
    },
  },
  {
    name: 'musescore_inspect',
    title: 'Read score metadata',
    description: 'Read title, composer, key, time signature, tempo, part list, page/measure count and duration from a score file.',
    inputSchema: {
      type: 'object',
      properties: { input: { type: 'string', description: 'Absolute path to the score file.' } },
      required: ['input'], additionalProperties: false,
    },
    handler: async (args) => {
      const r = await ops.inspect({ input: args.input });
      if (!r.ok) return text(`could not read ${args.input}`, { isError: true });
      return text([
        `title: ${r.title || '(none)'}`,
        r.subtitle ? `subtitle: ${r.subtitle}` : null,
        `composer: ${r.composer || '(none)'}`,
        `parts: ${r.parts.map((p) => p.name).join(', ') || '(none)'}`,
        `measures: ${r.measures} · pages: ${r.pages} · duration: ${r.durationSeconds}s`,
        `key fifths: ${r.key} · time: ${r.timeSignature} · tempo: ${r.tempo ?? '-'}`,
        `lyrics: ${r.hasLyrics ? 'yes' : 'no'}`,
      ].filter(Boolean).join('\n'), { structured: r });
    },
  },
  {
    name: 'musescore_transpose',
    title: 'Transpose a score',
    description: 'Transpose any score by a number of semitones (positive = up) and export the result.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Absolute path to the score file.' },
        semitones: { type: 'number', description: 'Semitones to transpose, e.g. 2 or -3.' },
        outDir: { type: 'string', description: 'Output directory.' },
        formats: { type: 'array', items: { type: 'string', enum: FORMAT_ENUM }, description: 'Default ["mscz","pdf","png"].' },
      },
      required: ['input', 'semitones'], additionalProperties: false,
    },
    handler: async (args) => {
      const res = await ops.transpose({
        input: args.input, semitones: args.semitones, outDir: args.outDir,
        formats: args.formats || ['mscz', 'pdf', 'png'],
      });
      return text([`✔ transposed by ${args.semitones >= 0 ? '+' : ''}${args.semitones} semitones`,
        ...Object.entries(res.files).flatMap(([k, v]) => Array.isArray(v) ? v.map((p) => `  ${k}: ${p}`) : [`  ${k}: ${v}`])].join('\n'),
        { structured: res });
    },
  },
  {
    name: 'musescore_extract_parts',
    title: 'Extract linked parts',
    description: 'Generate one .mscz per instrument/part from a full score.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Absolute path to the score file.' },
        outDir: { type: 'string', description: 'Output directory. Default: <score dir>/parts.' },
      },
      required: ['input'], additionalProperties: false,
    },
    handler: async (args) => {
      const res = await ops.extractParts({ input: args.input, outDir: args.outDir });
      if (!res.ok) return text(`no parts produced${res.error ? `: ${res.error}` : ''}`, { isError: true });
      return text(['✔ parts:', ...res.files.map((f) => `  ${f}`)].join('\n'), { structured: res });
    },
  },
  {
    name: 'musescore_edit',
    title: 'Edit an existing score',
    description:
      'Modify a score that already exists (any format MuseScore can open), at measure or element level. ' +
      'Operations run in order. Use this for fixes to an existing file instead of re-writing the whole piece.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Absolute path to the score file.' },
        operations: {
          type: 'array',
          description: [
            'Ordered list of operations. Supported `op` values:',
            'set_metadata {title?,subtitle?,composer?,lyricist?} · set_tempo {tempo,measure?} · set_key {key,measure?} · set_time {time,measure?}',
            'transpose {semitones,from?,to?} · delete_measures {from,to} · duplicate_measures {from,to,times?} · append_measures {count}',
            'add_lyrics {text,staff?,verse?,part?} · set_instrument {instrument,part?} · set_systems {measures}',
          ].join('\n'),
          items: {
            type: 'object',
            properties: {
              op: {
                type: 'string',
                enum: ['set_metadata', 'set_tempo', 'set_key', 'set_time', 'transpose',
                  'delete_measures', 'duplicate_measures', 'append_measures',
                  'add_lyrics', 'set_instrument', 'set_systems'],
              },
            },
            required: ['op'],
            additionalProperties: true,
          },
        },
        outDir: { type: 'string', description: 'Output directory. Default: <score dir>/out.' },
        name: { type: 'string', description: 'Output basename.' },
        formats: { type: 'array', items: { type: 'string', enum: FORMAT_ENUM }, description: 'Default ["mscz","pdf","png"].' },
        style: { type: 'string', description: 'Absolute path to a .mss style file.' },
      },
      required: ['input', 'operations'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const res = await ops.editScore({
        input: args.input, operations: args.operations,
        outDir: args.outDir, name: args.name,
        formats: args.formats || ['mscz', 'pdf', 'png'],
        style: args.style || null,
      });
      const lines = [`${res.ok ? '✔' : '✘'} ${res.applied.length} operation(s) applied`];
      for (const a of res.applied) lines.push(`  ${a.changed ? '✓' : '·'} ${a.op}`);
      lines.push(...Object.entries(res.files).flatMap(([k, v]) => Array.isArray(v) ? v.map((p) => `  ${k}: ${p}`) : [`  ${k}: ${v}`]));
      res.warnings.forEach((w) => lines.push(`  ! ${w}`));
      return text(lines.join('\n'), { structured: res });
    },
  },
  {
    name: 'musescore_join',
    title: 'Join scores end to end',
    description: 'Concatenate two or more scores that share the same part layout, e.g. to build a medley or append a second section.',
    inputSchema: {
      type: 'object',
      properties: {
        inputs: { type: 'array', items: { type: 'string' }, description: 'Absolute paths, in order.' },
        outDir: { type: 'string', description: 'Output directory.' },
        name: { type: 'string', description: 'Output basename.' },
        formats: { type: 'array', items: { type: 'string', enum: FORMAT_ENUM }, description: 'Default ["mscz","pdf","png"].' },
      },
      required: ['inputs'], additionalProperties: false,
    },
    handler: async (args) => {
      const res = await ops.joinScores({
        inputs: args.inputs, outDir: args.outDir, name: args.name,
        formats: args.formats || ['mscz', 'pdf', 'png'],
      });
      return text([`${res.ok ? '✔' : '✘'} joined ${args.inputs.length} scores`,
        ...Object.entries(res.files).flatMap(([k, v]) => Array.isArray(v) ? v.map((p) => `  ${k}: ${p}`) : [`  ${k}: ${v}`]),
        ...res.warnings.map((w) => `  ! ${w}`)].join('\n'), { structured: res });
    },
  },
  {
    name: 'musescore_open',
    title: 'Open in the MuseScore app',
    description: 'Open a score in the MuseScore desktop app so the user can look at or hand-edit it.',
    inputSchema: {
      type: 'object',
      properties: { input: { type: 'string', description: 'Absolute path to the score file.' } },
      required: ['input'], additionalProperties: false,
    },
    handler: async (args) => {
      const r = await ops.openInMuseScore({ input: args.input });
      return text(`opened ${r.opened}`, { structured: r });
    },
  },
];

function text(message, { structured, isError } = {}) {
  const content = [{ type: 'text', text: message }];
  const out = { content };
  if (structured) {
    out.structuredContent = structured;
  }
  if (isError) out.isError = true;
  return out;
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    const requested = params && params.protocolVersion;
    const version = typeof requested === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : DEFAULT_PROTOCOL;
    return send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'MuseScore score factory. Use musescore_notation_reference to learn the notation syntax, ' +
          'musescore_compose to write a score, and musescore_view to look at the rendered page.',
      },
    });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') {
    return send({
      jsonrpc: '2.0', id,
      result: {
        tools: TOOLS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema })),
      },
    });
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool: ${name}` } });
    }
    try {
      const result = await tool.handler(args);
      return send({ jsonrpc: '2.0', id, result });
    } catch (e) {
      return send({
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: `${name} failed: ${e && e.message ? e.message : e}` }], isError: true },
      });
    }
  }
  if (method === 'resources/list') return send({ jsonrpc: '2.0', id, result: { resources: [] } });
  if (method === 'prompts/list') return send({ jsonrpc: '2.0', id, result: { prompts: [] } });
  if (method === 'shutdown') return send({ jsonrpc: '2.0', id, result: null });
  if (id === undefined) return; // notification we do not care about
  return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
}

function main() {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const run = (m) => handle(m).catch((e) => {
        if (m && m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: String(e && e.message || e) } });
      });
      if (Array.isArray(msg)) msg.forEach(run); else run(msg);
    }
  });
  process.stdin.on('end', () => process.exit(0));
  process.on('uncaughtException', (e) => { process.stderr.write(`uncaught: ${e}\n`); });
}

main();
