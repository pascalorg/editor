/* ============================================================
   PlanCrafters — planset-pdf.cjs  (server-side, Node)
   VECTOR PLAN-SET EXTRACTION: a CAD-exported PDF (floor plans,
   elevations, schedules, roof plan) → one plain JSON "sheet" per
   page: every stroked line segment, every bezier curve, every
   filled polygon and every text run, in PDF points, y-DOWN
   (top-left origin), with stroke width + colour. Geometry only —
   nothing here knows what a wall is; that is planset.cjs (pure,
   dependency-free, tested), which turns sheets into a model spec.

   Why server-side: pdfjs-dist is ~1.5 MB and the operator walk over
   a 30k-path sheet is CPU work the studio tab should not do while
   the 3D view is live. The route is POST /api/planset (raw PDF
   bytes) in server.js.

   pdf.js path format (v4.4+ / v6): constructPath args are
   [op, data:Float32Array, minMax] where data is a flat stream of
   DrawOPS codes + coordinates in the CURRENT user space:
     0 moveTo x y · 1 lineTo x y · 2 curveTo x1 y1 x2 y2 x3 y3 ·
     3 quadraticCurveTo cx cy x y · 4 closePath
   Coordinates must be pushed through the CTM (transform/save/
   restore ops) to land in page space; the viewport transform then
   flips y so the sheet reads like paper.
   ============================================================ */
'use strict';

const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 };
class Path2DShim {}   // never instantiated: the instanceof guard only matters if a real Path2D ever appears

let _pdfjs = null;
const loadPdfjs = async () => {
  if (_pdfjs) return _pdfjs;
  _pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return _pdfjs;
};

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const r2 = (v) => Math.round(v * 100) / 100;
const hex = (h) => { const m = String(h).match(/^#?([0-9a-f]{6})$/i); if (!m) return null; const v = parseInt(m[1], 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255].map((x) => r2(x)); };
const rgb = (arr) => {
  // pdf.js 6 hands colours as a CSS hex string (possibly wrapped in a one-element array); older builds as numbers
  if (arr == null) return null;
  if (typeof arr === 'string') return hex(arr) || null;
  const a = Array.from(arr).slice(0, 3);
  if (a.length === 1 && typeof a[0] === 'string') return hex(a[0]) || null;
  if (a.length === 1) return [a[0], a[0], a[0]].map((v) => r2(v));
  if (a.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  return a.map((v) => r2(v));
};
const isFillOp = (name) => /^(fill|eoFill|fillStroke|eoFillStroke|closeFillStroke|closeEOFillStroke)$/.test(name);
const isStrokeOp = (name) => /^(stroke|closeStroke|fillStroke|eoFillStroke|closeFillStroke|closeEOFillStroke)$/.test(name);

/* Decode one packed path into subpaths of points (lines) + curves, in page
   space through `ctm` then `vp` (viewport, y-down). */
function decodePath(data, ctm, vp) {
  const M = mul(vp, ctm);
  const subpaths = [];
  const curves = [];
  let cur = null, start = null, last = null;
  const P = (x, y) => apply(M, x, y);
  let i = 0;
  const n = data.length;
  while (i < n) {
    const op = data[i++];
    if (op === DRAW.moveTo) {
      const p = P(data[i], data[i + 1]); i += 2;
      cur = [p]; subpaths.push(cur); start = p; last = p;
    } else if (op === DRAW.lineTo) {
      const p = P(data[i], data[i + 1]); i += 2;
      if (!cur) { cur = [last || p]; subpaths.push(cur); start = cur[0]; }
      cur.push(p); last = p;
    } else if (op === DRAW.curveTo) {
      const c1 = P(data[i], data[i + 1]), c2 = P(data[i + 2], data[i + 3]), p = P(data[i + 4], data[i + 5]); i += 6;
      if (last) curves.push({ x1: last[0], y1: last[1], cx1: c1[0], cy1: c1[1], cx2: c2[0], cy2: c2[1], x2: p[0], y2: p[1] });
      if (!cur) { cur = [last || p]; subpaths.push(cur); start = cur[0]; }
      cur.push(p); last = p;   // the chord keeps the polygon closed for fills
    } else if (op === DRAW.quadraticCurveTo) {
      const c = P(data[i], data[i + 1]), p = P(data[i + 2], data[i + 3]); i += 4;
      if (last) curves.push({ x1: last[0], y1: last[1], cx1: c[0], cy1: c[1], cx2: c[0], cy2: c[1], x2: p[0], y2: p[1] });
      if (!cur) { cur = [last || p]; subpaths.push(cur); start = cur[0]; }
      cur.push(p); last = p;
    } else if (op === DRAW.closePath) {
      if (cur && start) { cur.push(start); cur.closed = true; }
      last = start; cur = null;
    } else {
      break;   // unknown code — stop rather than misread coordinates
    }
  }
  return { subpaths, curves };
}

/* Extract one page. Returns { index, width, height, lines, curves, fills, texts, images }. */
async function extractPage(page, index) {
  const { OPS } = await loadPdfjs();
  const opName = new Map(Object.entries(OPS).map(([k, v]) => [v, k]));
  const vpObj = page.getViewport({ scale: 1 });
  const vp = vpObj.transform;   // PDF user space → page pixels (y-down)
  const ops = await page.getOperatorList();
  const lines = [], curves = [], fills = [];
  let images = 0;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let lineWidth = 1, stroke = [0, 0, 0], fill = [0, 0, 0];
  const gsStack = [];
  for (let k = 0; k < ops.fnArray.length; k++) {
    const name = opName.get(ops.fnArray[k]);
    const args = ops.argsArray[k];
    switch (name) {
      case 'save': stack.push(ctm); gsStack.push({ lineWidth, stroke, fill }); break;
      case 'restore': ctm = stack.pop() || ctm; { const g = gsStack.pop(); if (g) { lineWidth = g.lineWidth; stroke = g.stroke; fill = g.fill; } } break;
      case 'transform': ctm = mul(ctm, args); break;
      case 'setLineWidth': lineWidth = args[0]; break;
      case 'setStrokeRGBColor': stroke = rgb(args); break;
      case 'setStrokeGray': stroke = rgb([args[0]]); break;
      case 'setStrokeCMYKColor': { const [c, m, y, kk] = args; stroke = [r2((1 - c) * (1 - kk)), r2((1 - m) * (1 - kk)), r2((1 - y) * (1 - kk))]; } break;
      case 'setFillRGBColor': fill = rgb(args); break;
      case 'setFillGray': fill = rgb([args[0]]); break;
      case 'setFillCMYKColor': { const [c, m, y, kk] = args; fill = [r2((1 - c) * (1 - kk)), r2((1 - m) * (1 - kk)), r2((1 - y) * (1 - kk))]; } break;
      case 'paintImageXObject': case 'paintImageXObjectRepeat': case 'paintJpegXObject': case 'paintInlineImageXObject': images++; break;
      case 'constructPath': {
        const drawOp = opName.get(args[0]);
        // pdf.js hands [op, [pathData], minMax] — the path sits inside a one-element array
        const data = Array.isArray(args[1]) ? args[1][0] : args[1];
        if (!data || !data.length || data instanceof Path2DShim) break;
        const { subpaths, curves: cv } = decodePath(data, ctm, vp);
        // stroke width in page units: scale by the CTM's mean axis scale
        const sx = Math.hypot(ctm[0], ctm[1]), sy = Math.hypot(ctm[2], ctm[3]);
        const wPage = r2(lineWidth * (sx + sy) / 2 * Math.hypot(vp[0], vp[1]));
        if (isStrokeOp(drawOp)) {
          for (const sp of subpaths) {
            for (let i = 0; i + 1 < sp.length; i++) {
              const a = sp[i], b = sp[i + 1];
              if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) continue;
              lines.push({ x1: r2(a[0]), y1: r2(a[1]), x2: r2(b[0]), y2: r2(b[1]), w: wPage, c: stroke });
            }
          }
          for (const c of cv) curves.push(Object.assign({}, Object.fromEntries(Object.entries(c).map(([k, v]) => [k, r2(v)])), { w: wPage, c: stroke }));
        }
        if (isFillOp(drawOp)) {
          for (const sp of subpaths) {
            if (sp.length < 3) continue;
            const pts = sp.map((p) => [r2(p[0]), r2(p[1])]);
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
            fills.push({ pts, c: fill, bbox: [x0, y0, x1, y1] });
          }
        }
        break;
      }
      default: break;
    }
  }
  // text runs: transform = [a b c d e f] in user space; size = |(a,b)|, dir = unit (a,b)
  const tc = await page.getTextContent({ includeMarkedContent: false });
  const texts = [];
  for (const it of tc.items) {
    if (!it || typeof it.str !== 'string' || !it.str.trim()) continue;
    const t = it.transform;
    const M = mul(vp, t);
    const size = Math.hypot(M[0], M[1]);
    const dirX = M[0] / (size || 1), dirY = M[1] / (size || 1);
    const [x, y] = apply(vp, t[4], t[5]);   // baseline origin, page space
    const w = it.width * Math.hypot(vp[0], vp[1]) * (Math.hypot(t[0], t[1]) / (Math.hypot(t[0], t[1]) || 1));
    // width/height are already scaled by the font size in getTextContent
    texts.push({ s: it.str, x: r2(x), y: r2(y), w: r2(it.width), h: r2(it.height), size: r2(size), dx: r2(dirX), dy: r2(dirY) });
    void w;
  }
  return { index, width: r2(vpObj.width), height: r2(vpObj.height), lines, curves, fills, texts, images };
}

/* Extract every page (or the given 0-based indices). */
async function extractPlanSet(bytes, opts) {
  const { getDocument } = await loadPdfjs();
  // pdf.js insists on a plain Uint8Array (a Node Buffer is rejected by name)
  const data = (bytes && bytes.buffer) ? new Uint8Array(bytes.buffer, bytes.byteOffset || 0, bytes.byteLength) : new Uint8Array(bytes);
  const doc = await getDocument({ data, useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
  const want = (opts && Array.isArray(opts.pages) && opts.pages.length) ? opts.pages : null;
  const sheets = [];
  for (let i = 0; i < doc.numPages; i++) {
    if (want && !want.includes(i)) continue;
    const page = await doc.getPage(i + 1);
    try { sheets.push(await extractPage(page, i)); }
    finally { page.cleanup(); }
  }
  try { await doc.cleanup(); await doc.destroy(); } catch (e) { /* freed */ }
  return { pages: doc.numPages, sheets };
}

module.exports = { extractPlanSet, extractPage, decodePath, DRAW };
