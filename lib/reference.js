// The notation cheat sheet returned by `msc ref` and the MCP tool of the same name.
export const DSL_REFERENCE = `
════════════════════════════════════════════════════════════════════
  SCORE DSL — compact text notation (UTF-8, one token stream per line)
════════════════════════════════════════════════════════════════════

HEADER (once, before the first part)
  title: 小星星            subtitle: 变奏
  composer: 佚名           lyricist: 佚名
  key: C | G | D | A | E | B | F# | F | Bb | Eb | Ab ...
  key: Am | Em | Bm | F#m | Dm | Gm | Cm ...            (trailing m = minor)
  time: 4/4                tempo: 96        (or tempo: 行板 for a word-only mark)
  pickup: 1/4              (anacrusis length for measure 1)
  systems: 4               (measures per system; controls page layout)

PAGE / STYLE
  page: A4 | A5 | A3 | letter | legal | 210x297
  margins: 15              (mm; also "12,18" = vertical,horizontal, or "t,r,b,l")
  scaling: 7               (mm per staff space — bigger = larger notes)
  staff-distance: 165      (tenths between staves of a 2-staff part)
  system-distance: 140     (tenths between systems)
  style: /path/to/file.mss (a MuseScore style exported from Format ▸ Save Style)

PARTS
  part "Piano" instrument=piano staves=2 clefs=treble,bass
  part "Violin" instrument=violin clef=treble
  instruments: piano organ harpsichord guitar violin viola cello contrabass harp
               choir voice trumpet trombone tuba horn sax flute oboe clarinet
               bassoon timpani
  voices 1 | voices 2       switch voice (staves=2 → staff 1 / staff 2)

NOTES        <pitch>/<duration>      e.g.  C5/4   F#4/8   Bb3/2   C4/1
  pitch     letter A-G + optional accidental (#, ##, b, bb, n) + octave number
            C4 = middle C, C3 one octave lower, C5 one octave higher
  duration  1=whole 2=half 4=quarter 8=eighth 16=16th 32=32nd 64=64th
            add . for dotted, .. for double dotted      C5/4.  = dotted quarter
CHORD        [C4 E4 G4]/4      (space or comma separated)
REST         r/4               R  = whole-measure rest
TIE          C5/2~  C5/2       trailing ~ ties into the next same pitch
SLUR         (C5/4 D5/4)       parenthesis open/close a slur
TUPLET       T3{ C5/8 D5/8 E5/8 }     also T5{...} T7{...} (written durations inside)
BARLINE      |     ||     |]     |:  ...  :|     :|:

MARKS        appended to a note, comma separated
  %stacc  %staccissimo  %accent  %tenuto  %marcato  %breath  %upbow  %downbow
  %trill  %mordent  %inv-mordent  %turn  %inv-turn  %tremolo
  %fermata
  C5/4%stacc,accent      F#5/2%trill      G4/1%fermata

GRACE NOTE   gD5/16 (slashed grace)      g[C5 E5]/16 (grace chord)
DYNAMIC      C5/4!mf           !pp !p !mp !mf !f !ff !sf !fp
LYRIC        C5/4"一"          quoted syllable; end with - when the word continues

DIRECTIONS   standalone tokens (they take no time)
  %ped  %ped-up  %ped-change        sustain pedal on / off / change
  %cresc  %dim  %wedge-stop         hairpins

MID-SCORE CHANGES   standalone tokens, placed at the measure they belong to
  @time=3/4        @key=Eb        @tempo=120        @tempo-text=rit.
  (write them right after a "|" so they land at the start of a measure)

EXAMPLE
  title: 月光如水
  key: G
  time: 3/4
  tempo: 96
  systems: 4

  part "Piano" instrument=piano staves=2 clefs=treble,bass
  voices 1
  B4/2"月" D5/4"光" | E5/2"如" D5/4"水" |
  voices 2
  %ped G2/4 [B2 D3 G3]/4 [B2 D3 G3]/4 | %ped-up C3/4 [E3 G3 C4]/4 [E3 G3 C4]/4 |

RULES OF THUMB
  · every measure must add up to the time signature — the tool reports overfull
    measures and pads short ones with rests (watch the warnings)
  · pitch and duration are always separated by "/" — no bare notes
  · grace notes and directions do not count towards the measure length
  · use one line per voice; keep measures separated by "|"
`;
