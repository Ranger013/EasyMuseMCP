// Parser for the score DSL (see examples/ and the README).
// Output: { meta, parts:[{name, instrument, staves, clefs, streams:[{staff,voice,measures:[[event]]}]}], warnings }
import { f, add, cmp, isZero, eq, $ as fstr, splitDuration, sub } from './frac.js';

const PITCH_RE = /^([A-Ga-g])(#{1,2}|b{1,2}|n)?(-?\d{1,2})$/;
const DUR_RE = /^\/(\d{1,3})(\.{0,2})$/;

const KEY_FIFTHS = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
};
const MINOR_FIFTHS = {
  A: 0, E: 1, B: 2, 'F#': 3, 'C#': 4, 'G#': 5, 'D#': 6, 'A#': 7,
  D: -1, G: -2, C: -3, F: -4, Bb: -5, Eb: -6, Ab: -7,
};

export const INSTRUMENTS = {
  piano: { program: 1, name: 'Piano', family: 'keyboard' },
  keyboard: { program: 1, name: 'Keyboard', family: 'keyboard' },
  organ: { program: 20, name: 'Organ', family: 'keyboard' },
  harpsichord: { program: 7, name: 'Harpsichord', family: 'keyboard' },
  guitar: { program: 25, name: 'Guitar', family: 'plucked' },
  violin: { program: 41, name: 'Violin', family: 'strings' },
  viola: { program: 42, name: 'Viola', family: 'strings' },
  cello: { program: 43, name: 'Violoncello', family: 'strings' },
  contrabass: { program: 44, name: 'Contrabass', family: 'strings' },
  harp: { program: 47, name: 'Harp', family: 'plucked' },
  choir: { program: 53, name: 'Choir', family: 'voices' },
  voice: { program: 54, name: 'Voice', family: 'voices' },
  trumpet: { program: 57, name: 'Trumpet', family: 'brass' },
  trombone: { program: 58, name: 'Trombone', family: 'brass' },
  tuba: { program: 59, name: 'Tuba', family: 'brass' },
  horn: { program: 61, name: 'Horn', family: 'brass' },
  sax: { program: 66, name: 'Saxophone', family: 'woodwind' },
  flute: { program: 74, name: 'Flute', family: 'woodwind' },
  oboe: { program: 69, name: 'Oboe', family: 'woodwind' },
  clarinet: { program: 72, name: 'Clarinet', family: 'woodwind' },
  bassoon: { program: 71, name: 'Bassoon', family: 'woodwind' },
  timpani: { program: 48, name: 'Timpani', family: 'percussion' },
};

const CLEFS = {
  treble: { sign: 'G', line: 2 },
  bass: { sign: 'F', line: 4 },
  alto: { sign: 'C', line: 3 },
  tenor: { sign: 'C', line: 4 },
  percussion: { sign: 'percussion', line: 2 },
  none: { sign: 'none', line: 0 },
};

const REST_TOKEN = 'r';

// `%mark` suffixes on a note
const ARTICULATIONS = {
  stacc: 'staccato', staccissimo: 'staccatissimo', accent: 'accent',
  'strong-accent': 'strong-accent', marcato: 'strong-accent', tenuto: 'tenuto',
  breath: 'breath-mark', upbow: 'upbow', downbow: 'downbow',
};
const ORNAMENTS = {
  trill: 'trill-mark', mordent: 'mordent', 'inv-mordent': 'inverted-mordent',
  turn: 'turn', 'inv-turn': 'inverted-turn', tremolo: 'tremolo',
};
// `%mark` as a standalone token = an engraving direction (spanner or pedal)
const DIRECTIONS = {
  ped: { type: 'pedal', value: 'start' },
  'ped-up': { type: 'pedal', value: 'stop' },
  'ped-change': { type: 'pedal', value: 'change' },
  cresc: { type: 'wedge', value: 'crescendo' },
  dim: { type: 'wedge', value: 'diminuendo' },
  'wedge-stop': { type: 'wedge', value: 'stop' },
};
const PAGE_SIZES = {
  a3: { width: 297, height: 420 }, a4: { width: 210, height: 297 },
  a5: { width: 148, height: 210 }, a6: { width: 105, height: 148 },
  letter: { width: 215.9, height: 279.4 }, legal: { width: 215.9, height: 355.6 },
};

function tokenize(line) {
  const out = [];
  let cur = '';
  const flush = () => { if (cur) { out.push(cur); cur = ''; } };
  let bracket = 0; // keep chord pitches such as [C3 E3 G3] in one token
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      const j = line.indexOf('"', i + 1);
      const end = j < 0 ? line.length : j;
      cur += line.slice(i, end + 1);
      i = end;
      continue;
    }
    if (c === '{' || c === '}') { flush(); out.push(c); continue; }
    if (c === '|' || (c === ':' && line[i + 1] === '|')) {
      flush();
      let bl = c;
      i += 1;
      while (i < line.length && /[|:\]]/.test(line[i])) { bl += line[i]; i += 1; }
      if (bl === '|' && line[i] === '.') { bl = '|.'; i += 1; }
      i -= 1;
      out.push(bl);
      continue;
    }
    if (c === '[') { bracket++; cur += c; continue; }
    if (c === ']') { bracket = Math.max(0, bracket - 1); cur += c; continue; }
    if ((c === ' ' || c === '\t' || c === ',') && bracket === 0) {
      if (c === ',' && cur.includes('%')) { cur += c; continue; } // %stacc,accent
      flush(); continue;
    }
    if (c === ',') { cur += c; continue; }
    cur += c;
  }
  flush();
  return out;
}

function parsePitch(tok) {
  const m = PITCH_RE.exec(tok);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  let alter = 0;
  if (m[2]) {
    if (m[2][0] === '#') alter = m[2].length;
    else if (m[2][0] === 'b') alter = -m[2].length;
    else alter = 0;
  }
  return { step: letter, alter, octave: parseInt(m[3], 10) };
}

function parseDuration(tok) {
  const m = DUR_RE.exec(tok);
  if (!m) return null;
  const den = parseInt(m[1], 10);
  if (![1, 2, 4, 8, 16, 32, 64, 128].includes(den)) return null;
  const dots = m[2].length;
  const base = f(1, den);
  // dotted multiplier: 1 dot = 3/2, 2 dots = 7/4 (general: (2^(d+1)-1)/2^d)
  const mult = f(Math.pow(2, dots + 1) - 1, Math.pow(2, dots));
  return { written: f(base.n * mult.n, base.d * mult.d), dots };
}

// Parse a single atom (note / chord / rest) into an event.
function parseAtom(tok, ctx) {
  let t = tok;
  const ev = {
    type: 'note', pitches: [], dur: null, dots: 0,
    tie: false, slurStart: false, slurEnd: false, lyric: null, dynamic: null,
    staff: ctx.staff, voice: ctx.voice,
  };
  if (t.startsWith('(')) { ev.slurStart = true; t = t.slice(1); }
  if (t.endsWith(')')) { ev.slurEnd = true; t = t.slice(0, -1); }
  // modifiers may appear in any order: C5/4!mf%tenuto"字"  or  C5/4%tenuto!mf"字"
  let m;
  const marks = [];
  for (let guard = 0; guard < 8; guard++) {
    const before = t;
    if (ev.lyric === null && (m = /"((?:[^"\\]|\\.)*)"\s*$/.exec(t))) {
      ev.lyric = m[1].replace(/\\"/g, '"'); t = t.slice(0, m.index);
    } else if (ev.dynamic === null && (m = /!([a-z]+)$/.exec(t))) {
      ev.dynamic = m[1]; t = t.slice(0, m.index);
    } else if ((m = /%([A-Za-z0-9\-,\s]+)$/.exec(t))) {
      marks.unshift(...m[1].split(',').map((x) => x.trim()).filter(Boolean));
      t = t.slice(0, m.index);
    } else if (t.endsWith('~') && !ev.tie) {
      ev.tie = true; t = t.slice(0, -1);
    } else if (/^g(?:[A-Ga-g][#b]{0,2}-?\d|\[)/.test(t) && !ev.grace) {
      ev.grace = true; t = t.slice(1);
    }
    if (t === before) break;
  }
  if (marks.length) ev.marks = marks;
  if (!t) return { error: `empty note token "${tok}"` };

  if (t === 'R') {
    return { type: 'rest', measureRest: true, dur: null, dots: 0, tie: false, slurStart: false, slurEnd: false, lyric: null, dynamic: ev.dynamic, staff: ctx.staff, voice: ctx.voice };
  }

  let body = t;
  let durTok = null;
  const dash = body.lastIndexOf('/');
  if (dash > 0) { durTok = body.slice(dash); body = body.slice(0, dash); }
  else { return { error: `note "${tok}" needs a duration such as /4 or /8` }; }
  const dur = parseDuration(durTok);
  if (!dur) return { error: `bad duration "${durTok}" in "${tok}"` };

  if (body === REST_TOKEN) {
    applyMarks(ev);
    return { ...ev, type: 'rest', dur: dur.written, dots: dur.dots, pitches: [] };
  }

  let pitchToks;
  if (body.startsWith('[') && body.endsWith(']')) {
    pitchToks = body.slice(1, -1).split(/[\s,]+/).filter(Boolean);
    if (!pitchToks.length) return { error: `empty chord "${tok}"` };
  } else {
    pitchToks = [body];
  }
  const pitches = [];
  for (const p of pitchToks) {
    const pi = parsePitch(p);
    if (!pi) return { error: `bad pitch "${p}" in "${tok}"` };
    pitches.push(pi);
  }
  // order chord notes by sounding pitch, not by octave+accidental (keeps inversions readable)
  const SEMI_STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const sounding = (x) => x.octave * 12 + SEMI_STEP[x.step] + x.alter;
  pitches.sort((a, b) => sounding(a) - sounding(b));
  applyMarks(ev);
  return { ...ev, type: 'note', pitches, dur: dur.written, dots: dur.dots };
}

function applyMarks(ev) {
  const marks = ev.marks || [];
  ev.articulations = marks.filter((x) => ARTICULATIONS[x]).map((x) => ARTICULATIONS[x]);
  ev.ornaments = marks.filter((x) => ORNAMENTS[x]).map((x) => ORNAMENTS[x]);
  ev.fermata = marks.includes('fermata');
  ev.unknownMarks = marks.filter((x) => !ARTICULATIONS[x] && !ORNAMENTS[x] && x !== 'fermata' && x !== 'trill-lines');
  delete ev.marks;
  return ev;
}

function normKey(raw) {
  const s = String(raw).trim();
  const minor = /m(in|inor)?$/i.test(s) && s.length > 1;
  const root = s.replace(/m(in|inor)?$/i, '');
  const up = root[0].toUpperCase() + root.slice(1);
  return { root: up, minor };
}

export function parseDSL(text, opts = {}) {
  const warnings = [];
  const meta = {
    title: opts.title || null, subtitle: null, composer: null, lyricist: null,
    key: { root: 'C', minor: false }, time: { beats: 4, beatType: 4 },
    tempo: null, tempoText: null, pickup: null, measuresPerSystem: null,
    page: { name: 'A4', ...PAGE_SIZES.a4 },
    margins: { top: 15, right: 15, bottom: 15, left: 15 },
    scaling: 7, staffDistance: null, systemDistance: null, style: null,
  };
  const attrChanges = {}; // measure index -> { time?, key?, tempo? }
  const parts = [];
  let curPart = null;
  let curStream = null;
  let lyrics = [];
  let section = null; // 'lyrics' block mode
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  const newPart = (name, attrs = {}) => {
    const staves = Math.max(1, Math.min(4, parseInt(attrs.staves || 1, 10)));
    const clefList = String(attrs.clefs || attrs.clef || '').split(',').map((s) => s.trim()).filter(Boolean);
    const clefs = [];
    for (let i = 0; i < staves; i++) clefs.push(CLEFS[(clefList[i] || clefList[0] || (i === 0 ? 'treble' : 'bass')).toLowerCase()] ? (clefList[i] || clefList[0] || (i === 0 ? 'treble' : 'bass')).toLowerCase() : 'treble');
    const instrument = (attrs.instrument || 'piano').toLowerCase();
    const p = { name: name || 'Music', instrument, staves, clefs, streams: [] };
    parts.push(p);
    return p;
  };
  const newStream = (part, staff, voice) => {
    const s = { staff, voice, measures: [], pending: [], lyrics: [], startRepeat: new Set(), endRepeat: new Set() };
    s.cur = s.pending;
    part.streams.push(s);
    return s;
  };
  const touchStream = () => {
    if (!curPart) { curPart = newPart('Music', { instrument: 'piano', staves: 1, clef: 'treble' }); curStream = newStream(curPart, 1, 1); }
    if (!curStream) curStream = newStream(curPart, 1, 1);
    return curStream;
  };

  for (let raw of lines) {
    let line = raw;
    const cmt = line.indexOf(' //');
    if (cmt >= 0) line = line.slice(0, cmt);
    const t = line.trim();
    if (!t) { if (section === 'lyrics') section = null; continue; }
    if (t.startsWith('#') || t.startsWith('//')) continue;

    // ---- directives -------------------------------------------------------
    const dir = /^([A-Za-z][A-Za-z_-]*)\s*:\s*(.*)$/.exec(t);
    if (dir && !/^[A-Ga-g][#b]?-?\d/.test(t)) {
      const k = dir[1].toLowerCase();
      const v = dir[2].trim();
      section = null;
      if (k === 'title') meta.title = v;
      else if (k === 'subtitle') meta.subtitle = v;
      else if (k === 'composer') meta.composer = v;
      else if (k === 'lyricist') meta.lyricist = v;
      else if (k === 'key') meta.key = normKey(v);
      else if (k === 'time' || k === 'meter') {
        const m = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*$/.exec(v);
        if (!m) { warnings.push(`ignoring bad time signature "${v}"`); }
        else meta.time = { beats: parseInt(m[1], 10), beatType: parseInt(m[2], 10) };
      } else if (k === 'tempo') {
        const n = parseFloat(v);
        if (Number.isFinite(n) && n > 0) { meta.tempo = Math.round(n); meta.tempoText = null; }
        else { meta.tempoText = v; meta.tempo = null; }
      } else if (k === 'page' || k === 'page-size') {
        const size = PAGE_SIZES[String(v).toLowerCase().replace(/[\s_-]/g, '')];
        if (size) meta.page = { name: String(v).toUpperCase(), ...size };
        else {
          const m2 = /^\s*([\d.]+)\s*[x×]\s*([\d.]+)\s*$/i.exec(v);
          if (m2) meta.page = { name: 'custom', width: parseFloat(m2[1]), height: parseFloat(m2[2]) };
          else warnings.push(`unknown page size "${v}" — keeping A4`);
        }
      } else if (k === 'margins' || k === 'margin') {
        const nums = v.split(/[, ]+/).map(Number).filter((n) => Number.isFinite(n));
        if (nums.length === 1) meta.margins = { top: nums[0], right: nums[0], bottom: nums[0], left: nums[0] };
        else if (nums.length === 2) meta.margins = { top: nums[0], bottom: nums[0], left: nums[1], right: nums[1] };
        else if (nums.length === 4) meta.margins = { top: nums[0], right: nums[1], bottom: nums[2], left: nums[3] };
        else warnings.push(`bad margins "${v}" — expected 1, 2 or 4 numbers (mm)`);
      } else if (k === 'scaling' || k === 'staff-size') {
        const n = parseFloat(v);
        if (Number.isFinite(n) && n > 2 && n < 15) meta.scaling = n;
        else warnings.push(`bad scaling "${v}" (mm per staff space)`);
      } else if (k === 'staff-distance') {
        const n = parseFloat(v);
        if (Number.isFinite(n)) meta.staffDistance = n; else warnings.push(`bad staff-distance "${v}"`);
      } else if (k === 'system-distance') {
        const n = parseFloat(v);
        if (Number.isFinite(n)) meta.systemDistance = n; else warnings.push(`bad system-distance "${v}"`);
      } else if (k === 'style') {
        meta.style = v;
      } else if (k === 'systems' || k === 'measures-per-system') {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n > 0) meta.measuresPerSystem = n;
        else warnings.push(`ignoring bad systems value "${v}"`);
      } else if (k === 'pickup' || k === 'anacrusis') {
        const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(v);
        if (m) meta.pickup = f(parseInt(m[1], 10), parseInt(m[2], 10));
        else warnings.push(`ignoring bad pickup "${v}"`);
      } else if (k === 'lyrics') {
        if (curPart) { section = 'lyrics'; lyrics = v ? [v] : []; curPart._lyrics = lyrics; }
        else warnings.push('lyrics: before any part — ignored');
      } else if (k === 'instrument' && curPart) {
        curPart.instrument = v.toLowerCase();
      } else {
        warnings.push(`unknown directive "${k}:" — ignored`);
      }
      continue;
    }

    // ---- part / voice blocks ---------------------------------------------
    const partM = /^part\b\s*(?:"([^"]*)"|([^\s]*))?\s*(.*)$/i.exec(t);
    if (partM) {
      const name = partM[1] || partM[2] || 'Music';
      const attrs = {};
      for (const m of partM[3].matchAll(/(\w+)\s*=\s*("[^"]*"|[^\s]+)/g)) attrs[m[1]] = m[2].replace(/^"|"$/g, '');
      curPart = newPart(name, attrs);
      curStream = newStream(curPart, 1, 1);
      section = null;
      continue;
    }
    const voiceM = /^voices?\s+(\d{1,2})$/i.exec(t);
    if (voiceM) {
      const idx = parseInt(voiceM[1], 10);
      if (!curPart) { warnings.push('voice: before any part — ignored'); continue; }
      const staff = curPart.staves > 1 ? Math.min(idx, curPart.staves) : 1;
      const voice = curPart.staves > 1 ? 1 : idx;
      const existing = curPart.streams.find((s) => s.staff === staff && s.voice === voice);
      curStream = existing || newStream(curPart, staff, voice);
      section = null;
      continue;
    }
    const lyricsStart = /^lyrics$/i.test(t);
    if (lyricsStart) { section = 'lyrics'; if (curPart) { lyrics = []; curPart._lyrics = lyrics; } continue; }
    if (section === 'lyrics') {
      const looksMusic = /(^|\s)(\[|[A-Ga-grR(])[^\s]*\/\d/.test(t) || t.includes('|');
      if (!looksMusic) {
        for (const syl of t.split(/\s+/).filter(Boolean)) lyrics.push(syl);
        continue;
      }
      section = null; // fall through: this line is music, not lyrics
    }

    // ---- music -----------------------------------------------------------
    const stream = touchStream();
    const toks = tokenize(t);
    let tuplet = null;
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (/^T(\d{1,2})$/.test(tk) && toks[i + 1] === '{') {
        tuplet = { actual: parseInt(tk.slice(1), 10), events: [] };
        i += 1;
        continue;
      }
      if (tk === '{' || tk === '}') {
        if (tk === '}' && tuplet) {
          const normal = Math.pow(2, Math.floor(Math.log2(tuplet.actual)));
          tuplet.events.forEach((e, k) => {
            e.actual = f(e.dur.n * normal, e.dur.d * tuplet.actual);
            e.tuplet = { actual: tuplet.actual, normal, first: k === 0, last: k === tuplet.events.length - 1 };
          });
          stream.pending.push(...tuplet.events);
          tuplet = null;
        }
        continue;
      }
      if (tk.startsWith('|') || tk.startsWith(':|')) {
        const startsRepeat = tk.startsWith('|:') || tk === ':|:';
        const endsRepeat = tk.includes(':|');
        if (stream.pending.length) endMeasure(stream);
        if (startsRepeat) stream.startRepeat.add(stream.measures.length);
        if (endsRepeat && stream.measures.length) stream.endRepeat.add(stream.measures.length - 1);
        continue;
      }
      if (tk.startsWith('%')) {
        const dir = DIRECTIONS[tk.slice(1)];
        if (!dir) warnings.push(`unknown direction "${tk}" — ignored`);
        else stream.pending.push({ type: 'direction', kind: dir.type, value: dir.value, staff: stream.staff, voice: stream.voice, actual: f(0, 1) });
        continue;
      }
      if (tk.startsWith('@')) {
        let name = tk.slice(1);
        let val = null;
        const eq = name.indexOf('=');
        if (eq >= 0) { val = name.slice(eq + 1); name = name.slice(0, eq); }
        else if (toks[i + 1] && !toks[i + 1].startsWith('|') && !toks[i + 1].startsWith('%')) { val = toks[++i]; }
        const nameLc = name.toLowerCase();
        const target = stream.pending.length ? stream.measures.length + 1 : stream.measures.length;
        if (!val) { warnings.push(`@${name} needs a value (e.g. @time=3/4)`); continue; }
        const change = attrChanges[target] || (attrChanges[target] = {});
        if (nameLc === 'time' || nameLc === 'meter') {
          const m3 = /^(\d{1,2})\/(\d{1,2})$/.exec(val);
          if (m3) change.time = { beats: parseInt(m3[1], 10), beatType: parseInt(m3[2], 10) };
          else warnings.push(`bad @time "${val}"`);
        } else if (nameLc === 'key') {
          change.key = normKey(val);
        } else if (nameLc === 'tempo') {
          const n2 = parseFloat(val);
          if (Number.isFinite(n2) && n2 > 0) change.tempo = Math.round(n2);
          else warnings.push(`bad @tempo "${val}"`);
        } else if (nameLc === 'tempo-text') {
          change.tempoText = val;
        } else {
          warnings.push(`unknown attribute "@${name}" — ignored`);
        }
        continue;
      }
      const ev = parseAtom(tk, { staff: stream.staff, voice: stream.voice });
      if (ev.error) { warnings.push(`bar ${stream.measures.length + 1}: ${ev.error}`); continue; }
      if (!ev.actual) ev.actual = ev.dur;
      if (tuplet) tuplet.events.push(ev);
      else stream.pending.push(ev);
    }
  }

  // flush trailing events
  for (const p of parts) {
    for (const s of p.streams) {
      if (s.pending.length) endMeasure(s, meta, warnings);
    }
  }

  // attach lyrics
  for (const p of parts) {
    const syl = p._lyrics || [];
    if (!syl.length) continue;
    let k = 0;
    const main = p.streams.find((s) => s.staff === 1) || p.streams[0];
    outer: for (const meas of main.measures) {
      for (const ev of meas) {
        if (ev.type !== 'note') continue;
        if (k < syl.length) { ev.lyric = syl[k++]; }
        else break outer;
      }
    }
    if (k < syl.length) warnings.push(`lyrics: ${syl.length - k} syllable(s) left over (score has ${k} notes)`);
  }

  // tie pass
  for (const p of parts) {
    for (const s of p.streams) {
      const pend = new Map();
      for (const meas of s.measures) {
        for (const ev of meas) {
          if (ev.type !== 'note') continue;
          for (const pi of ev.pitches) {
            const key = `${pi.step}${pi.alter}:${pi.octave}`;
            if (pend.get(key)) { pi.tieStop = true; pend.delete(key); }
            if (ev.tie) { pi.tieStart = true; pend.set(key, true); }
          }
        }
      }
      for (const [key, ] of pend) if (pend.get(key)) warnings.push(`unresolved tie on ${key} at end of part "${p.name}"`);
    }
  }

  // measure validation
  const timeAt = (mi) => {
    let t = meta.time;
    for (const key of Object.keys(attrChanges).map(Number).sort((a, b) => a - b)) {
      if (key <= mi && attrChanges[key] && attrChanges[key].time) t = attrChanges[key].time;
    }
    return f(t.beats, t.beatType);
  };
  for (const p of parts) {
    const nMeasures = Math.max(...p.streams.map((s) => s.measures.length));
    for (let i = 0; i < nMeasures; i++) {
      const want = i === 0 && meta.pickup ? meta.pickup : timeAt(i);
      for (const s of p.streams) {
        let sum = f(0, 1);
        const meas = s.measures[i];
        if (!meas) {
          s.measures[i] = [];
        }
        for (const ev of meas || []) if (ev.actual && !ev.grace && ev.type !== 'direction') sum = add(sum, ev.actual);
        if (!meas || !meas.some((e) => e.actual && !e.grace && e.type !== 'direction')) {
          // empty measure -> whole measure rest
          const fill = sub(want, sum);
          for (const d of splitDuration(fill)) s.measures[i].push({ type: 'rest', dur: d, actual: d, dots: dotsFor(d), pitches: [], staff: s.staff, voice: s.voice, tie: false });
          continue;
        }
        if (cmp(sum, want) < 0) {
          const fill = sub(want, sum);
          const pad = splitDuration(fill);
          warnings.push(`part "${p.name}" measure ${i + 1}: ${fstr(sum)} of ${fstr(want)} — padded with ${pad.map(fstr).join('+')}`);
          for (const d of pad) s.measures[i].push({ type: 'rest', dur: d, actual: d, dots: dotsFor(d), pitches: [], staff: s.staff, voice: s.voice, tie: false });
        } else if (cmp(sum, want) > 0) {
          warnings.push(`part "${p.name}" measure ${i + 1}: ${fstr(sum)} exceeds ${fstr(want)} — measure is overfull`);
        }
      }
    }
    p.streams.forEach((s) => { s.measures.length = nMeasures; });
  }

  // Repeats are score-level: MusicXML wants the barline in every part, otherwise
  // MuseScore drops it entirely when another part lacks it.
  const startRepeat = new Set(), endRepeat = new Set();
  for (const p of parts) for (const st of p.streams) {
    st.startRepeat.forEach((i) => startRepeat.add(i));
    st.endRepeat.forEach((i) => endRepeat.add(i));
  }

  return { meta, parts, warnings, attrs: attrChanges, repeats: { start: startRepeat, end: endRepeat } };
}

function dotsFor(d) {
  for (const dots of [0, 1, 2]) {
    const mult = f(Math.pow(2, dots + 1) - 1, Math.pow(2, dots));
    const base = f(d.n * mult.d, d.d * mult.n);
    if (base.n === 1 && [1, 2, 4, 8, 16, 32, 64, 128].includes(base.d)) return dots;
  }
  return 0;
}

function endMeasure(stream) {
  if (!stream.pending.length) {
    // allow explicit empty measures with "|"
    stream.measures.push([]);
    return;
  }
  stream.measures.push(stream.pending);
  stream.pending = [];
}

export { CLEFS, KEY_FIFTHS, MINOR_FIFTHS };
