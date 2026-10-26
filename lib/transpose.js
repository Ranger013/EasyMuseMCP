// Pitch transposition performed on MusicXML text, so it works for scores that
// were never written in this DSL.
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SHARP_SPELL = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_SPELL = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function transposeMusicXML(xml, semitones, { fifthsShift } = {}) {
  const useFlats = /<fifths>-\d+<\/fifths>/.test(xml);
  const out = xml.replace(/<pitch>\s*<step>([A-G])<\/step>\s*(?:<alter>(-?\d+)<\/alter>\s*)?<octave>(-?\d+)<\/octave>\s*<\/pitch>/g, (all, step, alter, oct) => {
    const midi = (parseInt(oct, 10) + 1) * 12 + SEMI[step] + (parseInt(alter || '0', 10));
    const nm = midi + semitones;
    const octave = Math.floor(nm / 12) - 1;
    const pc = ((nm % 12) + 12) % 12;
    const name = (useFlats ? FLAT_SPELL : SHARP_SPELL)[pc];
    const letter = name[0];
    const acc = name.length > 1 ? (name[1] === '#' ? 1 : -1) : 0;
    return `<pitch><step>${letter}</step>${acc ? `<alter>${acc}</alter>` : ''}<octave>${octave}</octave></pitch>`;
  });
  let res = out;
  if (fifthsShift) {
    res = res.replace(/<fifths>(-?\d+)<\/fifths>/g, (a, v) => {
      let nv = parseInt(v, 10) + fifthsShift;
      nv = Math.max(-7, Math.min(7, nv));
      return `<fifths>${nv}</fifths>`;
    });
  }
  // accidentals may now disagree with pitches; drop them and let the importer re-derive
  res = res.replace(/<accidental>[^<]*<\/accidental>/g, '');
  return res;
}

