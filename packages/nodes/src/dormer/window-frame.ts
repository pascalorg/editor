import * as THREE from 'three'

/**
 * Frame + glass geometry for the window opening on a dormer's gable
 * face. Ported from the legacy `dormer-window-geometry` module — the
 * extruded frame profile follows the same shape as the CSG cut, so the
 * frame sits flush in the wall.
 *
 * Only the frame bars and glass panes are produced here; the wall
 * opening itself is CSG-subtracted from the dormer body inside the
 * viewer's `generateDormerGeometry`.
 */
export type DormerWindowShape = 'rectangle' | 'rounded' | 'arch'

export type WindowGeometries = {
  frameBars: { geo: THREE.BufferGeometry; pos: [number, number, number] }[]
  glassPanes: { geo: THREE.BufferGeometry; pos: [number, number, number] }[]
}

function makeArchShape(hw: number, hh: number, archHeight: number): THREE.Shape {
  const clampedArch = Math.min(Math.max(archHeight, 0.01), Math.max(hh * 2, 0.01))
  const springY = hh - clampedArch
  const segments = 32
  const shape = new THREE.Shape()
  shape.moveTo(-hw, -hh)
  shape.lineTo(hw, -hh)
  shape.lineTo(hw, springY)
  for (let i = 1; i <= segments; i++) {
    const x = hw + (-hw - hw) * (i / segments)
    const t = Math.min(Math.abs(x) / Math.max(hw, 1e-6), 1)
    const y = springY + clampedArch * Math.sqrt(Math.max(1 - t * t, 0))
    shape.lineTo(x, y)
  }
  shape.lineTo(-hw, -hh)
  shape.closePath()
  return shape
}

function normalizeRadii(
  radii: [number, number, number, number],
  w: number,
  h: number,
): [number, number, number, number] {
  const r = radii.map((v) => Math.max(v, 0)) as [number, number, number, number]
  const scale = Math.min(
    1,
    Math.max(w, 0) / Math.max(r[0] + r[1], 1e-6),
    Math.max(w, 0) / Math.max(r[3] + r[2], 1e-6),
    Math.max(h, 0) / Math.max(r[0] + r[3], 1e-6),
    Math.max(h, 0) / Math.max(r[1] + r[2], 1e-6),
  )
  if (scale >= 1) return r
  return r.map((v) => v * scale) as [number, number, number, number]
}

function makeRoundedShape(
  hw: number,
  hh: number,
  radii: [number, number, number, number],
): THREE.Shape {
  const [tl, tr, br, bl] = normalizeRadii(radii, hw * 2, hh * 2)
  const shape = new THREE.Shape()
  shape.moveTo(-hw + bl, -hh)
  shape.lineTo(hw - br, -hh)
  if (br > 0) shape.absarc(hw - br, -hh + br, br, -Math.PI / 2, 0, false)
  else shape.lineTo(hw, -hh)
  shape.lineTo(hw, hh - tr)
  if (tr > 0) shape.absarc(hw - tr, hh - tr, tr, 0, Math.PI / 2, false)
  else shape.lineTo(hw, hh)
  shape.lineTo(-hw + tl, hh)
  if (tl > 0) shape.absarc(-hw + tl, hh - tl, tl, Math.PI / 2, Math.PI, false)
  else shape.lineTo(-hw, hh)
  shape.lineTo(-hw, -hh + bl)
  if (bl > 0) shape.absarc(-hw + bl, -hh + bl, bl, Math.PI, (3 * Math.PI) / 2, false)
  else shape.lineTo(-hw, -hh)
  shape.closePath()
  return shape
}

export function buildDormerWindowGeometries(
  winW: number,
  winH: number,
  ft: number,
  fd: number,
  cols: number,
  rows: number,
  dt: number,
  shape: DormerWindowShape = 'rectangle',
  archHeight = 0.35,
  cornerRadii: [number, number, number, number] = [0.15, 0.15, 0.15, 0.15],
): WindowGeometries {
  const safeFt = Math.max(0.001, ft)
  const safeDt = Math.max(0.001, dt)
  const innerW = Math.max(0.01, winW - 2 * safeFt)
  const innerH = Math.max(0.01, winH - 2 * safeFt)
  const hw = winW / 2
  const hh = winH / 2

  const frameBars: WindowGeometries['frameBars'] = []
  const glassPanes: WindowGeometries['glassPanes'] = []

  if (shape === 'arch' || shape === 'rounded') {
    const insetRadii = cornerRadii.map((r) => Math.max(r - safeFt, 0)) as [
      number,
      number,
      number,
      number,
    ]
    const outerShape =
      shape === 'arch'
        ? makeArchShape(hw, hh, archHeight)
        : makeRoundedShape(hw, hh, cornerRadii)

    const innerHole =
      shape === 'arch'
        ? makeArchShape(hw - safeFt, hh - safeFt, Math.max(archHeight - safeFt, 0.01))
        : makeRoundedShape(hw - safeFt, hh - safeFt, insetRadii)

    outerShape.holes.push(innerHole)
    const frameGeo = new THREE.ExtrudeGeometry(outerShape, {
      depth: fd,
      bevelEnabled: false,
      curveSegments: 24,
    })
    frameGeo.translate(0, 0, -fd / 2)
    frameBars.push({ geo: frameGeo, pos: [0, 0, 0] })

    const colDividerCount = cols - 1
    const totalColDividerW = colDividerCount * safeDt
    const paneAreaW = Math.max(0.01, innerW - totalColDividerW)
    const paneW = paneAreaW / cols

    for (let c = 1; c < cols; c++) {
      const x = -innerW / 2 + c * paneW + (c - 0.5) * safeDt
      frameBars.push({ geo: new THREE.BoxGeometry(safeDt, innerH, fd), pos: [x, 0, 0] })
    }

    const rowDividerCount = rows - 1
    const totalRowDividerH = rowDividerCount * safeDt
    const paneAreaH = Math.max(0.01, innerH - totalRowDividerH)
    const paneH = paneAreaH / rows

    for (let r = 1; r < rows; r++) {
      const y = -innerH / 2 + r * paneH + (r - 0.5) * safeDt
      frameBars.push({ geo: new THREE.BoxGeometry(innerW, safeDt, fd), pos: [0, y, 0] })
    }

    const glassShape =
      shape === 'arch'
        ? makeArchShape(hw - safeFt, hh - safeFt, Math.max(archHeight - safeFt, 0.01))
        : makeRoundedShape(hw - safeFt, hh - safeFt, insetRadii)
    const glassGeo = new THREE.ExtrudeGeometry(glassShape, {
      depth: 0.008,
      bevelEnabled: false,
      curveSegments: 24,
    })
    glassGeo.translate(0, 0, -0.004)
    glassPanes.push({ geo: glassGeo, pos: [0, 0, 0] })
  } else {
    frameBars.push({
      geo: new THREE.BoxGeometry(winW, safeFt, fd),
      pos: [0, hh - safeFt / 2, 0],
    })
    frameBars.push({
      geo: new THREE.BoxGeometry(winW, safeFt, fd),
      pos: [0, -hh + safeFt / 2, 0],
    })
    frameBars.push({
      geo: new THREE.BoxGeometry(safeFt, innerH, fd),
      pos: [-hw + safeFt / 2, 0, 0],
    })
    frameBars.push({
      geo: new THREE.BoxGeometry(safeFt, innerH, fd),
      pos: [hw - safeFt / 2, 0, 0],
    })

    const colDividerCount = cols - 1
    const totalColDividerW = colDividerCount * safeDt
    const paneAreaW = Math.max(0.01, innerW - totalColDividerW)
    const paneW = paneAreaW / cols

    for (let c = 1; c < cols; c++) {
      const x = -innerW / 2 + c * paneW + (c - 0.5) * safeDt
      frameBars.push({ geo: new THREE.BoxGeometry(safeDt, innerH, fd), pos: [x, 0, 0] })
    }

    const rowDividerCount = rows - 1
    const totalRowDividerH = rowDividerCount * safeDt
    const paneAreaH = Math.max(0.01, innerH - totalRowDividerH)
    const paneH = paneAreaH / rows

    for (let r = 1; r < rows; r++) {
      const y = -innerH / 2 + r * paneH + (r - 0.5) * safeDt
      frameBars.push({ geo: new THREE.BoxGeometry(innerW, safeDt, fd), pos: [0, y, 0] })
    }

    const glassW = Math.max(0.01, paneAreaW / cols)
    const glassH = Math.max(0.01, paneAreaH / rows)
    const glassGeo = new THREE.BoxGeometry(glassW, glassH, 0.008)

    for (let c = 0; c < cols; c++) {
      const cx = -innerW / 2 + paneAreaW / cols / 2 + c * (paneAreaW / cols + safeDt)
      for (let r = 0; r < rows; r++) {
        const cy = -innerH / 2 + paneAreaH / rows / 2 + r * (paneAreaH / rows + safeDt)
        glassPanes.push({ geo: glassGeo, pos: [cx, cy, 0] })
      }
    }
  }

  return { frameBars, glassPanes }
}
