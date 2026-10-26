// Unit tests: notation parsing, MusicXML emission, transposition.
// Run: node test/run.js    (add --full to also exercise the MuseScore CLI)
import assert from 'node:assert/strict';
import { parseDSL } from '../lib/dsl.js';
import { toMusicXML, notatedDuration } from '../lib/musicxml.js';
import { transposeMusicXML } from '../lib/ops.js';
import { applyOperations, concatScores, measureUnits, partCount } from '../lib/edit.js';
import { f, add, $ as fstr } from '../lib/frac.js';

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✔ ${name}`); }
  catch (e) { failures.push([name, e]); console.log(`  ✘ ${name}\n      ${e.message}`); }
}

console.log('fractions');
test('normalises and adds exactly', () => {
  assert.equal(fstr(add(f(1, 4), f(1, 4))), '1/2');
  assert.equal(fstr(add(f(1, 3), f(1, 6))), '1/2');
  assert.equal(fstr(add(f(1, 8), f(1, 8), f(1, 8))), '3/8');
});

console.log('durations');
test('quarter/half/whole map to MusicXML types', () => {
  assert.equal(notatedDuration(f(1, 4)).type, 'quarter');
  assert.equal(notatedDuration(f(1, 2)).type, 'half');
  assert.equal(notatedDuration(f(1, 1)).type, 'whole');
});
test('dotted values are detected, not mistyped', () => {
  assert.deepEqual(notatedDuration(f(3, 8)), { type: 'quarter', dots: 1 });
  assert.deepEqual(notatedDuration(f(7, 16)), { type: 'quarter', dots: 2 });
});

console.log('parsing');
const twinkle = `
title: 小星星
composer: 法国民谣
key: C
time: 4/4
tempo: 100

part "Piano" instrument=piano staves=2 clefs=treble,bass
voices 1
C5/4 C5/4 G5/4 G5/4 | A5/4 A5/4 G5/2 |
voices 2
C3/2 C3/2 | F2/2 C3/2 |
`;

test('parses metadata', () => {
  const s = parseDSL(twinkle);
  assert.equal(s.meta.title, '小星星');
  assert.equal(s.meta.key.root, 'C');
  assert.deepEqual(s.meta.time, { beats: 4, beatType: 4 });
  assert.equal(s.meta.tempo, 100);
});
test('creates one part with two staves and two streams', () => {
  const s = parseDSL(twinkle);
  assert.equal(s.parts.length, 1);
  assert.equal(s.parts[0].staves, 2);
  assert.equal(s.parts[0].streams.length, 2);
  assert.deepEqual(s.parts[0].streams.map((x) => x.staff), [1, 2]);
});
test('splits measures on |', () => {
  const s = parseDSL(twinkle);
  for (const st of s.parts[0].streams) assert.equal(st.measures.length, 2);
});
test('no warnings for a well-formed score', () => {
  assert.deepEqual(parseDSL(twinkle).warnings, []);
});
test('flags an overfull measure', () => {
  const s = parseDSL('time: 4/4\npart "P"\nC4/1 C4/1 |');
  assert.ok(s.warnings.some((w) => /exceeds/.test(w)));
});
test('pads a short measure with rests and warns', () => {
  const s = parseDSL('time: 4/4\npart "P"\nC4/2 |');
  assert.ok(s.warnings.some((w) => /padded/.test(w)));
  const evs = s.parts[0].streams[0].measures[0];
  const total = evs.reduce((a, e) => add(a, e.actual), f(0, 1));
  assert.equal(fstr(total), '1');
});
test('handles a pickup measure', () => {
  const s = parseDSL('time: 4/4\npickup: 1/4\npart "P"\nC4/4 | D4/1 |');
  assert.ok(!s.warnings.some((w) => /padded|exceeds/.test(w)));
});
test('expands triplets to 2/3 of written value', () => {
  const s = parseDSL('time: 4/4\npart "P"\nT3{ C4/8 D4/8 E4/8 } C4/4 C4/2 |');
  const evs = s.parts[0].streams[0].measures[0];
  assert.equal(fstr(evs[0].actual), '1/12');
  assert.deepEqual(evs[0].tuplet, { actual: 3, normal: 2, first: true, last: false });
  assert.ok(!s.warnings.some((w) => /exceeds|padded/.test(w)));
});
test('ties resolve to start/stop pairs', () => {
  const s = parseDSL('time: 4/4\npart "P"\nC4/2~ | C4/2 r/2 |');
  const evs = s.parts[0].streams[0].measures;
  assert.equal(evs[0][0].pitches[0].tieStart, true);
  assert.equal(evs[1][0].pitches[0].tieStop, true);
});
test('keeps spaced chords in one token', () => {
  const s = parseDSL('time: 4/4\npart "P"\n[C3 E3 G3]/1 |');
  const ev = s.parts[0].streams[0].measures[0][0];
  assert.equal(ev.pitches.length, 3);
  assert.deepEqual(ev.pitches.map((p) => p.step), ['C', 'E', 'G']);
});
test('repeats are collected at score level', () => {
  const s = parseDSL('time: 4/4\npart "A"\nC4/1 | |: D4/1 :| \npart "B"\nE4/1 | E4/1 |');
  assert.ok(s.repeats.start.size === 1 && s.repeats.end.size === 1);
});

test('modifiers parse in any order', () => {
  const src = 'time: 3/4\npart "P"\nG4/2.!p%fermata"来" |';
  const ev = parseDSL(src).parts[0].streams[0].measures[0][0];
  assert.equal(ev.dynamic, 'p');
  assert.equal(ev.fermata, true);
  assert.equal(ev.lyric, '来');
  assert.equal(fstr(ev.dur), '3/4');
  const ev2 = parseDSL('time: 4/4\npart "P"\nC5/4%tenuto!mf |').parts[0].streams[0].measures[0][0];
  assert.equal(ev2.dynamic, 'mf');
  assert.deepEqual(ev2.articulations, ['tenuto']);
});
test('grace notes and directions do not consume time', () => {
  const s = parseDSL('time: 3/4\npart "P"\ngA4/8 G4/2. |');
  assert.deepEqual(s.warnings, []);
  const s2 = parseDSL('time: 3/4\npart "P"\n%ped G4/2. %ped-up |');
  assert.deepEqual(s2.warnings, []);
});
test('mid-score meter change re-bars validation', () => {
  const ok = parseDSL('time: 4/4\npart "P"\nC4/1 | @time=3/4 D4/2. |');
  assert.deepEqual(ok.warnings, []);
  const bad = parseDSL('time: 4/4\npart "P"\nC4/1 | @time=3/4 D4/1 |');
  assert.ok(bad.warnings.some((w) => /exceeds/.test(w)));
});

console.log('musicxml');
test('emits a valid score skeleton with attributes', () => {
  const { xml } = toMusicXML(parseDSL(twinkle));
  assert.match(xml, /<score-partwise version="4.0">/);
  assert.match(xml, /<staves>2<\/staves>/);
  assert.match(xml, /<beats>4<\/beats><beat-type>4<\/beat-type>/);
  assert.match(xml, /<divisions>1<\/divisions>/);
  assert.equal((xml.match(/<measure /g) || []).length, 2); // two measures, one part
});
test('writes the correct pitches and octaves', () => {
  const { xml } = toMusicXML(parseDSL(twinkle));
  assert.match(xml, /<pitch><step>C<\/step><octave>5<\/octave><\/pitch>/);
  assert.match(xml, /<pitch><step>F<\/step><octave>2<\/octave><\/pitch>/);
});
test('emits repeat barlines in every part', () => {
  const src = 'time: 4/4\npart "A"\nC4/1 | |: D4/1 :|\npart "B"\nE4/1 | E4/1 |';
  const { xml } = toMusicXML(parseDSL(src));
  const forward = (xml.match(/<repeat direction="forward"\/>/g) || []).length;
  const backward = (xml.match(/<repeat direction="backward"\/>/g) || []).length;
  assert.equal(forward, 2);
  assert.equal(backward, 2);
});
test('emits lyrics and dynamics', () => {
  const src = 'time: 4/4\npart "V"\nlyrics\n一 闪\nC5/4"一" D5/4!mf E5/2 |';
  const { xml } = toMusicXML(parseDSL(src));
  assert.match(xml, /<lyric number="1">/);
  assert.match(xml, /<mf\/>/);
});

test('omits accidentals already implied by the key signature', () => {
  const { xml } = toMusicXML(parseDSL('key: G\ntime: 4/4\npart "P"\nF#4/1 |'));
  assert.ok(!/<accidental>/.test(xml), 'diatonic F# must not print a sharp');
  const { xml: xml2 } = toMusicXML(parseDSL('key: G\ntime: 4/4\npart "P"\nF4/1 |'));
  assert.match(xml2, /<accidental>natural<\/accidental>/);
});
test('emits typed title credits and honours systems:', () => {
  const { xml } = toMusicXML(parseDSL('title: T\nsubtitle: S\nsystems: 2\ntime: 4/4\npart "P"\nC4/1 | C4/1 | C4/1 | C4/1 |'));
  assert.match(xml, /<credit-type>title<\/credit-type>/);
  assert.match(xml, /<credit-type>subtitle<\/credit-type>/);
  assert.equal((xml.match(/<print new-system="yes"\/>/g) || []).length, 1);
});

console.log('transposition');
test('shifts pitches and accidentals by semitones', () => {
  const src = 'time: 4/4\npart "P"\nC4/1 |';
  const { xml } = toMusicXML(parseDSL(src));
  const up2 = transposeMusicXML(xml, 2);
  assert.match(up2, /<pitch><step>D<\/step><octave>4<\/octave><\/pitch>/);
  const up1 = transposeMusicXML(xml, 1);
  assert.match(up1, /<pitch><step>C<\/step><alter>1<\/alter><octave>4<\/octave><\/pitch>/);
  const down1 = transposeMusicXML(xml, -1);
  assert.match(down1, /<pitch><step>B<\/step><octave>3<\/octave><\/pitch>/);
});


console.log('editing');
const miniXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Mini</work-title></work>
  <identification><creator type="composer">X</creator></identification>
  <part-list><score-part id="P1"><part-name>A</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <direction><direction-type><metronome><per-minute>90</per-minute></metronome></direction-type><sound tempo="90"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="2"><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
    <measure number="3"><note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure>
  </part>
</score-partwise>`;

test('measureUnits follows the note cursor', () => {
  const m = /<measure[\s\S]*?<\/measure>/.exec(miniXML)[0];
  assert.equal(measureUnits(m), 4);
});
test('set_tempo rewrites per-minute and sound', () => {
  const { xml } = applyOperations(miniXML, [{ op: 'set_tempo', tempo: 120 }]);
  assert.match(xml, /<per-minute>120<\/per-minute>/);
  assert.match(xml, /<sound tempo="120"\/>/);
});
test('set_metadata creates a subtitle credit when absent', () => {
  const { xml } = applyOperations(miniXML, [{ op: 'set_metadata', subtitle: 'Sub' }]);
  assert.match(xml, /<credit-type>subtitle<\/credit-type>/);
  assert.match(xml, /<credit-words[^>]*>Sub<\/credit-words>/);
});
test('duplicate_measures strips structural attributes and tempo', () => {
  const { xml } = applyOperations(miniXML, [{ op: 'duplicate_measures', from: 1, to: 1 }]);
  assert.equal((xml.match(/<measure /g) || []).length, 4);
  assert.equal((xml.match(/<fifths>/g) || []).length, 1, 'copied measure must not repeat the key signature');
  assert.equal((xml.match(/<per-minute>/g) || []).length, 1, 'copied measure must not repeat the tempo mark');
});
test('duplicate_measures renumbers sequentially', () => {
  const { xml } = applyOperations(miniXML, [{ op: 'duplicate_measures', from: 2, to: 3 }]);
  const numbers = [...xml.matchAll(/<measure number="(\d+)"/g)].map((m) => m[1]);
  assert.deepEqual(numbers, ['1', '2', '3', '4', '5']); // copies are renumbered, not duplicated numbers
});
test('delete_measures removes and renumbers', () => {
  const { xml } = applyOperations(miniXML, [{ op: 'delete_measures', from: 2, to: 2 }]);
  const numbers = [...xml.matchAll(/<measure number="(\d+)"/g)].map((m) => m[1]);
  assert.deepEqual(numbers, ['1', '2']);
  assert.ok(!xml.includes('<step>D</step>'));
});
test('delete_measures refuses to empty the score', () => {
  assert.throws(() => applyOperations(miniXML, [{ op: 'delete_measures', from: 1, to: 3 }]), /refusing/);
});
test('append_measures adds a full-measure rest', () => {
  const { xml } = applyOperations(miniXML, [{ op: 'append_measures', count: 2 }]);
  assert.equal((xml.match(/<measure /g) || []).length, 5);
  assert.equal((xml.match(/<rest measure="yes"\/>/g) || []).length, 2);
});
test('add_lyrics assigns one syllable per pitched note', () => {
  const { xml } = applyOperations(miniXML, [{ op: 'add_lyrics', text: '一 二 三' }]);
  const syl = [...xml.matchAll(/<text>([^<]*)<\/text>/g)].map((m) => m[1]);
  assert.deepEqual(syl, ['一', '二', '三']);
});
test('set_key changes the signature', () => {
  const { xml } = applyOperations(miniXML, [{ op: 'set_key', key: 'Eb' }]);
  assert.match(xml, /<fifths>-3<\/fifths>/);
});
test('set_systems inserts one break per N measures', () => {
  const { xml } = applyOperations(miniXML, [{ op: 'set_systems', measures: 1 }]);
  assert.equal((xml.match(/<print new-system="yes"\/>/g) || []).length, 2);
});
test('unknown operation is rejected loudly', () => {
  assert.throws(() => applyOperations(miniXML, [{ op: 'explode' }]), /unknown edit operation/);
});
test('concatScores joins measures and renumbers', () => {
  const { xml } = concatScores(miniXML, miniXML);
  assert.equal(partCount(xml), 1);
  const numbers = [...xml.matchAll(/<measure number="(\d+)"/g)].map((m) => m[1]);
  assert.deepEqual(numbers, ['1', '2', '3', '4', '5', '6']);
});

if (failures.length) {
  console.log(`${failures.length} test(s) failed, ${passed} passed`);
  process.exit(1);
}
console.log(`all ${passed} tests passed`);
