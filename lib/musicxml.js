// Score model -> MusicXML 4.0 (partwise). Pure string generation, no deps.
import { f, cmp, lcm, $ as fstr } from './frac.js';
import { CLEFS, KEY_FIFTHS, MINOR_FIFTHS, INSTRUMENTS } from './dsl.js';

const TYPE_NAMES = [
  [f(1, 1), 'whole'], [f(1, 2), 'half'], [f(1, 4), 'quarter'], [f(1, 8), 'eighth'],
  [f(1, 16), '16th'], [f(1, 32), '32nd'], [f(1, 64), '64th'], [f(1, 128), '128th'],
];

export function notatedDuration(dur) {
  for (let dots = 0; dots <= 2; dots++) {
    const den = Math.pow(2, dots), num = Math.pow(2, dots + 1) - 1;
    const base = f(dur.n * den, dur.d * num);
    const hit = TYPE_NAMES.find(([v]) => cmp(v, base) === 0);
    if (hit) return { type: hit[1], dots };
  }
  return null;
}

const ACCIDENTAL_NAMES = { 1: 'sharp', '-1': 'flat', 2: 'double-sharp', '-2': 'flat-flat', 0: 'natural' };
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Accidental implied by the key signature for a given letter.
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
function keyAlterFor(step, fifths) {
  if (fifths > 0) return SHARP_ORDER.slice(0, Math.min(7, fifths)).includes(step) ? 1 : 0;
  if (fifths < 0) return FLAT_ORDER.slice(0, Math.min(7, -fifths)).includes(step) ? -1 : 0;
  return 0;
}

function fifthsOf(key) {
  if (!key) return 0;
  const table = key.minor ? MINOR_FIFTHS : KEY_FIFTHS;
  const v = table[key.root];
  return v === undefined ? 0 : v;
}

export function toMusicXML(score, opts = {}) {
  const { meta, parts } = score;
  const warnings = [];
  const attrChanges = score.attrs || {};

  // ---- running key/time/tempo state ---------------------------------------
  const changeIdx = Object.keys(attrChanges).map(Number).filter((n) => n >= 0).sort((a, b) => a - b);
  const at = (mi) => {
    let time = meta.time, key = meta.key, tempo = meta.tempo, tempoText = meta.tempoText;
    for (const i of changeIdx) {
      if (i > mi) break;
      const c = attrChanges[i] || {};
      if (c.time) time = c.time;
      if (c.key) key = c.key;
      if (c.tempo !== undefined) { tempo = c.tempo; tempoText = null; }
      if (c.tempoText !== undefined) { tempoText = c.tempoText; tempo = null; }
    }
    return { time, key, tempo, tempoText };
  };

  // ---- divisions -----------------------------------------------------------
  let divisions = 1;
  for (const p of parts) for (const s of p.streams) for (const m of s.measures) for (const ev of m) {
    if (!ev.actual || ev.grace || ev.type === 'direction') continue;
    const q = f(ev.actual.n * 4, ev.actual.d);
    divisions = lcm(divisions, q.d);
  }
  if (divisions > 480) warnings.push(`high divisions value (${divisions}) — unusual durations present`);

  const unitsOf = (dur) => {
    const q = f(dur.n * 4, dur.d);
    if (q.d !== 1 && divisions % q.d !== 0) return null;
    return q.n * (divisions / q.d);
  };

  const nMeasures = Math.max(1, ...parts.map((p) => Math.max(0, ...p.streams.map((s) => s.measures.length))));
  const measureLenAt = (mi) => {
    const t = at(mi).time;
    return f(t.beats, t.beatType);
  };

  const out = [];
  const w = (s) => out.push(s);
  const title = meta.title || opts.defaultTitle || 'Untitled Score';

  w('<?xml version="1.0" encoding="UTF-8"?>');
  w('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  w('<score-partwise version="4.0">');
  w(`  <work><work-title>${esc(title)}</work-title></work>`);

  // MuseScore builds its title frame from <credit> elements tagged with
  // <credit-type>; movement-title would override a subtitle credit, so titles are
  // emitted purely as typed credits and the work element stays metadata-only.
  w('  <credit page="1">');
  w('    <credit-type>title</credit-type>');
  w(`    <credit-words default-x="595" default-y="1611" justify="center" valign="top" font-size="22">${esc(title)}</credit-words>`);
  w('  </credit>');
  if (meta.subtitle) {
    w('  <credit page="1">');
    w('    <credit-type>subtitle</credit-type>');
    w(`    <credit-words default-x="595" default-y="1530" justify="center" valign="top" font-size="13">${esc(meta.subtitle)}</credit-words>`);
    w('  </credit>');
  }

  w('  <identification>');
  if (meta.composer) w(`    <creator type="composer">${esc(meta.composer)}</creator>`);
  if (meta.lyricist) w(`    <creator type="lyricist">${esc(meta.lyricist)}</creator>`);
  w('    <encoding>');
  w('      <software>musescore-studio</software>');
  w(`      <encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date>`);
  w('    </encoding>');
  w('  </identification>');

  // ---- page layout ---------------------------------------------------------
  const scaling = meta.scaling || 7;
  const mm2tenths = (mm) => +((Number(mm) * 40) / scaling).toFixed(2);
  const page = meta.page || { width: 210, height: 297 };
  const margin = meta.margins || { top: 15, right: 15, bottom: 15, left: 15 };
  const hasLyrics = parts.some((p) => p.streams.some((s) => s.measures.some((m) => m.some((e) => e.lyric))));

  w('  <defaults>');
  w(`    <scaling><millimeters>${scaling}</millimeters><tenths>40</tenths></scaling>`);
  w('    <page-layout>');
  w(`      <page-height>${mm2tenths(page.height)}</page-height><page-width>${mm2tenths(page.width)}</page-width>`);
  w('      <page-margins type="both">');
  w(`        <left-margin>${mm2tenths(margin.left)}</left-margin><right-margin>${mm2tenths(margin.right)}</right-margin>`);
  w(`        <top-margin>${mm2tenths(margin.top)}</top-margin><bottom-margin>${mm2tenths(margin.bottom)}</bottom-margin>`);
  w('      </page-margins>');
  w('    </page-layout>');
  w('    <system-layout>');
  w('      <system-margins><left-margin>0</left-margin><right-margin>0</right-margin></system-margins>');
  w(`      <system-distance>${meta.systemDistance ?? (hasLyrics ? 140 : 120)}</system-distance>`);
  w(`      <top-system-distance>${meta.topSystemDistance ?? 240}</top-system-distance>`);
  w('    </system-layout>');
  if (parts.some((p) => p.staves > 1)) {
    w(`    <staff-layout number="1"><staff-distance>${meta.staffDistance ?? (hasLyrics ? 165 : 90)}</staff-distance></staff-layout>`);
  }
  w('  </defaults>');

  w('  <part-list>');
  parts.forEach((p, i) => {
    const inst = INSTRUMENTS[p.instrument] || INSTRUMENTS.piano;
    w(`    <score-part id="P${i + 1}">`);
    w(`      <part-name>${esc(p.name)}</part-name>`);
    w(`      <score-instrument id="P${i + 1}-I1"><instrument-name>${esc(inst.name)}</instrument-name></score-instrument>`);
    w(`      <midi-instrument id="P${i + 1}-I1"><midi-channel>${(i % 16) + 1}</midi-channel><midi-program>${inst.program}</midi-program><volume>78.7402</volume><pan>0</pan></midi-instrument>`);
    w('    </score-part>');
  });
  w('  </part-list>');

  parts.forEach((p, pi) => {
    w(`  <part id="P${pi + 1}">`);
    const streamsByStaff = new Map();
    for (const s of p.streams) {
      if (!streamsByStaff.has(s.staff)) streamsByStaff.set(s.staff, []);
      streamsByStaff.get(s.staff).push(s);
    }
    for (const arr of streamsByStaff.values()) arr.sort((a, b) => a.voice - b.voice);
    let openSlurs = 0;

    for (let mi = 0; mi < nMeasures; mi++) {
      const isPickup = mi === 0 && meta.pickup;
      const st = at(mi);
      const want = isPickup ? meta.pickup : measureLenAt(mi);
      const wantUnits = unitsOf(want) ?? unitsOf(f(st.time.beats, st.time.beatType)) ?? 0;
      const fifths = fifthsOf(st.key);

      w(`    <measure number="${mi + 1}"${isPickup ? ' implicit="yes"' : ''}>`);
      if (meta.measuresPerSystem && mi > 0 && mi % meta.measuresPerSystem === 0) {
        w('      <print new-system="yes"/>');
      }

      const change = attrChanges[mi] || {};
      if (mi === 0) {
        w('      <attributes>');
        w(`        <divisions>${divisions}</divisions>`);
        w(`        <key><fifths>${fifths}</fifths><mode>${st.key.minor ? 'minor' : 'major'}</mode></key>`);
        w(`        <time><beats>${st.time.beats}</beats><beat-type>${st.time.beatType}</beat-type></time>`);
        if (p.staves > 1) w(`        <staves>${p.staves}</staves>`);
        for (let sIdx = 1; sIdx <= p.staves; sIdx++) {
          const clefName = p.clefs[sIdx - 1] || (sIdx === 1 ? 'treble' : 'bass');
          const clef = CLEFS[clefName] || CLEFS.treble;
          const num = p.staves > 1 ? ` number="${sIdx}"` : '';
          w(`        <clef${num}><sign>${clef.sign}</sign><line>${clef.line}</line></clef>`);
        }
        w('      </attributes>');
        if (pi === 0 && (st.tempo || st.tempoText)) {
          if (st.tempo) {
            w('      <direction placement="above">');
            w('        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>' + st.tempo + '</per-minute></metronome></direction-type>');
            w(`        <sound tempo="${st.tempo}"/>`);
            w('      </direction>');
          } else {
            w('      <direction placement="above">');
            w(`        <direction-type><words>${esc(st.tempoText)}</words></direction-type>`);
            w('      </direction>');
          }
        }
      } else if (change.key || change.time || change.tempo !== undefined || change.tempoText !== undefined) {
        if (change.key || change.time) {
          w('      <attributes>');
          if (change.key) w(`        <key><fifths>${fifths}</fifths><mode>${st.key.minor ? 'minor' : 'major'}</mode></key>`);
          if (change.time) w(`        <time><beats>${st.time.beats}</beats><beat-type>${st.time.beatType}</beat-type></time>`);
          w('      </attributes>');
        }
        // only a real tempo change re-prints the mark — a mere meter/key change must not
        if (pi === 0 && change.tempo !== undefined && st.tempo) {
          w('      <direction placement="above">');
          w('        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>' + st.tempo + '</per-minute></metronome></direction-type>');
          w(`        <sound tempo="${st.tempo}"/>`);
          w('      </direction>');
        } else if (pi === 0 && change.tempoText && st.tempoText) {
          w('      <direction placement="above">');
          w(`        <direction-type><words>${esc(st.tempoText)}</words></direction-type>`);
          w('      </direction>');
        }
      }

      if (mi === 0 && score.repeats && score.repeats.start.has(0)) {
        w('      <barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>');
      }

      let firstGroup = true;
      for (const staff of [...streamsByStaff.keys()].sort((a, b) => a - b)) {
        for (const s of streamsByStaff.get(staff)) {
          if (!firstGroup) w(`      <backup><duration>${wantUnits}</duration></backup>`);
          firstGroup = false;
          const evs = s.measures[mi] || [];
          const soundings = evs.filter((e) => e.type !== 'direction');
          const allRests = soundings.length > 0 && soundings.every((e) => e.type === 'rest');

          if (allRests && soundings.length === 1 && !soundings[0].grace) {
            w('      <note>');
            w('        <rest measure="yes"/>');
            w(`        <duration>${wantUnits}</duration>`);
            w(`        <voice>${s.voice}</voice>`);
            if (p.staves > 1) w(`        <staff>${staff}</staff>`);
            w('      </note>');
            continue;
          }

          for (const ev of evs) {
            if (ev.type === 'direction') {
              w('      <direction placement="below">');
              if (ev.kind === 'pedal') w(`        <direction-type><pedal type="${ev.value}" line="yes"/></direction-type>`);
              else w(`        <direction-type><wedge type="${ev.value}"/></direction-type>`);
              if (p.staves > 1) w(`        <staff>${p.staves}</staff>`);
              w('      </direction>');
              continue;
            }

            const durs = notatedDuration(ev.dur);
            if (!durs && !ev.grace) warnings.push(`unrepresentable duration ${fstr(ev.dur)} — exported as-is`);
            if (ev.dynamic) {
              w('      <direction placement="below">');
              w(`        <direction-type><dynamics><${ev.dynamic}/></dynamics></direction-type>`);
              if (p.staves > 1) w(`        <staff>${p.staves}</staff>`);
              w('      </direction>');
            }

            if (ev.type === 'rest') {
              w('      <note>');
              if (ev.grace) w('        <grace slash="yes"/>');
              w('        <rest/>');
              if (!ev.grace) w(`        <duration>${unitsOf(ev.actual) ?? 0}</duration>`);
              w(`        <voice>${s.voice}</voice>`);
              if (durs) { w(`        <type>${durs.type}</type>`); for (let d = 0; d < durs.dots; d++) w('        <dot/>'); }
              if (ev.tuplet && !ev.grace) w(`        <time-modification><actual-notes>${ev.tuplet.actual}</actual-notes><normal-notes>${ev.tuplet.normal}</normal-notes></time-modification>`);
              if (p.staves > 1) w(`        <staff>${staff}</staff>`);
              if (ev.fermata) w('        <notations><fermata/></notations>');
              w('      </note>');
              continue;
            }

            const unitsForNote = ev.grace ? null : unitsOf(ev.actual);
            if (!ev.grace && unitsForNote == null) { warnings.push(`duration ${fstr(ev.actual)} does not fit divisions`); continue; }
            ev.pitches.forEach((pit, idx) => {
              w('      <note>');
              if (ev.grace) w('        <grace slash="yes"/>');
              if (idx > 0) w('        <chord/>');
              w(`        <pitch><step>${pit.step}</step>${pit.alter ? `<alter>${pit.alter}</alter>` : ''}<octave>${pit.octave}</octave></pitch>`);
              if (!ev.grace) w(`        <duration>${unitsForNote}</duration>`);
              if (!ev.grace && pit.tieStart) w('        <tie type="start"/>');
              if (!ev.grace && pit.tieStop) w('        <tie type="stop"/>');
              w(`        <voice>${s.voice}</voice>`);
              if (durs) { w(`        <type>${durs.type}</type>`); for (let d = 0; d < durs.dots; d++) w('        <dot/>'); }
              // Only print an accidental when it departs from the key signature;
              // a diatonic F# in G major needs no visible sharp.
              if (pit.alter !== keyAlterFor(pit.step, fifths)) {
                w(`        <accidental>${ACCIDENTAL_NAMES[String(pit.alter)] || 'natural'}</accidental>`);
              }
              if (ev.tuplet && !ev.grace) w(`        <time-modification><actual-notes>${ev.tuplet.actual}</actual-notes><normal-notes>${ev.tuplet.normal}</normal-notes></time-modification>`);
              if (p.staves > 1) w(`        <staff>${staff}</staff>`);

              const notations = [];
              if (!ev.grace && pit.tieStart) notations.push('<tied type="start"/>');
              if (!ev.grace && pit.tieStop) notations.push('<tied type="stop"/>');
              if (ev.tuplet && ev.tuplet.first && idx === 0 && !ev.grace) notations.push('<tuplet type="start" number="1"/>');
              if (ev.tuplet && ev.tuplet.last && !ev.grace) notations.push('<tuplet type="stop" number="1"/>');
              if (ev.slurStart && idx === 0) { openSlurs += 1; notations.push(`<slur type="start" number="${openSlurs}"/>`); }
              if (ev.slurEnd && idx === 0 && openSlurs > 0) { notations.push(`<slur type="stop" number="${openSlurs}"/>`); openSlurs -= 1; }
              if (ev.articulations && ev.articulations.length) {
                notations.push(`<articulations>${ev.articulations.map((x) => `<${x}/>`).join('')}</articulations>`);
              }
              if (ev.ornaments && ev.ornaments.length) {
                notations.push(`<ornaments>${ev.ornaments.map((x) => `<${x}/>`).join('')}</ornaments>`);
              }
              if (ev.fermata) notations.push('<fermata/>');
              if (notations.length) w(`        <notations>${notations.join('')}</notations>`);

              if (ev.lyric && idx === 0) {
                const raw = String(ev.lyric);
                const begins = /-$/.test(raw);
                const text = raw.replace(/-$/, '');
                w(`        <lyric number="1"><syllabic>${begins ? 'begin' : 'single'}</syllabic><text>${esc(text)}</text></lyric>`);
              }
              w('      </note>');
            });
          }
        }
      }

      const rep = score.repeats || { start: new Set(), end: new Set() };
      const back = rep.end.has(mi);
      const fwd = rep.start.has(mi + 1);
      const isLast = mi === nMeasures - 1;
      if (back && fwd) {
        w('      <barline location="right"><bar-style>light-light</bar-style><repeat direction="backward"/><repeat direction="forward"/></barline>');
      } else if (back) {
        w('      <barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>');
      } else if (fwd) {
        w('      <barline location="right"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>');
      } else if (isLast) {
        w('      <barline location="right"><bar-style>light-heavy</bar-style></barline>');
      }
      w('    </measure>');
    }
    w('  </part>');
  });

  w('</score-partwise>');
  return { xml: out.join('\n') + '\n', warnings, divisions };
}
