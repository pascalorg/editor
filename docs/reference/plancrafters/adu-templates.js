/* ============================================================
   Home Architect — adu-templates.js
   PlanCrafters Studio ADU template library: 20 fully-furnished
   accessory dwelling unit designs (studio to 2bd/2ba) built
   programmatically against the same spatial contract as
   designs.js. Registered in HA.ADU_TEMPLATES and merged into
   HA.DESIGNS so they show up in the Designs dropdown.
   Conventions: inches; x east, y south; front of house = +y.
   ============================================================ */
(function () {
  'use strict';
  const HA = window.HA;

  /* ---------- tiny building DSL (mirrors designs.js) ---------- */
  const W = (lvl, x1, y1, x2, y2, type, S) => {
    const w = HA.makeWall(x1, y1, x2, y2, type || 'ext2x6', S);
    lvl.walls.push(w);
    return w;
  };
  const ring = (lvl, pts, type, S) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push(W(lvl, a[0], a[1], b[0], b[1], type, S));
    }
    return out;
  };
  const door = (wall, pos, w, opts) => {
    const o = HA.makeDoor(pos, w || 36, opts || {});
    HA.clampOpening(wall, o);
    wall.openings.push(o);
    return o;
  };
  const win = (wall, pos, w, h, sill, opts) => {
    const o = Object.assign(HA.makeWindow(pos, w, h, sill), opts || {});
    HA.clampOpening(wall, o);
    wall.openings.push(o);
    return o;
  };
  /* place openings by ABSOLUTE plan coordinate (x for horizontal walls,
     y for vertical walls) so wall direction never flips a position */
  const wcoord = (wall, c) =>
    Math.abs(wall.y1 === wall.y2 ? c - wall.x1 : c - wall.y1);
  const doorAt = (wall, c, w, opts) => door(wall, wcoord(wall, c), w, opts);
  const winAt = (wall, c, w, h, sill, opts) => win(wall, wcoord(wall, c), w, h, sill, opts);

  const fix = (lvl, type, x, y, rot, w) => {
    const f = HA.makeFixture(type, x, y, rot || 0);
    if (w) f.w = w;
    lvl.fixtures.push(f);
    return f;
  };
  const label = (lvl, text, x, y, w) => {
    const f = fix(lvl, 'room_label', x, y, 0);
    f.text = text;
    if (w) f.w = w;
    return f;
  };
  /* Washer + dryer. Side-by-side pair by default (washer at x,y; dryer 27" east).
     {stack:true} = a stacked unit on one ~27"×29" footprint (tight closets);
     {vert:true} = pair stacked north-south; {rot} rotates both. Placements are
     picked clear of every door swing (the dev-adu-test clearance guard is a hard
     error), so a tight unit gets a stacked unit by the bath wet wall. */
  const laundry = (lvl, x, y, opts = {}) => {
    const rot = opts.rot || 0;
    fix(lvl, 'washer', x, y, rot);
    if (opts.stack) fix(lvl, 'dryer', x, y, rot);
    else if (opts.vert) fix(lvl, 'dryer', x, y + 27, rot);
    else fix(lvl, 'dryer', x + 27, y, rot);
  };
  const elec = (model, li, type, x, y) => {
    const snap = HA.snapElectrical(model, li, { x, y }, type);
    if (snap) model.levels[li].electrical.push(
      HA.makeElectrical(type, snap.wallId, snap.pos, snap.side));
  };
  const stdElec = (model, pts) => {
    for (const [t, x, y] of pts) elec(model, 0, t, x, y);
  };

  /* Reach-in closet: box (x0,y0)-(x1,y1). A wall is drawn for every side
     not listed in `skip` (neighboring walls already close those sides);
     the door goes on side `face` ('n'|'s'|'e'|'w'). */
  const closet = (lvl, S, x0, y0, x1, y1, face, skip) => {
    skip = skip || '';
    const seg = {
      n: [x0, y0, x1, y0], s: [x0, y1, x1, y1],
      w: [x0, y0, x0, y1], e: [x1, y0, x1, y1],
    };
    for (const side of 'nsew') {
      if (skip.includes(side)) continue;
      const wall = W(lvl, seg[side][0], seg[side][1], seg[side][2], seg[side][3], 'int2x4', S);
      if (side === face) {
        const len = HA.wallLen(wall);
        if (len >= 60) // sliding bypass slabs on wide closets, like real builds
          door(wall, len / 2, Math.min(72, len - 16),
            { doorType: 'slider', panels: 2, style: 'flush', handle: 'none', trim: 'modern' });
        else
          door(wall, len / 2, Math.min(44, len - 20), { style: 'flush' });
      }
    }
  };

  /* Standard 3/4 bath (w 84-96): box (x0,y0)-(x0+w,y0+d), door on the
     south wall near its east end. skip = walls a neighbor already
     provides. opts.tub swaps the shower for a tub along the west wall. */
  const bathS = (lvl, S, x0, y0, w, d, skip, opts) => {
    skip = skip || '';
    opts = opts || {};
    const x1 = x0 + w, y1 = y0 + d;
    if (!skip.includes('n')) W(lvl, x0, y0, x1, y0, 'int2x4', S);
    if (!skip.includes('e')) W(lvl, x1, y0, x1, y1, 'int2x4', S);
    if (!skip.includes('w')) W(lvl, x0, y0, x0, y1, 'int2x4', S);
    if (!skip.includes('s')) {
      const s = W(lvl, x0, y1, x1, y1, 'int2x4', S);
      door(s, w - 36, 28, { hinge: 'right', swing: 'in' });
    }
    if (opts.tub) fix(lvl, 'tub', x0 + 18, y0 + 44, 90);
    else fix(lvl, 'shower', x0 + 22, y0 + d - 26, 180);
    fix(lvl, 'toilet', x0 + w - 34, y0 + 17, 0);
    fix(lvl, 'vanity', x0 + w - 13, y0 + 44, 270);
  };

  /* Compact 3/4 bath (w 60-72): shower in the NW corner, vanity on the
     west wall, toilet on the east wall, centered south door. */
  const bathC = (lvl, S, x0, y0, w, d, skip) => {
    skip = skip || '';
    const x1 = x0 + w, y1 = y0 + d;
    if (!skip.includes('n')) W(lvl, x0, y0, x1, y0, 'int2x4', S);
    if (!skip.includes('e')) W(lvl, x1, y0, x1, y1, 'int2x4', S);
    if (!skip.includes('w')) W(lvl, x0, y0, x0, y1, 'int2x4', S);
    if (!skip.includes('s')) {
      const s = W(lvl, x0, y1, x1, y1, 'int2x4', S);
      door(s, w / 2, 28, { hinge: 'left', swing: 'in' });
    }
    fix(lvl, 'shower', x0 + 20, y0 + 21, 0);
    fix(lvl, 'toilet', x0 + w - 16, y0 + 62, 270);
    fix(lvl, 'vanity', x0 + 13, y0 + 56, 90);
  };

  /* Straight kitchen run (base + uppers, sink + range) tight to a wall.
     side = compass side the run backs onto; wallC = that wall's
     centerline coordinate; a0..a1 = extent along the wall.
     Returns a placer for extras: place('fridge', alongC, 18). */
  const kRun = (lvl, side, wallC, a0, a1, sinkC, rangeC) => {
    const len = a1 - a0, c = (a0 + a1) / 2;
    const place = (type, alongC, off, wOverride) =>
      side === 'n' ? fix(lvl, type, alongC, wallC + off, 0, wOverride) :
      side === 's' ? fix(lvl, type, alongC, wallC - off, 180, wOverride) :
      side === 'w' ? fix(lvl, type, wallC + off, alongC, 90, wOverride) :
                     fix(lvl, type, wallC - off, alongC, 270, wOverride);
    place('base_cabinet', c, 15, len);
    place('upper_cabinet', c, 15, len);
    place('kitchen_sink', sinkC, 15);
    place('range', rangeC, 16);
    return place;
  };

  /* Covered front porch along the south wall: pony walls with a walk
     gap (gx0..gx1), posts, covered deck. */
  const frontPorch = (lvl, S, x0, x1, y0, depth, gx0, gx1) => {
    const y1 = y0 + depth;
    for (const seg of [[x0, y0, x0, y1], [x0, y1, gx0, y1], [gx1, y1, x1, y1], [x1, y1, x1, y0]])
      W(lvl, seg[0], seg[1], seg[2], seg[3], 'porch', S).height = 34;
    const px = [x0 + 8, x1 - 8];
    if (gx0 - 6 - (x0 + 8) > 24) px.push(gx0 - 6);
    if (x1 - 8 - (gx1 + 6) > 24) px.push(gx1 + 6);
    for (const x of px) lvl.posts.push(HA.makePost(x, y1 - 6, 5.5, 98));
    lvl.decks.push(Object.assign(HA.makeDeck(x0, y0, x1, y1), { railing: false, covered: true }));
  };

  const base = (name, o) => {
    const m = HA.newModel();
    m.name = name;
    m.project.designer = 'PlanCrafters Studio';
    m.project.date = '2026-06-12';
    const S = m.settings;
    S.surfaces.exteriorWall = o.siding;
    S.surfaces.roof = o.roof;
    if (o.trim) S.colors.trim = o.trim;
    if (o.door) S.colors.door = o.door;
    m.roof.pitch = o.pitch || 6;
    m.roof.overhang = o.overhang || 16;
    if (o.rake) m.roof.rake = o.rake;
    return m;
  };

  /* ============ 1 · The Wren — 600sf studio, hip ============ */
  const wren = () => {
    const m = base('The Wren ADU', {
      siding: 'lap_white', roof: 'shingle_charcoal',
      trim: '#f6f4ee', door: '#27425c', pitch: 5,
    });
    const S = m.settings, L1 = m.levels[0];
    laundry(L1, 115, 14);   // laundry nook by the closet
    const [back, right, front, left] = ring(L1, [[0, 0], [288, 0], [288, 300], [0, 300]], 'ext2x6', S);
    bathS(L1, S, 0, 0, 96, 96, 'nw');
    closet(L1, S, 96, 0, 168, 28, 's', 'nw');
    const kp = kRun(L1, 'n', 0, 168, 288, 198, 258);
    fix(L1, 'fridge', 270, 50, 270);   // y 44->50: clears the range (-3") + base run (-5")
    doorAt(front, 144, 42, { swing: 'in', hinge: 'right', style: 'glass', trim: 'modern' });
    winAt(front, 60, 60, 60, 24, { trim: 'modern', muntins: false });
    winAt(front, 228, 60, 60, 24, { trim: 'modern', muntins: false });
    winAt(left, 190, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(right, 180, 48, 48, 32, { trim: 'modern', muntins: false });
    winAt(back, 198, 48, 36, 42, { trim: 'modern', muntins: false });
    winAt(back, 30, 36, 24, 50, { trim: 'modern', muntins: false });
    fix(L1, 'bed_queen', 44, 190, 90);
    fix(L1, 'dresser', 14, 130, 90);
    fix(L1, 'sofa', 200, 225, 0);
    fix(L1, 'coffee_table', 200, 265, 0);
    fix(L1, 'armchair', 120, 228, 90);
    fix(L1, 'dining_table', 52, 260, 90);
    label(L1, 'STUDIO', 160, 140);
    label(L1, 'KITCHEN', 228, 60, 48);
    label(L1, 'BATH', 52, 44, 24);
    label(L1, 'CL', 132, 12, 20);
    stdElec(m, [['meter', 6, 150], ['panel', 10, 180], ['outlet', 198, 6],
      ['outlet', 144, 294], ['switch', 176, 294], ['outlet_220', 258, 6]]);
    return m;
  };

  /* ============ 2 · The Heron — 608sf long-narrow studio ============ */
  const heron = () => {
    const m = base('The Heron ADU', {
      siding: 'batten_olive', roof: 'metal_black',
      trim: '#e8e2d2', door: '#3c4a3a', pitch: 9, rake: 14,
    });
    const S = m.settings, L1 = m.levels[0];
    laundry(L1, 103, 14);   // laundry nook by the closet
    const [back, right, front, left] = ring(L1, [[0, 0], [192, 0], [192, 456], [0, 456]], 'ext2x6', S);
    back.gable = true; front.gable = true;
    bathS(L1, S, 0, 0, 84, 96, 'nw');
    closet(L1, S, 84, 0, 192, 30, 's', 'new');
    const kp = kRun(L1, 'w', 0, 120, 240, 150, 210);
    kp('fridge', 266, 18);
    doorAt(right, 228, 36, { swing: 'in', hinge: 'left' });
    winAt(front, 66, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(front, 126, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(right, 120, 36, 48, 32, { trim: 'modern', muntins: false });
    winAt(right, 300, 36, 48, 32, { trim: 'modern', muntins: false });
    winAt(right, 400, 36, 48, 32, { trim: 'modern', muntins: false });
    winAt(left, 380, 36, 48, 32, { trim: 'modern', muntins: false });
    winAt(left, 48, 36, 24, 50, { trim: 'modern', muntins: false });
    winAt(back, 42, 36, 24, 50, { trim: 'modern', muntins: false });
    fix(L1, 'bed_queen', 96, 408, 180);
    fix(L1, 'dining_table', 134, 180, 90);
    fix(L1, 'sofa', 60, 310, 90);
    fix(L1, 'coffee_table', 118, 310, 90);
    fix(L1, 'armchair', 130, 250, 180);
    L1.decks.push(HA.makeDeck(24, 456, 168, 552));
    label(L1, 'STUDIO', 60, 210, 50);
    label(L1, 'KITCHEN', 60, 108, 48);
    label(L1, 'BATH', 52, 40, 28);
    label(L1, 'SLEEPING', 150, 390, 40);
    label(L1, 'CL', 138, 14, 20);
    stdElec(m, [['meter', 186, 330], ['panel', 184, 360], ['outlet', 96, 450],
      ['outlet', 160, 120], ['switch', 186, 252], ['outlet_220', 6, 210]]);
    return m;
  };

  /* ============ 3 · The Finch — 600sf 1bd, hip + porch ============ */
  const finch = () => {
    const m = base('The Finch ADU', {
      siding: 'stucco_gray', roof: 'shingle_brown',
      trim: '#efe9da', door: '#5d3a23', pitch: 5,
    });
    const S = m.settings, L1 = m.levels[0];
    const [back, right, front, left] = ring(L1, [[0, 0], [288, 0], [288, 300], [0, 300]], 'ext2x6', S);
    const bw1 = W(L1, 144, 0, 144, 156, 'int2x4', S);
    W(L1, 0, 156, 144, 156, 'int2x4', S);
    doorAt(bw1, 126, 30);
    closet(L1, S, 0, 128, 60, 156, 'n', 'sw');
    bathS(L1, S, 144, 0, 96, 96, 'nw');
    kRun(L1, 'e', 288, 96, 216, 126, 186);
    fix(L1, 'fridge', 262, 18, 0);
    // laundry pair south of the kitchen run (was colliding with counter+sink)
    fix(L1, 'washer', 262, 232, 90);
    fix(L1, 'dryer', 262, 266, 90);
    doorAt(front, 144, 36, { swing: 'in', hinge: 'left', style: 'glass' });
    winAt(front, 60, 60, 60, 24, { trim: 'craftsman' });
    winAt(front, 228, 60, 60, 24, { trim: 'craftsman' });
    winAt(left, 78, 48, 48, 24, { trim: 'craftsman' });
    winAt(left, 240, 48, 48, 32, { trim: 'craftsman' });
    winAt(back, 96, 36, 48, 30, { trim: 'craftsman' });
    winAt(back, 192, 36, 24, 50, { trim: 'craftsman' });
    winAt(right, 126, 36, 36, 42, { trim: 'craftsman' });
    winAt(right, 260, 48, 48, 32, { trim: 'craftsman' });
    fix(L1, 'bed_queen', 72, 60, 0);
    fix(L1, 'dresser', 131, 60, 270);
    fix(L1, 'sofa', 70, 230, 90);
    fix(L1, 'coffee_table', 122, 230, 90);
    fix(L1, 'dining_table', 210, 260, 0);
    frontPorch(L1, S, 96, 192, 300, 96, 120, 168);
    label(L1, 'BEDROOM', 72, 112, 56);
    label(L1, 'BATH', 192, 42, 24);
    label(L1, 'KITCHEN', 235, 160, 50);
    label(L1, 'LIVING', 160, 210, 44);
    label(L1, 'LAUNDRY', 264, 90, 36);
    stdElec(m, [['meter', 6, 220], ['panel', 10, 250], ['outlet', 72, 6],
      ['outlet', 60, 294], ['switch', 172, 294], ['outlet_220', 282, 186]]);
    return m;
  };

  /* ============ 4 · The Alder — 600sf 1bd L-plan + patio ============ */
  const alder = () => {
    const m = base('The Alder ADU', {
      siding: 'lap_navy', roof: 'shingle_slate',
      trim: '#e9e7e0', door: '#c9a227', pitch: 6,
    });
    const S = m.settings, L1 = m.levels[0];
    laundry(L1, 99, 47, { stack: true });   // stacked W/D by the bath wet wall
    const pts = [[0, 0], [336, 0], [336, 180], [240, 180], [240, 288], [0, 288]];
    const [back, east, notchS, notchW, front, west] = ring(L1, pts, 'ext2x6', S);
    front.material = 'batten_cream';
    const bw1 = W(L1, 216, 0, 216, 180, 'int2x4', S);
    W(L1, 216, 180, 240, 180, 'int2x4', S);
    doorAt(bw1, 150, 30);
    closet(L1, S, 276, 0, 336, 28, 's', 'ne');
    bathS(L1, S, 0, 0, 84, 96, 'nw');
    kRun(L1, 'n', 0, 96, 216, 126, 186);
    fix(L1, 'fridge', 200, 60, 270);
    doorAt(front, 120, 36, { swing: 'in', hinge: 'left' });
    doorAt(notchW, 234, 72, { doorType: 'slider', panels: 2, style: 'full_glass', handle: 'none', trim: 'modern' });
    winAt(front, 60, 48, 60, 24, { trim: 'modern', muntins: false });
    winAt(front, 180, 48, 60, 24, { trim: 'modern', muntins: false });
    winAt(east, 90, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(back, 246, 36, 48, 30, { trim: 'modern', muntins: false });
    winAt(back, 126, 48, 36, 42, { trim: 'modern', muntins: false });
    winAt(back, 42, 36, 24, 50, { trim: 'modern', muntins: false });
    winAt(notchS, 300, 36, 48, 30, { trim: 'modern', muntins: false });
    winAt(west, 120, 48, 48, 32, { trim: 'modern', muntins: false });
    winAt(west, 220, 48, 48, 32, { trim: 'modern', muntins: false });
    L1.decks.push(Object.assign(HA.makeDeck(240, 180, 336, 288), { railing: false, drop: 2, material: 'concrete' }));
    fix(L1, 'bed_queen', 276, 136, 180);
    fix(L1, 'dresser', 226, 60, 90);
    fix(L1, 'sofa', 90, 200, 270);
    fix(L1, 'coffee_table', 140, 200, 270);
    fix(L1, 'dining_table', 150, 108, 0);
    label(L1, 'BEDROOM', 276, 60, 56);
    label(L1, 'BATH', 44, 44, 22);
    label(L1, 'KITCHEN', 156, 60, 50);
    label(L1, 'DINING', 150, 142, 44);
    label(L1, 'LIVING', 120, 255, 44);
    stdElec(m, [['meter', 330, 120], ['panel', 326, 150], ['outlet', 126, 6],
      ['outlet', 60, 282], ['switch', 96, 282], ['outlet_220', 186, 6]]);
    return m;
  };

  /* ============ 5 · The Juniper — 600sf 1bd, gable cabin ============ */
  const juniper = () => {
    const m = base('The Juniper ADU', {
      siding: 'cedar_plank', roof: 'metal_gray',
      trim: '#3a3f44', door: '#2d3338', pitch: 10, rake: 14,
    });
    const S = m.settings, L1 = m.levels[0];
    laundry(L1, 199, 104);   // laundry off the bath/hall
    const [back, right, front, left] = ring(L1, [[0, 0], [240, 0], [240, 360], [0, 360]], 'ext2x6', S);
    back.gable = true; front.gable = true;
    const part = W(L1, 0, 120, 240, 120, 'int2x4', S);
    doorAt(part, 96, 30);   // bedroom door W of the bath (was pos192, clipped the toilet)
    closet(L1, S, 0, 92, 72, 120, 'n', 'sw');
    bathS(L1, S, 144, 120, 96, 96, 'ne');
    kRun(L1, 'w', 0, 132, 252, 162, 222);
    fix(L1, 'fridge', 18, 280, 90);
    doorAt(front, 48, 36, { swing: 'in', hinge: 'right', style: 'glass' });
    winAt(front, 144, 48, 60, 24, { trim: 'modern', muntins: false });
    winAt(front, 192, 48, 60, 24, { trim: 'modern', muntins: false });
    winAt(back, 144, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(right, 60, 36, 48, 32, { trim: 'modern', muntins: false });
    winAt(right, 200, 48, 48, 32, { trim: 'modern', muntins: false });
    winAt(left, 60, 36, 48, 32, { trim: 'modern', muntins: false });
    fix(L1, 'bed_queen', 120, 55, 0);
    fix(L1, 'dresser', 200, 16, 0);
    fix(L1, 'sofa', 220, 290, 270);
    fix(L1, 'coffee_table', 170, 285, 90);
    fix(L1, 'dining_table', 110, 280, 0);
    L1.decks.push(HA.makeDeck(24, 360, 216, 468));
    label(L1, 'BEDROOM', 140, 108, 52);
    label(L1, 'BATH', 194, 162, 20);
    label(L1, 'KITCHEN', 70, 150, 50);
    label(L1, 'DINING', 110, 248, 40);
    label(L1, 'LIVING', 120, 330, 44);
    stdElec(m, [['meter', 234, 320], ['panel', 232, 348], ['outlet', 120, 6],
      ['outlet', 144, 354], ['switch', 78, 354], ['outlet_220', 6, 222]]);
    return m;
  };

  /* ============ 6 · The Cedar Court — 598sf 1bd brick, porch ============ */
  const cedarCourt = () => {
    const m = base('The Cedar Court ADU', {
      siding: 'brick_tan', roof: 'shingle_charcoal',
      trim: '#efe9da', door: '#22313f', pitch: 6,
    });
    const S = m.settings, L1 = m.levels[0];
    laundry(L1, 99, 43, { stack: true });   // stacked W/D by the bath wet wall
    const [back, right, front, left] = ring(L1, [[0, 0], [312, 0], [312, 276], [0, 276]], 'ext2x6', S);
    const bw1 = W(L1, 168, 0, 168, 144, 'int2x4', S);
    const bw2 = W(L1, 168, 144, 312, 144, 'int2x4', S);
    doorAt(bw2, 204, 30);
    closet(L1, S, 240, 116, 312, 144, 'n', 'se');
    bathS(L1, S, 0, 0, 84, 96, 'nw');
    kRun(L1, 'w', 0, 96, 216, 126, 186);
    fix(L1, 'fridge', 18, 246, 90);
    doorAt(front, 120, 36, { swing: 'in', hinge: 'left', style: 'craftsman' });
    winAt(front, 60, 48, 60, 24, { trim: 'craftsman' });
    winAt(front, 246, 60, 60, 24, { trim: 'craftsman' });
    winAt(right, 72, 36, 48, 30, { trim: 'craftsman' });
    winAt(right, 210, 48, 48, 32, { trim: 'craftsman' });
    winAt(back, 252, 48, 48, 24, { trim: 'craftsman' });
    winAt(back, 120, 48, 36, 42, { trim: 'craftsman' });
    winAt(back, 42, 36, 24, 50, { trim: 'craftsman' });
    winAt(left, 48, 36, 24, 50, { trim: 'craftsman' });
    fix(L1, 'bed_queen', 212, 72, 90);
    fix(L1, 'dresser', 200, 16, 0);
    fix(L1, 'sofa', 250, 196, 0);
    fix(L1, 'coffee_table', 250, 240, 0);
    fix(L1, 'armchair', 180, 228, 90);
    fix(L1, 'dining_table', 110, 180, 0);
    frontPorch(L1, S, 60, 252, 276, 96, 96, 144);
    label(L1, 'BEDROOM', 282, 80, 44);
    label(L1, 'BATH', 44, 44, 22);
    label(L1, 'KITCHEN', 70, 150, 50);
    label(L1, 'DINING', 110, 140, 40);
    label(L1, 'LIVING', 180, 260, 44);
    label(L1, 'PORCH', 156, 330, 40);
    stdElec(m, [['meter', 306, 200], ['panel', 304, 230], ['outlet', 126, 6],
      ['outlet', 240, 270], ['switch', 96, 270], ['outlet_220', 6, 186]]);
    return m;
  };

  /* ============ 7 · The Madrone — 800sf 1bd + den, long gable ============ */
  const madrone = () => {
    const m = base('The Madrone ADU', {
      siding: 'batten_white', roof: 'metal_copper',
      trim: '#2e3338', door: '#31424e', pitch: 9, rake: 14,
    });
    const S = m.settings, L1 = m.levels[0];
    laundry(L1, 13, 128);   // laundry on the west wall by the kitchen
    const [back, right, front, left] = ring(L1, [[0, 0], [240, 0], [240, 480], [0, 480]], 'ext2x6', S);
    back.gable = true; front.gable = true;
    const part = W(L1, 0, 144, 240, 144, 'int2x4', S);
    doorAt(part, 132, 30);   // bedroom door E of the bath (was pos96, clipped the vanity)
    closet(L1, S, 156, 116, 240, 144, 'n', 'se');
    bathS(L1, S, 0, 144, 96, 96, 'nw');
    kRun(L1, 'w', 0, 264, 384, 294, 354);
    fix(L1, 'fridge', 18, 414, 90);
    doorAt(right, 300, 36, { swing: 'in', hinge: 'left' });
    winAt(front, 174, 48, 60, 24, { trim: 'modern', muntins: false });
    winAt(front, 66, 48, 60, 24, { trim: 'modern', muntins: false });
    winAt(back, 72, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(back, 180, 36, 48, 30, { trim: 'modern', muntins: false });
    winAt(right, 84, 36, 48, 32, { trim: 'modern', muntins: false });
    winAt(right, 200, 36, 48, 32, { trim: 'modern', muntins: false });
    winAt(right, 380, 48, 48, 32, { trim: 'modern', muntins: false });
    winAt(left, 72, 36, 48, 32, { trim: 'modern', muntins: false });
    winAt(left, 192, 36, 24, 50, { trim: 'modern', muntins: false });
    fix(L1, 'bed_queen', 120, 62, 0);
    fix(L1, 'dresser', 227, 33, 270);
    fix(L1, 'desk', 180, 170, 0);
    fix(L1, 'bookcase', 231, 200, 270);
    fix(L1, 'sofa', 120, 430, 180);
    fix(L1, 'coffee_table', 120, 380, 0);
    fix(L1, 'dining_table', 150, 310, 90);
    L1.decks.push(HA.makeDeck(36, 480, 204, 576));
    label(L1, 'BEDROOM', 120, 112, 52);
    label(L1, 'BATH', 52, 186, 22);
    label(L1, 'DEN', 170, 230, 36);
    label(L1, 'KITCHEN', 80, 320, 50);
    label(L1, 'DINING', 110, 250, 40);
    label(L1, 'LIVING', 160, 402, 44);
    stdElec(m, [['meter', 234, 380], ['panel', 232, 410], ['outlet', 120, 6],
      ['outlet', 60, 474], ['switch', 234, 330], ['outlet_220', 6, 354]]);
    return m;
  };

  /* ============ 8 · The Laurel — 798sf 2bd, stucco + patio ============ */
  const laurel = () => {
    const m = base('The Laurel ADU', {
      siding: 'stucco_white', roof: 'tile_terra',
      trim: '#6b4a32', door: '#4a2f1d', pitch: 4, overhang: 20,
    });
    const S = m.settings, L1 = m.levels[0];
    laundry(L1, 187, 14);   // laundry by the bath
    const [back, right, front, left] = ring(L1, [[0, 0], [336, 0], [336, 342], [0, 342]], 'ext2x6', S);
    const b1e = W(L1, 132, 0, 132, 144, 'int2x4', S);
    const b1s = W(L1, 0, 144, 132, 144, 'int2x4', S);
    doorAt(b1s, 100, 30);
    closet(L1, S, 0, 116, 60, 144, 'n', 'sw');
    const b2w = W(L1, 204, 0, 204, 144, 'int2x4', S);
    const b2s = W(L1, 204, 144, 336, 144, 'int2x4', S);
    doorAt(b2s, 236, 30);
    closet(L1, S, 276, 116, 336, 144, 'n', 'se');
    bathC(L1, S, 132, 0, 72, 96, 'new');
    kRun(L1, 'e', 336, 156, 276, 186, 246);
    fix(L1, 'fridge', 318, 310, 270);
    doorAt(front, 96, 36, { swing: 'in', hinge: 'right' });
    doorAt(front, 228, 72, { doorType: 'slider', panels: 2, style: 'full_glass', handle: 'none', trim: 'modern' });
    winAt(front, 36, 48, 60, 24, { trim: 'modern', muntins: false });
    winAt(front, 306, 48, 60, 24, { trim: 'modern', muntins: false });
    winAt(back, 66, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(back, 270, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(left, 72, 36, 48, 32, { trim: 'modern', muntins: false });
    winAt(left, 250, 48, 48, 32, { trim: 'modern', muntins: false });
    winAt(right, 72, 36, 48, 32, { trim: 'modern', muntins: false });
    fix(L1, 'bed_queen', 66, 62, 0);
    fix(L1, 'bed_queen', 270, 62, 0);
    fix(L1, 'dining_table', 258, 226, 90);   // clear of the bedroom-2 door swing
    fix(L1, 'sofa', 70, 230, 90);
    fix(L1, 'coffee_table', 122, 230, 90);
    fix(L1, 'armchair', 56, 308, 0);
    L1.decks.push(Object.assign(HA.makeDeck(180, 342, 300, 438), { railing: false, drop: 2, material: 'concrete' }));
    label(L1, 'BEDROOM 1', 82, 112, 56);
    label(L1, 'BATH', 164, 84, 20);
    label(L1, 'BEDROOM 2', 252, 110, 48);
    label(L1, 'KITCHEN', 290, 250, 36);
    label(L1, 'DINING', 250, 154, 40);
    label(L1, 'LIVING', 130, 300, 44);
    stdElec(m, [['meter', 6, 220], ['panel', 10, 250], ['outlet', 66, 6],
      ['outlet', 270, 336], ['switch', 120, 336], ['outlet_220', 330, 246]]);
    return m;
  };

  /* ============ 9 · The Bayberry — 800sf 1bd L-plan + patio ============ */
  const bayberry = () => {
    const m = base('The Bayberry ADU', {
      siding: 'lap_sage', roof: 'shingle_charcoal',
      trim: '#f4f1ea', door: '#5d4632', pitch: 6,
    });
    const S = m.settings, L1 = m.levels[0];
    laundry(L1, 111, 47, { stack: true });   // stacked W/D by the bath wet wall
    const pts = [[0, 0], [384, 0], [384, 192], [288, 192], [288, 336], [0, 336]];
    const [back, east, notchS, notchW, front, west] = ring(L1, pts, 'ext2x6', S);
    front.material = 'stone_gray';
    const bw1 = W(L1, 240, 0, 240, 192, 'int2x4', S);
    W(L1, 240, 192, 288, 192, 'int2x4', S);
    doorAt(bw1, 168, 30);
    closet(L1, S, 300, 0, 372, 28, 's', 'n');
    bathS(L1, S, 0, 0, 96, 96, 'nw');
    kRun(L1, 'n', 0, 108, 204, 138, 180);
    fix(L1, 'fridge', 222, 18, 0);
    fix(L1, 'island', 156, 84, 0);
    doorAt(front, 144, 36, { swing: 'in', hinge: 'left', style: 'glass' });
    doorAt(notchW, 264, 72, { doorType: 'slider', panels: 2, style: 'full_glass', handle: 'none', trim: 'modern' });
    winAt(front, 60, 60, 60, 24, { trim: 'modern', muntins: false });
    winAt(front, 228, 60, 60, 24, { trim: 'modern', muntins: false });
    winAt(west, 156, 48, 48, 32, { trim: 'modern', muntins: false });
    winAt(west, 276, 48, 48, 32, { trim: 'modern', muntins: false });
    winAt(east, 96, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(back, 264, 36, 48, 30, { trim: 'modern', muntins: false });
    winAt(back, 138, 48, 36, 42, { trim: 'modern', muntins: false });
    winAt(back, 48, 36, 24, 50, { trim: 'modern', muntins: false });
    winAt(notchS, 336, 36, 48, 30, { trim: 'modern', muntins: false });
    L1.decks.push(Object.assign(HA.makeDeck(288, 192, 384, 336), { railing: false, drop: 2, material: 'concrete' }));
    for (const [px, py] of [[376, 200], [376, 328], [296, 328]])
      L1.posts.push(HA.makePost(px, py, 5.5, 96));
    fix(L1, 'bed_queen', 320, 148, 180);
    fix(L1, 'dresser', 250, 40, 90);
    fix(L1, 'sofa', 120, 230, 0);
    fix(L1, 'coffee_table', 120, 275, 0);
    fix(L1, 'armchair', 50, 240, 90);
    fix(L1, 'dining_table', 184, 150, 90);   // clear of the bedroom-2 door swing
    label(L1, 'BEDROOM', 320, 60, 56);
    label(L1, 'BATH', 52, 44, 22);
    label(L1, 'KITCHEN', 156, 130, 50);
    label(L1, 'DINING', 210, 200, 40);
    label(L1, 'LIVING', 76, 305, 40);
    stdElec(m, [['meter', 6, 200], ['panel', 10, 230], ['outlet', 138, 6],
      ['outlet', 80, 330], ['switch', 120, 330], ['outlet_220', 180, 6]]);
    return m;
  };

  /* ============ 10 · The Tamarack — 800sf 2bd T-plan ============ */
  const tamarack = () => {
    const m = base('The Tamarack ADU', {
      siding: 'lap_yellow', roof: 'shingle_brown',
      trim: '#ffffff', door: '#3e5e44', pitch: 6,
    });
    const S = m.settings, L1 = m.levels[0];
    laundry(L1, 355, 14);   // laundry by the kitchen
    const pts = [[0, 0], [480, 0], [480, 192], [336, 192], [336, 312], [144, 312], [144, 192], [0, 192]];
    const [back, east, barSE, stemE, stemS, stemW, barSW, west] = ring(L1, pts, 'ext2x6', S);
    const bw1 = W(L1, 132, 0, 132, 192, 'int2x4', S);
    doorAt(bw1, 120, 30);
    closet(L1, S, 12, 164, 84, 192, 'n', 's');
    const bw2 = W(L1, 348, 0, 348, 192, 'int2x4', S);
    doorAt(bw2, 120, 30);
    closet(L1, S, 396, 0, 468, 28, 's', 'n');
    bathC(L1, S, 132, 0, 72, 96, 'nw');
    kRun(L1, 'n', 0, 216, 336, 246, 300);
    fix(L1, 'fridge', 332, 60, 270);
    doorAt(stemS, 240, 36, { swing: 'in', hinge: 'right', style: 'craftsman' });
    winAt(stemS, 186, 48, 60, 24, { trim: 'craftsman' });
    winAt(stemS, 294, 48, 60, 24, { trim: 'craftsman' });
    winAt(stemW, 252, 48, 48, 32, { trim: 'craftsman' });
    winAt(stemE, 252, 48, 48, 32, { trim: 'craftsman' });
    winAt(west, 96, 48, 48, 24, { trim: 'craftsman' });
    winAt(east, 96, 48, 48, 24, { trim: 'craftsman' });
    winAt(barSW, 108, 36, 48, 30, { trim: 'craftsman' });
    winAt(barSE, 420, 48, 48, 30, { trim: 'craftsman' });
    winAt(back, 246, 48, 36, 42, { trim: 'craftsman' });
    winAt(back, 66, 36, 48, 30, { trim: 'craftsman' });
    fix(L1, 'bed_queen', 66, 62, 0);
    fix(L1, 'bed_queen', 414, 80, 0);
    fix(L1, 'dining_table', 260, 150, 0);
    fix(L1, 'sofa', 172, 250, 90);
    fix(L1, 'coffee_table', 224, 250, 90);
    fix(L1, 'armchair', 300, 225, 180);
    label(L1, 'BEDROOM 1', 66, 124, 56);
    label(L1, 'BEDROOM 2', 414, 135, 56);
    label(L1, 'BATH', 166, 84, 16);
    label(L1, 'KITCHEN', 276, 60, 50);
    label(L1, 'DINING', 260, 110, 40);
    label(L1, 'LIVING', 260, 290, 44);
    stdElec(m, [['meter', 474, 150], ['panel', 472, 120], ['outlet', 246, 6],
      ['outlet', 200, 306], ['switch', 270, 306], ['outlet_220', 300, 6]]);
    return m;
  };

  /* ============ 11 · The Willow — 800sf 1bd, split-gable front ============ */
  const willow = () => {
    const m = base('The Willow ADU', {
      siding: 'batten_charcoal', roof: 'metal_black',
      trim: '#16181b', door: '#b3552c', pitch: 8, rake: 14,
    });
    const S = m.settings, L1 = m.levels[0];
    const [back, right, front, left] = ring(L1, [[0, 0], [300, 0], [300, 384], [0, 384]], 'ext2x6', S);
    // mixed roof: gable over the east half of the front wall
    const frontW = HA.splitWall(m, front, 150);
    front.gable = true;
    front.material = 'cedar_plank';
    const bw1 = W(L1, 156, 0, 156, 156, 'int2x4', S);
    const bw2 = W(L1, 156, 156, 300, 156, 'int2x4', S);
    doorAt(bw2, 192, 30);
    closet(L1, S, 272, 36, 300, 108, 'w', 'e');
    bathC(L1, S, 84, 0, 72, 96, 'ne');
    W(L1, 0, 96, 84, 96, 'int2x4', S); // utility room south wall
    doorAt(L1.walls[L1.walls.length - 1], 42, 30);
    fix(L1, 'washer', 24, 17, 0);
    fix(L1, 'dryer', 54, 17, 0);
    fix(L1, 'water_heater', 70, 74, 0);
    kRun(L1, 'w', 0, 138, 240, 156, 210);   // run starts S of the utility-door swing
    fix(L1, 'fridge', 18, 270, 90);
    doorAt(frontW, 84, 36, { swing: 'in', hinge: 'left' });
    winAt(front, 192, 60, 60, 24, { trim: 'modern', muntins: false });
    winAt(front, 252, 48, 60, 24, { trim: 'modern', muntins: false });
    winAt(back, 216, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(back, 270, 36, 48, 30, { trim: 'modern', muntins: false });
    winAt(back, 42, 36, 24, 50, { trim: 'modern', muntins: false });
    winAt(left, 320, 48, 48, 32, { trim: 'modern', muntins: false });
    winAt(right, 260, 48, 48, 32, { trim: 'modern', muntins: false });
    fix(L1, 'bed_queen', 210, 62, 0);
    fix(L1, 'dresser', 166, 80, 90);
    fix(L1, 'dining_table', 100, 300, 0);
    fix(L1, 'sofa', 230, 210, 0);
    fix(L1, 'coffee_table', 230, 255, 0);
    fix(L1, 'armchair', 160, 228, 90);
    L1.decks.push(Object.assign(HA.makeDeck(36, 384, 180, 480), { railing: false, covered: true }));
    L1.posts.push(HA.makePost(42, 474, 5.5, 98));
    L1.posts.push(HA.makePost(174, 474, 5.5, 98));
    label(L1, 'BEDROOM', 210, 130, 56);
    label(L1, 'BATH', 120, 82, 22);
    label(L1, 'UTILITY', 40, 60, 34);
    label(L1, 'KITCHEN', 70, 180, 50);
    label(L1, 'DINING', 100, 260, 40);
    label(L1, 'LIVING', 230, 300, 44);
    stdElec(m, [['meter', 294, 280], ['panel', 292, 310], ['outlet', 216, 6],
      ['outlet', 240, 378], ['switch', 108, 378], ['outlet_220', 6, 210]]);
    return m;
  };

  /* ============ 12 · The Poppy — 792sf 2bd, black gable ============ */
  const poppy = () => {
    const m = base('The Poppy ADU', {
      siding: 'lap_black', roof: 'metal_gray',
      trim: '#16181b', door: '#b3552c', pitch: 9, rake: 14,
    });
    const S = m.settings, L1 = m.levels[0];
    fix(L1, 'dryer', 144, 18, 0);   // stacked over the washer in the laundry closet
    const [back, right, front, left] = ring(L1, [[0, 0], [288, 0], [288, 396], [0, 396]], 'ext2x6', S);
    back.gable = true; front.gable = true;
    front.material = 'cedar_plank';
    const b1e = W(L1, 126, 0, 126, 132, 'int2x4', S);
    const b1s = W(L1, 0, 132, 126, 132, 'int2x4', S);
    doorAt(b1s, 104, 30, { hinge: 'right' });   // hinge E so the swing clears the bath vanity
    closet(L1, S, 12, 104, 72, 132, 'n', 's');
    const b2w = W(L1, 162, 0, 162, 132, 'int2x4', S);
    const b2s = W(L1, 162, 132, 288, 132, 'int2x4', S);
    doorAt(b2s, 184, 30);
    closet(L1, S, 216, 104, 276, 132, 'n', 's');
    const utilS = W(L1, 126, 132, 162, 132, 'int2x4', S);
    doorAt(utilS, 144, 28);
    fix(L1, 'washer', 144, 18, 0);
    fix(L1, 'water_heater', 144, 60, 0);
    bathS(L1, S, 0, 132, 96, 96, 'nw', { tub: true });
    kRun(L1, 'e', 288, 144, 264, 174, 234);
    fix(L1, 'fridge', 270, 294, 270);
    doorAt(front, 120, 36, { swing: 'in', hinge: 'right' });
    winAt(front, 210, 60, 60, 24, { trim: 'modern', muntins: false });
    winAt(front, 42, 48, 60, 24, { trim: 'modern', muntins: false });
    winAt(back, 63, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(back, 225, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(left, 66, 36, 48, 32, { trim: 'modern', muntins: false });
    winAt(left, 180, 36, 24, 50, { trim: 'modern', muntins: false });
    winAt(left, 330, 48, 48, 32, { trim: 'modern', muntins: false });
    winAt(right, 66, 36, 48, 32, { trim: 'modern', muntins: false });
    winAt(right, 340, 48, 48, 32, { trim: 'modern', muntins: false });
    fix(L1, 'bed_queen', 63, 60, 0);
    fix(L1, 'bed_queen', 225, 60, 0);
    fix(L1, 'dining_table', 170, 190, 0);
    fix(L1, 'sofa', 80, 310, 90);
    fix(L1, 'coffee_table', 132, 310, 90);
    fix(L1, 'armchair', 175, 345, 180);
    L1.decks.push(HA.makeDeck(48, 396, 240, 492));
    label(L1, 'BEDROOM 1', 95, 116, 40);
    label(L1, 'BEDROOM 2', 252, 110, 36);
    label(L1, 'BATH', 52, 212, 24);
    label(L1, 'LAUNDRY', 144, 90, 30);
    label(L1, 'KITCHEN', 234, 200, 44);
    label(L1, 'DINING', 170, 160, 40);
    label(L1, 'LIVING', 180, 300, 44);
    stdElec(m, [['meter', 6, 300], ['panel', 10, 330], ['outlet', 63, 6],
      ['outlet', 180, 390], ['switch', 144, 390], ['outlet_220', 282, 234]]);
    return m;
  };

  /* ============ 13 · The Olive — 780sf 1bd, full porch ============ */
  const olive = () => {
    const m = base('The Olive ADU', {
      siding: 'stucco_sage', roof: 'shingle_green',
      trim: '#7a6a52', door: '#5a3b28', pitch: 5, overhang: 20,
    });
    const S = m.settings, L1 = m.levels[0];
    laundry(L1, 271, 74);   // laundry by the kitchen
    const [back, right, front, left] = ring(L1, [[0, 0], [312, 0], [312, 360], [0, 360]], 'ext2x6', S);
    const bw1 = W(L1, 144, 0, 144, 168, 'int2x4', S);
    W(L1, 0, 168, 144, 168, 'int2x4', S);
    doorAt(bw1, 140, 30);
    closet(L1, S, 12, 0, 84, 28, 's', 'n');
    bathS(L1, S, 144, 0, 96, 96, 'nw');
    kRun(L1, 'e', 312, 96, 216, 126, 186);
    fix(L1, 'fridge', 294, 246, 270);
    doorAt(front, 156, 36, { swing: 'in', hinge: 'left', style: 'glass' });
    winAt(front, 60, 60, 60, 24, { trim: 'craftsman' });
    winAt(front, 252, 60, 60, 24, { trim: 'craftsman' });
    winAt(left, 84, 48, 48, 24, { trim: 'craftsman' });
    winAt(left, 260, 48, 48, 32, { trim: 'craftsman' });
    winAt(right, 300, 48, 48, 32, { trim: 'craftsman' });
    winAt(back, 114, 36, 48, 30, { trim: 'craftsman' });
    winAt(back, 192, 36, 24, 50, { trim: 'craftsman' });
    winAt(back, 270, 36, 36, 42, { trim: 'craftsman' });
    fix(L1, 'bed_queen', 72, 80, 0);
    fix(L1, 'dresser', 14, 130, 90);
    fix(L1, 'dining_table', 190, 160, 0);
    fix(L1, 'sofa', 100, 250, 90);
    fix(L1, 'coffee_table', 152, 250, 90);
    fix(L1, 'armchair', 90, 318, 0);
    frontPorch(L1, S, 0, 312, 360, 96, 132, 180);
    label(L1, 'BEDROOM', 72, 146, 56);
    label(L1, 'BATH', 188, 40, 20);
    label(L1, 'KITCHEN', 260, 150, 44);
    label(L1, 'DINING', 190, 124, 40);
    label(L1, 'LIVING', 134, 295, 44);
    label(L1, 'PORCH', 156, 410, 40);
    stdElec(m, [['meter', 306, 40], ['panel', 304, 70], ['outlet', 114, 6],
      ['outlet', 240, 354], ['switch', 132, 354], ['outlet_220', 306, 186]]);
    return m;
  };

  /* ============ 14 · The Sequoia — 1080sf 2bd/2ba + porch ============ */
  const sequoia = () => {
    const m = base('The Sequoia ADU', {
      siding: 'lap_gray', roof: 'shingle_slate',
      trim: '#f1efe8', door: '#23303a', pitch: 6,
    });
    const S = m.settings, L1 = m.levels[0];
    laundry(L1, 13, 140);   // laundry in the gap between bedroom 2 and the bath
    const [back, right, front, left] = ring(L1, [[0, 0], [360, 0], [360, 432], [0, 432]], 'ext2x6', S);
    front.material = 'brick_white';
    // primary suite (NE) with ensuite + closet
    const sw1 = W(L1, 192, 0, 192, 216, 'int2x4', S);
    const sw2 = W(L1, 192, 216, 360, 216, 'int2x4', S);
    doorAt(sw2, 228, 30);
    bathS(L1, S, 276, 0, 84, 96, 'ne');
    closet(L1, S, 192, 96, 220, 168, 'e', 'w');
    fix(L1, 'bed_king', 270, 140, 0);  // shifted west to clear the ensuite door swing
    fix(L1, 'dresser', 290, 204, 180);
    // bedroom 2 (NW) + hall bath
    const b2e = W(L1, 156, 0, 156, 156, 'int2x4', S);
    const b2s = W(L1, 0, 156, 156, 156, 'int2x4', S);
    doorAt(b2s, 120, 30);
    closet(L1, S, 12, 128, 84, 156, 'n', 's');
    fix(L1, 'bed_queen', 78, 60, 0);
    bathS(L1, S, 0, 156, 96, 96, 'nw', { tub: true });
    // kitchen / dining / living
    kRun(L1, 'e', 360, 228, 348, 258, 318);
    fix(L1, 'fridge', 342, 378, 270);
    fix(L1, 'island', 277, 288, 270);
    fix(L1, 'dining_table', 150, 210, 90);
    fix(L1, 'sofa', 120, 330, 0);
    fix(L1, 'coffee_table', 120, 375, 0);
    fix(L1, 'armchair', 52, 328, 90);
    doorAt(front, 120, 42, { swing: 'in', hinge: 'right', style: 'glass' });
    winAt(front, 240, 60, 60, 24, { trim: 'modern', muntins: false });
    winAt(front, 312, 48, 60, 24, { trim: 'modern', muntins: false });
    winAt(right, 156, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(back, 78, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(back, 246, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(back, 318, 36, 24, 50, { trim: 'modern', muntins: false });
    winAt(left, 78, 36, 48, 32, { trim: 'modern', muntins: false });
    winAt(left, 204, 36, 24, 50, { trim: 'modern', muntins: false });
    winAt(left, 330, 48, 48, 32, { trim: 'modern', muntins: false });
    frontPorch(L1, S, 48, 204, 432, 96, 96, 144);
    label(L1, 'PRIMARY BEDROOM', 246, 52, 52);
    label(L1, 'ENSUITE', 300, 40, 30);
    label(L1, 'BEDROOM 2', 78, 116, 56);
    label(L1, 'BATH', 52, 236, 24);
    label(L1, 'KITCHEN', 300, 240, 50);
    label(L1, 'DINING', 150, 260, 40);
    label(L1, 'LIVING', 120, 300, 44);
    label(L1, 'PORCH', 126, 480, 40);
    stdElec(m, [['meter', 354, 400], ['panel', 352, 420], ['outlet', 246, 6],
      ['outlet', 60, 426], ['switch', 150, 426], ['outlet_220', 354, 318]]);
    return m;
  };

  /* ============ 15 · The Manzanita — 1000sf 2bd hacienda ============ */
  const manzanita = () => {
    const m = base('The Manzanita ADU', {
      siding: 'stucco_adobe', roof: 'tile_terra',
      trim: '#6b4a32', door: '#4a2f1d', pitch: 8, rake: 14, overhang: 20,
    });
    const S = m.settings, L1 = m.levels[0];
    const [back, right, front, left] = ring(L1, [[0, 0], [300, 0], [300, 480], [0, 480]], 'ext2x6', S);
    back.gable = true; front.gable = true;
    const shared = W(L1, 150, 0, 150, 156, 'int2x4', S);
    const b1s = W(L1, 0, 156, 150, 156, 'int2x4', S);
    doorAt(b1s, 100, 30, { swing: 'out' });   // into the bedroom (was swinging onto the vanity/washer)
    closet(L1, S, 12, 0, 84, 28, 's', 'n');
    const b2s = W(L1, 150, 156, 300, 156, 'int2x4', S);
    doorAt(b2s, 200, 30);
    closet(L1, S, 216, 0, 288, 28, 's', 'n');
    bathS(L1, S, 0, 156, 96, 96, 'nw', { tub: true });
    // laundry between bath and shared-wall line
    W(L1, 162, 156, 162, 228, 'int2x4', S);
    const lndS = W(L1, 96, 228, 162, 228, 'int2x4', S);
    doorAt(lndS, 129, 30);
    fix(L1, 'washer', 114, 172, 0);
    fix(L1, 'dryer', 144, 172, 0);
    kRun(L1, 'e', 300, 180, 300, 210, 270);
    fix(L1, 'fridge', 282, 330, 270);
    fix(L1, 'island', 217, 240, 270);
    fix(L1, 'bed_queen', 75, 72, 0);
    fix(L1, 'bed_queen', 225, 72, 0);
    fix(L1, 'dining_table', 80, 310, 0);
    fix(L1, 'sofa', 90, 400, 90);
    fix(L1, 'coffee_table', 142, 400, 90);
    fix(L1, 'armchair', 240, 380, 180);
    doorAt(front, 180, 36, { swing: 'in', hinge: 'right', style: 'plank' });
    winAt(front, 60, 48, 60, 24, { trim: 'colonial' });
    winAt(front, 246, 48, 60, 24, { trim: 'colonial' });
    winAt(back, 114, 48, 48, 24, { trim: 'colonial' });
    winAt(back, 186, 48, 48, 24, { trim: 'colonial' });
    winAt(left, 78, 48, 48, 32, { trim: 'colonial' });
    winAt(left, 204, 36, 24, 50, { trim: 'colonial' });
    winAt(left, 310, 48, 48, 32, { trim: 'colonial' });
    winAt(left, 420, 48, 48, 32, { trim: 'colonial' });
    winAt(right, 78, 48, 48, 32, { trim: 'colonial' });
    winAt(right, 400, 48, 48, 32, { trim: 'colonial' });
    L1.decks.push(Object.assign(HA.makeDeck(60, 480, 240, 576), { railing: false, drop: 2, material: 'concrete' }));
    label(L1, 'BEDROOM 1', 75, 130, 56);
    label(L1, 'BEDROOM 2', 225, 130, 56);
    label(L1, 'BATH', 52, 232, 24);
    label(L1, 'LAUNDRY', 129, 205, 30);
    label(L1, 'KITCHEN', 256, 170, 44);
    label(L1, 'DINING', 80, 270, 40);
    label(L1, 'LIVING', 180, 420, 44);
    stdElec(m, [['meter', 6, 350], ['panel', 10, 380], ['outlet', 114, 6],
      ['outlet', 240, 474], ['switch', 204, 474], ['outlet_220', 294, 270]]);
    return m;
  };

  /* ============ 16 · The Redwood — 1008sf 2bd/2ba L-plan ============ */
  const redwood = () => {
    const m = base('The Redwood ADU', {
      siding: 'batten_cream', roof: 'metal_gray',
      trim: '#2e3338', door: '#31424e', pitch: 7, rake: 14,
    });
    const S = m.settings, L1 = m.levels[0];
    laundry(L1, 325, 14);   // laundry by the primary ensuite
    const pts = [[0, 0], [432, 0], [432, 240], [288, 240], [288, 384], [0, 384]];
    const [back, east, notchS, notchW, front, west] = ring(L1, pts, 'ext2x6', S);
    east.gable = true;
    front.material = 'stone_tan';
    // primary suite — east wing
    const sw = W(L1, 288, 0, 288, 240, 'int2x4', S);
    doorAt(sw, 200, 30, { swing: 'out' });   // into the suite (was swinging onto the kitchen run)
    bathS(L1, S, 348, 0, 84, 96, 'ne');
    closet(L1, S, 288, 96, 316, 168, 'e', 'w');
    fix(L1, 'bed_king', 390, 166, 0);  // shifted south to clear the ensuite door swing
    fix(L1, 'dresser', 340, 226, 180);
    // bedroom 2 + hall bath
    const b2e = W(L1, 144, 0, 144, 144, 'int2x4', S);
    const b2s = W(L1, 0, 144, 144, 144, 'int2x4', S);
    doorAt(b2s, 110, 30);
    closet(L1, S, 12, 116, 84, 144, 'n', 's');
    fix(L1, 'bed_queen', 72, 60, 0);
    bathS(L1, S, 144, 0, 96, 96, 'nw');
    // kitchen backed on the suite wall, fridge in the north nook
    kRun(L1, 'e', 288, 108, 216, 138, 192);
    fix(L1, 'fridge', 262, 18, 0);
    fix(L1, 'island', 192, 162, 0);
    fix(L1, 'dining_table', 72, 210, 0);
    fix(L1, 'sofa', 120, 300, 0);
    fix(L1, 'coffee_table', 120, 345, 0);
    fix(L1, 'armchair', 44, 300, 90);
    doorAt(front, 216, 36, { swing: 'in', hinge: 'left' });
    doorAt(notchW, 312, 96, { doorType: 'slider', panels: 2, style: 'full_glass', handle: 'none', trim: 'modern' });
    winAt(front, 144, 60, 60, 24, { trim: 'modern', muntins: false });
    winAt(front, 48, 48, 60, 24, { trim: 'modern', muntins: false });
    winAt(east, 156, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(notchS, 396, 36, 48, 30, { trim: 'modern', muntins: false });
    winAt(west, 204, 48, 48, 32, { trim: 'modern', muntins: false });
    winAt(west, 72, 36, 48, 30, { trim: 'modern', muntins: false });
    winAt(west, 324, 48, 48, 32, { trim: 'modern', muntins: false });
    winAt(back, 72, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(back, 192, 36, 24, 50, { trim: 'modern', muntins: false });
    winAt(back, 390, 36, 24, 50, { trim: 'modern', muntins: false });
    L1.decks.push(Object.assign(HA.makeDeck(288, 240, 420, 384), { railing: false, drop: 2, material: 'concrete' }));
    L1.posts.push(HA.makePost(414, 246, 5.5, 96));
    L1.posts.push(HA.makePost(414, 378, 5.5, 96));
    label(L1, 'PRIMARY BEDROOM', 370, 200, 52);
    label(L1, 'ENSUITE', 370, 40, 30);
    label(L1, 'BEDROOM 2', 72, 108, 56);
    label(L1, 'BATH', 180, 44, 22);
    label(L1, 'KITCHEN', 240, 130, 40);
    label(L1, 'DINING', 72, 170, 40);
    label(L1, 'LIVING', 190, 310, 44);
    stdElec(m, [['meter', 426, 200], ['panel', 424, 170], ['outlet', 138, 6],
      ['outlet', 100, 378], ['switch', 192, 378], ['outlet_220', 282, 192]]);
    return m;
  };

  /* ============ 17 · The Sycamore — 1120sf 2bd/2ba T-plan ============ */
  const sycamore = () => {
    const m = base('The Sycamore ADU', {
      siding: 'lap_white', roof: 'shingle_charcoal',
      trim: '#2e3338', door: '#8c3b2e', pitch: 6,
    });
    const S = m.settings, L1 = m.levels[0];
    laundry(L1, 487, 44);   // laundry in the primary suite
    const pts = [[0, 0], [528, 0], [528, 240], [384, 240], [384, 384], [144, 384], [144, 240], [0, 240]];
    const [back, east, barSE, stemE, stemS, stemW, barSW, west] = ring(L1, pts, 'ext2x6', S);
    stemS.material = 'brick_white';
    // primary suite — east bar
    const b1 = W(L1, 384, 0, 384, 240, 'int2x4', S);
    doorAt(b1, 200, 30);
    bathS(L1, S, 384, 0, 84, 96, 'nw');
    closet(L1, S, 500, 96, 528, 168, 'w', 'e');
    fix(L1, 'bed_king', 456, 166, 0);  // shifted south to clear the ensuite door swing
    // bedroom 2 — west bar
    const b2 = W(L1, 144, 0, 144, 240, 'int2x4', S);
    doorAt(b2, 200, 30);
    closet(L1, S, 12, 0, 84, 28, 's', 'n');
    fix(L1, 'bed_queen', 72, 76, 0);
    bathS(L1, S, 144, 0, 96, 96, 'nw');
    // kitchen on the back wall, dining in the bar, living in the stem
    kRun(L1, 'n', 0, 252, 372, 282, 336);
    fix(L1, 'fridge', 368, 64, 270);
    fix(L1, 'island', 312, 84, 0);
    fix(L1, 'dining_table', 210, 160, 0);
    fix(L1, 'sofa', 180, 300, 90);
    fix(L1, 'coffee_table', 232, 300, 90);
    fix(L1, 'armchair', 320, 278, 180);
    doorAt(stemS, 264, 42, { swing: 'in', hinge: 'right', style: 'glass' });
    winAt(stemS, 330, 48, 60, 24, { trim: 'modern', muntins: false });
    winAt(stemS, 198, 48, 60, 24, { trim: 'modern', muntins: false });
    winAt(stemW, 312, 48, 48, 32, { trim: 'modern', muntins: false });
    winAt(stemE, 312, 48, 48, 32, { trim: 'modern', muntins: false });
    winAt(barSE, 456, 48, 48, 30, { trim: 'modern', muntins: false });
    winAt(barSW, 72, 48, 48, 30, { trim: 'modern', muntins: false });
    winAt(east, 204, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(west, 120, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(back, 114, 36, 48, 30, { trim: 'modern', muntins: false });
    winAt(back, 192, 36, 24, 50, { trim: 'modern', muntins: false });
    winAt(back, 282, 48, 36, 42, { trim: 'modern', muntins: false });
    winAt(back, 420, 36, 24, 50, { trim: 'modern', muntins: false });
    winAt(back, 498, 48, 48, 24, { trim: 'modern', muntins: false });
    L1.decks.push(Object.assign(HA.makeDeck(168, 384, 360, 480), { railing: false, covered: true }));
    L1.posts.push(HA.makePost(174, 474, 5.5, 98));
    L1.posts.push(HA.makePost(354, 474, 5.5, 98));
    label(L1, 'PRIMARY BEDROOM', 450, 222, 52);
    label(L1, 'ENSUITE', 410, 40, 30);
    label(L1, 'BEDROOM 2', 72, 140, 56);
    label(L1, 'BATH', 180, 44, 22);
    label(L1, 'KITCHEN', 312, 120, 50);
    label(L1, 'DINING', 210, 200, 40);
    label(L1, 'LIVING', 268, 300, 44);
    label(L1, 'PORCH', 264, 430, 40);
    stdElec(m, [['meter', 522, 200], ['panel', 520, 170], ['outlet', 282, 6],
      ['outlet', 200, 378], ['switch', 290, 378], ['outlet_220', 336, 6]]);
    return m;
  };

  /* ============ 18 · The Cottonwood — 1120sf 2bd, gable + porch ============ */
  const cottonwood = () => {
    const m = base('The Cottonwood ADU', {
      siding: 'lap_sage', roof: 'shingle_brown',
      trim: '#ece5d3', door: '#5d3a23', pitch: 8, rake: 16, overhang: 20,
    });
    const S = m.settings, L1 = m.levels[0];
    const [back, right, front, left] = ring(L1, [[0, 0], [336, 0], [336, 480], [0, 480]], 'ext2x6', S);
    back.gable = true; front.gable = true;
    const shared = W(L1, 168, 0, 168, 168, 'int2x4', S);
    const b1s = W(L1, 0, 168, 168, 168, 'int2x4', S);
    doorAt(b1s, 120, 30, { swing: 'out' });   // into the bedroom (was swinging toward the laundry/washer)
    closet(L1, S, 12, 140, 84, 168, 'n', 's');
    const b2s = W(L1, 168, 168, 336, 168, 'int2x4', S);
    doorAt(b2s, 216, 30);
    closet(L1, S, 252, 140, 324, 168, 'n', 's');
    bathS(L1, S, 0, 180, 96, 96, 'w', { tub: true });
    // laundry
    W(L1, 96, 180, 168, 180, 'int2x4', S);
    W(L1, 168, 180, 168, 252, 'int2x4', S);
    const lndS = W(L1, 96, 252, 168, 252, 'int2x4', S);
    doorAt(lndS, 132, 30);
    fix(L1, 'washer', 118, 196, 0);
    fix(L1, 'dryer', 146, 196, 0);
    kRun(L1, 'e', 336, 192, 312, 222, 276);
    fix(L1, 'fridge', 318, 342, 270);
    fix(L1, 'island', 253, 252, 270);
    fix(L1, 'bed_queen', 84, 72, 0);
    fix(L1, 'bed_queen', 252, 72, 0);
    fix(L1, 'dining_table', 220, 390, 0);
    fix(L1, 'sofa', 100, 390, 90);
    fix(L1, 'coffee_table', 152, 390, 90);
    doorAt(front, 168, 36, { swing: 'in', hinge: 'left', style: 'craftsman' });
    winAt(front, 84, 60, 60, 24, { trim: 'craftsman' });
    winAt(front, 252, 60, 60, 24, { trim: 'craftsman' });
    winAt(back, 84, 48, 48, 24, { trim: 'craftsman' });
    winAt(back, 252, 48, 48, 24, { trim: 'craftsman' });
    winAt(left, 84, 48, 48, 32, { trim: 'craftsman' });
    winAt(left, 228, 36, 24, 50, { trim: 'craftsman' });
    winAt(left, 390, 48, 48, 32, { trim: 'craftsman' });
    winAt(right, 84, 48, 48, 32, { trim: 'craftsman' });
    winAt(right, 400, 48, 48, 32, { trim: 'craftsman' });
    frontPorch(L1, S, 0, 336, 480, 96, 132, 204);
    label(L1, 'BEDROOM 1', 84, 126, 56);
    label(L1, 'BEDROOM 2', 252, 126, 56);
    label(L1, 'BATH', 52, 256, 24);
    label(L1, 'LAUNDRY', 132, 226, 30);
    label(L1, 'KITCHEN', 260, 184, 50);
    label(L1, 'DINING', 220, 350, 40);
    label(L1, 'LIVING', 190, 424, 44);
    stdElec(m, [['meter', 6, 350], ['panel', 10, 380], ['outlet', 84, 6],
      ['outlet', 240, 474], ['switch', 192, 474], ['outlet_220', 330, 276]]);
    return m;
  };

  /* ============ 19 · The Ponderosa — 1152sf 2bd/2ba + dormer ============ */
  const ponderosa = () => {
    const m = base('The Ponderosa ADU', {
      siding: 'stucco_sand', roof: 'shingle_slate',
      trim: '#6b4a32', door: '#3c4a3a', pitch: 7,
    });
    const S = m.settings, L1 = m.levels[0];
    laundry(L1, 13, 134);   // laundry between bedroom 2 and the kitchen
    const [back, right, front, left] = ring(L1, [[0, 0], [384, 0], [384, 432], [0, 432]], 'ext2x6', S);
    right.material = 'walnut_plank';
    // primary suite with ensuite + walk-in closet
    const sw = W(L1, 240, 0, 240, 240, 'int2x4', S);
    doorAt(sw, 210, 30);
    bathS(L1, S, 240, 0, 84, 96, 'nw');
    const wicS = W(L1, 324, 96, 384, 96, 'int2x4', S);
    doorAt(wicS, 354, 30);
    fix(L1, 'dresser', 371, 40, 270);
    fix(L1, 'bed_king', 312, 168, 0);  // shifted south to clear the ensuite + W.I.C. door swings
    // bedroom 2 + hall bath
    const b2e = W(L1, 144, 0, 144, 144, 'int2x4', S);
    const b2s = W(L1, 0, 144, 144, 144, 'int2x4', S);
    doorAt(b2s, 110, 30);
    closet(L1, S, 12, 116, 84, 144, 'n', 's');
    fix(L1, 'bed_queen', 72, 64, 0);
    bathS(L1, S, 144, 0, 96, 96, 'new');
    // kitchen / dining / living
    kRun(L1, 'w', 0, 156, 276, 186, 246);
    fix(L1, 'fridge', 18, 306, 90);
    fix(L1, 'island', 84, 216, 90);
    fix(L1, 'dining_table', 164, 200, 0);   // clear of the bedroom-2 door swing
    fix(L1, 'sofa', 250, 330, 0);
    fix(L1, 'coffee_table', 250, 375, 0);
    fix(L1, 'armchair', 330, 328, 270);
    doorAt(front, 192, 42, { swing: 'in', hinge: 'right', style: 'glass' });
    winAt(front, 96, 60, 60, 24, { trim: 'colonial' });
    winAt(front, 300, 60, 60, 24, { trim: 'colonial' });
    winAt(right, 170, 48, 48, 24, { trim: 'colonial' });
    winAt(right, 330, 48, 48, 32, { trim: 'colonial' });
    winAt(left, 72, 36, 48, 32, { trim: 'colonial' });
    winAt(left, 370, 48, 48, 32, { trim: 'colonial' });
    winAt(back, 72, 48, 48, 24, { trim: 'colonial' });
    winAt(back, 192, 36, 24, 50, { trim: 'colonial' });
    winAt(back, 270, 36, 24, 50, { trim: 'colonial' });
    m.roof.dormers.push(Object.assign(HA.makeDormer(front.id, 192), { width: 84, inset: 30 }));
    L1.decks.push(Object.assign(HA.makeDeck(132, 432, 276, 528), { railing: false, covered: true }));
    L1.posts.push(HA.makePost(138, 522, 5.5, 98));
    L1.posts.push(HA.makePost(270, 522, 5.5, 98));
    label(L1, 'PRIMARY BEDROOM', 310, 212, 52);
    label(L1, 'ENSUITE', 266, 40, 30);
    label(L1, 'W.I.C.', 354, 80, 24);
    label(L1, 'BEDROOM 2', 110, 124, 40);
    label(L1, 'BATH', 180, 44, 22);
    label(L1, 'KITCHEN', 84, 160, 50);
    label(L1, 'DINING', 190, 160, 40);
    label(L1, 'LIVING', 250, 300, 44);
    label(L1, 'PORCH', 204, 480, 40);
    stdElec(m, [['meter', 6, 380], ['panel', 10, 410], ['outlet', 72, 6],
      ['outlet', 300, 426], ['switch', 222, 426], ['outlet_220', 6, 246]]);
    return m;
  };

  /* ============ 20 · The Live Oak — 1200sf 2bd/2ba flagship ============ */
  const liveOak = () => {
    const m = base('The Live Oak ADU', {
      siding: 'batten_white', roof: 'metal_black',
      trim: '#2e3338', door: '#b3552c', pitch: 6, overhang: 18,
    });
    const S = m.settings, L1 = m.levels[0];
    laundry(L1, 187, 14);   // laundry by the baths
    const [back, right, front, left] = ring(L1, [[0, 0], [360, 0], [360, 480], [0, 480]], 'ext2x6', S);
    front.material = 'stone_gray';
    // primary suite with ensuite + walk-in closet
    const sw1 = W(L1, 204, 0, 204, 228, 'int2x4', S);
    const sw2 = W(L1, 204, 228, 360, 228, 'int2x4', S);
    doorAt(sw2, 240, 30);
    bathS(L1, S, 204, 0, 84, 96, 'nw');
    const wicS = W(L1, 288, 96, 360, 96, 'int2x4', S);
    doorAt(wicS, 318, 30);
    fix(L1, 'dresser', 347, 40, 270);
    fix(L1, 'bed_king', 300, 168, 0);  // shifted south to clear the ensuite + W.I.C. door swings
    // bedroom 2 + hall bath
    const b2e = W(L1, 132, 0, 132, 132, 'int2x4', S);
    const b2s = W(L1, 0, 132, 132, 132, 'int2x4', S);
    doorAt(b2s, 100, 30);
    closet(L1, S, 12, 104, 72, 132, 'n', 's');
    fix(L1, 'bed_queen', 66, 60, 0);
    bathC(L1, S, 132, 0, 72, 96, 'new');
    // kitchen / dining / living
    kRun(L1, 'w', 0, 156, 276, 186, 246);
    fix(L1, 'fridge', 18, 306, 90);
    fix(L1, 'island', 84, 216, 90);
    fix(L1, 'dining_table', 150, 330, 0);
    fix(L1, 'sofa', 280, 330, 0);
    fix(L1, 'coffee_table', 280, 375, 0);
    doorAt(front, 192, 42, { swing: 'in', hinge: 'right', style: 'glass' });
    doorAt(front, 276, 96, { doorType: 'slider', panels: 2, style: 'full_glass', handle: 'none', trim: 'modern' });
    winAt(front, 84, 60, 60, 24, { trim: 'modern', muntins: false });
    winAt(right, 150, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(right, 330, 48, 48, 32, { trim: 'modern', muntins: false });
    winAt(right, 414, 48, 48, 32, { trim: 'modern', muntins: false });
    winAt(left, 66, 36, 48, 32, { trim: 'modern', muntins: false });
    winAt(left, 360, 48, 48, 32, { trim: 'modern', muntins: false });
    winAt(back, 66, 48, 48, 24, { trim: 'modern', muntins: false });
    winAt(back, 252, 36, 24, 50, { trim: 'modern', muntins: false });
    winAt(back, 324, 36, 24, 50, { trim: 'modern', muntins: false });
    frontPorch(L1, S, 24, 336, 480, 96, 168, 216);
    label(L1, 'PRIMARY BEDROOM', 300, 208, 52);
    label(L1, 'ENSUITE', 230, 40, 28);
    label(L1, 'W.I.C.', 320, 80, 24);
    label(L1, 'BEDROOM 2', 96, 116, 40);
    label(L1, 'BATH', 166, 84, 16);
    label(L1, 'KITCHEN', 84, 144, 50);
    label(L1, 'DINING', 150, 290, 40);
    label(L1, 'LIVING', 280, 290, 44);
    label(L1, 'PORCH', 180, 530, 40);
    stdElec(m, [['meter', 354, 440], ['panel', 352, 410], ['outlet', 66, 6],
      ['outlet', 300, 474], ['switch', 222, 474], ['outlet_220', 6, 246]]);
    return m;
  };

  /* ============ registry ============ */
  HA.ADU_TEMPLATES = {
    wren: { id: 'wren', name: 'The Wren', sqft: 600, beds: 0, baths: 1, shape: 'rectangle', style: 'coastal lap studio', build: wren },
    heron: { id: 'heron', name: 'The Heron', sqft: 608, beds: 0, baths: 1, shape: 'long-narrow', style: 'board & batten gable studio', build: heron },
    finch: { id: 'finch', name: 'The Finch', sqft: 600, beds: 1, baths: 1, shape: 'rectangle', style: 'stucco hip + entry porch', build: finch },
    alder: { id: 'alder', name: 'The Alder', sqft: 600, beds: 1, baths: 1, shape: 'L', style: 'navy lap + batten accent, patio', build: alder },
    juniper: { id: 'juniper', name: 'The Juniper', sqft: 600, beds: 1, baths: 1, shape: 'rectangle', style: 'cedar alpine gable + deck', build: juniper },
    cedar_court: { id: 'cedar_court', name: 'The Cedar Court', sqft: 598, beds: 1, baths: 1, shape: 'rectangle', style: 'brick hip + covered porch', build: cedarCourt },
    madrone: { id: 'madrone', name: 'The Madrone', sqft: 800, beds: 1, baths: 1, shape: 'long-narrow', style: 'board & batten gable, den + deck', build: madrone },
    laurel: { id: 'laurel', name: 'The Laurel', sqft: 798, beds: 2, baths: 1, shape: 'rectangle', style: 'white stucco + terracotta, patio slider', build: laurel },
    bayberry: { id: 'bayberry', name: 'The Bayberry', sqft: 800, beds: 1, baths: 1, shape: 'L', style: 'sage lap + stone accent, courtyard patio', build: bayberry },
    tamarack: { id: 'tamarack', name: 'The Tamarack', sqft: 800, beds: 2, baths: 1, shape: 'T', style: 'buttercream lap craftsman', build: tamarack },
    willow: { id: 'willow', name: 'The Willow', sqft: 800, beds: 1, baths: 1, shape: 'rectangle', style: 'charcoal batten, split-gable front + porch', build: willow },
    poppy: { id: 'poppy', name: 'The Poppy', sqft: 792, beds: 2, baths: 1, shape: 'rectangle', style: 'iron black gable + cedar accent', build: poppy },
    olive: { id: 'olive', name: 'The Olive', sqft: 780, beds: 1, baths: 1, shape: 'rectangle', style: 'sage stucco + full-width porch', build: olive },
    sequoia: { id: 'sequoia', name: 'The Sequoia', sqft: 1080, beds: 2, baths: 2, shape: 'rectangle', style: 'gray lap + brick accent, porch', build: sequoia },
    manzanita: { id: 'manzanita', name: 'The Manzanita', sqft: 1000, beds: 2, baths: 1, shape: 'rectangle', style: 'adobe stucco hacienda gable', build: manzanita },
    redwood: { id: 'redwood', name: 'The Redwood', sqft: 1008, beds: 2, baths: 2, shape: 'L', style: 'cream batten + stone, mixed gable, patio', build: redwood },
    sycamore: { id: 'sycamore', name: 'The Sycamore', sqft: 1120, beds: 2, baths: 2, shape: 'T', style: 'white lap + brick stem, covered porch', build: sycamore },
    cottonwood: { id: 'cottonwood', name: 'The Cottonwood', sqft: 1120, beds: 2, baths: 1, shape: 'rectangle', style: 'sage lap gable + full porch', build: cottonwood },
    ponderosa: { id: 'ponderosa', name: 'The Ponderosa', sqft: 1152, beds: 2, baths: 2, shape: 'rectangle', style: 'sand stucco + walnut accent, dormer', build: ponderosa },
    live_oak: { id: 'live_oak', name: 'The Live Oak', sqft: 1200, beds: 2, baths: 2, shape: 'rectangle', style: 'white batten + stone, flagship porch', build: liveOak },
  };

  /* STAMP every ADU template as an ADU building. The auto-kitchen designer reads
     model._genOpts.mode to decide the kitchen tier — a generated house carries
     that stamp, but a template built directly did not, so its kitchen was sized
     off raw wall length (an 800sf ADU with a long open wall read 'large' and got
     a full kitchen + island). Steve: "in ADUs it should just be a kitchenette."
     Wrap each build() so the returned model is tagged — single point, no
     per-template edits, and it flows through to HA.DESIGNS (which reuses t.build). */
  for (const t of Object.values(HA.ADU_TEMPLATES)) {
    const orig = t.build;
    t.build = function () {
      const m = orig.apply(this, arguments);
      if (m && !m._genOpts) m._genOpts = { mode: 'adu', source: 'template', id: t.id, sqft: t.sqft, beds: t.beds, baths: t.baths };
      return m;
    };
  }

  /* merge into the Designs dropdown */
  HA.DESIGNS = HA.DESIGNS || {};
  for (const [id, t] of Object.entries(HA.ADU_TEMPLATES)) {
    const bd = t.beds === 0 ? 'studio' : t.beds + 'bd/' + t.baths + 'ba';
    HA.DESIGNS['adu_' + id] = {
      label: 'ADU · ' + t.name + ' — ' + bd + ' · ' + t.sqft + ' sf',
      build: t.build,
    };
  }
})();
