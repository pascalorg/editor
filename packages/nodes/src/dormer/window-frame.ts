import * as THREE from 'three'
import { createDormerArchShape, createDormerRoundedShape } from './csg-geometry'

/**
 * Frame + glass geometry for the window opening on a dormer's gable
 * face. The extruded frame profile uses the same shape builders as the
 * CSG cut in the viewer (`generateDormerGeometry`), so the frame sits
 * flush in the wall — keeping the cut and the frame visually in sync.
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
        ? createDormerArchShape(winW, winH, archHeight)
        : createDormerRoundedShape(winW, winH, cornerRadii)

    const innerHole =
      shape === 'arch'
        ? createDormerArchShape(
            winW - 2 * safeFt,
            winH - 2 * safeFt,
            Math.max(archHeight - safeFt, 0.01),
          )
        : createDormerRoundedShape(winW - 2 * safeFt, winH - 2 * safeFt, insetRadii)

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
        ? createDormerArchShape(
            winW - 2 * safeFt,
            winH - 2 * safeFt,
            Math.max(archHeight - safeFt, 0.01),
          )
        : createDormerRoundedShape(winW - 2 * safeFt, winH - 2 * safeFt, insetRadii)
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
