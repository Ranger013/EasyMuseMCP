// Score editing for existing MuseScore files, at measure/element granularity.
// Works on MusicXML text (any score MuseScore can open is converted first),
// so it can edit scores that were not written in this DSL.
import { INSTRUMENTS, KEY_FIFTHS, MINOR_FIFTHS } from './dsl.js';
import { transposeMusicXML } from './transpose.js';

const MEASURE_RE = /<measure\b[^>]*>[\s\S]*?<\/measure>/g;
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function mapParts(xml, fn) {
  const re = /(<part id="[^"]+">)([\s\S]*?)(<\/part>)/g;
  let i = 0;
  return xml.replace(re, (all, open, body, close) => open + fn(body, i++) + close);
}

export function partCount(xml) {
  return (xml.match(/<part id="/g) || []).length;
}

const getMeasures = (body) => body.match(MEASURE_RE) || [];

function setMeasures(body, measures) {
  const first = body.search(/<measure\b/);
  if (first < 0) return body;
  const lastMatch = [...body.matchAll(/<\/measure>/g)].pop();
  const lastEnd = lastMatch.index + lastMatch[0].length;
  return body.slice(0, first) + measures.join('\n    ') + body.slice(lastEnd);
}

function renumber(measures) {
  return measures.map((m, i) => m.replace(/<measure\b[^>]*?(\/?)>/,
    (all, selfClose) => `<measure number="${i + 1}"${all.includes('implicit="yes"') ? ' implicit="yes"' : ''}${selfClose}>`));
}

// Walk the note/backup/forward cursor to find how long a measure really is.
export function measureUnits(measure) {
  let pos = 0, max = 0;
  const tokens = measure.match(/<note\b[\s\S]*?<\/note>|<backup\b[\s\S]*?<\/backup>|<forward\b[\s\S]*?<\/forward>/g) || [];
  for (const t of tokens) {
    const d = /<duration>(\d+)<\/duration>/.exec(t);
    const dur = d ? parseInt(d[1], 10) : 0;
    if (t.startsWith('<note')) {
      if (!t.includes('<chord/>')) pos += dur;
    } else if (t.startsWith('<backup')) {
      pos -= dur;
    } else {
      pos += dur;
    }
    max = Math.max(max, pos);
  }
  return max;
}


// Structural elements must not travel with copied measures.
function stripStructural(measure, { keepTempo = false } = {}) {
  let m = measure;
  m = m.replace(/<print\b[^>]*\/>/g, '');
  m = m.replace(/<print\b[^>]*>[\s\S]*?<\/print>/g, '');
  m = m.replace(/<attributes>[\s\S]*?<\/attributes>/g, '');
  if (!keepTempo) {
    // drop tempo indications (round-tripped files carry attributes on <metronome>)
    m = m.replace(/<direction\b[\s\S]*?<\/direction>/g, (d) => (/<metronome\b/.test(d) ? '' : d));
    m = m.replace(/<sound\b[^>]*\btempo="[^"]*"[^>]*\/>/g, '');
  }
  return m;
}

function stripSystemBreaks(xml) {
  return mapParts(xml, (body) => body.replace(/\s*<print[^>]*new-system="yes"[^>]*\/>/g, ''));
}

const attributesOf = (measure) => (/<attributes>[\s\S]*?<\/attributes>/.exec(measure) || [null])[0];

function emptyMeasureLike(source, number) {
  const units = measureUnits(source) || 1;
  const attrs = attributesOf(source);
  const voice = (/<voice>(\d+)<\/voice>/.exec(source) || [, '1'])[1];
  return `<measure number="${number}">${attrs ? '\n      ' + attrs : ''}
      <note><rest measure="yes"/><duration>${units}</duration><voice>${voice}</voice></note>
    </measure>`;
}

// --------------------------------------------------------------------------
// individual operations
// --------------------------------------------------------------------------
export const OPERATIONS = {
  /** title/subtitle/composer/lyricist */
  set_metadata(xml, { title, subtitle, composer, lyricist }) {
    let out = xml;
    const CREDIT_RE = (type) => new RegExp(`(<credit page="1">\\s*<credit-type>${type}</credit-type>\\s*<credit-words[^>]*>)([\\s\\S]*?)(</credit-words>)`);
    const setCredit = (type, value, y, size) => {
      if (value === undefined) return;
      const re = CREDIT_RE(type);
      if (re.test(out)) { out = out.replace(re, (m, a, _b, c) => a + esc(value) + c); return; }
      const block = `  <credit page="1">\n    <credit-type>${type}</credit-type>\n    <credit-words default-x="595" default-y="${y}" justify="center" valign="top" font-size="${size}">${esc(value)}</credit-words>\n  </credit>`;
      if (type === 'title') {
        out = out.replace(/<work-title>[\s\S]*?<\/work-title>/, `<work-title>${esc(value)}</work-title>`);
      }
      const lastCredit = out.lastIndexOf('</credit>');
      if (lastCredit >= 0) {
        const at = lastCredit + '</credit>'.length;
        out = out.slice(0, at) + '\n' + block + out.slice(at);
      } else {
        out = out.replace('<identification>', block + '\n  <identification>');
      }
    };
    setCredit('title', title, 1611, 22);
    setCredit('subtitle', subtitle, 1530, 13);
    for (const [type, value] of [['composer', composer], ['lyricist', lyricist]]) {
      if (value === undefined) continue;
      const re = new RegExp(`(<creator type="${type}">)[\\s\\S]*?(</creator>)`);
      if (re.test(out)) out = out.replace(re, (m, a, b) => a + esc(value) + b);
      else out = out.replace('</identification>', `  <creator type="${type}">${esc(value)}</creator>\n  </identification>`);
    }
    return out;
  },

  /** global or from a given measure on */
  set_tempo(xml, { tempo, measure = 1 }) {
    const v = Math.round(Number(tempo));
    if (!Number.isFinite(v) || v <= 0) throw new Error('tempo must be a positive number');
    if (measure <= 1) {
      let touched = false;
      let out = xml.replace(/<sound\b[^>]*\btempo="[^"]*"[^>]*\/>/, (m) => { touched = true; return m.replace(/tempo="[^"]*"/, `tempo="${v}"`); });
      out = out.replace(/<per-minute>\d+(?:\.\d+)?<\/per-minute>/g, `<per-minute>${v}</per-minute>`);
      if (touched || out !== xml) return out;
    }
    return mapParts(xml, (body) => {
      const ms = getMeasures(body);
      const idx = Math.min(Math.max(0, measure - 1), ms.length - 1);
      if (!ms[idx]) return body;
      ms[idx] = ms[idx].replace(/(<attributes>[\s\S]*?<\/attributes>)/,
        `$1\n      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${v}</per-minute></metronome></direction-type><sound tempo="${v}"/></direction>`);
      return setMeasures(body, ms);
    });
  },

  set_key(xml, { key, measure = 1 }) {
    const k = parseKey(key);
    return mapParts(xml, (body) => {
      const ms = getMeasures(body);
      const idx = Math.min(Math.max(0, measure - 1), ms.length - 1);
      if (!ms[idx]) return body;
      const attr = `<attributes><key><fifths>${k.fifths}</fifths><mode>${k.minor ? 'minor' : 'major'}</mode></key></attributes>`;
      if (/<attributes>[\s\S]*?<\/key>[\s\S]*?<\/attributes>/.test(ms[idx])) {
        ms[idx] = ms[idx].replace(/(<attributes>[\s\S]*?<key>)[\s\S]*?(<\/key>[\s\S]*?<\/attributes>)/,
          `$1<fifths>${k.fifths}</fifths><mode>${k.minor ? 'minor' : 'major'}</mode>$2`);
      } else if (/<attributes>[\s\S]*?<\/attributes>/.test(ms[idx])) {
        ms[idx] = ms[idx].replace('</attributes>', `<key><fifths>${k.fifths}</fifths><mode>${k.minor ? 'minor' : 'major'}</mode></key></attributes>`);
      } else {
        ms[idx] = ms[idx].replace(/(<measure\b[^>]*>)/, `$1\n      ${attr}`);
      }
      return setMeasures(body, ms);
    });
  },

  set_time(xml, { time, measure = 1 }) {
    const m = parseTime(time);
    return mapParts(xml, (body) => {
      const ms = getMeasures(body);
      const idx = Math.min(Math.max(0, measure - 1), ms.length - 1);
      if (!ms[idx]) return body;
      if (/<attributes>[\s\S]*?<\/time>[\s\S]*?<\/attributes>/.test(ms[idx])) {
        ms[idx] = ms[idx].replace(/(<attributes>[\s\S]*?<time>)[\s\S]*?(<\/time>[\s\S]*?<\/attributes>)/,
          `$1<beats>${m.beats}</beats><beat-type>${m.beatType}</beat-type>$2`);
      } else if (/<attributes>[\s\S]*?<\/attributes>/.test(ms[idx])) {
        ms[idx] = ms[idx].replace('</attributes>', `<time><beats>${m.beats}</beats><beat-type>${m.beatType}</beat-type></time></attributes>`);
      } else {
        ms[idx] = ms[idx].replace(/(<measure\b[^>]*>)/, `$1\n      <attributes><time><beats>${m.beats}</beats><beat-type>${m.beatType}</beat-type></time></attributes>`);
      }
      return setMeasures(body, ms);
    });
  },

  transpose(xml, { semitones, from, to }) {
    const n = Number(semitones);
    if (!Number.isFinite(n) || n === 0) return xml;
    return mapParts(xml, (body) => {
      const ms = getMeasures(body);
      const a = Math.max(0, (from || 1) - 1);
      const b = Math.min(ms.length - 1, (to || ms.length) - 1);
      for (let i = a; i <= b; i++) ms[i] = transposeMusicXML(ms[i], n, {});
      return setMeasures(body, ms);
    });
  },

  delete_measures(xml, { from, to }) {
    const a = Number(from), b = Number(to ?? from);
    return mapParts(stripSystemBreaks(xml), (body) => {
      const ms = getMeasures(body);
      if (ms.length - (b - a + 1) < 1) throw new Error(`refusing to delete every measure (${ms.length} total)`);
      const kept = ms.filter((_, i) => i + 1 < a || i + 1 > b);
      return setMeasures(body, renumber(kept));
    });
  },

  duplicate_measures(xml, { from, to, times = 1 }) {
    const a = Number(from), b = Number(to ?? from);
    const clean = stripSystemBreaks(xml);
    return mapParts(clean, (body) => {
      const ms = getMeasures(body);
      const block = ms.slice(a - 1, b).map((m) => stripStructural(m));
      if (!block.length) throw new Error(`no measures in range ${a}-${b}`);
      const out = [...ms];
      for (let t = 0; t < Number(times); t++) out.splice(b - 1 + t * block.length + 1, 0, ...block);
      return setMeasures(body, renumber(out));
    });
  },

  /** Re-space systems: a system break every N measures (0 = let MuseScore decide). */
  set_systems(xml, { measures }) {
    const n = Number(measures) || 0;
    return mapParts(stripSystemBreaks(xml), (body) => {
      const ms = getMeasures(body);
      const out = ms.map((m, i) => {
        if (!n || i === 0 || i % n !== 0) return m;
        return m.replace(/(<measure\b[^>]*>)/, '$1\n      <print new-system="yes"/>');
      });
      return setMeasures(body, out);
    });
  },

  append_measures(xml, { count = 1 }) {
    return mapParts(stripSystemBreaks(xml), (body) => {
      const ms = getMeasures(body);
      if (!ms.length) return body;
      const last = ms[ms.length - 1];
      const added = [];
      for (let i = 0; i < Number(count); i++) added.push(emptyMeasureLike(last, ms.length + i + 1));
      return setMeasures(body, renumber([...ms, ...added]));
    });
  },

  add_lyrics(xml, { text, staff = 1, verse = 1, part = 1 }) {
    const syllables = String(text).trim().split(/\s+/).filter(Boolean);
    if (!syllables.length) throw new Error('add_lyrics needs text');
    let k = 0;
    let partIdx = 0;
    return mapParts(xml, (body) => {
      if (partIdx++ !== part - 1) return body;
      const out = body.replace(/<note>[\s\S]*?<\/note>/g, (note) => {
        if (k >= syllables.length) return note;
        if (!note.includes('<pitch>') || note.includes('<chord/>') || note.includes('<grace')) return note;
        if (new RegExp(`<staff>${staff}</staff>`).test(note) || (staff === 1 && !/<staff>/.test(note))) {
          const clean = note.replace(/<lyric number="\d+">[\s\S]*?<\/lyric>/g, '');
          k += 1;
          return clean.replace(/<\/note>$/, `<lyric number="${verse}"><syllabic>single</syllabic><text>${esc(syllables[k - 1])}</text></lyric></note>`);
        }
        return note;
      });
      return out;
    });
  },

  set_instrument(xml, { part = 1, instrument }) {
    const inst = INSTRUMENTS[String(instrument).toLowerCase()];
    if (!inst) throw new Error(`unknown instrument "${instrument}"`);
    let n = 0;
    return xml.replace(/(<score-part id="(P\d+)">)([\s\S]*?)(<\/score-part>)/g, (all, open, id, inner, close) => {
      if (++n !== part) return all;
      let body = inner.replace(/<part-name>[\s\S]*?<\/part-name>/, `<part-name>${esc(inst.name)}</part-name>`);
      if (!body.includes('midi-program')) {
        body = body.replace('</score-part>', `<midi-instrument id="${id}-I1"><midi-program>${inst.program}</midi-program></midi-instrument></score-part>`);
      } else {
        body = body.replace(/<midi-program>\d+<\/midi-program>/, `<midi-program>${inst.program}</midi-program>`);
      }
      return open + body + close;
    });
  },
};

function parseKey(v) {
  const s = String(v).trim();
  const minor = /m(in|inor)?$/i.test(s) && s.length > 1;
  const root = s.replace(/m(in|inor)?$/i, '');
  const up = root[0].toUpperCase() + root.slice(1);
  const table = minor ? MINOR_FIFTHS : KEY_FIFTHS;
  if (table[up] === undefined) throw new Error(`unknown key "${v}"`);
  return { root: up, minor, fifths: table[up] };
}

function parseTime(v) {
  const m = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(String(v).trim());
  if (!m) throw new Error(`bad time signature "${v}" (expected e.g. 3/4)`);
  return { beats: parseInt(m[1], 10), beatType: parseInt(m[2], 10) };
}

export function applyOperations(xml, operations) {
  const applied = [];
  let out = xml;
  for (const op of operations || []) {
    const name = op.op || op.operation;
    const fn = OPERATIONS[name];
    if (!fn) throw new Error(`unknown edit operation "${name}"`);
    const before = out;
    out = fn(out, op);
    applied.push({ op: name, changed: out !== before });
  }
  return { xml: out, applied };
}

// --------------------------------------------------------------------------
// concatenation
// --------------------------------------------------------------------------
export function concatScores(xmlA, xmlB) {
  const warnings = [];
  const partsA = partCount(xmlA), partsB = partCount(xmlB);
  if (partsA !== partsB) throw new Error(`cannot join scores with ${partsA} and ${partsB} parts`);

  const headEnd = xmlA.indexOf('<part id=');
  let head = xmlA.slice(0, headEnd);
  head = head.replace(/<work-title>[\s\S]*?<\/work-title>/, `<work-title>${(/<work-title>([\s\S]*?)<\/work-title>/.exec(xmlA) || [, 'Joined'])[1]}</work-title>`);

  const bodiesA = [...xmlA.matchAll(/<part id="([^"]+)">([\s\S]*?)<\/part>/g)].map((m) => m[2]);
  const bodiesB = [...xmlB.matchAll(/<part id="([^"]+)">([\s\S]*?)<\/part>/g)].map((m) => m[2]);

  const merged = bodiesA.map((bodyA, i) => {
    const msA = getMeasures(bodyA).map((m) => m.replace(/<barline location="right">[\s\S]*?<\/barline>\s*$/, ''));
    const msB = getMeasures(bodiesB[i]).map((m, idx) => {
      let m2 = m;
      if (idx === 0) {
        m2 = m2.replace(/<attributes>[\s\S]*?<\/attributes>/, '');
        if (/<key>|<time>/.test(m2)) warnings.push('second score has its own key/time — the join keeps the first score’s signature');
      }
      return m2;
    });
    return renumber([...msA, ...msB]).join('\n    ');
  });

  const parts = merged.map((body, i) => `<part id="P${i + 1}">\n    ${body}\n  </part>`).join('\n');
  return { xml: `${head}${parts}\n</score-partwise>\n`, warnings };
}
