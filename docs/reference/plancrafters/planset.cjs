/* ============================================================
   PlanCrafters — planset.cjs  (pure, dependency-free, tested)
   VECTOR PLAN SET → MODEL SPEC.
   Input: the sheets planset-pdf.cjs extracted (lines / curves /
   fills / texts in PDF points, y-down). Output: a plan spec the
   studio applies with HA.planset.apply — levels with wall
   centerlines (inches, plan axes: x east, y south), openings with
   schedule sizes + heights, room labels, level heights, roof
   pitch, exterior finishes — plus a report of what was read, what
   was assumed, and what could not be read. Nothing here guesses
   silently: every assumption lands in report.assumptions and every
   miss in report.warnings.

   HOW A SHEET IS READ
   1. DRAWINGS — a big title ("Proposed 1st Floor Plan", "North
      Elevation", "Roof Plan") sits UNDER its drawing. Its region is
      the sheet rectangle between the neighbouring titles (left /
      right on the same row, the next title above), which is how
      a drafter lays sheets out; sheet-border lines are ignored.
      "Scale: 1/4" = 1'" next to the title gives inches per point.
   2. FLOOR PLAN — CAD plans draw every wall LAYER (cladding,
      sheathing, stud faces, drywall) as its own parallel line.
      Parallel dark strokes 3–13" apart pair into candidate walls,
      stud-sized gaps (3½" / 5½") first; a stack of near-coincident
      candidates is ONE wall at the stud pair's centre. Collinear
      runs merge across junction breaks and across door-sized
      breaks; corners snap; unconnected pairs (dimension lines,
      table rules) fall away. The exterior loop is the outer walk
      of the thick-wall graph. DOORS: both faces missing for
      18–144" (a swing arc confirms); WINDOWS: the glass-line pair
      drawn inside the wall band, mulled units merged. The nearest
      mark "(N) D05" / "W01" names an opening; the schedule sizes it.
   3. SCHEDULES — DOOR SCHEDULE rows "D05 3068" (3'-0" x 6'-8");
      WINDOW SCHEDULE rows "W07 3050SH 32" 92"" (3'-0" x 5'-0",
      single hung, sill 32", head 92").
   4. ELEVATIONS — datum stacks "Finish Floor / 11'-4"", "Ceiling
      Height / 20'-5"", "Highest Ridge / 42'-11"", pitch flags
      "6 : 12", finish notes.
   5. ROOF PLAN — pitch flags (the mode wins).
   ============================================================ */
'use strict';

/* ---------------- units + parsing ---------------- */
const frac = (x) => {
  const m = String(x).trim().match(/^(\d+)?\s*(?:(\d+)\/(\d+))?$/);
  if (!m || (!m[1] && !m[2])) return null;
  return (m[1] ? parseFloat(m[1]) : 0) + (m[2] ? parseFloat(m[2]) / parseFloat(m[3]) : 0);
};
/* "19'-8"" → 236, "10'" → 120, "38"" → 38, "91 5/8"" → 91.625, "1'-1"" → 13. null when not a length. */
const parseLength = (s) => {
  const t = String(s || '').replace(/[“”″]/g, '"').replace(/[‘’′]/g, "'").trim();
  if (!t || !/\d/.test(t)) return null;
  let m = t.match(/^(-?\d+)\s*'\s*-?\s*(?:(\d+(?:\s+\d+\/\d+)?|\d+\/\d+)\s*"?)?$/);
  if (m) { const inch = m[2] ? frac(m[2]) : 0; const ft = parseFloat(m[1]); return ft * 12 + (inch || 0) * (ft < 0 ? -1 : 1); }
  m = t.match(/^(\d+(?:\s+\d+\/\d+)?|\d+\/\d+)\s*"$/);
  if (m) return frac(m[1]);
  return null;
};
const isLengthText = (s) => parseLength(s) != null;
/* schedule size codes: "3068" → 36 x 80; "2668" → 30 x 80; "12068" → 144 x 80; "6050SH" → 72 x 60 + type */
const parseSizeCode = (s) => {
  const m = String(s || '').trim().toUpperCase().match(/^(\d{4,5})\s*([A-Z]{1,3})?$/);
  if (!m) return null;
  const d = m[1];
  let wf, wi, hf, hi;
  if (d.length === 4) { wf = +d[0]; wi = +d[1]; hf = +d[2]; hi = +d[3]; }
  else { wf = +d.slice(0, 2); wi = +d[2]; hf = +d[3]; hi = +d[4]; }
  if (wi > 9 || hi > 9 || wf === 0 || hf === 0) return null;
  return { width: wf * 12 + wi, height: hf * 12 + hi, code: m[2] || '' };
};
const WINDOW_CODE = { SH: 'single_hung', DH: 'double_hung', SL: 'slider', LS: 'slider', RS: 'slider', XO: 'slider', OX: 'slider', XOX: 'slider',
  CS: 'casement', CA: 'casement', C: 'casement', TC: 'casement', AW: 'awning', A: 'awning', FX: 'picture', FIX: 'picture', PW: 'picture', P: 'picture' };
const parsePitch = (s) => {
  const m = String(s || '').match(/^\s*(\d+(?:\.\d+)?)\s*(?::|\/|in)\s*12\s*$/i);
  return m ? parseFloat(m[1]) : null;
};
/* "Scale: 1/4" = 1'" → inches of building per PDF point */
const parseScale = (s) => {
  const t = String(s || '').replace(/[“”″]/g, '"').replace(/[‘’′]/g, "'");
  let m = t.match(/(\d+(?:\/\d+)?)\s*"\s*=\s*(\d+)\s*'\s*-?\s*(\d+)?\s*"?/);
  if (m) {
    const paper = m[1].includes('/') ? (+m[1].split('/')[0] / +m[1].split('/')[1]) : +m[1];
    const real = (+m[2]) * 12 + (m[3] ? +m[3] : 0);
    if (paper > 0 && real > 0) return real / paper / 72;
  }
  m = t.match(/(\d+)\s*"\s*=\s*(\d+)\s*"/);
  if (m && +m[1] > 0) return (+m[2]) / (+m[1]) / 72;
  m = t.match(/\b1\s*:\s*(\d+)\b/);
  if (m && +m[1] > 0) return (+m[1]) / 72;
  return null;
};

/* ---------------- small geometry ---------------- */
const bboxOf = (pts) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
};
const rectContains = (r, x, y, pad) => x >= r.x0 - (pad || 0) && x <= r.x1 + (pad || 0) && y >= r.y0 - (pad || 0) && y <= r.y1 + (pad || 0);
const textBox = (t) => {
  const w = t.w || 0, h = t.h || t.size || 0;
  const horiz = Math.abs(t.dx == null ? 1 : t.dx) >= 0.7;
  if (horiz) return { x0: t.x, y0: t.y - h, x1: t.x + w, y1: t.y };
  const up = (t.dy || 0) < 0;
  return up ? { x0: t.x - h, y0: t.y - w, x1: t.x, y1: t.y } : { x0: t.x, y0: t.y, x1: t.x + h, y1: t.y + w };
};
const textCenter = (t) => { const b = textBox(t); return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }; };
const isDark = (c) => !c || !Array.isArray(c) || (c[0] <= 0.55 && c[1] <= 0.55 && c[2] <= 0.55);
const polyArea = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a) / 2; };

/* ---------------- 1. drawings on a sheet ---------------- */
const TITLE_RE = /\b(floor plan|elevation|roof plan|site plan|building section|section|foundation plan|framing plan|electrical plan|plumbing plan|reflected ceiling|detail|plan)\b/i;
const kindOfTitle = (s) => {
  const t = s.toLowerCase();
  if (/floor plan/.test(t) || (/\bplan\b/.test(t) && /(floor|level|story|storey|basement|main|upper|lower|1st|2nd|3rd|first|second|third)/.test(t))) return 'floor';
  if (/roof plan/.test(t)) return 'roof';
  if (/elevation/.test(t) && !/finish(ed)? floor|flood|grade/.test(t)) return 'elevation';
  if (/site plan|plot plan/.test(t)) return 'site';
  if (/section/.test(t)) return 'section';
  if (/foundation/.test(t)) return 'foundation';
  if (/electrical|plumbing|framing|ceiling|detail/.test(t)) return 'other';
  return 'other';
};
const levelIndexOfTitle = (s) => {
  const t = s.toLowerCase();
  if (/basement|cellar/.test(t)) return -1;
  const m = t.match(/(\d+)(?:st|nd|rd|th)?\s*(?:floor|level|story|storey)/) || t.match(/(?:floor|level|story|storey)\s*(\d+)/);
  if (m) return parseInt(m[1], 10) - 1;
  if (/first|main|ground|lower/.test(t)) return 0;
  if (/second|upper/.test(t)) return 1;
  if (/third/.test(t)) return 2;
  return 0;
};

/* title-neighbour regions: between the titles left/right on the same row, up to the title above */
function findDrawings(sheet) {
  const titles = sheet.texts.filter((t) => t.size >= 14 && TITLE_RE.test(t.s) && !/^scale/i.test(t.s) && kindOfTitle(t.s) !== 'other');
  const boxes = titles.map((t) => ({ t, b: textBox(t), cx: (textBox(t).x0 + textBox(t).x1) / 2 }));
  const out = [];
  for (const cur of boxes) {
    let x0 = 0, x1 = sheet.width, y0 = 0;
    for (const o of boxes) {
      if (o === cur) continue;
      const sameRow = Math.abs(o.b.y1 - cur.b.y1) < 220;
      if (sameRow) {
        const mid = (o.cx + cur.cx) / 2;
        if (o.cx < cur.cx) x0 = Math.max(x0, mid); else x1 = Math.min(x1, mid);
      }
    }
    for (const o of boxes) {
      if (o === cur) continue;
      const above = o.b.y1 < cur.b.y0 - 40;
      const overlapsX = o.b.x1 > x0 && o.b.x0 < x1;
      if (above && overlapsX) y0 = Math.max(y0, o.b.y1 + 4);
    }
    const region = { x0, y0, x1, y1: cur.b.y0 - 2 };
    let scale = null, scaleText = null, best = Infinity;
    for (const s of sheet.texts) {
      if (!/scale/i.test(s.s)) continue;
      const sc = parseScale(s.s);
      if (!sc) continue;
      const d = Math.hypot(s.x - cur.b.x0, s.y - cur.b.y1);
      if (d < best && d < 260) { best = d; scale = sc; scaleText = s.s; }
    }
    const kind = kindOfTitle(cur.t.s);
    out.push({ kind, title: cur.t.s.trim(), titleBox: cur.b, region, scale, scaleText, levelIndex: kind === 'floor' ? levelIndexOfTitle(cur.t.s) : null });
  }
  return out;
}

/* ---------------- 2. floor plan geometry ---------------- */
/* Axis-aligned dark strokes inside the region, sheet borders dropped; the dominant heavy class is the wall class. */
function wallFaceLines(sheet, region) {
  const cand = [];
  const maxLen = Math.max(sheet.width, sheet.height) * 0.6;
  for (const l of sheet.lines) {
    if (!rectContains(region, l.x1, l.y1, 2) || !rectContains(region, l.x2, l.y2, 2)) continue;
    if (!isDark(l.c)) continue;
    const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
    if (len > maxLen) continue;   // sheet border / title-block rule
    const horiz = Math.abs(l.y1 - l.y2) < 0.35 && Math.abs(l.x1 - l.x2) >= 1.5;
    const vert = Math.abs(l.x1 - l.x2) < 0.35 && Math.abs(l.y1 - l.y2) >= 1.5;
    if (!horiz && !vert) continue;
    cand.push({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, w: l.w || 0, horiz });
  }
  const byW = new Map();
  for (const l of cand) { if (l.w <= 0.3) continue; const L = Math.hypot(l.x2 - l.x1, l.y2 - l.y1); byW.set(l.w, (byW.get(l.w) || 0) + L); }
  let wallW = null, bestLen = 0;
  for (const [w, L] of byW) if (L > bestLen) { bestLen = L; wallW = w; }
  const faces = wallW == null ? cand : cand.filter((l) => Math.abs(l.w - wallW) < 0.26);
  return { faces, wallW, all: cand };
}

/* merge collinear, overlapping/touching axis-aligned segments (units of the input) */
function mergeCollinear(segs, tol, along) {
  const joinTol = along == null ? tol : along;
  const out = [];
  const groups = new Map();
  for (const s of segs) {
    const key = (s.horiz ? 'h' : 'v') + ':' + Math.round((s.horiz ? s.y1 : s.x1) / tol);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  for (const [, g] of groups) {
    const items = g.map((s) => s.horiz ? { a: Math.min(s.x1, s.x2), b: Math.max(s.x1, s.x2), c: s.y1, horiz: true, w: s.w } : { a: Math.min(s.y1, s.y2), b: Math.max(s.y1, s.y2), c: s.x1, horiz: false, w: s.w });
    items.sort((p, q) => p.a - q.a);
    let cur = null;
    for (const it of items) {
      if (cur && it.a <= cur.b + joinTol) { if (it.a > cur.b + 0.2) { cur.gap += it.a - cur.b; cur.n++; } cur.b = Math.max(cur.b, it.b); }
      else { if (cur) out.push(cur); cur = Object.assign({ n: 1, gap: 0 }, it); }
    }
    if (cur) out.push(cur);
  }
  return out.map((it) => it.horiz ? { x1: it.a, y1: it.c, x2: it.b, y2: it.c, horiz: true, w: it.w, n: it.n, gap: it.gap } : { x1: it.c, y1: it.a, x2: it.c, y2: it.b, horiz: false, w: it.w, n: it.n, gap: it.gap });
}
/* a run made of many short pieces with regular gaps is a DASHED line (overhang, floor-above, hidden edge) */
const isDashed = (m) => { const len = m.horiz ? m.x2 - m.x1 : m.y2 - m.y1; return m.n >= 4 && m.gap > 0.12 * len && (len / m.n) < 14; };
/* GLASS LINES: two parallel lines 0.5–2.5" apart with the same extent — a window symbol, never a wall */
function findGlassPairs(lines, k) {
  const glass = new Set();
  const byDir = { h: lines.filter((f) => f.horiz), v: lines.filter((f) => !f.horiz) };
  for (const dir of ['h', 'v']) {
    const list = byDir[dir];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const gap = Math.abs((dir === 'h' ? a.y1 - b.y1 : a.x1 - b.x1)) * k;
      if (gap < 0.5 || gap > 2.6) continue;
      const a0 = dir === 'h' ? a.x1 : a.y1, a1 = dir === 'h' ? a.x2 : a.y2, b0 = dir === 'h' ? b.x1 : b.y1, b1 = dir === 'h' ? b.x2 : b.y2;
      const len = (a1 - a0) * k;
      if (len < 8 || len > 150) continue;
      if (Math.abs(a0 - b0) * k > 2.5 || Math.abs(a1 - b1) * k > 2.5) continue;
      glass.add(a); glass.add(b);
    }
  }
  return glass;
}
/* snap every wall endpoint to the centroid of its cluster (endpoints within tol), so corners share exact coordinates */
function snapNodes(walls, tol) {
  const pts = [];
  walls.forEach((w, i) => { pts.push({ w, end: 0, x: w.x1, y: w.y1 }); pts.push({ w, end: 1, x: w.x2, y: w.y2 }); });
  const parent = pts.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    if (Math.abs(pts[i].x - pts[j].x) <= tol && Math.abs(pts[i].y - pts[j].y) <= tol) parent[find(i)] = find(j);
  }
  const groups = new Map();
  pts.forEach((p, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
  for (const g of groups.values()) {
    let sx = 0, sy = 0; for (const p of g) { sx += p.x; sy += p.y; }
    const cx = Math.round(sx / g.length * 4) / 4, cy = Math.round(sy / g.length * 4) / 4;
    for (const p of g) { if (p.end === 0) { p.w.x1 = cx; p.w.y1 = cy; } else { p.w.x2 = cx; p.w.y2 = cy; } }
  }
  return walls;
}
/* bridge collinear same-class walls across a break of ≤ maxGap when allow(gapMid) says an opening sits there */
function bridgeWalls(walls, maxGap, allow) {
  const cls = (t) => (t >= 4.5 ? 'x' : 'i');
  const out = [];
  const groups = new Map();
  for (const w of walls) {
    const key = cls(w.t) + (w.horiz ? 'h' : 'v') + ':' + Math.round((w.horiz ? w.y1 : w.x1) / 1.0);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }
  for (const [, g] of groups) {
    const items = g.map((w) => ({ w, a: w.horiz ? Math.min(w.x1, w.x2) : Math.min(w.y1, w.y2), b: w.horiz ? Math.max(w.x1, w.x2) : Math.max(w.y1, w.y2) })).sort((p, q) => p.a - q.a);
    let cur = items[0];
    for (let i = 1; i < items.length; i++) {
      const it = items[i];
      const gap = it.a - cur.b;
      const c = cur.w.horiz ? cur.w.y1 : cur.w.x1;
      const mid = (cur.b + it.a) / 2;
      if (gap <= maxGap && gap > -1 && allow(cur.w, gap, cur.w.horiz ? { x: mid, y: c } : { x: c, y: mid })) {
        cur = { w: Object.assign({}, cur.w, cur.w.horiz ? { x1: cur.a, x2: Math.max(cur.b, it.b), t: Math.max(cur.w.t, it.w.t) } : { y1: cur.a, y2: Math.max(cur.b, it.b), t: Math.max(cur.w.t, it.w.t) }), a: cur.a, b: Math.max(cur.b, it.b) };
      } else { out.push(cur.w); cur = it; }
    }
    if (cur) out.push(cur.w);
  }
  return out;
}

const STUDS = [3.5, 5.5];
const studScore = (t) => Math.min(...STUDS.map((s) => Math.abs(t - s)));

/* pair parallel faces → candidate walls (inches). Stud-sized gaps first, then the rest;
   each stretch of a face is claimed once. */
function pairFaces(faces, k, opts) {
  const minT = (opts && opts.minThickness) || 3.0, maxT = (opts && opts.maxThickness) || 13.5;
  const cands = [];
  const byDir = { h: faces.filter((f) => f.horiz), v: faces.filter((f) => !f.horiz) };
  for (const dir of ['h', 'v']) {
    const list = byDir[dir];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const aPos = dir === 'h' ? a.y1 : a.x1;
      const a0 = dir === 'h' ? a.x1 : a.y1, a1 = dir === 'h' ? a.x2 : a.y2;
      for (let j = 0; j < list.length; j++) {
        if (j === i) continue;
        const b = list[j];
        const bPos = dir === 'h' ? b.y1 : b.x1;
        const gap = (bPos - aPos) * k;
        if (gap < minT || gap > maxT) continue;
        const b0 = dir === 'h' ? b.x1 : b.y1, b1 = dir === 'h' ? b.x2 : b.y2;
        const o0 = Math.max(a0, b0), o1 = Math.min(a1, b1);
        const ov = (o1 - o0) * k;
        if (ov < 6) continue;
        cands.push({ dir, a, b, gap, o0, o1, ov, score: studScore(gap) });
      }
    }
  }
  cands.sort((p, q) => (p.score - q.score) || (p.gap - q.gap) || (q.ov - p.ov));
  const claimed = new Map();
  const free = (f, o0, o1) => { const iv = claimed.get(f) || []; return iv.every(([a, b]) => o1 <= a + 0.5 || o0 >= b - 0.5); };
  const claim = (f, o0, o1) => { if (!claimed.has(f)) claimed.set(f, []); claimed.get(f).push([o0, o1]); };
  const walls = [];
  for (const c of cands) {
    if (!free(c.a, c.o0, c.o1) || !free(c.b, c.o0, c.o1)) continue;
    claim(c.a, c.o0, c.o1); claim(c.b, c.o0, c.o1);
    const aPos = c.dir === 'h' ? c.a.y1 : c.a.x1, bPos = c.dir === 'h' ? c.b.y1 : c.b.x1;
    const mid = (aPos + bPos) / 2;
    walls.push(c.dir === 'h'
      ? { x1: c.o0 * k, y1: mid * k, x2: c.o1 * k, y2: mid * k, t: c.gap, horiz: true }
      : { x1: mid * k, y1: c.o0 * k, x2: mid * k, y2: c.o1 * k, t: c.gap, horiz: false });
  }
  return walls;
}

/* a stack of layer pairs at (nearly) the same centre is ONE wall: keep the stud-sized one */
function dedupeLayered(walls, centreTol) {
  const keep = [];
  const sorted = walls.slice().sort((p, q) => (studScore(p.t) - studScore(q.t)) || (q.t - p.t));
  for (const w of sorted) {
    const c = w.horiz ? w.y1 : w.x1;
    const a = w.horiz ? Math.min(w.x1, w.x2) : Math.min(w.y1, w.y2), b = w.horiz ? Math.max(w.x1, w.x2) : Math.max(w.y1, w.y2);
    let dup = false;
    for (const k of keep) {
      if (k.horiz !== w.horiz) continue;
      const kc = k.horiz ? k.y1 : k.x1;
      if (Math.abs(kc - c) > Math.max(centreTol, k.t / 2 + 0.75)) continue;
      const ka = k.horiz ? Math.min(k.x1, k.x2) : Math.min(k.y1, k.y2), kb = k.horiz ? Math.max(k.x1, k.x2) : Math.max(k.y1, k.y2);
      const ov = Math.min(b, kb) - Math.max(a, ka);
      if (ov > 6) { dup = true; k.layers = (k.layers || 1) + 1; break; }
    }
    if (!dup) { w.layers = w.layers || 1; keep.push(w); }
  }
  return keep;
}

/* join collinear walls of one class across small breaks (junctions) and door-sized breaks */
function mergeWalls(walls, tolIn, joinIn) {
  const cls = (t) => (t >= 4.5 ? 'x' : 'i');
  const out = [];
  for (const c of ['x', 'i']) {
    const sub = walls.filter((w) => cls(w.t) === c);
    const merged = mergeCollinear(sub.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, horiz: w.horiz, w: w.t })), tolIn, joinIn == null ? tolIn : joinIn);
    for (const m of merged) {
      const src = sub.filter((w) => w.horiz === m.horiz && Math.abs((w.horiz ? w.y1 : w.x1) - (m.horiz ? m.y1 : m.x1)) <= tolIn);
      const layers = src.reduce((mx, w) => Math.max(mx, w.layers || 1), 1);
      out.push({ x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2, horiz: m.horiz, t: m.w, layers });
    }
  }
  return out.filter((w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= 8);
}

/* extend/trim wall ends so perpendicular walls meet at their centerline crossing */
function snapCorners(walls, tolIn) {
  const H = walls.filter((w) => w.horiz), V = walls.filter((w) => !w.horiz);
  const adjust = (w, isH) => {
    const others = isH ? V : H;
    for (const end of ['a', 'b']) {
      const px = isH ? (end === 'a' ? w.x1 : w.x2) : w.x1;
      const py = isH ? w.y1 : (end === 'a' ? w.y1 : w.y2);
      let best = null, bd = tolIn;
      for (const o of others) {
        const cx = isH ? o.x1 : px, cy = isH ? py : o.y1;
        const reach = isH ? (cy >= Math.min(o.y1, o.y2) - tolIn && cy <= Math.max(o.y1, o.y2) + tolIn) : (cx >= Math.min(o.x1, o.x2) - tolIn && cx <= Math.max(o.x1, o.x2) + tolIn);
        if (!reach) continue;
        const d = Math.hypot(cx - px, cy - py);
        if (d < bd) { bd = d; best = { x: cx, y: cy, o }; }
      }
      if (best) {
        if (isH) { if (end === 'a') w.x1 = best.x; else w.x2 = best.x; }
        else { if (end === 'a') w.y1 = best.y; else w.y2 = best.y; }
        const o = best.o;
        if (isH) { if (Math.abs(o.y1 - best.y) < tolIn && o.y1 !== best.y) o.y1 = best.y; else if (Math.abs(o.y2 - best.y) < tolIn && o.y2 !== best.y) o.y2 = best.y; }
        else { if (Math.abs(o.x1 - best.x) < tolIn && o.x1 !== best.x) o.x1 = best.x; else if (Math.abs(o.x2 - best.x) < tolIn && o.x2 !== best.x) o.x2 = best.x; }
      }
    }
  };
  for (const w of H) adjust(w, true);
  for (const w of V) adjust(w, false);
  return walls;
}

/* connected components of the wall graph (endpoint on another wall within tol) */
function wallComponents(walls, tol) {
  const n = walls.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { parent[find(a)] = find(b); };
  const ends = (w) => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }];
  const onWall = (w, p) => {
    if (w.horiz) return Math.abs(p.y - w.y1) <= tol && p.x >= Math.min(w.x1, w.x2) - tol && p.x <= Math.max(w.x1, w.x2) + tol;
    return Math.abs(p.x - w.x1) <= tol && p.y >= Math.min(w.y1, w.y2) - tol && p.y <= Math.max(w.y1, w.y2) + tol;
  };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = walls[i], b = walls[j];
    let joined = false;
    for (const p of ends(a)) if (onWall(b, p)) { joined = true; break; }
    if (!joined) for (const p of ends(b)) if (onWall(a, p)) { joined = true; break; }
    if (joined) union(i, j);
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  return [...groups.values()];
}

/* exterior loop: the outer walk of the wall graph. Returns { pts, wallIdx, nodesByWall } */
function traceExteriorLoop(walls, snapIn) {
  const key = (x, y) => Math.round(x / snapIn) + ',' + Math.round(y / snapIn);
  const nodes = new Map();
  const nodePt = (x, y) => { const k = key(x, y); if (!nodes.has(k)) nodes.set(k, { x, y, edges: [] }); return nodes.get(k); };
  const edges = [];
  walls.forEach((w, i) => {
    const a = nodePt(w.x1, w.y1), b = nodePt(w.x2, w.y2);
    if (a === b) return;
    const e = { i, a, b };
    a.edges.push(e); b.edges.push(e); edges.push(e);
  });
  if (edges.length < 4) return null;
  let start = null;
  for (const n of nodes.values()) if (n.edges.length && (!start || n.y < start.y - 1e-6 || (Math.abs(n.y - start.y) < 1e-6 && n.x < start.x))) start = n;
  const angle = (from, to) => Math.atan2(to.y - from.y, to.x - from.x);
  const loop = [];
  let cur = start, prevAng = Math.PI, prevEdge = null;
  let guard = edges.length * 2 + 4;
  while (guard-- > 0) {
    let best = null, bestTurn = Infinity;
    for (const e of cur.edges) {
      if (e === prevEdge && cur.edges.length > 1) continue;
      const other = e.a === cur ? e.b : e.a;
      let turn = angle(cur, other) - (prevAng + Math.PI);
      while (turn <= 0) turn += 2 * Math.PI;
      while (turn > 2 * Math.PI) turn -= 2 * Math.PI;
      if (turn < bestTurn) { bestTurn = turn; best = { e, other }; }
    }
    if (!best) return null;
    loop.push(best.e);
    prevAng = angle(cur, best.other);
    prevEdge = best.e;
    cur = best.other;
    if (cur === start) break;
  }
  if (cur !== start || loop.length < 4) return null;
  const pts = [];
  let n = start;
  const ends = [];
  for (const e of loop) { pts.push({ x: n.x, y: n.y }); const m = e.a === n ? e.b : e.a; ends.push([n, m]); n = m; }
  if (polyArea(pts) < 100 * 144) return null;   // under 100 sq ft is a closet, not a building
  return { pts, wallIdx: loop.map((e) => e.i), ends };
}

/* OUTLINE BY RASTER: paint every wall band into a 3" grid, flood the outside in
   from the margin, and trace the boundary of what the flood could not reach —
   the building's true outer edge, closed by construction whatever the wall
   ends did. Each boundary run then snaps to the nearest parallel wall's
   centerline, so the exterior walls are the drawn walls, exactly joined. */
function outlineFromRaster(walls, cellIn) {
  const cell = cellIn || 3;
  let bb = bboxOf(walls.flatMap((w) => [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }]));
  const M = 24;
  const ox = bb.x0 - M, oy = bb.y0 - M;
  const W = Math.ceil((bb.w + 2 * M) / cell) + 1, H = Math.ceil((bb.h + 2 * M) / cell) + 1;
  const solid = new Uint8Array(W * H);
  for (const w of walls) {
    const half = Math.max(w.t / 2, 1.5);
    const x0 = Math.min(w.x1, w.x2) - (w.horiz ? 0 : half), x1 = Math.max(w.x1, w.x2) + (w.horiz ? 0 : half);
    const y0 = Math.min(w.y1, w.y2) - (w.horiz ? half : 0), y1 = Math.max(w.y1, w.y2) + (w.horiz ? half : 0);
    for (let cy = Math.floor((y0 - oy) / cell); cy <= Math.floor((y1 - oy) / cell); cy++) for (let cx = Math.floor((x0 - ox) / cell); cx <= Math.floor((x1 - ox) / cell); cx++) if (cx >= 0 && cy >= 0 && cx < W && cy < H) solid[cy * W + cx] = 1;
  }
  const outside = new Uint8Array(W * H);
  const stack = [0];
  outside[0] = 1;
  while (stack.length) {
    const i = stack.pop();
    const cx = i % W, cy = Math.floor(i / W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = cx + dx, yy = cy + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (outside[j] || solid[j]) continue;
      outside[j] = 1; stack.push(j);
    }
  }
  // boundary edges between an inside cell and an outside cell, chained into loops
  const edges = new Map();   // key "x,y" of edge start → end (directed so inside is on the left when y-down… we only need cycles)
  const add = (ax, ay, bx, by) => { edges.set(ax + ',' + ay + '>' + bx + ',' + by, [ax, ay, bx, by]); };
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    if (outside[cy * W + cx]) continue;
    if (cx === 0 || outside[cy * W + cx - 1]) add(cx, cy + 1, cx, cy);          // west edge
    if (cx === W - 1 || outside[cy * W + cx + 1]) add(cx + 1, cy, cx + 1, cy + 1); // east edge
    if (cy === 0 || outside[(cy - 1) * W + cx]) add(cx, cy, cx + 1, cy);          // north edge
    if (cy === H - 1 || outside[(cy + 1) * W + cx]) add(cx + 1, cy + 1, cx, cy + 1); // south edge
  }
  const byStart = new Map();
  for (const e of edges.values()) { const k = e[0] + ',' + e[1]; if (!byStart.has(k)) byStart.set(k, []); byStart.get(k).push(e); }
  const used = new Set();
  const loops = [];
  for (const e0 of edges.values()) {
    const k0 = e0.join(',');
    if (used.has(k0)) continue;
    const pts = [];
    let e = e0;
    let guard = edges.size + 2;
    while (e && guard-- > 0) {
      const kk = e.join(',');
      if (used.has(kk)) break;
      used.add(kk);
      pts.push([e[0], e[1]]);
      const nxt = (byStart.get(e[2] + ',' + e[3]) || []).find((x) => !used.has(x.join(',')));
      if (!nxt) break;
      e = nxt;
    }
    if (pts.length >= 4) loops.push(pts);
  }
  if (!loops.length) return null;
  const area = (pts) => polyArea(pts.map(([x, y]) => ({ x, y })));
  loops.sort((a, b) => area(b) - area(a));
  const best = loops[0];
  // simplify: keep direction changes only
  let simp = [];
  for (let i = 0; i < best.length; i++) {
    const p = best[(i - 1 + best.length) % best.length], c = best[i], n = best[(i + 1) % best.length];
    const d1 = [c[0] - p[0], c[1] - p[1]], d2 = [n[0] - c[0], n[1] - c[1]];
    if (d1[0] * d2[1] - d1[1] * d2[0] !== 0) simp.push(c);
  }
  // to inches
  let pts = simp.map(([x, y]) => ({ x: ox + x * cell, y: oy + y * cell }));
  // remove jogs shorter than a wall thickness (raster stair-steps at slightly off-axis walls)
  for (let pass = 0; pass < 6 && pts.length > 4; pass++) {
    let changed = false;
    for (let i = 0; i < pts.length && pts.length > 4; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 9) {
        // collapse the short edge onto its longer neighbour's line
        const prev = pts[(i - 1 + pts.length) % pts.length], next = pts[(i + 2) % pts.length];
        const horizEdge = Math.abs(b.y - a.y) < Math.abs(b.x - a.x);
        if (horizEdge) { const y = (a.y + b.y) / 2; a.y = y; b.y = y; } else { const x = (a.x + b.x) / 2; a.x = x; b.x = x; }
        void prev; void next;
        pts.splice(i, 2, { x: horizEdge ? (a.x + b.x) / 2 : a.x, y: horizEdge ? a.y : (a.y + b.y) / 2 });
        changed = true;
      }
    }
    // drop collinear vertices produced by the collapse
    pts = pts.filter((c, i) => { const p = pts[(i - 1 + pts.length) % pts.length], n = pts[(i + 1) % pts.length]; return Math.abs((c.x - p.x) * (n.y - c.y) - (c.y - p.y) * (n.x - c.x)) > 1e-6; });
    if (!changed) break;
  }
  return pts;
}

/* snap each outline edge to the nearest parallel wall centerline (within its band), then
   re-intersect consecutive edges so corners are exact. Returns loop walls. */
function outlineToWalls(outline, walls) {
  const edges = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const horiz = Math.abs(b.y - a.y) < Math.abs(b.x - a.x);
    const pos = horiz ? (a.y + b.y) / 2 : (a.x + b.x) / 2;
    const lo = horiz ? Math.min(a.x, b.x) : Math.min(a.y, b.y), hi = horiz ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    // the raster boundary sits on the OUTER face; the matching wall centerline is t/2 inside
    let best = null, bd = Infinity;
    for (const w of walls) {
      if (w.horiz !== horiz) continue;
      const wc = horiz ? w.y1 : w.x1;
      const wlo = horiz ? Math.min(w.x1, w.x2) : Math.min(w.y1, w.y2), whi = horiz ? Math.max(w.x1, w.x2) : Math.max(w.y1, w.y2);
      const ov = Math.min(hi, whi) - Math.max(lo, wlo);
      if (ov < Math.min(24, (hi - lo) * 0.5)) continue;
      const d = Math.abs(wc - pos);
      const score = d + ((w.layers || 1) >= 2 ? 0 : 2) + (studScore(w.t) < 0.3 && w.t >= 5 ? 0 : 2);
      if (d <= w.t / 2 + 3.5 && score < bd) { bd = score; best = w; }
    }
    edges.push({ horiz, pos: best ? (horiz ? best.y1 : best.x1) : pos, t: best ? best.t : 5.5, src: best, lo, hi });
  }
  // neighbouring edges of the same orientation that snapped to the same line are one edge
  let E = edges.slice();
  for (let pass = 0; pass < 4; pass++) {
    const merged = [];
    for (const e of E) {
      const last = merged[merged.length - 1];
      if (last && last.horiz === e.horiz && Math.abs(last.pos - e.pos) < 1.5) { last.lo = Math.min(last.lo, e.lo); last.hi = Math.max(last.hi, e.hi); if (!last.src && e.src) { last.src = e.src; last.t = e.t; } continue; }
      merged.push(Object.assign({}, e));
    }
    if (merged.length > 1) { const f = merged[0], l = merged[merged.length - 1]; if (f.horiz === l.horiz && Math.abs(f.pos - l.pos) < 1.5) { f.lo = Math.min(f.lo, l.lo); f.hi = Math.max(f.hi, l.hi); merged.pop(); } }
    // same orientation but a different line: the raster saw a jog; keep it as a real step
    if (merged.length === E.length) { E = merged; break; }
    E = merged;
  }
  // two consecutive same-orientation edges on different lines need a connector edge between them
  const withSteps = [];
  for (let i = 0; i < E.length; i++) {
    const e = E[i], f = E[(i + 1) % E.length];
    withSteps.push(e);
    if (e.horiz === f.horiz) {
      const at = e.horiz ? (e.hi >= f.hi ? f.hi : f.lo) : (e.hi >= f.hi ? f.hi : f.lo);
      withSteps.push({ horiz: !e.horiz, pos: at, t: e.t, src: null, lo: Math.min(e.pos, f.pos), hi: Math.max(e.pos, f.pos) });
    }
  }
  E = withSteps;
  const n = E.length;
  if (n < 4) return [];
  const corners = [];
  for (let i = 0; i < n; i++) {
    const e = E[i], f = E[(i + 1) % n];
    corners.push(e.horiz ? { x: f.pos, y: e.pos } : { x: e.pos, y: f.pos });
  }
  // walls between consecutive corners; a corner pair closer than 1" collapses (no wall), the loop stays closed
  const loopWalls = [];
  for (let i = 0; i < n; i++) {
    const a = corners[(i - 1 + n) % n], b = corners[i];
    const e = E[i];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1) continue;
    loopWalls.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, t: e.t, horiz: e.horiz, ext: true, src: e.src });
  }
  // every wall end must be exactly the next wall's start
  for (let i = 0; i < loopWalls.length; i++) { const w = loopWalls[i], nx = loopWalls[(i + 1) % loopWalls.length]; nx.x1 = w.x2; nx.y1 = w.y2; }
  return tidyLoop(loopWalls);
}

/* a loop of walls with raster stair-steps → the same loop without jogs shorter than
   a wall thickness: a tiny connector between two collinear runs is dropped and the
   runs joined; a tiny run between two perpendicular walls is dropped and the
   neighbours re-cornered. Consecutive collinear walls merge. Always stays closed. */
function tidyLoop(walls) {
  let W = walls.map((w) => Object.assign({}, w));
  const len = (w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
  for (let pass = 0; pass < 200 && W.length > 4; pass++) {
    // merge consecutive collinear walls
    let merged = false;
    for (let i = 0; i < W.length && W.length > 4; i++) {
      const a = W[i], b = W[(i + 1) % W.length];
      const col = a.horiz === b.horiz && Math.abs((a.horiz ? a.y2 : a.x2) - (b.horiz ? b.y1 : b.x1)) < 0.75;
      if (col) { a.x2 = b.x2; a.y2 = b.y2; if (!a.src && b.src) { a.src = b.src; a.t = b.t; } W.splice((i + 1) % W.length, 1); merged = true; break; }
    }
    if (merged) continue;
    // drop the shortest jog under 9"
    let si = -1, sl = 9;
    for (let i = 0; i < W.length; i++) if (len(W[i]) < sl) { sl = len(W[i]); si = i; }
    if (si < 0) break;
    const prev = W[(si - 1 + W.length) % W.length], next = W[(si + 1) % W.length];
    if (prev.horiz === next.horiz) {
      // connector between two collinear-ish runs: continue prev to next's end at prev's line
      if (prev.horiz) { next.y1 = prev.y2; next.y2 = prev.y2; } else { next.x1 = prev.x2; next.x2 = prev.x2; }
      next.x1 = prev.x2; next.y1 = prev.y2;
      W.splice(si, 1);
    } else {
      // short run between perpendicular walls: extend them to a new corner
      const c = prev.horiz ? { x: next.x1, y: prev.y2 } : { x: prev.x2, y: next.y1 };
      prev.x2 = c.x; prev.y2 = c.y; next.x1 = c.x; next.y1 = c.y;
      W.splice(si, 1);
    }
  }
  // keep every axis-aligned wall exactly aligned and every corner shared
  for (let i = 0; i < W.length; i++) {
    const w = W[i];
    if (w.horiz) { const y = w.y1; w.y2 = y; } else { const x = w.x1; w.x2 = x; }
    const nx = W[(i + 1) % W.length];
    nx.x1 = w.x2; nx.y1 = w.y2;
  }
  // a final pass can leave the last-to-first joint slightly off when a horizontal follows a horizontal; re-corner
  return W.filter((w) => len(w) >= 1);
}

/* ---------------- 3. schedules ---------------- */
const markOf = (s) => {
  const t = String(s || '').replace(/^\((N|E|R)\)\s*/i, '').trim();
  const m = t.match(/^([DW])\s*-?\s*0*(\d{1,3}[A-Z]?)$/i);
  return m ? (m[1].toUpperCase() + m[2].toUpperCase()) : null;
};

function parseSchedules(sheet) {
  const doors = new Map(), windows = new Map();
  const heads = sheet.texts.filter((t) => /^(door|window)\s+schedule$/i.test(t.s.trim()));
  for (const h of heads) {
    const isDoor = /^door/i.test(h.s);
    const hb = textBox(h);
    const rows = new Map();
    for (const t of sheet.texts) {
      if (t.y <= hb.y1 || t.y > hb.y1 + 700) continue;
      if (t.x < hb.x0 - 260 || t.x > hb.x1 + 500) continue;
      const mk = markOf(t.s);
      const rowKey = Math.round(t.y / 5);
      if (!rows.has(rowKey)) rows.set(rowKey, []);
      rows.get(rowKey).push({ t, mk });
    }
    for (const [, cells] of rows) {
      const mkCell = cells.find((c) => c.mk);
      if (!mkCell) continue;
      const mark = mkCell.mk;
      if ((isDoor && mark[0] !== 'D') || (!isDoor && mark[0] !== 'W')) continue;
      cells.sort((p, q) => p.t.x - q.t.x);
      const strs = cells.map((c) => c.t.s.trim());
      const size = strs.map(parseSizeCode).find(Boolean);
      const lengths = strs.filter((s) => /"$/.test(s) && /^\d/.test(s)).map(parseLength).filter((v) => v != null);
      const rec = { mark, size: size ? { width: size.width, height: size.height } : null, code: size ? size.code : '', raw: strs };
      if (!isDoor) {
        rec.winType = WINDOW_CODE[rec.code] || null;
        if (lengths.length >= 2) { rec.sill = lengths[0]; rec.head = lengths[1]; }
        else if (lengths.length === 1) rec.head = lengths[0];
        rec.egress = strs.some((s) => /^YES$/i.test(s)) ? true : undefined;
        // a real table row has a size; a plan mark that drifted into the column band does not
        if (!rec.size && cells.length < 2) continue;
        const prevW = windows.get(mark);
        if (!prevW || (!prevW.size && rec.size)) windows.set(mark, rec);
      } else {
        rec.tempered = strs.some((s) => /^YES$/i.test(s)) ? true : undefined;
        if (!rec.size && cells.length < 2) continue;
        const prevD = doors.get(mark);
        if (!prevD || (!prevD.size && rec.size)) doors.set(mark, rec);
      }
    }
  }
  return { doors, windows };
}

/* ---------------- 4. elevations + roof ---------------- */
function readElevation(sheet, drawing) {
  const R = drawing.region;
  const T = sheet.texts.filter((t) => R && rectContains(R, t.x, t.y, 60));
  const out = { pitches: [], floors: [], ceilings: [], ridge: null, grade: null, notes: [] };
  const valueBelow = (t) => {
    const tb = textBox(t);
    let best = null, bd = Infinity;
    for (const u of T) {
      if (u === t) continue;
      const v = parseLength(u.s.trim());
      if (v == null) continue;
      const ub = textBox(u);
      const dy = ub.y0 - tb.y1;
      const dx = Math.abs((ub.x0 + ub.x1) / 2 - (tb.x0 + tb.x1) / 2);
      if (dy < -2 || dy > 24 || dx > 60) continue;
      const d = dy + dx / 4;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  };
  for (const t of T) {
    const s = t.s.trim();
    const p = parsePitch(s);
    if (p != null) { out.pitches.push(p); continue; }
    if (/^finish(ed)?\s*floor$/i.test(s)) { const v = valueBelow(t); if (v != null) out.floors.push({ y: t.y, v }); }
    else if (/^(ceiling\s*height|top\s*of\s*plate|t\.?o\.?p\.?|plate\s*height)$/i.test(s)) { const v = valueBelow(t); if (v != null) out.ceilings.push({ y: t.y, v }); }
    else if (/^(highest\s*)?ridge$/i.test(s)) { const v = valueBelow(t); if (v != null && (out.ridge == null || v > out.ridge)) out.ridge = v; }
    else if (/^grade(\s*level)?$/i.test(s) && out.grade == null) { const v = valueBelow(t); if (v != null) out.grade = v; }
    else if (/siding|stucco|stone|brick|shingle|roofing|metal roof|standing seam|hardie|board\s*&?\s*batten|batten|\blap\b|veneer|tile roof|comp\.?\s*roof|composition/i.test(s)) out.notes.push(s);
  }
  out.floors.sort((a, b) => b.y - a.y);
  out.ceilings.sort((a, b) => b.y - a.y);
  return out;
}

/* ---------------- 5. finishes from notes ---------------- */
const SIDING_MAP = [
  [/board\s*&?\s*batten|batten/i, { exteriorWall: 'batten_cream', sidingProduct: 'hardie_batten', label: 'board & batten' }],
  [/stone|ledger|veneer/i, { exteriorWall: 'stone_gray', label: 'stone veneer' }],
  [/brick/i, { exteriorWall: 'brick_red', label: 'brick' }],
  [/stucco|plaster/i, { exteriorWall: 'stucco_sand', label: 'stucco' }],
  [/cedar|wood siding|plank/i, { exteriorWall: 'cedar_plank', label: 'wood siding' }],
  [/\blap\b|hardie|fiber\s*cement|clapboard/i, { exteriorWall: 'lap_white', sidingProduct: 'hardie_lap', label: 'lap siding' }],
];
const ROOF_MAP = [
  [/standing\s*seam|metal roof|metal roofing|class\s*"?a"?\s*metal/i, { roof: 'metal_standing', roofProduct: 'metal_standing', label: 'metal roofing' }],
  [/\btile\b|clay|concrete tile/i, { roof: 'tile_terra', label: 'tile roofing' }],
  [/comp\b|composition|asphalt|shingle|landmark/i, { roof: 'shingle_charcoal', roofProduct: 'ct_landmark', label: 'asphalt shingle' }],
];
function finishesFromNotes(notes) {
  const out = { surfaces: {}, finishes: {}, from: [], choices: { siding: [], roof: [] } };
  const roofVotes = new Map(), sideVotes = new Map();
  for (const n of notes) {
    for (const [re, v] of ROOF_MAP) if (re.test(n) && /roof/i.test(n)) { const cur = roofVotes.get(v.label) || { v, n: 0, note: n }; cur.n++; roofVotes.set(v.label, cur); break; }
    for (const [re, v] of SIDING_MAP) if (re.test(n) && !/roof/i.test(n)) { const cur = sideVotes.get(v.label) || { v, n: 0, note: n }; cur.n++; sideVotes.set(v.label, cur); break; }
  }
  const top = (m) => [...m.values()].sort((a, b) => b.n - a.n)[0] || null;
  const r = top(roofVotes), s = top(sideVotes);
  if (r) { out.surfaces.roof = r.v.roof; if (r.v.roofProduct) out.finishes.roofProduct = r.v.roofProduct; out.from.push(r.note); }
  if (s) { out.surfaces.exteriorWall = s.v.exteriorWall; if (s.v.sidingProduct) out.finishes.sidingProduct = s.v.sidingProduct; out.from.push(s.note); }
  out.choices.roof = [...roofVotes.values()].map((x) => ({ label: x.v.label, mentions: x.n, note: x.note, roof: x.v.roof, roofProduct: x.v.roofProduct }));
  out.choices.siding = [...sideVotes.values()].map((x) => ({ label: x.v.label, mentions: x.n, note: x.note, exteriorWall: x.v.exteriorWall, sidingProduct: x.v.sidingProduct }));
  return out;
}

/* ---------------- 6. the floor plan ---------------- */
const LABEL_STOP = /^(UP|DN|DOWN|NEW|YES|NO|SCALE|NOTES?|LABEL|SIZE|QTY|INFO|STATUS|DESCRIPTION|TEMPERED|EGRESS|BOTTOM|TOP|TYP\.?|N|E|S|W|A\d+|\(N\)|\(E\)|CONC\.?|LANDING ABOVE|INSTALL PER MANU\.?|WEATHERDEK|COMBO|UNIT|ELECTRIC|ELECTRICAL|PLUMBING)$/;

function readFloorPlan(sheet, drawing, schedules, report) {
  const R = drawing.region;
  const k = drawing.scale;
  const warn = (m) => report.warnings.push(drawing.title + ': ' + m);
  if (!R) { warn('no drawing region above the title'); return null; }
  if (!k) { warn('no "Scale:" text near the title — cannot size the plan'); return null; }
  const { faces: rawFaces, wallW, all } = wallFaceLines(sheet, R);
  const allM = mergeCollinear(all, 0.6, 1.0);
  const glass = findGlassPairs(allM, k);
  const facesM = mergeCollinear(rawFaces, 0.6, 1.0).filter((m) => !isDashed(m));
  const glassKey = new Set([...glass].map((g) => (g.horiz ? 'h' : 'v') + Math.round(g.horiz ? g.y1 : g.x1) + ':' + Math.round(g.horiz ? g.x1 : g.y1) + ':' + Math.round(g.horiz ? g.x2 : g.y2)));
  const faces = facesM;   // glass lines are told apart later by where they sit (inside a wall band), not by spacing
  void glass; void glassKey;
  // marks on the plan — not the schedule tables' own label column (a size code sits on the same row there)
  const sizeRows = new Set(sheet.texts.filter((t) => parseSizeCode(t.s.trim())).map((t) => Math.round(t.y / 5)));
  const marksAll = sheet.texts.map((t) => ({ t, mk: markOf(t.s.trim()) })).filter((m) => m.mk && rectContains(R, m.t.x, m.t.y, 40) && !sizeRows.has(Math.round(m.t.y / 5)));
  const markPts = marksAll.map((m) => { const c = textCenter(m.t); return { x: c.x * k, y: c.y * k }; });
  const arcPts = (sheet.curves || []).map((c) => ({ x: (c.x1 + c.x2) / 2 * k, y: (c.y1 + c.y2) / 2 * k }));
  // polyline swings: chains of short non-axis segments read as arcs — their midpoints
  for (const l of sheet.lines) {
    if (!rectContains(R, l.x1, l.y1, 0)) continue;
    const dx = Math.abs(l.x2 - l.x1), dy = Math.abs(l.y2 - l.y1);
    if (dx < 0.4 || dy < 0.4 || Math.hypot(dx, dy) > 6) continue;
    arcPts.push({ x: (l.x1 + l.x2) / 2 * k, y: (l.y1 + l.y2) / 2 * k });
  }
  const nearAny = (pts, p, r) => pts.some((q) => Math.abs(q.x - p.x) <= r && Math.abs(q.y - p.y) <= r);
  let walls = pairFaces(faces, k);
  walls = dedupeLayered(walls, 2.5);
  walls = walls.filter((w) => !(w.t > 8.5 && Math.hypot(w.x2 - w.x1, w.y2 - w.y1) < 72));   // stair treads, counters, table rules
  walls = mergeWalls(walls, 1.0, 8);        // junction breaks
  // door / window breaks: a thick wall always continues; an interior wall only where a mark or a swing sits in the gap, or the gap is a doorway
  walls = bridgeWalls(walls, 150, (w, gap, mid) => w.t >= 5.0 || gap <= 42 || nearAny(markPts, mid, Math.max(30, gap)) || nearAny(arcPts, mid, Math.max(24, gap)) || (Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= 48));
  snapCorners(walls, 12);
  walls = mergeWalls(walls, 1.0, 1.5);
  snapNodes(walls, 6);
  const comps = wallComponents(walls, 2.5);
  let main = null;
  for (const c of comps) if (!main || c.length > main.length) main = c;
  const keepSet = new Set(main || []);
  // secondary components that are buildings too (a detached garage): ≥ 6 walls
  for (const c of comps) if (c !== main && c.length >= 6) for (const i of c) keepSet.add(i);
  const dropped = walls.length - keepSet.size;
  walls = walls.filter((_, i) => keepSet.has(i));
  if (dropped) report.assumptions.push(drawing.title + ': ' + dropped + ' unconnected parallel-line pair(s) ignored (dimension lines, table rules, symbols)');
  if (!walls.length) { warn('no walls recognised'); return null; }
  // stud thickness → studio wall type; the centerline stays at the stud pair
  for (const w of walls) w.type = w.t >= 5.0 ? 'ext2x6' : 'int2x4';
  // ---- the outline: raster flood from outside, boundary snapped to the drawn centerlines ----
  let loop = null;
  try {
    const hasLayers = walls.some((w) => (w.layers || 1) >= 2);
    const weak = (w) => hasLayers && (w.layers || 1) < 2 && w.t >= 5.0 && w.t <= 7.5 && Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= 60;
    const strong = walls.filter((w) => !weak(w));
    let outline = outlineFromRaster(strong.length >= 4 ? strong : walls, 3);
    let lw = outline ? outlineToWalls(outline, walls) : [];
    if (lw.length < 4 && strong.length !== walls.length) { outline = outlineFromRaster(walls, 3); lw = outline ? outlineToWalls(outline, walls) : []; }
    const weakCount = walls.filter(weak).length;
    if (weakCount) report.assumptions.push(drawing.title + ': ' + weakCount + ' single-line-pair run(s) (deck rim, eave or fascia) kept out of the exterior outline');
    if (lw.length >= 4 && polyArea(lw.map((w) => ({ x: w.x1, y: w.y1 }))) >= 100 * 144) {
      // interior walls = recovered walls not lying on a loop wall
      const onLoop = (w) => lw.some((e) => e.horiz === w.horiz && Math.abs((e.horiz ? e.y1 : e.x1) - (w.horiz ? w.y1 : w.x1)) <= Math.max(e.t, w.t) / 2 + 4
        && Math.min(e.horiz ? Math.max(e.x1, e.x2) : Math.max(e.y1, e.y2), w.horiz ? Math.max(w.x1, w.x2) : Math.max(w.y1, w.y2)) - Math.max(e.horiz ? Math.min(e.x1, e.x2) : Math.min(e.y1, e.y2), w.horiz ? Math.min(w.x1, w.x2) : Math.min(w.y1, w.y2)) > 0.6 * Math.hypot(w.x2 - w.x1, w.y2 - w.y1));
      const interior = walls.filter((w) => !onLoop(w)).map((w) => Object.assign(w, { ext: false, type: w.t >= 5.0 ? 'int2x6' : 'int2x4' }));
      for (const e of lw) e.type = e.t >= 5.0 ? 'ext2x6' : 'ext2x4';
      walls = lw.concat(interior);
      snapCorners(interior, 12);
      const kkey = (x, y) => Math.round(x * 4) + ',' + Math.round(y * 4);
      const deg = new Map();
      for (const w of lw) for (const p of [[w.x1, w.y1], [w.x2, w.y2]]) deg.set(kkey(p[0], p[1]), (deg.get(kkey(p[0], p[1])) || 0) + 1);
      const closed = [...deg.values()].every((v) => v === 2);
      loop = closed ? { pts: lw.map((w) => ({ x: w.x1, y: w.y1 })) } : null;
      if (!closed) report.warnings.push(drawing.title + ': the traced outline has ' + [...deg.values()].filter((v) => v !== 2).length + ' loose corner(s) — close them in the studio before the roof builds');
      report.assumptions.push(drawing.title + ': exterior outline traced from the wall bands (' + lw.length + ' sides)');
    }
  } catch (e) { loop = null; }
  const pruneLeaves = (set) => {
    let cur = set;
    for (let pass = 0; pass < 8; pass++) {
      const deg = new Map();
      const kk = (x, y) => Math.round(x * 4) + ',' + Math.round(y * 4);
      for (const w of cur) for (const p of [[w.x1, w.y1], [w.x2, w.y2]]) deg.set(kk(p[0], p[1]), (deg.get(kk(p[0], p[1])) || 0) + 1);
      const next = cur.filter((w) => (deg.get(kk(w.x1, w.y1)) || 0) >= 2 && (deg.get(kk(w.x2, w.y2)) || 0) >= 2);
      if (next.length === cur.length) break;
      cur = next;
    }
    return cur;
  };
  let thick = pruneLeaves(walls.filter((w) => w.t >= 5.0 && Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= 12));
  let loopSource = '2x6-class walls';
  if (!traceExteriorLoop(thick, 0.5)) { thick = pruneLeaves(walls.filter((w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= 12)); loopSource = 'all walls'; }
  if (!loop) {
    const walked = traceExteriorLoop(thick, 0.5);
    if (walked) {
      loop = walked;
      report.assumptions.push(drawing.title + ': exterior outline traced from ' + loopSource);
      const onLoop = new Set(walked.wallIdx.map((i) => thick[i]));
      for (const w of walls) { w.ext = onLoop.has(w); if (w.ext) w.type = w.t >= 5.0 ? 'ext2x6' : 'ext2x4'; else if (w.t >= 5.0) w.type = 'int2x6'; }
      walked.ends.forEach(([na, nb], j) => {
        const w = thick[walked.wallIdx[j]];
        const d1 = Math.hypot(w.x1 - na.x, w.y1 - na.y) + Math.hypot(w.x2 - nb.x, w.y2 - nb.y);
        const d2 = Math.hypot(w.x1 - nb.x, w.y1 - nb.y) + Math.hypot(w.x2 - na.x, w.y2 - na.y);
        if (d1 <= d2) { w.x1 = na.x; w.y1 = na.y; w.x2 = nb.x; w.y2 = nb.y; } else { w.x1 = nb.x; w.y1 = nb.y; w.x2 = na.x; w.y2 = na.y; }
      });
    }
  }
  if (!loop) {
    warn('exterior walls do not close into one loop — the roof and foundation will not build until the outline is closed in the studio');
    for (const w of walls) w.ext = w.t >= 5.0;
  }
  // ---- openings ----
  const openings = [];
  const marks = marksAll;
  const usedMarks = new Set();
  const faceLines = faces.map((f) => ({ horiz: f.horiz, pos: (f.horiz ? f.y1 : f.x1) * k, a: (f.horiz ? Math.min(f.x1, f.x2) : Math.min(f.y1, f.y2)) * k, b: (f.horiz ? Math.max(f.x1, f.x2) : Math.max(f.y1, f.y2)) * k }));
  const bandLines = all.map((f) => ({ horiz: f.horiz, pos: (f.horiz ? f.y1 : f.x1) * k, a: (f.horiz ? Math.min(f.x1, f.x2) : Math.min(f.y1, f.y2)) * k, b: (f.horiz ? Math.max(f.x1, f.x2) : Math.max(f.y1, f.y2)) * k }));
  const curveEnds = (sheet.curves || []).map((c) => ({ x: (c.x1 + c.x2) / 2 * k, y: (c.y1 + c.y2) / 2 * k }));
  for (const w of walls) {
    const wa = w.horiz ? Math.min(w.x1, w.x2) : Math.min(w.y1, w.y2), wb = w.horiz ? Math.max(w.x1, w.x2) : Math.max(w.y1, w.y2);
    const c = w.horiz ? w.y1 : w.x1;
    const half = w.t / 2;
    // every face line within ±1.25" of either stud face, plus the finish layers just outside (up to 2.5" out)
    const runs = faceLines.filter((f) => f.horiz === w.horiz && Math.abs(Math.abs(f.pos - c) - half) <= 1.25 && f.b > wa - 1 && f.a < wb + 1);
    const outer = faceLines.filter((f) => f.horiz === w.horiz && Math.abs(f.pos - c) > half + 1.25 && Math.abs(f.pos - c) <= half + 2.75 && f.b > wa - 1 && f.a < wb + 1);
    const covered = (pos) => runs.some((f) => pos >= f.a - 0.75 && pos <= f.b + 0.75);
    const coveredOuter = (pos) => outer.some((f) => pos >= f.a - 0.75 && pos <= f.b + 0.75);
    // window symbols: lines strictly inside the stud band, parallel to the wall
    const wins = bandLines.filter((l) => l.horiz === w.horiz && Math.abs(l.pos - c) < half - 0.6 && l.b - l.a >= 10 && l.a >= wa - 2 && l.b <= wb + 2).sort((p, q) => p.a - q.a);
    const units = [];
    for (const l of wins) {
      const u = units.find((x) => Math.abs(x.a - l.a) < 3 && Math.abs(x.b - l.b) < 3);
      if (u) u.n++; else units.push({ a: l.a, b: l.b, n: 1 });
    }
    const perp = bandLines.filter((l) => l.horiz !== w.horiz && l.a <= c + half + 1 && l.b >= c - half - 1);   // lines crossing the band
    const jambAt = (pos) => perp.some((l) => Math.abs(l.pos - pos) <= 1.5);
    const winSpans = !w.ext ? [] : units.filter((x) => x.n >= 2 && jambAt(x.a) && jambAt(x.b)).sort((p, q) => p.a - q.a).map((u) => ({ a: u.a, b: u.b, kind: 'window' }));
    const spans = winSpans.slice();
    // door gaps: both stud faces missing for 16–150"
    let pos = wa + 1, gapStart = null;
    while (pos < wb - 1) {
      const cov = covered(pos);
      if (!cov && gapStart == null) gapStart = pos;
      if (cov && gapStart != null) { if (pos - gapStart >= 16) spans.push({ a: gapStart, b: pos, kind: 'gap' }); gapStart = null; }
      pos += 1;
    }
    if (gapStart != null && wb - gapStart >= 16) spans.push({ a: gapStart, b: wb, kind: 'gap' });
    for (const sp of spans) {
      if (sp.kind === 'gap' && spans.some((o) => o.kind === 'window' && o.a < sp.b + 2 && o.b > sp.a - 2)) continue;
      const width = sp.b - sp.a;
      if (width > 200) continue;
      const mid = sp.a + width / 2;
      const px = w.horiz ? mid : w.x1, py = w.horiz ? w.y1 : mid;
      let best = null, bd = Infinity;
      for (const m of marks) {
        if (usedMarks.has(m)) continue;
        const cc = textCenter(m.t);
        const d = Math.hypot(cc.x * k - px, cc.y * k - py);
        if (d > 60) continue;
        const srow = m.mk[0] === 'D' ? schedules.doors.get(m.mk) : schedules.windows.get(m.mk);
        const fit = srow && srow.size ? Math.min(60, Math.abs(srow.size.width - width)) : 20;
        const score = d + fit * 1.5;
        if (score < bd) { bd = score; best = m; }
      }
      const swing = curveEnds.some((e) => Math.abs((w.horiz ? e.x : e.y) - mid) < width && Math.abs((w.horiz ? e.y : e.x) - c) < width + 6);
      const rec = { wallIndex: walls.indexOf(w), pos: sp.a - wa, width, mark: best ? best.mk : null };
      rec.kind = best ? (best.mk[0] === 'D' ? 'door' : 'window') : (sp.kind === 'window' ? 'window' : (swing || !coveredOuter(mid) ? 'door' : 'opening'));
      if (best) usedMarks.add(best);
      const sched = best ? (best.mk[0] === 'D' ? schedules.doors.get(best.mk) : schedules.windows.get(best.mk)) : null;
      if (sched && sched.size) {
        rec.schedWidth = sched.size.width; rec.height = sched.size.height;
        if (Math.abs(sched.size.width - width) <= Math.max(6, width * 0.3)) { rec.pos += (width - sched.size.width) / 2; rec.width = sched.size.width; }
        else report.assumptions.push(drawing.title + ': ' + best.mk + ' drawn ' + Math.round(width) + '" wide but scheduled ' + sched.size.width + '" — kept the drawn width');
        if (rec.kind === 'window') { rec.winType = sched.winType || null; if (sched.sill != null) rec.sill = sched.sill; if (sched.head != null && sched.sill != null) rec.height = sched.head - sched.sill; if (sched.egress) rec.egress = true; }
        else { if (sched.tempered) rec.tempered = true; rec.code = sched.code; if (sched.size.width >= 96 && w.ext) rec.doorType = 'garage'; else if (/^(SL|XO|OX)$/i.test(sched.code) || (sched.size.width >= 60 && w.ext)) rec.doorType = 'slider'; }
      } else if (best) {
        warn(best.mk + ' has no schedule row — using the drawn width');
      }
      openings.push(rec);
    }
  }
  // a mulled unit: an unmarked window butting a marked one on the same wall reads the same mark
  for (const o of openings) {
    if (o.mark || o.kind !== 'window') continue;
    const mate = openings.find((p) => p !== o && p.mark && p.kind === 'window' && p.wallIndex === o.wallIndex && (Math.abs(p.pos + p.width - o.pos) <= 4 || Math.abs(o.pos + o.width - p.pos) <= 4) && Math.abs(p.width - o.width) <= 6);
    if (mate) { o.mark = mate.mark; o.inherited = true; for (const key of ['schedWidth', 'height', 'winType', 'sill', 'egress']) if (mate[key] != null) o[key] = mate[key]; }
  }
  // a mark that matched no gap still names an opening: place it on the nearest wall with the schedule size
  for (const m of marks) {
    if (usedMarks.has(m)) continue;
    const cc = textCenter(m.t); const mx = cc.x * k, my = cc.y * k;
    let best = null, bd = 30;
    walls.forEach((w, wi) => {
      const wa = w.horiz ? Math.min(w.x1, w.x2) : Math.min(w.y1, w.y2), wb = w.horiz ? Math.max(w.x1, w.x2) : Math.max(w.y1, w.y2);
      const along = w.horiz ? mx : my, across = w.horiz ? my : mx, c = w.horiz ? w.y1 : w.x1;
      if (along < wa - 6 || along > wb + 6) return;
      const d = Math.abs(across - c);
      if (d < bd) { bd = d; best = { w, wi, along: Math.max(wa, Math.min(wb, along)), wa, wb }; }
    });
    if (!best) { report.warnings.push(drawing.title + ': mark ' + m.mk + ' at (' + Math.round(m.t.x) + ',' + Math.round(m.t.y) + ' pt) is not beside any wall'); continue; }
    const sched = m.mk[0] === 'D' ? schedules.doors.get(m.mk) : schedules.windows.get(m.mk);
    const width = sched && sched.size ? sched.size.width : (m.mk[0] === 'D' ? 36 : 36);
    if (m.mk[0] === 'W' && !best.w.ext) { report.warnings.push(drawing.title + ': window mark ' + m.mk + ' sits on an interior wall — skipped'); continue; }
    const pos = Math.max(0, Math.min(best.wb - best.wa - width, best.along - best.wa - width / 2));
    const rec = { wallIndex: best.wi, pos, width, mark: m.mk, kind: m.mk[0] === 'D' ? 'door' : 'window', fromMark: true };
    if (sched && sched.size) {
      rec.height = sched.size.height;
      if (rec.kind === 'window') { rec.winType = sched.winType || null; if (sched.sill != null) rec.sill = sched.sill; if (sched.head != null && sched.sill != null) rec.height = sched.head - sched.sill; if (sched.egress) rec.egress = true; }
      else { if (sched.tempered) rec.tempered = true; rec.code = sched.code; if (sched.size.width >= 96 && best.w.ext) rec.doorType = 'garage'; else if (/^(SL|XO|OX)$/i.test(sched.code) || (sched.size.width >= 60 && best.w.ext)) rec.doorType = 'slider'; }
    }
    // never stack on an opening already found there
    if (openings.some((o) => o.wallIndex === best.wi && o.pos < pos + width && o.pos + o.width > pos)) { report.assumptions.push(drawing.title + ': ' + m.mk + ' overlaps an opening already read — mark ignored'); continue; }
    usedMarks.add(m);
    openings.push(rec);
    report.assumptions.push(drawing.title + ': ' + m.mk + ' placed from its mark (no drawn gap matched) — ' + width + '" on the nearest wall');
  }
  // ---- room labels ----
  const labels = [];
  for (const t of sheet.texts) {
    if (!rectContains(R, t.x, t.y, 0)) continue;
    const s = t.s.trim();
    if (s.length < 3 || s.length > 28) continue;
    if (!/^[A-Z][A-Z0-9 \/&.'-]+$/.test(s)) continue;
    if (LABEL_STOP.test(s)) continue;
    if (markOf(s) || isLengthText(s) || /SCHEDULE|ELEVATION|PLAN|DETAIL|SECTION|\d+ *: *12|^\(|PER T24|SPECS|MANU/.test(s)) continue;
    if (t.size < 8 || t.size > 20) continue;
    const cc = textCenter(t);
    labels.push({ text: s, x: cc.x * k, y: cc.y * k });
  }
  // ---- normalise to the plan origin ----
  const allPts = [];
  for (const w of walls) allPts.push({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
  const bb = bboxOf(allPts);
  const ox = bb.x0, oy = bb.y0;
  for (const w of walls) { w.x1 -= ox; w.y1 -= oy; w.x2 -= ox; w.y2 -= oy; }
  for (const l of labels) { l.x -= ox; l.y -= oy; }
  // labels outside the walls' extent are not room names
  const inside = labels.filter((l) => l.x >= -6 && l.y >= -6 && l.x <= bb.w + 6 && l.y <= bb.h + 6);
  return { title: drawing.title, levelIndex: drawing.levelIndex, scale: k, wallStroke: wallW, walls, openings, labels: inside, loopClosed: !!loop, footprint: { w: bb.w, h: bb.h }, origin: { x: ox, y: oy } };
}

/* ---------------- 7. assemble ---------------- */
const r1 = (v) => Math.round(v * 10) / 10;
function buildPlanSet(extracted) {
  const report = { warnings: [], assumptions: [], drawings: [], schedules: { doors: 0, windows: 0 } };
  const sheets = extracted.sheets || [];
  const drawings = [];
  const schedules = { doors: new Map(), windows: new Map() };
  for (const sh of sheets) {
    const sc = parseSchedules(sh);
    for (const [k, v] of sc.doors) if (!schedules.doors.has(k)) schedules.doors.set(k, v);
    for (const [k, v] of sc.windows) if (!schedules.windows.has(k)) schedules.windows.set(k, v);
    for (const d of findDrawings(sh)) drawings.push(Object.assign({ sheet: sh.index }, d, { _sheet: sh }));
  }
  report.schedules.doors = schedules.doors.size; report.schedules.windows = schedules.windows.size;
  if (typeof process !== 'undefined' && process.env && process.env.PLANSET_DEBUG) console.log('[planset] schedules', JSON.stringify([...schedules.doors.values()]), JSON.stringify([...schedules.windows.values()]));
  const floors = [], elevations = [], roofs = [];
  for (const d of drawings) {
    report.drawings.push({ sheet: d.sheet, kind: d.kind, title: d.title, ptPerIn: d.scale ? r1(1 / d.scale) : null, region: d.region ? [Math.round(d.region.x0), Math.round(d.region.y0), Math.round(d.region.x1), Math.round(d.region.y1)] : null });
    if (d.kind === 'floor') { const fp = readFloorPlan(d._sheet, d, schedules, report); if (fp) floors.push(fp); }
    else if (d.kind === 'elevation') elevations.push(Object.assign({ title: d.title }, readElevation(d._sheet, d)));
    else if (d.kind === 'roof') roofs.push(Object.assign({ title: d.title }, readElevation(d._sheet, d)));
  }
  if (!floors.length) report.warnings.push('no floor plan drawing was recognised (a title containing "Floor Plan" must sit under the plan)');
  const byLevel = new Map();
  for (const f of floors) { const cur = byLevel.get(f.levelIndex); if (!cur || f.walls.length > cur.walls.length) byLevel.set(f.levelIndex, f); }
  const levels = [...byLevel.values()].sort((a, b) => a.levelIndex - b.levelIndex);
  let datums = null;
  for (const e of elevations) { if (e.floors.length && e.ceilings.length && (!datums || e.floors.length > datums.floors.length)) datums = e; }
  levels.forEach((L, i) => {
    let h = null;
    if (datums && datums.floors[i] && datums.ceilings[i]) h = datums.ceilings[i].v - datums.floors[i].v;
    if (h != null && (h < 84 || h > 240)) { report.assumptions.push(L.title + ': elevation datums give a ' + r1(h / 12) + ' ft storey — ignored'); h = null; }
    if (h == null) { h = 108; report.assumptions.push(L.title + ': no ceiling height read from the elevations — assumed 9\'-0"'); }
    L.height = h;
    L.finishFloor = datums && datums.floors[i] ? datums.floors[i].v : null;
  });
  if (levels.length > 1) {
    const g = levels[0];
    for (const L of levels.slice(1)) {
      const dx = L.origin.x - g.origin.x, dy = L.origin.y - g.origin.y;
      if (Math.abs(dx) < 24 && Math.abs(dy) < 24) L.shift = { x: r1(dx), y: r1(dy) };
      else { L.shift = { x: 0, y: 0 }; report.assumptions.push(L.title + ': drawn at a different sheet position than the ground floor — stacked by outline corner'); }
    }
  }
  const pitches = [];
  for (const r of roofs) pitches.push(...r.pitches);
  for (const e of elevations) pitches.push(...e.pitches);
  let pitch = null;
  if (pitches.length) { const cnt = new Map(); for (const p of pitches) cnt.set(p, (cnt.get(p) || 0) + 1); pitch = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0]; }
  else report.assumptions.push('no roof pitch flag ("6 : 12") found on the roof plan or elevations — the studio default applies');
  const ridge = elevations.map((e) => e.ridge).find((v) => v != null) || null;
  const notes = [];
  for (const e of elevations) notes.push(...e.notes);
  for (const sh of sheets) for (const t of sh.texts) if (/exterior schedule|exterior finish|finish schedule/i.test(t.s)) {
    for (const u of sh.texts) if (u.y > t.y && u.y < t.y + 240 && Math.abs(u.x - t.x) < 320) notes.push(u.s.trim());
  }
  const fin = finishesFromNotes(notes);
  if (!fin.surfaces.exteriorWall) report.assumptions.push('no exterior siding note recognised — the studio default siding applies');
  if (!fin.surfaces.roof) report.assumptions.push('no roofing note recognised — the studio default roofing applies');
  if (fin.choices.roof.length > 1) report.assumptions.push('roofing notes name more than one material (' + fin.choices.roof.map((c) => c.label).join(', ') + ') — took the most mentioned; pick the other in the import dialog if that is wrong');
  if (fin.choices.siding.length > 1) report.assumptions.push('siding notes name more than one material (' + fin.choices.siding.map((c) => c.label).join(', ') + ') — took the most mentioned');
  return {
    version: 1,
    source: { pages: extracted.pages, sheets: sheets.length },
    levels: levels.map((L) => ({ title: L.title, levelIndex: L.levelIndex, height: r1(L.height), finishFloor: L.finishFloor, footprint: { w: r1(L.footprint.w), h: r1(L.footprint.h) }, loopClosed: L.loopClosed, shift: L.shift || { x: 0, y: 0 },
      walls: L.walls.map((w) => ({ x1: r1(w.x1), y1: r1(w.y1), x2: r1(w.x2), y2: r1(w.y2), thickness: r1(w.t), type: w.type, ext: !!w.ext })),
      openings: L.openings.map((o) => Object.assign({}, o, { pos: r1(o.pos), width: r1(o.width) })),
      labels: L.labels.map((l) => ({ text: l.text, x: r1(l.x), y: r1(l.y) })) })),
    roof: { pitch, ridge },
    surfaces: fin.surfaces, finishes: fin.finishes, finishNotes: fin.from, finishChoices: fin.choices,
    schedules: { doors: [...schedules.doors.values()], windows: [...schedules.windows.values()] },
    report,
  };
}

module.exports = {
  buildPlanSet, findDrawings, readFloorPlan, readElevation, parseSchedules, finishesFromNotes,
  parseLength, parseSizeCode, parseScale, parsePitch, markOf, kindOfTitle, levelIndexOfTitle,
  mergeCollinear, pairFaces, dedupeLayered, mergeWalls, bridgeWalls, snapCorners, snapNodes, wallComponents, traceExteriorLoop, findGlassPairs, isDashed, textBox, WINDOW_CODE,
  outlineFromRaster, outlineToWalls,
};
