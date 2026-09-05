/* dev-planset-test.cjs — VECTOR PLAN SET → MODEL SPEC (planset.cjs).
   Pure, no network, no PDF: a synthetic sheet in the exact shape
   planset-pdf.cjs emits (lines/texts in points, y-down) — a 30×20 ft
   house drawn CAD-style with layered wall lines, one interior wall,
   a door gap with its mark, a window glass pair with its mark, the
   two schedules, an elevation datum stack, a roof-plan pitch flag
   and an exterior finish note. Asserts the whole chain: drawings,
   scale, walls, closed outline, openings from marks + schedules,
   storey height, pitch, finishes, report honesty.
   Run: node dev-planset-test.cjs */
'use strict';
const P = require('./planset.cjs');
let pass = 0, total = 0;
const ok = (name, cond, detail) => { total++; if (cond) { pass++; console.log('  ok  ' + name); } else { console.log('  FAIL ' + name + (detail != null ? ' -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); } };

console.log('--- 1. parsers ---');
ok("19'-8\" = 236", P.parseLength("19'-8\"") === 236);
ok("10' = 120", P.parseLength("10'") === 120);
ok('38" = 38', P.parseLength('38"') === 38);
ok('91 5/8" = 91.625', P.parseLength('91 5/8"') === 91.625);
ok("1'-1\" = 13", P.parseLength("1'-1\"") === 13);
ok('plain words are not lengths', P.parseLength('LIVING') === null && P.parseLength('6 : 12') === null);
ok('3068 → 36 × 80', JSON.stringify(P.parseSizeCode('3068')) === JSON.stringify({ width: 36, height: 80, code: '' }));
ok('12068 → 144 × 80 (garage)', P.parseSizeCode('12068').width === 144);
ok('6050SH → 72 × 60 single hung', P.parseSizeCode('6050SH').width === 72 && P.WINDOW_CODE[P.parseSizeCode('6050SH').code] === 'single_hung');
ok('3016FX → fixed', P.WINDOW_CODE[P.parseSizeCode('3016FX').code] === 'picture');
ok('Scale: 1/4" = 1\' → 2/3 in per pt', Math.abs(P.parseScale('Scale: 1/4" = 1\'') - 48 / 72) < 1e-9);
ok('1/8" = 1\'-0" → 4/3 in per pt', Math.abs(P.parseScale('1/8" = 1\'-0"') - 96 / 72) < 1e-9);
ok('6 : 12 pitch', P.parsePitch('6 : 12') === 6 && P.parsePitch('4/12') === 4);
ok('marks: "(N) D05" → D5, "W01" → W1, "D-3" → D3', P.markOf('(N) D05') === 'D5' && P.markOf('W01') === 'W1' && P.markOf('D-3') === 'D3');
ok('titles classify', P.kindOfTitle('Proposed 1st Floor Plan') === 'floor' && P.kindOfTitle('North Elevation') === 'elevation' && P.kindOfTitle('Roof Plan') === 'roof' && P.kindOfTitle('Building Section') === 'section');
ok('level index from title', P.levelIndexOfTitle('Proposed 2nd Floor Plan') === 1 && P.levelIndexOfTitle('Basement Plan') === -1 && P.levelIndexOfTitle('Main Floor Plan') === 0);

/* ---------- synthetic sheet ----------
   1/4" = 1' → 1 pt = 2/3 in → 1 in = 1.5 pt. House 30x20 ft, exterior 2x6
   (stud faces 5.5" apart = 8.25 pt) with cladding line 1" outside and drywall
   line 0.5" inside (the layer stack). Origin of the stud centreline box at
   (400,300) pt, running to (400+540, 300+360). */
const K = 1.5;  // pt per inch
const lines = [], texts = [];
const L = (x1, y1, x2, y2, w) => lines.push({ x1, y1, x2, y2, w: w == null ? 0.75 : w, c: [0, 0, 0] });
const T = (s, x, y, size) => texts.push({ s, x, y, w: s.length * (size || 12) * 0.5, h: size || 12, size: size || 12, dx: 1, dy: 0 });
const X0 = 400, Y0 = 300, X1 = 400 + 360 * K, Y1 = 300 + 240 * K;   // centreline box, 30x20 ft
const half = 2.75 * K;
// exterior walls as layer stacks: offsets from the centreline (inches → pt)
const offs = [-3.75, -2.75, 2.75, 3.25];
const box = (x0, y0, x1, y1, gapX) => {
  for (const o of offs) {
    const d = o * K;
    // north wall y0 (with a window at gapX+ [60..96 in] → glass lines only; faces continue)
    L(x0 - Math.abs(d), y0 + d, x1 + Math.abs(d), y0 + d);
    // south wall y1 with a DOOR gap 36" wide at 120..156 in from x0
    const gA = x0 + 120 * K, gB = x0 + 156 * K;
    L(x0 - Math.abs(d), y1 - d, gA, y1 - d); L(gB, y1 - d, x1 + Math.abs(d), y1 - d);
    // west / east
    L(x0 + d, y0 - Math.abs(d), x0 + d, y1 + Math.abs(d));
    L(x1 - d, y0 - Math.abs(d), x1 - d, y1 + Math.abs(d));
  }
  void gapX;
};
box(X0, Y0, X1, Y1);
// door swing at the south gap (short off-axis segments approximating an arc) + mark
for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI / 2, b = ((i + 1) / 8) * Math.PI / 2; L(X0 + 120 * K + Math.sin(a) * 36 * K, Y1 - Math.cos(a) * 36 * K, X0 + 120 * K + Math.sin(b) * 36 * K, Y1 - Math.cos(b) * 36 * K); }
T('(N) D01', X0 + 128 * K, Y1 - 12 * K, 6);
// window on the north wall: glass pair inside the band from 60" to 96" + jambs, mark above
const wa = X0 + 60 * K, wb = X0 + 96 * K;
L(wa, Y0 - 0.5 * K, wb, Y0 - 0.5 * K); L(wa, Y0 + 0.5 * K, wb, Y0 + 0.5 * K);
L(wa, Y0 - half, wa, Y0 + half); L(wb, Y0 - half, wb, Y0 + half);
T('(N) W01', X0 + 66 * K, Y0 - 8 * K, 6);
// interior 2x4 wall (drywall faces 4.5" apart) from the north wall down to the south wall at x = 180"
const ix = X0 + 180 * K;
L(ix - 2.25 * K, Y0, ix - 2.25 * K, Y1); L(ix + 2.25 * K, Y0, ix + 2.25 * K, Y1);
// room labels + dimension string
T('LIVING', X0 + 60 * K, Y0 + 120 * K, 12); T('BEDROOM', X0 + 250 * K, Y0 + 120 * K, 12);
T("30'-0\"", X0 + 160 * K, Y0 - 30 * K, 12);
// title + scale under the plan
T('First Floor Plan', X0 + 100 * K, Y1 + 60 * K, 25);
T('Scale: 1/4" = 1\'', X0 + 100 * K, Y1 + 76 * K, 12);
// schedules (left of the plan)
T('DOOR SCHEDULE', 60, 80, 12);
T('(N) D01', 60, 100, 8); T('3068', 140, 100, 8); T('1', 200, 100, 8); T('NEW', 240, 100, 8);
T('WINDOW SCHEDULE', 60, 160, 12);
T('(N) W01', 60, 180, 8); T('3050SH', 140, 180, 8); T('1', 200, 180, 8); T('NEW', 240, 180, 8); T('32"', 280, 180, 8); T('92"', 320, 180, 8);
// exterior schedule note
T('New Exterior Schedule', 60, 240, 12); T('- New lap siding (Hardie)', 60, 256, 9); T('- New class "A" asphalt shingle roofing', 60, 270, 9);
const sheetPlan = { index: 0, width: 2592, height: 1728, lines, curves: [], fills: [], texts, images: 0 };

// elevation sheet: datum stack + pitch flag under a title
const eLines = [], eTexts = [];
const ET = (s, x, y, size) => eTexts.push({ s, x, y, w: s.length * (size || 12) * 0.5, h: size || 12, size: size || 12, dx: 1, dy: 0 });
eLines.push({ x1: 300, y1: 700, x2: 1200, y2: 700, w: 0.75, c: [0, 0, 0] });
ET('Grade Level', 100, 700, 12); ET("0'", 120, 714, 12);
ET('Finish Floor', 100, 660, 12); ET("1'", 120, 674, 12);
ET('Ceiling Height', 100, 520, 12); ET("10'", 120, 534, 12);
ET('Highest Ridge', 100, 400, 12); ET("22'-6\"", 120, 414, 12);
ET('6 : 12', 700, 450, 10);
ET('North Elevation', 600, 760, 25); ET('Scale: 1/4" = 1\'', 600, 776, 12);
const sheetElev = { index: 1, width: 2592, height: 1728, lines: eLines, curves: [], fills: [], texts: eTexts, images: 0 };

console.log('--- 2. drawings + scale ---');
const dr = P.findDrawings(sheetPlan);
ok('one floor plan drawing found', dr.length === 1 && dr[0].kind === 'floor', dr.map((d) => d.kind));
ok('scale read from the note beside the title', dr[0] && Math.abs(dr[0].scale - 1 / K) < 1e-9, dr[0] && dr[0].scale);
ok('elevation drawing found', P.findDrawings(sheetElev).some((d) => d.kind === 'elevation'));

console.log('--- 3. the whole chain ---');
const spec = P.buildPlanSet({ pages: 2, sheets: [sheetPlan, sheetElev] });
const lv = spec.levels[0];
ok('one level', spec.levels.length === 1, spec.levels.length);
ok('exterior outline closed', lv && lv.loopClosed === true);
ok('footprint 30 × 20 ft on the centreline', lv && Math.abs(lv.footprint.w - 360) < 2 && Math.abs(lv.footprint.h - 240) < 2, lv && lv.footprint);
ok('4 exterior walls, 2x6', lv && lv.walls.filter((w) => w.ext).length === 4 && lv.walls.filter((w) => w.ext).every((w) => w.type === 'ext2x6'), lv && lv.walls.filter((w) => w.ext).map((w) => w.type));
ok('the interior wall is 2x4 and not exterior', lv && lv.walls.some((w) => !w.ext && w.type === 'int2x4'), lv && lv.walls.map((w) => w.type));
const door = lv && lv.openings.find((o) => o.kind === 'door');
const win = lv && lv.openings.find((o) => o.kind === 'window');
ok('door D1 found, 36" from the schedule', !!door && door.mark === 'D1' && door.width === 36 && door.height === 80, door);
ok('window W1 found, 36 × 60 single hung, sill 32", head 92"', !!win && win.mark === 'W1' && win.width === 36 && win.winType === 'single_hung' && win.sill === 32 && win.height === 60, win);
ok('room labels read', lv && lv.labels.map((l) => l.text).sort().join(',') === 'BEDROOM,LIVING', lv && lv.labels);
ok('storey height 9\'-0" from Ceiling Height − Finish Floor', lv && lv.height === 108, lv && lv.height);
ok('finish floor 1\'-0"', lv && lv.finishFloor === 12);
ok('roof pitch 6:12 and ridge 22\'-6"', spec.roof.pitch === 6 && spec.roof.ridge === 270, spec.roof);
ok('finishes: lap siding + asphalt shingle', spec.surfaces.exteriorWall === 'lap_white' && spec.surfaces.roof === 'shingle_charcoal', spec.surfaces);
ok('schedules parsed', spec.schedules.doors.length === 1 && spec.schedules.windows.length === 1);
ok('report lists no missing marks', !spec.report.warnings.some((w) => /did not land|not beside/.test(w)), spec.report.warnings);

console.log('--- 4. honesty ---');
const noScale = { index: 0, width: 2592, height: 1728, lines, curves: [], fills: [], texts: texts.filter((t) => !/scale/i.test(t.s)), images: 0 };
const s2 = P.buildPlanSet({ pages: 1, sheets: [noScale] });
ok('no scale note → no level, a warning says why', s2.levels.length === 0 && s2.report.warnings.some((w) => /Scale/.test(w)), s2.report.warnings);
const empty = P.buildPlanSet({ pages: 1, sheets: [{ index: 0, width: 100, height: 100, lines: [], curves: [], fills: [], texts: [], images: 0 }] });
ok('empty sheet → no floor plan recognised', empty.levels.length === 0 && empty.report.warnings.some((w) => /no floor plan/i.test(w)));

console.log('\n' + pass + '/' + total + ' planset checks pass');
if (pass !== total) process.exit(1);
console.log('OK');
