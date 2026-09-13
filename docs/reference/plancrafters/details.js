/* ============================================================
   Home Architect — details.js
   THE AUTOMATED DRAFTSMAN (#48): a registry of parametric
   construction details drawn LIVE from model variables — like
   Revit details, not static blocks. Every dimension, layer
   thickness, product name and code note reads the model at draw
   time, so a pitch/assembly/product change re-drafts the detail
   and its labels can never go stale.

   Registry entry: { id, title, applies(model)->bool, draw(ctx,
   model, item, ppi) }. item: { x, y (paper in), num (detail
   number on the sheet), w? }. Placement + numbering happen in
   sheets.generateSet (A6.0 grid); model.detailIndex maps id ->
   'n/A6.0' so plans/sections can bubble-call the right detail.
   ============================================================ */
(function () {
  'use strict';
  const HA = window.HA;

  const D = (HA.details = {});

  /* shared cut-material palette — matches section2d so the sheet set reads
     as one hand */
  const WOOD = '#d8b98a';
  const WOOD2 = '#c9a36b';
  const CONC = '#8a8f96';
  const GYP = '#e8d9b8';
  const SHTG = '#c9c3b8';
  const CLAD = '#b9c4a8';
  const EARTH = 'rgba(122,99,72,0.5)';
  const RED = '#c2372b';

  /* ---------- shared drawing kit ----------
     px = paper x0 (px), py = paper baseline y (px), s = px per WORLD inch.
     X/Y map world inches (y up) into the sheet raster. */
  const kit = (ctx, ppi, px, py, s) => {
    const X = (wx) => px + wx * s;
    const Y = (wz) => py - wz * s;
    const hair = Math.max(0.9, ppi * 0.01);
    const K = { X, Y, s, hair };
    K.rect = (wx, wz, ww, wh, fill) => {          // world rect, wz = TOP edge
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(X(wx), Y(wz), ww * s, wh * s); }
      ctx.strokeRect(X(wx), Y(wz), ww * s, wh * s);
    };
    K.xRect = (wx, wz, ww, wh, fill) => {         // cut lumber: rect + drafting X
      K.rect(wx, wz, ww, wh, fill || WOOD);
      ctx.beginPath();
      ctx.moveTo(X(wx), Y(wz)); ctx.lineTo(X(wx + ww), Y(wz - wh));
      ctx.moveTo(X(wx + ww), Y(wz)); ctx.lineTo(X(wx), Y(wz - wh));
      ctx.stroke();
    };
    K.line = (x1, z1, x2, z2) => {
      ctx.beginPath(); ctx.moveTo(X(x1), Y(z1)); ctx.lineTo(X(x2), Y(z2)); ctx.stroke();
    };
    /* batt insulation: the section2d chained-semicircle squiggle, vertical run */
    K.batt = (wx, zTop, zBot, width) => {
      const r = Math.max(2, (width * s) / 2);
      ctx.save();
      ctx.strokeStyle = '#b48ead'; ctx.lineWidth = Math.max(1, ppi * 0.011);
      const cx = X(wx + width / 2);
      let y = Y(zTop) + r;
      const yEnd = Y(zBot) - r;
      let flip = false;
      ctx.beginPath();
      while (y < yEnd) {
        ctx.arc(cx, y, r, flip ? Math.PI / 2 : -Math.PI / 2, flip ? (3 * Math.PI) / 2 : Math.PI / 2, flip);
        y += r * 1.6; flip = !flip;
      }
      ctx.stroke();
      ctx.restore();
    };
    return K;
  };

  /* A6.x uses a fixed 2x2 allocator: anchors are 15.2in x 11.2in apart. Treat
     each allocation as a HARD paper-space panel so a note/leader from one detail
     can never enter its neighbour. The small negative left inset accommodates
     foundation grade hatching while retaining a visible gutter between panels. */
  const panelOf = (item, ppi, opts) => {
    item = item || {}; opts = opts || {};
    const x = Number(item.x) || 0, y = Number(item.y) || 0;
    const l = (x - 0.25) * ppi, r = (x + 14.75) * ppi;
    const t = (y - 0.08) * ppi, b = (y + 10.84) * ppi;
    const capY = opts.capY != null
      ? opts.capY
      : (y + (Number(item.capDy) || 5)) * ppi;
    return {
      l, r, t, b,
      noteT: Math.max(t + ppi * 0.18, opts.noteT == null ? -Infinity : opts.noteT),
      noteB: Math.min(b - ppi * 0.2, capY - ppi * 0.28,
        opts.noteB == null ? Infinity : opts.noteB),
    };
  };
  D.panelFor = panelOf;

  /* Panel-bounded note columns with monotone elbow leaders. notes:
     [{t,tx,ty,side?}] in px. side:-1 uses a LEFT, right-aligned column; all
     other notes use the RIGHT column. Text remains 0.105in paper height, wraps
     to a 4.2in lane, and is vertically packed between the panel top + caption. */
  const notesCol = (ctx, ppi, notes, lx, lxLeft, bounds) => {
    const fpx = Math.max(7, ppi * 0.105);
    ctx.font = '600 ' + fpx + 'px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'middle';
    const lineH = fpx * 1.28;
    const blockGap = fpx * 0.55;
    const p = bounds || { l: -1e9, r: 1e9, noteT: -1e9, noteB: 1e9 };
    const safe = ppi * 0.18;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const wrap = (text, maxWidth) => {
      const words = String(text || '').trim().split(/\s+/).filter(Boolean);
      if (!words.length) return [''];
      const lines = [];
      let line = words.shift();
      for (const word of words) {
        const next = line + ' ' + word;
        const semanticPair = /(?:SHEAR|TOP|DBL)$/.test(line) && /^(?:TRANSFER|PLATE)$/.test(word);
        if (ctx.measureText(next).width <= maxWidth || !line || semanticPair) line = next;
        else { lines.push(line); line = word; }
      }
      lines.push(line);
      return lines;
    };
    const runCol = (list, requestedX, left) => {
      if (!list.length) return;
      const colX = left
        ? clamp(requestedX, p.l + ppi * 2.25, p.r - ppi * 4.5)
        : clamp(requestedX, p.l + ppi * 4.5, p.r - ppi * 2.25);
      const available = left ? colX - (p.l + safe) : (p.r - safe) - colX;
      const maxWidth = Math.max(ppi * 1.6, Math.min(ppi * 4.2, available));
      ctx.textAlign = left ? 'right' : 'left';
      const blocks = list.slice().sort((a, b) => a.ty - b.ty).map((n) => {
        const lines = wrap(n.t, maxWidth);
        const h = lines.length * lineH;
        return { n, lines, h, ideal: clamp(n.ty - h / 2, p.noteT, p.noteB - h), top: 0 };
      });
      const totalH = blocks.reduce((sum, b) => sum + b.h, 0);
      const gap = blocks.length > 1
        ? Math.max(0, Math.min(blockGap, (p.noteB - p.noteT - totalH) / (blocks.length - 1))) : 0;
      let cursor = p.noteT;
      for (const b of blocks) { b.top = Math.max(b.ideal, cursor); cursor = b.top + b.h + gap; }
      // Backward correction retains target order while pulling a crowded column
      // above the caption. With the fixed paper font, the normal panels have ample
      // room; this also makes low-resolution screen previews deterministic.
      for (let i = blocks.length - 1; i >= 0; i--) {
        const maxTop = i === blocks.length - 1
          ? p.noteB - blocks[i].h
          : blocks[i + 1].top - gap - blocks[i].h;
        blocks[i].top = Math.min(blocks[i].top, maxTop);
      }
      if (blocks.length && blocks[0].top < p.noteT) {
        const dy = p.noteT - blocks[0].top;
        for (const b of blocks) b.top += dy;
      }
      for (const b of blocks) {
        const n = b.n, lines = b.lines, top = b.top, ly = top + b.h / 2;
        const tx = clamp(n.tx, p.l + safe, p.r - safe);
        const ty = clamp(n.ty, p.noteT, p.noteB);
        ctx.strokeStyle = n.red ? RED : '#333';
        ctx.lineWidth = Math.max(0.8, ppi * 0.008);
        const tail = Math.max(8, ppi * 0.08);
        const startX = left ? colX + 3 : colX - 3;
        const elbowX = left
          ? Math.min(p.r - safe, startX + tail)
          : Math.max(p.l + safe, startX - tail);
        ctx.beginPath();
        ctx.moveTo(startX, ly); ctx.lineTo(elbowX, ly); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.beginPath(); ctx.arc(tx, ty, Math.max(1.2, ppi * 0.014), 0, 7);
        ctx.fillStyle = n.red ? RED : '#333'; ctx.fill();
        ctx.fillStyle = n.red ? RED : '#111';
        lines.forEach((line, i) => ctx.fillText(line, colX, top + lineH * (i + 0.5)));
        if (D._captureLayout) {
          const w = lines.reduce((mx, line) => Math.max(mx, ctx.measureText(line).width), 0);
          (D._layoutTrace || (D._layoutTrace = [])).push({
            detailId: D._traceDetail || null, text: String(n.t || ''), side: left ? -1 : 1, fontPx: fpx,
            box: { l: left ? colX - w : colX, r: left ? colX : colX + w, t: top, b: top + b.h },
            target: { x: tx, y: ty }, leader: [{ x: startX, y: ly }, { x: elbowX, y: ly }, { x: tx, y: ty }],
            panel: { l: p.l, r: p.r, t: p.t, b: p.b, noteT: p.noteT, noteB: p.noteB },
          });
        }
      }
    };
    const all = notes.filter(Boolean);
    if (lxLeft != null) runCol(all.filter((n) => n.side === -1), lxLeft, true);
    runCol(all.filter((n) => !(lxLeft != null && n.side === -1)), lx, false);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#111';
  };

  /* numbered caption under a detail: hex bubble + title + scale */
  const caption = (ctx, ppi, item, title, scaleLabel) => {
    const x = item.x * ppi, y = (item.y + (item.capDy || 4.1)) * ppi;
    const r = Math.max(8, ppi * 0.13);
    ctx.save();
    ctx.lineWidth = Math.max(1.2, ppi * 0.014); ctx.strokeStyle = '#111';
    ctx.beginPath();                                     // hexagon detail bubble
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      const hx = x + r + Math.cos(a) * r, hy = y + Math.sin(a) * r;
      i ? ctx.lineTo(hx, hy) : ctx.moveTo(hx, hy);
    }
    ctx.closePath(); ctx.stroke();
    ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '800 ' + Math.max(8, ppi * 0.13) + 'px "IBM Plex Sans", sans-serif';
    ctx.fillText(String(item.num || ''), x + r, y);
    ctx.textAlign = 'left';
    ctx.font = '800 ' + Math.max(9, ppi * 0.15) + 'px "IBM Plex Sans", sans-serif';
    ctx.fillText(title, x + r * 2 + 8, y - r * 0.35);
    ctx.font = '600 ' + Math.max(7, ppi * 0.1) + 'px "IBM Plex Mono", monospace';
    ctx.fillStyle = '#555';
    ctx.fillText('SCALE: ' + scaleLabel, x + r * 2 + 8, y + r * 0.55);
    ctx.restore();
  };

  const asmOf = (model) => (model.settings && model.settings.assembly) || { drywall: 0.5, sheathing: 0.5, cladding: 0.75 };
  const studOf = (model) => {
    // dominant exterior stud depth via the wall schedule (falls back 2x6)
    try {
      const ws = HA.wallSchedule(model);
      const ext = ws.rows.filter((r) => /ext/.test(r.key || '') || /EXT/i.test(r.assembly || ''));
      const big = ext.sort((a, b) => (b.lf || 0) - (a.lf || 0))[0];
      // SIP schedule row: STUD column reads 'SIP' — return the panel core depth
      // so a mixed set's shared details draw a sane cavity, honestly named.
      if (big && /SIP/i.test(big.stud || '')) {
        const T = HA.WALL_TYPES[big.type] || {};
        return { d: T.core || 5.5, name: 'SIP', batt: 'EPS CORE', sip: true, T };
      }
      if (big && /2X4/i.test(big.stud || '')) return { d: 3.5, name: '2X4', batt: 'R-15' };
    } catch (e) { /* fall through */ }
    return { d: 5.5, name: '2X6', batt: 'R-21' };
  };
  /* dominant exterior wall system is SIP (by schedule LF) — decides which
     family of typical details (stick vs SIP) lands on A6.x. */
  const sipDominant = (model) => { try { return !!studOf(model).sip; } catch (e) { return false; } };
  D.sipDominant = sipDominant;
  const FOAM = '#f4efe3';
  const OSB = '#d9c08a';
  const spacingOf = (model) => (model.settings && model.settings.studSpacing) || 16;
  const prod = (fn, model) => { try { return HA.products && HA.products[fn] ? HA.products[fn](model) : null; } catch (e) { return null; } };

  /* ================= DETAIL: TYPICAL EAVE ================= */
  const eaveDetail = {
    id: 'eave',
    title: 'TYPICAL EAVE',
    applies: (model) => !!(model.roof && model.roof.enabled),
    draw(ctx, model, item, ppi) {
      const roof = model.roof || {};
      const pitch = roof.pitch || 6;
      const slope = pitch / 12;
      const over = roof.overhang != null ? roof.overhang : 16;
      const memD = roof.thickness || 8;                    // rafter/structure depth
      const closed = (roof.eaveStyle || 'closed') === 'closed';
      const exposed = roof.eaveStyle === 'exposed';
      const asm = asmOf(model);
      const stud = studOf(model);
      const sc = 1 / 12;                                    // 1" = 1'-0"
      const s = sc * ppi;
      // origin: wall OUTSIDE (sheathing face) at top-plate top; wall runs down,
      // roof up-right → tail left. Baseline derives from the up-slope crest so
      // the ridge-side roofing never pokes above the cell top.
      const spanX = stud.d + 16;
      const crest = spanX * slope + memD + 6;
      // drawing sits 4.5" into the cell — the tail/soffit notes hang in a LEFT
      // column beside the eave (Steve: "roof stuff to the left")
      const px = item.x * ppi + 4.5 * ppi, py = item.y * ppi + 0.35 * ppi + crest * s;
      const K = kit(ctx, ppi, px, py, s);
      ctx.save();
      ctx.lineWidth = K.hair; ctx.strokeStyle = '#111';
      const wallH = 26;                                     // drawn wall stub below plates
      // WALL (outside face at x=0, interior to the right): cladding | shtg | studs | gyp
      const cl = Math.max(0.6, asm.cladding), sh = Math.max(0.4, asm.sheathing), gy = Math.max(0.4, asm.drywall);
      K.rect(-cl - sh, -3, cl, wallH, CLAD);                // cladding (below frieze)
      K.rect(-sh, 0, sh, wallH + 3, SHTG);                  // sheathing to plate top
      K.rect(0, -3, stud.d, wallH, '#f7f5f1');              // stud bay below plates
      K.batt(0, -3.5, -(wallH - 1), stud.d);
      K.xRect(0, 0, stud.d, 1.5);                           // double top plate
      K.xRect(0, -1.5, stud.d, 1.5);
      K.rect(stud.d, -3, gy, wallH, GYP);                   // interior gyp
      // RAFTER: bears on the plate, tail cantilevers past the wall by `over`
      const tailX = -(cl + sh) - over;                      // tail plumb face
      // (spanX — the drawn up-slope extent — is computed above for the baseline)
      const zAt = (wx) => wx * slope;                       // roof underside rise (z at plate top = 0)
      // CEILING JOIST — drawn FIRST so the rafter/bird block overlay it (it
      // sits BESIDE the rafter, one bay behind the cut — Steve: "weird beam in
      // the way / covering the top plates"). Profile member, no drafting X.
      // Runs to the OUTER EDGE of the top plate (Steve Jul 3) — the rafter
      // paints over the corner, which reads as the end clipped to the slope.
      ctx.fillStyle = '#efe6d4';
      ctx.fillRect(K.X(0), K.Y(5.5), (spanX - 1) * s, 5.5 * s);
      ctx.strokeRect(K.X(0), K.Y(5.5), (spanX - 1) * s, 5.5 * s);
      ctx.fillStyle = WOOD;
      ctx.beginPath();                                      // rafter parallelogram (plumb ends)
      ctx.moveTo(K.X(tailX), K.Y(zAt(tailX)));
      ctx.lineTo(K.X(spanX), K.Y(zAt(spanX)));
      ctx.lineTo(K.X(spanX), K.Y(zAt(spanX) + memD));
      ctx.lineTo(K.X(tailX), K.Y(zAt(tailX) + memD));
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // bird block: FULL-DEPTH — plate top to the UNDERSIDE OF THE ROOF
      // SHEATHING (Steve Jul 3: "your blocking/frieze blocks don't go to the
      // bottom of sheathing"), slope-cut top. This is the shear-transfer
      // block: roof diaphragm edge-nails into it, it toe-nails to the plate.
      const bx0 = -sh, bx1 = stud.d * 0.5;
      ctx.fillStyle = WOOD2;
      ctx.beginPath();
      ctx.moveTo(K.X(bx0), K.Y(0)); ctx.lineTo(K.X(bx1), K.Y(0));
      ctx.lineTo(K.X(bx1), K.Y(zAt(bx1) + memD)); ctx.lineTo(K.X(bx0), K.Y(zAt(bx0) + memD));
      ctx.closePath(); ctx.fill(); ctx.stroke();
      K.line(bx0, 0, bx1, zAt(bx1) + memD);                 // drafting X (cut member)
      K.line(bx1, 0, bx0, zAt(bx0) + memD);
      // ROOF ASSEMBLY above the rafter: sheathing + underlayment + roofing
      const shpts = [tailX, spanX];
      ctx.fillStyle = SHTG;
      ctx.beginPath();
      ctx.moveTo(K.X(shpts[0]), K.Y(zAt(shpts[0]) + memD));
      ctx.lineTo(K.X(shpts[1]), K.Y(zAt(shpts[1]) + memD));
      ctx.lineTo(K.X(shpts[1]), K.Y(zAt(shpts[1]) + memD + 0.5));
      ctx.lineTo(K.X(shpts[0]), K.Y(zAt(shpts[0]) + memD + 0.5));
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.save();                                            // underlayment — dashed
      ctx.setLineDash([4, 3]); ctx.strokeStyle = '#555';
      K.line(tailX, zAt(tailX) + memD + 0.7, spanX, zAt(spanX) + memD + 0.7);
      ctx.restore();
      ctx.lineWidth = Math.max(1.6, ppi * 0.02);             // roofing = heavy line
      K.line(tailX - 0.5, zAt(tailX) + memD + 1.2, spanX, zAt(spanX) + memD + 1.2);
      ctx.lineWidth = K.hair;
      // FASCIA + SOFFIT per eaveStyle
      if (!exposed) K.rect(tailX - 1.5, zAt(tailX) + memD, 1.5, memD + 1.5, WOOD2); // fascia board
      if (closed) {
        K.rect(tailX, zAt(tailX) + 0.75, -(tailX) - cl - sh, 0.75, '#efece6');       // level soffit panel
        // frieze closes soffit-to-wall
        K.rect(-cl - sh, zAt(tailX) + 0.75, cl, 3, WOOD2);
      }
      // insulation baffle at the plate + ceiling batt hint
      ctx.save();
      ctx.strokeStyle = '#2e86c1'; ctx.setLineDash([6, 3]); ctx.lineWidth = Math.max(1.1, ppi * 0.013);
      K.line(0, zAt(0) + 1, spanX * 0.8, zAt(spanX * 0.8) + 1);
      ctx.restore();
      // attic wedge between rafter underside and the ceiling joist (was drawn
      // BELOW the plate — i.e. inside the room)
      K.batt(spanX - 5, zAt(spanX - 5) - 0.3, 5.7, 8);
      // HIDDEN CJ (Steve Jul 3: "show a dashed line"): where the joist runs
      // BEHIND the rafter its edges draw dashed — the standard hidden-line
      // convention for the member one bay back.
      const xHid = Math.min(spanX - 1, 5.5 / Math.max(slope, 0.01));
      ctx.save();
      ctx.setLineDash([Math.max(4, ppi * 0.05), Math.max(3, ppi * 0.035)]);
      ctx.strokeStyle = '#5a4a38'; ctx.lineWidth = Math.max(1, ppi * 0.011);
      K.line(0, 5.5, xHid, 5.5);                            // CJ top edge behind the rafter
      K.line(0, 5.5, 0, 0);                                 // CJ end at the plate outer edge
      ctx.restore();
      // NAILING — the SHEAR-TRANSFER path (Steve: "nail through the top [of the
      // block]… a nail through the sheathing on the wall… and a nail to the top
      // plate"): roof shtg → block → plate → wall shtg, each fastener drawn.
      const nail = (x1, z1, x2, z2) => {
        ctx.save();
        ctx.strokeStyle = '#1f2a36'; ctx.lineWidth = Math.max(1.3, ppi * 0.016);
        K.line(x1, z1, x2, z2);
        const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz) || 1;
        const hx = -dz / L * 0.9, hz = dx / L * 0.9;         // head tick ⊥ the shank
        K.line(x1 - hx, z1 - hz, x1 + hx, z1 + hz);
        ctx.restore();
      };
      const bmx = (bx0 + bx1) / 2;
      nail(bmx, zAt(bmx) + memD + 1.6, bmx, zAt(bmx) + memD - 2.6);  // shtg → block (edge nail)
      nail(bx1 - 0.4, 2.6, bx1 - 2.6, -1.6);                          // block → plate (toe-nail)
      nail(-sh - 0.9, -1.2, 1.8, -1.2);                               // wall shtg → top plate (edge nail)
      // CJ → RAFTER face nails go INTO the page: drawn as heads (filled dots)
      ctx.fillStyle = '#1f2a36';
      for (const fx of [7.5, 9.5]) {
        ctx.beginPath(); ctx.arc(K.X(fx), K.Y(3.4), Math.max(1.6, ppi * 0.02), 0, 7); ctx.fill();
      }
      // overhang dimension
      ctx.strokeStyle = '#333'; ctx.lineWidth = Math.max(0.8, ppi * 0.008);
      const dimY = K.Y(-8);
      ctx.beginPath(); ctx.moveTo(K.X(tailX), dimY); ctx.lineTo(K.X(-cl - sh), dimY); ctx.stroke();
      ctx.font = '700 ' + Math.max(7, ppi * 0.11) + 'px "IBM Plex Mono", monospace';
      ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(HA.U.fmtLen(over) + ' EAVE', (K.X(tailX) + K.X(-cl - sh)) / 2, dimY - 2);
      ctx.textAlign = 'left';
      // pitch flag on the DOWN-SLOPE (eave) side (Steve: "the 6:12 is on the
      // wrong side") — classic run/rise triangle riding the slope: 12" run
      // leg, rise leg up `pitch` at the ridge-side end
      const pfx0 = tailX + 3;
      const zR = zAt(pfx0) + memD + 2.6;
      ctx.beginPath();
      ctx.moveTo(K.X(pfx0), K.Y(zR));
      ctx.lineTo(K.X(pfx0 + 12), K.Y(zR));
      ctx.lineTo(K.X(pfx0 + 12), K.Y(zR + pitch));
      ctx.stroke();
      ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
      ctx.fillText(pitch + ':12', K.X(pfx0 - 1), K.Y(zR + 1));
      ctx.textAlign = 'left';
      // live notes
      const roofSpec = prod('roofSpec', model);
      notesCol(ctx, ppi, [
        { t: (roofSpec || 'ROOFING PER SCHEDULE') + ' O/ UNDERLAYMENT', tx: K.X(spanX * 0.5), ty: K.Y(zAt(spanX * 0.5) + memD + 1.3) },
        { t: '1/2" WSP ROOF SHTG — 8d @ 6" O.C. E.N. INCL. INTO BLOCKING', tx: K.X(bmx), ty: K.Y(zAt(bmx) + memD + 0.8) },
        // tail/slope notes read from a LEFT column (side:-1) so neither side cramps
        { t: 'RAFTER ' + (memD >= 9 ? '2X10' : memD >= 7 ? '2X8' : '2X6') + ' @ ' + ((model.settings && model.settings.rafterSpacing) || 24) + '" O.C.', side: -1, tx: K.X(spanX * 0.35), ty: K.Y(zAt(spanX * 0.35) + memD / 2) },
        { t: 'BAFFLE — 1" MIN AIR @ VENT', side: -1, tx: K.X(spanX * 0.25), ty: K.Y(zAt(spanX * 0.25) + 1) },
        { t: 'CLG JOIST 2X6 @ 16" O.C. — FACE-NAIL TO RAFTER PER T. R802.5.2 + (3) 8d TOE TO PLATE', tx: K.X(8.5), ty: K.Y(3.4) },
        { t: 'CLG INSUL PER T24 (R-38 TYP)', tx: K.X(spanX - 5), ty: K.Y(6.8) },
        exposed ? null : { t: '2X FASCIA' + (closed ? ' + GUTTER PER PLAN' : ''), side: -1, tx: K.X(tailX - 0.75), ty: K.Y(zAt(tailX) + memD - 2) },
        closed ? { t: 'VENTED SOFFIT — CONT. 2" STRIP VENT', side: -1, tx: K.X(tailX / 2), ty: K.Y(zAt(tailX) + 0.75) } : null,
        exposed ? { t: 'EXPOSED RAFTER TAILS — PLUMB CUT', side: -1, tx: K.X(tailX + 2), ty: K.Y(zAt(tailX) + memD / 2) } : null,
        { t: 'FULL-DEPTH 2X BLOCKING — 8d TOE-NAIL @ 6" O.C. TO PLATE (OR A35) — SHEAR TRANSFER', tx: K.X(bx1 - 1.5), ty: K.Y(0.6) },
        { t: 'WALL SHTG EDGE-NAILED TO DBL TOP PLATE — 8d @ 6" O.C. E.N.', tx: K.X(-sh - 0.5), ty: K.Y(-1.2) },
        { t: 'DBL TOP PLATE', tx: K.X(stud.d / 2), ty: K.Y(-2.4) },
        { t: (prod('sidingSpec', model) || 'CLADDING') + ' O/ WRB', side: -1, tx: K.X(-cl - sh + cl / 2), ty: K.Y(-14) },
      ], K.X(spanX) + ppi * 0.5, K.X(tailX - 2) - ppi * 0.15, panelOf(item, ppi));
      ctx.restore();
      caption(ctx, ppi, item, this.title, '1" = 1\'-0"');
    },
  };

  /* ============ DETAIL: TYPICAL EXTERIOR WALL ============ */
  const wallDetail = {
    id: 'wallsection',
    title: 'TYPICAL EXTERIOR WALL',
    // stick detail yields to the SIP wall detail when SIPs dominate the shell
    applies: (model) => !sipDominant(model),
    draw(ctx, model, item, ppi) {
      const asm = asmOf(model);
      const stud = studOf(model);
      const fd = model.foundation || {};
      const slab = (fd.type || 'slab') !== 'raised';
      const sc = 1 / 12;
      const s = sc * ppi;
      const px = item.x * ppi + 1.1 * ppi, py = item.y * ppi + 0.08 * ppi;
      const K = kit(ctx, ppi, px, py, s);
      const H = 40;                                          // drawn wall height stub
      ctx.save();
      ctx.lineWidth = K.hair; ctx.strokeStyle = '#111';
      const cl = Math.max(0.6, asm.cladding), sh = Math.max(0.4, asm.sheathing), gy = Math.max(0.4, asm.drywall);
      // layers, outside at left (x=0 = stud face out)
      K.rect(-cl - sh, -0, cl, H - 2, CLAD);
      K.rect(-sh, 0, sh, H, SHTG);
      K.rect(0, 0, stud.d, H, '#f7f5f1');
      K.batt(0, -1.8, -(H - (slab ? 3.2 : 3.2)), stud.d);
      K.rect(stud.d, 0, gy, H - 1.5, GYP);
      // plates + bearing
      K.xRect(0, -(H - 3), stud.d, 1.5);                     // bottom plate
      if (slab) {
        // slab edge: PT plate on concrete w/ anchor bolt
        ctx.fillStyle = CONC;
        ctx.fillRect(K.X(-cl - sh - 4), K.Y(-(H - 1.5)), (cl + sh + stud.d + gy + 10) * s, (fd.slabThickness || 4) * s + 14 * s);
        ctx.strokeRect(K.X(-cl - sh - 4), K.Y(-(H - 1.5)), (cl + sh + stud.d + gy + 10) * s, (fd.slabThickness || 4) * s + 14 * s);
        // anchor bolt through the plate
        ctx.strokeStyle = '#333';
        K.line(stud.d / 2, -(H - 3), stud.d / 2, -(H + 4));
        K.line(stud.d / 2 - 1.2, -(H - 3.4), stud.d / 2 + 1.2, -(H - 3.4));   // washer/nut
        ctx.strokeStyle = '#111';
        // grade + earth
        ctx.fillStyle = EARTH;
        ctx.fillRect(K.X(-cl - sh - 14), K.Y(-(H + 1)), 10 * s, 10 * s);
      }
      // mark tie-in header
      const notes = [
        { t: (prod('sidingSpec', model) || 'CLADDING PER ELEVATIONS') + ' — ' + (Math.round(cl * 100) / 100) + '"', tx: K.X(-cl - sh + cl / 2), ty: K.Y(-6) },
        { t: 'WRB — CONT., LAP SHINGLE-STYLE', tx: K.X(-sh - 0.1), ty: K.Y(-10) },
        { t: (Math.round(sh * 100) / 100) + '" WD STRUCT PANEL SHTG', tx: K.X(-sh / 2), ty: K.Y(-14) },
        { t: stud.name + ' STUDS @ ' + spacingOf(model) + '" O.C. + ' + stud.batt + ' BATT', tx: K.X(stud.d / 2), ty: K.Y(-19) },
        { t: (Math.round(gy * 100) / 100) + '" GYP BD — INT.', tx: K.X(stud.d + gy / 2), ty: K.Y(-24) },
        { t: slab ? 'PT MUDSILL + 5/8"Ø A.B. PER R403.1.6' : 'RIM + MUDSILL — SEE FOUNDATION DETAIL', tx: K.X(stud.d / 2), ty: K.Y(-(H - 2.2)) },
        { t: 'SEE WALL SCHEDULE (A2.x) FOR TYPES', tx: K.X(stud.d + gy), ty: K.Y(-30) },
      ];
      notesCol(ctx, ppi, notes, K.X(stud.d + gy) + ppi * 0.5, null, panelOf(item, ppi));
      ctx.restore();
      caption(ctx, ppi, item, this.title, '1" = 1\'-0"');
    },
  };

  /* ========= DETAIL: WINDOW HEAD / SILL + FLASHING ========= */
  const openingDetail = {
    id: 'openinghead',
    title: 'WINDOW HEAD & SILL',
    applies: (model) => !sipDominant(model) &&
      model.levels.some((l) => l.walls.some((w) => (w.openings || []).some((o) => o.type !== 'door'))),
    draw(ctx, model, item, ppi) {
      const asm = asmOf(model);
      const stud = studOf(model);
      const sc = 1 / 8;                                     // fat scale, 1-1/2"=1'-0"
      const s = sc * ppi * 1.5;
      const px = item.x * ppi + 1.1 * ppi, py = item.y * ppi + 0.1 * ppi;
      const K = kit(ctx, ppi, px, py, s);
      const cl = Math.max(0.6, asm.cladding), sh = Math.max(0.4, asm.sheathing), gy = Math.max(0.4, asm.drywall);
      ctx.save();
      ctx.lineWidth = K.hair; ctx.strokeStyle = '#111';
      /* HEAD (top block): header over the opening, flashing over the trim */
      const hdrD = 7.25;                                     // 4x8 header default callout
      K.rect(-cl - sh, 0, cl, 6, CLAD);
      K.rect(-sh, 0, sh, 6 + hdrD, SHTG);
      K.xRect(0, 0, stud.d, hdrD, WOOD);                     // header (drafting X)
      K.rect(stud.d, 0, gy, 6 + hdrD, GYP);
      K.rect(-cl - sh, -(6), cl + 0.4, 1.2, WOOD2);          // head trim
      // head flashing — Z over the trim
      ctx.strokeStyle = '#2e86c1'; ctx.lineWidth = Math.max(1.3, ppi * 0.015);
      ctx.beginPath();
      ctx.moveTo(K.X(-sh), K.Y(-4.6));
      ctx.lineTo(K.X(-cl - sh - 0.5), K.Y(-4.6));
      ctx.lineTo(K.X(-cl - sh - 0.5), K.Y(-5.4));
      ctx.stroke();
      ctx.strokeStyle = '#111'; ctx.lineWidth = K.hair;
      // window frame head
      K.rect(-sh - 0.4, -(hdrD - 0.2), 2, 1.6, '#dfe7ee');
      K.line(-sh + 0.6, -(hdrD + 1.2), -sh + 0.6, -(hdrD + 8)); // glazing line down
      /* SILL (lower block, offset down) */
      const sy = -(hdrD + 12);                               // sill top z
      K.rect(-cl - sh, sy, cl, 8, CLAD);
      K.rect(-sh, sy + 1.5, sh, 9.5, SHTG);
      K.xRect(0, sy, stud.d, 1.5);                           // 2x sill plate (dbl opt.)
      K.rect(stud.d, sy, gy, 8, GYP);
      // sloped exterior sill + pan
      ctx.fillStyle = WOOD2;
      ctx.beginPath();
      ctx.moveTo(K.X(-sh), K.Y(sy + 1.7));
      ctx.lineTo(K.X(-cl - sh - 1.2), K.Y(sy + 0.8));
      ctx.lineTo(K.X(-cl - sh - 1.2), K.Y(sy + 0.2));
      ctx.lineTo(K.X(-sh), K.Y(sy + 1.1));
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#2e86c1'; ctx.lineWidth = Math.max(1.3, ppi * 0.015);
      ctx.beginPath();                                       // sill pan — turns up at back
      ctx.moveTo(K.X(-cl - sh - 1.0), K.Y(sy + 1.0));
      ctx.lineTo(K.X(-sh + 0.2), K.Y(sy + 1.9));
      ctx.lineTo(K.X(-sh + 0.2), K.Y(sy + 3.4));
      ctx.stroke();
      ctx.strokeStyle = '#111'; ctx.lineWidth = K.hair;
      K.rect(-sh - 0.4, sy + 3.4, 2, 1.6, '#dfe7ee');        // window frame sill
      K.line(-sh + 0.6, sy + 3.4, -sh + 0.6, sy + 9);        // glazing line up
      notesCol(ctx, ppi, [
        { t: 'HDR PER PLAN (4X8 U.N.O.) — 2 TRIMMERS @ >6\'', tx: K.X(stud.d / 2), ty: K.Y(hdrD / 2) },
        { t: 'HEAD FLASHING — LAP WRB OVER', tx: K.X(-cl - sh - 0.4), ty: K.Y(-4.8) },
        { t: 'SEALANT + BACKER @ FRAME PERIM.', tx: K.X(-sh - 0.3), ty: K.Y(-(hdrD - 0.4)) },
        { t: 'WINDOW PER SCHEDULE (A8.0) — FIN OR FLANGE', tx: K.X(-sh + 0.6), ty: K.Y(-(hdrD + 4)) },
        { t: 'SILL PAN — TURN UP 4" @ JAMBS + BACK DAM', tx: K.X(-sh - 0.2), ty: K.Y(sy + 2.2) },
        { t: 'SLOPED SILL — 1/4"/FT MIN', tx: K.X(-cl - sh - 0.6), ty: K.Y(sy + 0.6) },
        { t: '2X SILL PLATE', tx: K.X(stud.d / 2), ty: K.Y(sy + 0.75) },
      ], K.X(stud.d + gy) + ppi * 0.5, null, panelOf(item, ppi));
      ctx.restore();
      caption(ctx, ppi, item, this.title, '3" = 1\'-0"');
    },
  };

  /* ============ DETAIL: FOUNDATION @ EXT. WALL ============ */
  const foundationDetail = {
    id: 'foundationdetail',
    title: 'FOUNDATION @ EXT. WALL',
    // yields to the SIP-to-foundation detail when SIPs dominate the shell
    applies: (model) => !!(model.foundation && model.foundation.enabled) && !sipDominant(model),
    draw(ctx, model, item, ppi) {
      const fd = model.foundation || {};
      const raised = fd.type === 'raised';
      const stud = studOf(model);
      const fw = fd.footingWidth || 12, fdp = fd.footingDepth || 12;
      const stemH = raised ? (fd.stemHeight || 18) : 0;
      const slabT = fd.slabThickness || 4;
      const rb = fd.rebar || {};
      const bar = rb.bar || '#4';
      const sc = 1 / 10;
      const s = sc * ppi;
      // baseline (grade z=0) sits BELOW the tallest drawn stack so the floor
      // platform / wall stub never pokes above the cell top
      const topZ = raised ? (stemH + 18) : (slabT + 12);
      const px = item.x * ppi + 1.6 * ppi, py = item.y * ppi + 0.35 * ppi + topZ * s;
      const K = kit(ctx, ppi, px, py, s);
      ctx.save();
      ctx.lineWidth = K.hair; ctx.strokeStyle = '#111';
      const stemW = 6;
      if (raised) {
        const ftgTop = -6;                                   // footing top 6" below grade
        const ftgBot = ftgTop - fdp;
        // EARTH wraps the concrete (was a floating soil column running well past
        // the footing): one bed from just below the crawl grade down to 4" under
        // the footing, plus the exterior bank up to finish grade. The stem +
        // footing paint OVER it, so the soil reads as ground around the pour.
        ctx.fillStyle = EARTH;
        ctx.fillRect(K.X(-fw - 4), K.Y(-2), (fw + 4 + stemW / 2 + 16) * s, (-2 - ftgBot + 4) * s);
        ctx.fillRect(K.X(-fw - 4), K.Y(0), (fw + 4 - stemW / 2) * s, 2 * s);   // exterior bank above crawl grade
        // grade lines: finish grade (exterior) + crawl grade (interior)
        ctx.strokeStyle = '#4a6b3a'; ctx.lineWidth = Math.max(1.4, ppi * 0.016);
        K.line(-fw - 6, 0, -stemW / 2, 0);
        ctx.lineWidth = Math.max(1, ppi * 0.011);
        K.line(stemW / 2, -2, stemW / 2 + 15, -2);
        ctx.strokeStyle = '#111'; ctx.lineWidth = K.hair;
        // stem (grade to sill seat) + spread footing — concrete fills
        K.rect(-stemW / 2, stemH, stemW, stemH - ftgTop, CONC);
        K.rect(-fw / 2, ftgTop, fw, fdp, CONC);
        // rebar: footing longitudinal bars + stem vertical dowel w/ hook
        ctx.fillStyle = '#b03a2e'; ctx.strokeStyle = '#b03a2e';
        const nB = rb.footingBars || 2;
        for (let i = 0; i < nB; i++) {
          const bx = -fw / 2 + (fw / (nB + 1)) * (i + 1);
          ctx.beginPath(); ctx.arc(K.X(bx), K.Y(ftgBot + 3), Math.max(1.6, ppi * 0.02), 0, 7); ctx.fill();
        }
        ctx.lineWidth = Math.max(1.2, ppi * 0.014);
        K.line(0, stemH - 2, 0, ftgBot + 3);                 // vertical dowel
        K.line(0, ftgBot + 3, Math.min(4, fw / 3), ftgBot + 3); // hook into footing
        ctx.strokeStyle = '#111'; ctx.lineWidth = K.hair;
        // mudsill + anchor bolt + rim + joist bay + subfloor + wall stub
        K.xRect(-stemW / 2, stemH + 1.5, stemW, 1.5, WOOD2);  // PT mudsill on the stem
        ctx.strokeStyle = '#333';
        K.line(0, stemH + 1.5, 0, stemH - 7);                 // anchor bolt into stem
        K.line(-1.2, stemH + 1.5, 1.2, stemH + 1.5);          // washer/nut at plate top
        ctx.strokeStyle = '#111';
        const rimTop = stemH + 1.5 + 9.25;
        K.xRect(-stemW / 2, rimTop, 1.5, 9.25);               // rim joist (cut)
        K.rect(-stemW / 2 + 1.5, rimTop, 14, 9.25, '#f7f5f1'); // joist bay beyond
        K.rect(-stemW / 2, rimTop + 1.1, 16, 1.1, WOOD);      // subfloor
        K.xRect(-stemW / 2, rimTop + 1.1 + 1.5, stud.d, 1.5); // bottom plate
        notesCol(ctx, ppi, [
          // sill matches the STEM width (2x6 on a 6" stem), not the stud depth
          { t: '2X' + Math.round(stemW) + ' PT MUDSILL + 5/8"Ø A.B. @ 6\'-0" O.C. (R403.1.6)', tx: K.X(0), ty: K.Y(stemH + 2.2) },
          { t: 'RIM JOIST — FIRE BLOCKING PER R302.11', tx: K.X(-stemW / 2 + 0.75), ty: K.Y(stemH + 1.5 + 4.6 + 4.6) },
          { t: 'STEM ' + stemW + '" W × ' + HA.U.fmtLen(stemH) + ' ABV GRADE', tx: K.X(0), ty: K.Y(stemH / 2) },
          { t: bar + ' VERT DOWELS @ ' + (rb.stemVertOC || 48) + '" O.C. — HOOK @ FTG', tx: K.X(0.4), ty: K.Y(2) },
          { t: 'FTG ' + fw + '"W × ' + fdp + '"D — (' + (rb.footingBars || 2) + ') ' + bar + ' CONT.', tx: K.X(fw / 4), ty: K.Y(-6 - fdp + 3) },
          { t: '6" MIN CLR GRADE→WOOD (R317)', tx: K.X(-stemW / 2 - 2), ty: K.Y(stemH * 0.75), red: stemH < 6 },
          { t: '18" MIN CRAWL CLEARANCE (R408)', tx: K.X(stemW / 2 + 5), ty: K.Y(stemH + 3) },
        ], K.X(stemW / 2 + 14) + ppi * 0.5, null, panelOf(item, ppi));
      } else {
        // EARTH: bank left of the form face + bed under the whole pour (the
        // thickened-edge poly paints over it)
        ctx.fillStyle = EARTH;
        ctx.fillRect(K.X(-fw - 4), K.Y(0), (fw + 4 + fw / 2 + 26) * s, (fdp - slabT + 6) * s);
        ctx.strokeStyle = '#4a6b3a'; ctx.lineWidth = Math.max(1.4, ppi * 0.016);
        K.line(-fw - 6, 0, -stemW / 2 - 2, 0);               // finish grade to the form face
        ctx.strokeStyle = '#111'; ctx.lineWidth = K.hair;
        // slab: thickened edge monopour
        ctx.fillStyle = CONC;
        ctx.beginPath();                                     // slab + turned-down edge as one poly
        ctx.moveTo(K.X(-stemW / 2 - 2), K.Y(slabT + 2));     // slab top out at form edge
        ctx.lineTo(K.X(24), K.Y(slabT + 2));
        ctx.lineTo(K.X(24), K.Y(2));
        ctx.lineTo(K.X(fw / 2), K.Y(2));
        ctx.lineTo(K.X(fw / 2), K.Y(-(fdp - slabT)));
        ctx.lineTo(K.X(-fw / 2), K.Y(-(fdp - slabT)));
        ctx.lineTo(K.X(-fw / 2), K.Y(slabT - 2));
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // vapor barrier under slab — dashed
        ctx.save();
        ctx.setLineDash([5, 3]); ctx.strokeStyle = '#555';
        K.line(2, 1.4, 24, 1.4);
        ctx.restore();
        // rebar: slab mesh dots + edge bars
        ctx.fillStyle = '#b03a2e';
        for (let bx = 4; bx <= 22; bx += 6) { ctx.beginPath(); ctx.arc(K.X(bx), K.Y(slabT / 2 + 2), Math.max(1.4, ppi * 0.018), 0, 7); ctx.fill(); }
        const nB = fd.rebar && fd.rebar.footingBars || 2;
        for (let i = 0; i < nB; i++) { ctx.beginPath(); ctx.arc(K.X(-fw / 4 + (i * fw) / (2 * nB)), K.Y(-(fdp - slabT - 3)), Math.max(1.6, ppi * 0.02), 0, 7); ctx.fill(); }
        ctx.fillStyle = '#111';
        // PT plate + AB + wall stub
        K.xRect(-stemW / 2, slabT + 2 + 1.5, stud.d, 1.5, WOOD2);
        ctx.strokeStyle = '#333';
        K.line(-stemW / 2 + stud.d / 2, slabT + 3.5, -stemW / 2 + stud.d / 2, slabT - 4);
        ctx.strokeStyle = '#111';
        notesCol(ctx, ppi, [
          { t: 'PT PLATE + 5/8"Ø A.B. @ 6\'-0" O.C., 7" MIN EMBED (R403.1.6)', tx: K.X(-stemW / 2 + stud.d / 2), ty: K.Y(slabT + 2.6) },
          { t: slabT + '" CONC SLAB — ' + bar + ' @ 18" O.C.E.W.', tx: K.X(12), ty: K.Y(slabT / 2 + 2) },
          { t: '10-MIL VAPOR RETARDER O/ 4" BASE', tx: K.X(14), ty: K.Y(1.4) },
          { t: 'THICKENED EDGE ' + fw + '"W × ' + fdp + '"D — (' + nB + ') ' + bar + ' CONT.', tx: K.X(0), ty: K.Y(-(fdp - slabT - 3)) },
          { t: 'FIN GRADE — SLOPE 5% AWAY 10\' (R401.3)', tx: K.X(-fw + 3), ty: K.Y(0) },
        ], K.X(24) + ppi * 0.5, null, panelOf(item, ppi));
      }
      ctx.restore();
      caption(ctx, ppi, item, this.title + (raised ? ' (RAISED)' : ' (SLAB)'), '1" = 1\'-0"');
    },
  };

  /* ============ DETAIL: DECK LEDGER @ RIM ============ */
  const deckLedgerDetail = {
    id: 'deckledger',
    title: 'DECK LEDGER @ RIM',
    applies: (model) => model.levels.some((l) => (l.decks || []).length > 0),
    draw(ctx, model, item, ppi) {
      const asm = asmOf(model);
      const sc = 1 / 8;                                    // 1-1/2" = 1'-0"
      const s = sc * ppi * 1.5;
      // baseline: highest drawn z is +13 (wall stub) → anchor so the whole
      // stack sits between the cell top and the caption line
      const px = item.x * ppi + 1.8 * ppi, py = item.y * ppi + 0.4 * ppi + 13 * s;
      const K = kit(ctx, ppi, px, py, s);
      const cl = Math.max(0.6, asm.cladding), sh = Math.max(0.4, asm.sheathing);
      ctx.save();
      ctx.lineWidth = K.hair; ctx.strokeStyle = '#111';
      // HOUSE side (right of x=0 = sheathing face): rim joist + subfloor + plates
      K.rect(0, 12, sh, 24, SHTG);                          // wall sheathing strip
      K.xRect(sh, 4, 1.5, 9.25);                            // house rim joist (cut)
      K.rect(sh + 1.5, 4, 12, 9.25, '#f7f5f1');             // house joist bay
      K.rect(sh, 5.1, 14, 1.1, WOOD);                       // subfloor
      K.xRect(sh, 8.1, 5.5, 1.5);                           // bottom plate above (stub)
      K.rect(sh, 12, 5.5, 3, '#f7f5f1');                    // wall stub
      // LEDGER bolted through sheathing to the rim
      K.xRect(-1.5, 3.4, 1.5, 9.25, WOOD2);                 // 2x ledger (cut)
      // through-bolts: two staggered
      ctx.strokeStyle = '#333'; ctx.lineWidth = Math.max(1.1, ppi * 0.012);
      K.line(-2.2, 1.2, sh + 1.8, 1.2); K.line(-2.2, -2.4, sh + 1.8, -2.4);
      ctx.strokeStyle = '#111'; ctx.lineWidth = K.hair;
      // DECK joist on hanger + decking
      K.xRect(-14, 2.9, 12.5, 9.25, WOOD);                  // deck joist (end at hanger)
      K.rect(-16, 4.2, 16, 1.1, WOOD2);                     // decking boards
      // joist hanger — U strap lines
      ctx.strokeStyle = '#555'; ctx.lineWidth = Math.max(1.2, ppi * 0.014);
      K.line(-1.5, 2.4, -3.6, 2.4); K.line(-3.6, 2.4, -3.6, -5.4); K.line(-3.6, -5.4, -1.5, -5.4);
      ctx.strokeStyle = '#111'; ctx.lineWidth = K.hair;
      // Z-flashing over the ledger, up behind cladding
      ctx.strokeStyle = '#2e86c1'; ctx.lineWidth = Math.max(1.3, ppi * 0.015);
      ctx.beginPath();
      ctx.moveTo(K.X(0.2), K.Y(8));
      ctx.lineTo(K.X(0.2), K.Y(3.6));
      ctx.lineTo(K.X(-1.7), K.Y(3.6));
      ctx.lineTo(K.X(-1.7), K.Y(2.6));
      ctx.stroke();
      ctx.strokeStyle = '#111'; ctx.lineWidth = K.hair;
      notesCol(ctx, ppi, [
        { t: 'DECKING PER PLAN', tx: K.X(-10), ty: K.Y(3.8) },
        { t: 'LEDGER FLASHING — UP BEHIND WRB, OVER LEDGER (R703.4)', tx: K.X(-0.7), ty: K.Y(3.2) },
        { t: '2X LEDGER — 1/2"Ø THRU-BOLTS/LEDGERLOK PER R507.9.1.3(1)', tx: K.X(-0.75), ty: K.Y(-0.8) },
        { t: 'JOIST HANGER EA. JOIST (SIMPSON LUS OR EQ.)', tx: K.X(-3.6), ty: K.Y(-3.5) },
        { t: 'DECK JOIST PER PLAN', tx: K.X(-9), ty: K.Y(-1.5) },
        { t: 'LATERAL LOAD CONNECTION REQ\'D — R507.9.2 (2 LOCATIONS)', tx: K.X(sh + 2.5), ty: K.Y(0) },
        { t: 'NO SHEATHING GAP — BOLT THRU RIM, VERIFY MEMBER (SSD IF STEEL)', tx: K.X(sh + 0.75), ty: K.Y(6) },
      ], K.X(sh + 15) + ppi * 0.4, null, panelOf(item, ppi));
      ctx.restore();
      caption(ctx, ppi, item, this.title, '1-1/2" = 1\'-0"');
    },
  };

  /* ========= DETAIL: ROOF-TO-WALL (step flashing + kickout) ========= */
  const roofWallDetail = {
    id: 'rooftowall',
    title: 'ROOF-TO-WALL @ 2ND STORY',
    // fires when a lower roof can meet an upper wall (2+ levels w/ roof)
    applies: (model) => model.levels.length >= 2 && !!(model.roof && model.roof.enabled),
    draw(ctx, model, item, ppi) {
      const asm = asmOf(model);
      const stud = studOf(model);
      const pitch = (model.roof && model.roof.pitch) || 6;
      const slope = pitch / 12;
      const sc = 1 / 10;
      const s = sc * ppi;
      const cl = Math.max(0.6, asm.cladding), sh = Math.max(0.4, asm.sheathing);
      // origin: upper-wall sheathing face (x=0, wall to the right), lower-roof
      // deck plane passing z=0 at the wall; roof slopes DOWN to the left
      const px = item.x * ppi + 2.2 * ppi, py = item.y * ppi + 0.4 * ppi + 22 * s;
      const K = kit(ctx, ppi, px, py, s);
      const zAt = (wx) => wx * slope;                        // deck rise toward the wall
      ctx.save();
      ctx.lineWidth = K.hair; ctx.strokeStyle = '#111';
      // UPPER WALL: stud bay + sheathing; siding held ABOVE the roof (2" gap)
      K.rect(0, 20, stud.d, 34, '#f7f5f1');                  // stud bay
      K.batt(0, 19, -13, stud.d);
      K.rect(-sh, 20, sh, 34, SHTG);                         // wall sheathing runs DOWN past the roof deck
      K.rect(-cl - sh, 20, cl, 16.5, CLAD);                  // siding STOPS 2" above the roof surface
      // LOWER ROOF: rafter + deck + shingles sloping away from the wall
      const rx0 = -26;                                       // drawn up-slope extent (left)
      ctx.fillStyle = WOOD;
      ctx.beginPath();                                       // rafter (plumb cut at the wall)
      ctx.moveTo(K.X(rx0), K.Y(zAt(rx0)));
      ctx.lineTo(K.X(-sh), K.Y(zAt(-sh)));
      ctx.lineTo(K.X(-sh), K.Y(zAt(-sh) - 7.25));
      ctx.lineTo(K.X(rx0), K.Y(zAt(rx0) - 7.25));
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = SHTG;                                  // roof sheathing band
      ctx.beginPath();
      ctx.moveTo(K.X(rx0), K.Y(zAt(rx0) + 0.5)); ctx.lineTo(K.X(-sh), K.Y(zAt(-sh) + 0.5));
      ctx.lineTo(K.X(-sh), K.Y(zAt(-sh))); ctx.lineTo(K.X(rx0), K.Y(zAt(rx0)));
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = Math.max(1.6, ppi * 0.02);             // shingles = heavy line
      K.line(rx0 - 1, zAt(rx0) + 1.1, -sh - 1, zAt(-sh) + 1.1);
      ctx.lineWidth = K.hair;
      // STEP FLASHING: L-pieces up the wall, one per course (drawn as a sawtooth
      // of verticals against the sheathing + short roof legs)
      ctx.strokeStyle = '#2e86c1'; ctx.lineWidth = Math.max(1.3, ppi * 0.015);
      for (let i = 0; i < 4; i++) {
        const wx = -sh - 1 - i * 5;
        K.line(-sh, zAt(wx) + 1.1 + 4, -sh, zAt(wx) + 1.1);   // vertical leg on the wall
        K.line(-sh, zAt(wx) + 1.1, wx, zAt(wx) + 1.1);        // roof leg under the course
      }
      // KICKOUT at the eave end (schematic hook at the low end)
      ctx.beginPath();
      ctx.moveTo(K.X(rx0 + 2), K.Y(zAt(rx0 + 2) + 1.1));
      ctx.lineTo(K.X(rx0), K.Y(zAt(rx0) + 4));
      ctx.stroke();
      ctx.strokeStyle = '#111'; ctx.lineWidth = K.hair;
      notesCol(ctx, ppi, [
        { t: 'SIDING HELD 2" MIN ABV ROOF — NO CAULK JOINT', tx: K.X(-cl - sh + cl / 2), ty: K.Y(4.5), side: -1 },
        { t: 'STEP FLASHING 4"x4" MIN EA. COURSE — LAP WRB OVER (R903.2)', tx: K.X(-sh), ty: K.Y(zAt(-sh - 6) + 3), side: -1 },
        { t: 'KICKOUT DIVERTER @ EAVE TERMINATION — TO GUTTER', tx: K.X(rx0 + 1), ty: K.Y(zAt(rx0) + 3), side: -1 },
        { t: 'WRB LAPS OVER FLASHING VERT LEG — SHINGLE-STYLE', tx: K.X(-sh - 0.2), ty: K.Y(12) },
        { t: stud.sip ? 'UPPER WALL SIP PANEL — OSB SKINS CONT. PAST DECK'
          : 'UPPER WALL ' + stud.name + ' STUDS + SHTG CONT. PAST DECK', tx: K.X(stud.d / 2), ty: K.Y(16) },
        { t: 'LOWER ROOF RAFTER — PLUMB CUT @ WALL, HANGER/LEDGER PER PLAN', tx: K.X(-10), ty: K.Y(zAt(-10) - 3.6) },
      ], K.X(stud.d) + ppi * 0.4, K.X(rx0 - 2) - ppi * 0.15, panelOf(item, ppi));
      ctx.restore();
      caption(ctx, ppi, item, this.title, '1" = 1\'-0"');
    },
  };

  /* ============ DETAIL: TYPICAL SIP EXTERIOR WALL ============
     Vertical section through the panel: cladding | WRB | OSB skin | EPS core |
     OSB skin | gyp, with the lumber chassis (sole plate at core width) and the
     factory electrical chases called out. Applies when SIPs dominate the shell. */
  const sipWallDetail = {
    id: 'sipwallsection',
    title: 'TYPICAL SIP EXTERIOR WALL',
    applies: (model) => sipDominant(model),
    draw(ctx, model, item, ppi) {
      const asm = asmOf(model);
      const stud = studOf(model);
      const T = stud.T || HA.WALL_TYPES.ext_sip65 || {};
      const sk = T.skin || 0.4375;
      const core = T.core || 5.5;
      const panel = core + 2 * sk;
      const rVal = HA.sipPanelR ? HA.sipPanelR(T) : 22;
      const fd = model.foundation || {};
      const slab = (fd.type || 'slab') !== 'raised';
      const sc = 1 / 12;
      const s = sc * ppi;
      const px = item.x * ppi + 1.1 * ppi, py = item.y * ppi + 0.08 * ppi;
      const K = kit(ctx, ppi, px, py, s);
      const H = 40;                                          // drawn wall height stub
      ctx.save();
      ctx.lineWidth = K.hair; ctx.strokeStyle = '#111';
      const cl = Math.max(0.6, asm.cladding), gy = Math.max(0.4, asm.drywall);
      // layers, outside at left (x=0 = OSB skin exterior face)
      K.rect(-cl, 0, cl, H - 2, CLAD);                       // factory cladding
      K.rect(0, 0, sk, H, OSB);                              // exterior OSB skin
      K.rect(sk, 0, core, H, FOAM);                          // EPS core
      K.rect(sk + core, 0, sk, H, OSB);                      // interior OSB skin
      K.rect(panel, 0, gy, H - 1.5, GYP);                    // gyp
      // lumber chassis: sole plate at CORE width between the skins
      K.xRect(sk, -(H - 3), core, 1.5);
      // factory wire chase in the core @ 16" AFF (44" noted — above this stub)
      const chaseZ = -(H - 17.5);
      ctx.beginPath();
      ctx.arc(K.X(sk + core / 2), K.Y(chaseZ), Math.max(2.5, 0.75 * s), 0, 7);
      ctx.stroke();
      if (slab) {
        ctx.fillStyle = CONC;
        ctx.fillRect(K.X(-cl - 4), K.Y(-(H - 1.5)), (cl + panel + gy + 10) * s, (fd.slabThickness || 4) * s + 14 * s);
        ctx.strokeRect(K.X(-cl - 4), K.Y(-(H - 1.5)), (cl + panel + gy + 10) * s, (fd.slabThickness || 4) * s + 14 * s);
        ctx.strokeStyle = '#333';
        K.line(sk + core / 2, -(H - 3), sk + core / 2, -(H + 4));   // anchor bolt
        K.line(sk + core / 2 - 1.2, -(H - 3.4), sk + core / 2 + 1.2, -(H - 3.4));
        ctx.strokeStyle = '#111';
        ctx.fillStyle = EARTH;
        ctx.fillRect(K.X(-cl - 14), K.Y(-(H + 1)), 10 * s, 10 * s);
      }
      const notes = [
        { t: 'CLADDING — FACTORY-APPLIED PER SIP MFR (SITE PER ELEVATIONS)', tx: K.X(-cl / 2), ty: K.Y(-5) },
        { t: 'WRB — CONT., LAP SHINGLE-STYLE', tx: K.X(-0.1), ty: K.Y(-9) },
        { t: '7/16" OSB SKIN EA. FACE (ANSI/APA PRS 610.1)', tx: K.X(sk / 2), ty: K.Y(-13) },
        { t: 'EPS CORE ' + core + '" — R-' + rVal + ' PANEL', tx: K.X(sk + core / 2), ty: K.Y(-18) },
        { t: 'WIRE CHASES @ 16" + 44" AFF — FACTORY-CUT IN CORE', tx: K.X(sk + core / 2), ty: K.Y(chaseZ) },
        { t: (Math.round(gy * 100) / 100) + '" GYP BD — INT.', tx: K.X(panel + gy / 2), ty: K.Y(-23) },
        { t: 'PANEL JOINTS: SURFACE SPLINE + SIP SEALANT + TAPE EA. SIDE', tx: K.X(sk + core), ty: K.Y(-27) },
        { t: slab ? '2X SOLE PLATE (CORE WIDTH) + 5/8"Ø A.B. PER R403.1.6' : '2X SOLE PLATE — SEE SIP FOUNDATION DETAIL', tx: K.X(sk + core / 2), ty: K.Y(-(H - 2.2)) },
        { t: 'PANEL LAYOUT + CONNECTIONS PER SIP MFR SHOP DWGS (ICC-ES)', tx: K.X(panel + gy), ty: K.Y(-31) },
      ];
      notesCol(ctx, ppi, notes, K.X(panel + gy) + ppi * 0.5, null, panelOf(item, ppi));
      ctx.restore();
      caption(ctx, ppi, item, this.title, '1" = 1\'-0"');
    },
  };

  /* ========= DETAIL: SIP WINDOW HEAD / SILL (2x bucks in foam recess) ========= */
  const sipOpeningDetail = {
    id: 'sipopeninghead',
    title: 'SIP WINDOW HEAD & SILL',
    applies: (model) => sipDominant(model) &&
      model.levels.some((l) => l.walls.some((w) => (w.openings || []).some((o) => o.type !== 'door'))),
    draw(ctx, model, item, ppi) {
      const asm = asmOf(model);
      const stud = studOf(model);
      const T = stud.T || HA.WALL_TYPES.ext_sip65 || {};
      const sk = T.skin || 0.4375;
      const core = T.core || 5.5;
      const panel = core + 2 * sk;
      const sc = 1 / 8;
      const s = sc * ppi * 1.5;
      const px = item.x * ppi + 1.1 * ppi, py = item.y * ppi + 0.1 * ppi;
      const K = kit(ctx, ppi, px, py, s);
      const cl = Math.max(0.6, asm.cladding), gy = Math.max(0.4, asm.drywall);
      ctx.save();
      ctx.lineWidth = K.hair; ctx.strokeStyle = '#111';
      /* HEAD block: panel above the opening — skins run to the RO, foam recessed
         1-1/2" for the 2x head buck */
      const REC = 1.5;
      const headH = 8;                                       // drawn panel stub above
      K.rect(-cl, 0, cl, headH - 1, CLAD);
      K.rect(0, 0, sk, headH, OSB);                          // ext skin runs to the RO
      K.rect(sk, 0, core, headH - REC, FOAM);                // foam stops short (recess)
      K.rect(sk + core, 0, sk, headH, OSB);                  // int skin runs to the RO
      K.rect(panel, 0, gy, headH, GYP);
      K.xRect(sk, -(headH - REC), core, REC, WOOD);          // 2x head buck in the recess
      // head flashing — Z over the trim line
      ctx.strokeStyle = '#2e86c1'; ctx.lineWidth = Math.max(1.3, ppi * 0.015);
      ctx.beginPath();
      ctx.moveTo(K.X(0), K.Y(-(headH - 1.4)));
      ctx.lineTo(K.X(-cl - 0.5), K.Y(-(headH - 1.4)));
      ctx.lineTo(K.X(-cl - 0.5), K.Y(-(headH - 0.6)));
      ctx.stroke();
      ctx.strokeStyle = '#111'; ctx.lineWidth = K.hair;
      K.rect(-0.4, -(headH + 0.2), 2, 1.6, '#dfe7ee');       // window frame head
      K.line(0.6, -(headH + 1.8), 0.6, -(headH + 7));        // glazing line down
      /* SILL block (offset down): 2x sill buck in the recess, sloped sill + pan */
      const sy = -(headH + 12);                              // sill top z (RO line)
      K.rect(-cl, sy, cl, 8, CLAD);
      K.rect(0, sy, sk, 9.5, OSB);                           // ext skin to the RO
      K.rect(sk, sy - REC, core, 8 - REC, FOAM);             // foam below the buck
      K.rect(sk + core, sy, sk, 9.5, OSB);                   // int skin to the RO
      K.rect(panel, sy, gy, 8, GYP);
      K.xRect(sk, sy, core, REC, WOOD);                      // 2x sill buck in the recess
      ctx.fillStyle = WOOD2;                                 // sloped exterior sill
      ctx.beginPath();
      ctx.moveTo(K.X(0), K.Y(sy + 1.7));
      ctx.lineTo(K.X(-cl - 1.2), K.Y(sy + 0.8));
      ctx.lineTo(K.X(-cl - 1.2), K.Y(sy + 0.2));
      ctx.lineTo(K.X(0), K.Y(sy + 1.1));
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#2e86c1'; ctx.lineWidth = Math.max(1.3, ppi * 0.015);
      ctx.beginPath();                                       // sill pan — turns up at back
      ctx.moveTo(K.X(-cl - 1.0), K.Y(sy + 1.0));
      ctx.lineTo(K.X(0.2), K.Y(sy + 1.9));
      ctx.lineTo(K.X(0.2), K.Y(sy + 3.4));
      ctx.stroke();
      ctx.strokeStyle = '#111'; ctx.lineWidth = K.hair;
      K.rect(-0.4, sy + 3.4, 2, 1.6, '#dfe7ee');             // window frame sill
      K.line(0.6, sy + 3.4, 0.6, sy + 9);                    // glazing line up
      notesCol(ctx, ppi, [
        { t: '1-1/2" FOAM RECESS + 2X BUCK — NAIL 8d @ 6" O.C. EA. FACE', tx: K.X(sk + core / 2), ty: K.Y(-(headH - REC / 2) - 0.75) },
        { t: '>5\'-0" OPENINGS: ENGINEERED HEADER PER SIP MFR', tx: K.X(sk + core / 2), ty: K.Y(-(headH / 2)) },
        { t: 'HEAD FLASHING — LAP WRB OVER', tx: K.X(-cl - 0.4), ty: K.Y(-(headH - 1)) },
        { t: 'SEALANT + BACKER @ FRAME PERIM. (SIP SEALANT AT BUCKS)', tx: K.X(-0.3), ty: K.Y(-(headH - 0.4)) },
        { t: 'WINDOW PER SCHEDULE (A8.0) — FIN OR FLANGE', tx: K.X(0.6), ty: K.Y(-(headH + 4)) },
        { t: 'SILL PAN — TURN UP 4" @ JAMBS + BACK DAM', tx: K.X(-0.2), ty: K.Y(sy + 2.2) },
        { t: '2X SILL BUCK IN FOAM RECESS', tx: K.X(sk + core / 2), ty: K.Y(sy + 0.75) },
      ], K.X(panel + gy) + ppi * 0.5, null, panelOf(item, ppi));
      ctx.restore();
      caption(ctx, ppi, item, this.title, '3" = 1\'-0"');
    },
  };

  /* ============ DETAIL: SIP PANEL @ FOUNDATION ============
     Anchor-bolted 2x sole plate (core width) on the slab; panel set OVER the
     plate with the foam recessed; skins run down past the plate; continuous
     SIP sealant beads both sides; ZEE/capillary protection at the base. */
  const sipFoundationDetail = {
    id: 'sipfoundation',
    title: 'SIP PANEL @ FOUNDATION',
    applies: (model) => !!(model.foundation && model.foundation.enabled) && sipDominant(model),
    draw(ctx, model, item, ppi) {
      const fd = model.foundation || {};
      const stud = studOf(model);
      const T = stud.T || HA.WALL_TYPES.ext_sip65 || {};
      const sk = T.skin || 0.4375;
      const core = T.core || 5.5;
      const fw = fd.footingWidth || 12, fdp = fd.footingDepth || 12;
      const slabT = fd.slabThickness || 4;
      const rb = fd.rebar || {};
      const bar = rb.bar || '#4';
      const sc = 1 / 10;
      const s = sc * ppi;
      const topZ = slabT + 12;
      const px = item.x * ppi + 1.6 * ppi, py = item.y * ppi + 0.35 * ppi + topZ * s;
      const K = kit(ctx, ppi, px, py, s);
      ctx.save();
      ctx.lineWidth = K.hair; ctx.strokeStyle = '#111';
      const stemW = 6;
      // EARTH bank + bed (thickened-edge poly paints over it)
      ctx.fillStyle = EARTH;
      ctx.fillRect(K.X(-fw - 4), K.Y(0), (fw + 4 + fw / 2 + 26) * s, (fdp - slabT + 6) * s);
      ctx.strokeStyle = '#4a6b3a'; ctx.lineWidth = Math.max(1.4, ppi * 0.016);
      K.line(-fw - 6, 0, -stemW / 2 - 2, 0);
      ctx.strokeStyle = '#111'; ctx.lineWidth = K.hair;
      // slab: thickened-edge monopour
      ctx.fillStyle = CONC;
      ctx.beginPath();
      ctx.moveTo(K.X(-stemW / 2 - 2), K.Y(slabT + 2));
      ctx.lineTo(K.X(24), K.Y(slabT + 2));
      ctx.lineTo(K.X(24), K.Y(2));
      ctx.lineTo(K.X(fw / 2), K.Y(2));
      ctx.lineTo(K.X(fw / 2), K.Y(-(fdp - slabT)));
      ctx.lineTo(K.X(-fw / 2), K.Y(-(fdp - slabT)));
      ctx.lineTo(K.X(-fw / 2), K.Y(slabT - 2));
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.save();
      ctx.setLineDash([5, 3]); ctx.strokeStyle = '#555';
      K.line(2, 1.4, 24, 1.4);                              // vapor barrier
      ctx.restore();
      ctx.fillStyle = '#b03a2e';                            // rebar dots
      for (let bx = 4; bx <= 22; bx += 6) { ctx.beginPath(); ctx.arc(K.X(bx), K.Y(slabT / 2 + 2), Math.max(1.4, ppi * 0.018), 0, 7); ctx.fill(); }
      const nB = rb.footingBars || 2;
      for (let i = 0; i < nB; i++) { ctx.beginPath(); ctx.arc(K.X(-fw / 4 + (i * fw) / (2 * nB)), K.Y(-(fdp - slabT - 3)), Math.max(1.6, ppi * 0.02), 0, 7); ctx.fill(); }
      ctx.fillStyle = '#111';
      // SIP base: PT sole plate (CORE width) + AB, panel over w/ recessed core.
      // x origin: exterior OSB skin face at slab edge line (-stemW/2)
      const x0 = -stemW / 2;
      const plateTop = slabT + 2 + 1.5;
      K.xRect(x0 + sk, plateTop, core, 1.5, WOOD2);          // 2x PT sole plate (core width)
      ctx.strokeStyle = '#333';
      K.line(x0 + sk + core / 2, plateTop, x0 + sk + core / 2, slabT - 4);  // anchor bolt
      K.line(x0 + sk + core / 2 - 1.2, plateTop + 0.4, x0 + sk + core / 2 + 1.2, plateTop + 0.4);
      ctx.strokeStyle = '#111';
      // panel over: skins run DOWN past the plate to the slab line; core sits on the plate
      const wallTop = plateTop + 12;
      K.rect(x0, wallTop, sk, 12 + 1.5, OSB);                // ext skin laps the plate
      K.rect(x0 + sk, wallTop, core, 12 - 1.5 + 1.5, FOAM);  // foam stops ON the plate
      K.rect(x0 + sk + core, wallTop, sk, 12 + 1.5, OSB);    // int skin laps the plate
      // continuous sealant beads both sides of the plate (blue dots)
      ctx.fillStyle = '#2e86c1';
      ctx.beginPath(); ctx.arc(K.X(x0 + sk + 0.3), K.Y(plateTop - 0.5), Math.max(1.6, ppi * 0.02), 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(K.X(x0 + sk + core - 0.3), K.Y(plateTop - 0.5), Math.max(1.6, ppi * 0.02), 0, 7); ctx.fill();
      ctx.fillStyle = '#111';
      // ZEE trim at the base of the skins
      ctx.strokeStyle = '#2e86c1'; ctx.lineWidth = Math.max(1.3, ppi * 0.015);
      ctx.beginPath();
      ctx.moveTo(K.X(x0 - 0.2), K.Y(slabT + 2 + 0.75));
      ctx.lineTo(K.X(x0 - 1.4), K.Y(slabT + 2 + 0.75));
      ctx.lineTo(K.X(x0 - 1.4), K.Y(slabT + 2));
      ctx.stroke();
      ctx.strokeStyle = '#111'; ctx.lineWidth = K.hair;
      notesCol(ctx, ppi, [
        { t: '2X PT SOLE PLATE (CORE WIDTH) + 5/8"Ø A.B. @ 6\'-0" O.C., 7" EMBED (R403.1.6)', tx: K.X(x0 + sk + core / 2), ty: K.Y(plateTop - 0.75) },
        { t: 'PANEL SET OVER PLATE — FOAM RECESSED 1-1/2", SKINS LAP PLATE, NAIL 8d @ 6" O.C.', tx: K.X(x0 + sk / 2), ty: K.Y(plateTop + 4) },
        { t: 'CONT. SIP SEALANT BEADS BOTH SIDES OF PLATE (AIR SEAL)', tx: K.X(x0 + sk + core - 0.3), ty: K.Y(plateTop - 0.6) },
        { t: 'ZEE FLASHING @ SKIN BASE + CAPILLARY BREAK — KEEP OSB ≥6" ABV GRADE (R317)', tx: K.X(x0 - 1), ty: K.Y(slabT + 2.4) },
        { t: slabT + '" CONC SLAB — ' + bar + ' @ 18" O.C.E.W. / 10-MIL VAPOR RETARDER', tx: K.X(12), ty: K.Y(slabT / 2 + 2) },
        { t: 'THICKENED EDGE ' + fw + '"W × ' + fdp + '"D — (' + nB + ') ' + bar + ' CONT.', tx: K.X(0), ty: K.Y(-(fdp - slabT - 3)) },
        { t: 'HOLD-DOWNS / UPLIFT STRAPS PER SIP MFR ENGINEERED DESIGN (SSD)', tx: K.X(x0 + sk + core), ty: K.Y(wallTop - 2) },
      ], K.X(24) + ppi * 0.5, null, panelOf(item, ppi));
      ctx.restore();
      caption(ctx, ppi, item, this.title, '1" = 1\'-0"');
    },
  };

  /* The stair section is authored in section2d, but occupies the SAME A6.x cell
     allocator. Wrap it here (details.js loads after section2d) so its legacy
     unwrapped note column cannot run into the adjacent Exterior Wall panel.
     Geometry + caption still come from the canonical stair renderer; only its
     note/leader pass is suppressed and redrafted through notesCol's bounded lane. */
  const installStairPanel = () => {
    const S2 = HA.section2d;
    const original = S2 && S2.stairDetail;
    if (!original || original._a6PanelBounded) return;
    const wrapped = (ctx, model, item, ppi) => {
      const L0 = model && model.levels && model.levels[0];
      const e = L0 && ((L0.entrances || []).find((en) => en.id === item.entranceId) || (L0.entrances || [])[0]);
      const fl = e && HA.entranceFlight ? HA.entranceFlight(model, 0, e) : null;
      if (!fl || fl.nR < 1) return original(ctx, model, item, ppi);
      const run = fl.tread * Math.max(1, fl.nR - 1);
      const fit = Math.min(5.5 / (fl.rise + 64), 11 / (run + 110), 1 / 3);
      let scale = 1 / 16;
      for (const sc of [1 / 4, 3 / 16, 1 / 8, 3 / 32, 1 / 16]) { if (sc <= fit) { scale = sc; break; } }
      const s = scale * ppi;
      const x0 = item.x * ppi + 40, yBase = item.y * ppi + (fl.rise + 56) * s;
      const X = (wx) => x0 + wx * s, Y = (wz) => yBase - wz * s;
      const capY = yBase + 26 * s;
      const panel = panelOf(item, ppi, { capY });

      // Suppress only section2d's old note loop. It announces that pass with a
      // 600-weight mono font and announces the following caption with 800-weight
      // sans. All earlier stair geometry/dimensions and the caption remain native.
      let suppress = false;
      const muted = new Set(['beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill', 'fillText']);
      const proxy = new Proxy(ctx, {
        get(target, prop) {
          if (suppress && muted.has(prop)) return () => {};
          const v = target[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
        set(target, prop, value) {
          if (prop === 'font') {
            const f = String(value || '');
            if (/^600\s/.test(f) && /Plex Mono/.test(f)) suppress = true;
            else if (suppress && /^800\s/.test(f) && /Plex Sans/.test(f)) suppress = false;
          }
          target[prop] = value; return true;
        },
      });

      ctx.save();
      ctx.beginPath(); ctx.rect(panel.l, panel.t, panel.r - panel.l, panel.b - panel.t); ctx.clip();
      original(proxy, model, item, ppi);
      const n = fl.notes || null;
      const fmt = (v) => (Math.round(v * 100) / 100) + '"';
      const wIn = e.stairWidth || fl.stairHalf * 2;
      const rail = fl.nR >= 4;
      const notes = [
        { t: (n && n.hanger) || 'TOP: STRINGER HANGERS @ RIM — SSD', tx: X(run + 2), ty: Y(fl.rise - 5) },
        rail ? { t: 'HANDRAIL 34"-38" ABV NOSING — R311.7.8', tx: X(run * 0.7), ty: Y(fl.riser + 36 + (fl.rise - fl.riser) * 0.7) } : null,
        { t: (n && n.riser) || ('RISERS: ' + fl.nR + ' @ ' + fmt(fl.riser) + ' (7-3/4" MAX — CRC R311.7.5.1)'), tx: X(run * 0.55 + 4), ty: Y(fl.rise * 0.62) },
        { t: (n && n.tread) || ('TREADS: ' + fmt(fl.tread) + ' RUN (10" MIN — CRC R311.7.5.2)'), tx: X(run * 0.4), ty: Y(fl.rise * 0.45) },
        { t: (n && n.stringers) || '3× 2X12 STRINGERS @ ≤16" O.C.', tx: X(run * 0.35), ty: Y(fl.rise * 0.3) },
        { t: (n && n.width) || ('WIDTH: ' + fmt(wIn) + (wIn < 36 ? ' — 36" MIN R311.7.1' : ' (36" MIN OK — R311.7.1)')), tx: X(run * 0.3), ty: Y(fl.rise * 0.22) },
        { t: (n && n.fire) || '1/2" GYP BD @ ENCLOSED USABLE SPACE UNDER (CRC R302.7)', tx: X(run * 0.5), ty: Y((fl.rise - 12.5) * 0.55) },
        { t: (n && n.pad) || 'BOT: CONC. PAD @ STRINGER BRG — SSD', tx: X(2), ty: Y(-4) },
      ].filter(Boolean);
      const prior = D._traceDetail; D._traceDetail = 'stair';
      notesCol(ctx, ppi, notes, X(run + 46), null, panel);
      D._traceDetail = prior;
      ctx.restore();
    };
    wrapped._a6PanelBounded = true;
    wrapped._original = original;
    S2.stairDetail = wrapped;
  };
  installStairPanel();

  D.registry = [foundationDetail, sipFoundationDetail, wallDetail, sipWallDetail,
    eaveDetail, openingDetail, sipOpeningDetail, deckLedgerDetail, roofWallDetail];

  /* applicable details for a model (order = sheet order) */
  D.list = (model) => D.registry.filter((d) => { try { return !!d.applies(model); } catch (e) { return false; } });

  /* sheet renderer dispatch — fail-soft like every other sheet item */
  D.draw = (ctx, model, item, ppi) => {
    const d = D.registry.find((r) => r.id === item.detailId);
    if (!d) return;
    const panel = panelOf(item, ppi);
    const prior = D._traceDetail;
    try {
      ctx.save();
      ctx.beginPath(); ctx.rect(panel.l, panel.t, panel.r - panel.l, panel.b - panel.t); ctx.clip();
      D._traceDetail = item.detailId;
      d.draw(ctx, model, item, ppi);
      ctx.restore();
    } catch (e) { try { ctx.restore(); } catch (err) {} /* additive */ }
    D._traceDetail = prior;
  };
})();
