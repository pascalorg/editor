'use client'

import {
  resolveStairHandrailPaths,
  resolveStairRailPaths,
  resolveStairWalkInside,
  type StairNode,
  type StairRailPath,
  useScene,
} from '@pascal-app/core'
import { getStairRailingMaterial, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { guardBoxGeometry, metricBox } from './baluster-geometry'
import { buildBalusterGuard } from './baluster-guard'
import { buildBoardsGuard } from './boards-guard'
import { buildCableGuard } from './cable-guard'
import { buildGlassGuard, type GlassPanel } from './glass-guard'
import { resolveStairSlotMaterial } from './materials'
import { buildMetalGuard } from './metal-guard'
import { buildPostAndRailGuard } from './post-and-rail-guard'
import type { StairRenderData } from './use-stair-render-data'

/** A continuous guard's newels are at most this far apart along the run. */
const GUARD_POST_SPACING = 1.2192
/** Picket pitch; its 95 mm clear gap (0.127 − 0.032 m) matches the detail budget. */
const GUARD_PICKET_PITCH = 0.127

function bar(a: THREE.Vector3, b: THREE.Vector3, width: number, depth: number, round = false) {
  const direction = b.clone().sub(a),
    length = direction.length()
  if (length < 1e-8) return null
  const geometry = round
    ? new THREE.CylinderGeometry(width / 2, width / 2, length, 12)
    : metricBox(length, depth, width)
  if (round) {
    const uv = geometry.getAttribute('uv'),
      position = geometry.getAttribute('position'),
      normal = geometry.getAttribute('normal')
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(normal.getY(i)) > 0.5) uv.setXY(i, position.getX(i), position.getZ(i))
      else uv.setXY(i, uv.getX(i) * 12 * width * Math.sin(Math.PI / 12), uv.getY(i) * length)
    }
    geometry.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.clone().normalize(),
      ),
    )
  } else {
    const x = direction.normalize(),
      z = new THREE.Vector3().crossVectors(x, new THREE.Vector3(0, 1, 0)).normalize()
    if (z.lengthSq() < 1e-8) z.set(0, 0, 1)
    const y = new THREE.Vector3().crossVectors(z, x).normalize()
    geometry.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z))
  }
  geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
  return geometry
}

/** One flat glass pane as a plumb-edged parallelogram of real thickness, with
 * metre UVs on every face (E-009). Built in a local frame (x along the chord, y
 * vertical, z the thickness) then yawed to the chord heading and set at its
 * inset foot, so the pane's edges stay plumb through a sloping flight. */
function glassPanelGeometry(panel: GlassPanel) {
  const { run, rise, bottom, top, thickness } = panel
  const shape = new THREE.Shape()
    .moveTo(0, bottom)
    .lineTo(run, rise + bottom)
    .lineTo(run, rise + top)
    .lineTo(0, top)
    .closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false })
  const position = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal'),
    uv = geometry.getAttribute('uv')
  for (let i = 0; i < position.count; i++) {
    const n = new THREE.Vector3(normal.getX(i), normal.getY(i), normal.getZ(i))
    const axis = Math.abs(n.x) < 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
    const u = axis.addScaledVector(n, -axis.dot(n)).normalize(),
      v = new THREE.Vector3().crossVectors(n, u).normalize()
    const point = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i))
    uv.setXY(i, point.dot(u), point.dot(v))
  }
  geometry.translate(0, 0, -thickness / 2)
  geometry.rotateY(-panel.yaw)
  geometry.translate(panel.start[0], panel.start[1], panel.start[2])
  return geometry
}

function buildRails(
  stair: StairNode,
  paths: StairRailPath[],
  handrails: StairRailPath[],
  guard: boolean,
  insideWalk?: (x: number, z: number) => boolean,
) {
  const parts: THREE.BufferGeometry[] = [],
    infill: THREE.BufferGeometry[] = []
  const add = (geometry: THREE.BufferGeometry | null, glass = false) => {
    if (geometry) (glass ? infill : parts).push(geometry)
  }
  const style = stair.railingStyle ?? 'balusters',
    height = stair.railingHeight
  for (const path of guard ? paths : []) {
    // The chassis guards (balusters, post-and-rail, cable, boards, glass, metal)
    // share the path chassis, so the winder/continuous run reads as the same
    // guard as the per-flight one. Cable then spans straight chords between the
    // shared posts, not along the curve, so a sweep stays physically honest;
    // boards run a stack of flat courses along the path; glass hangs one rigid
    // flat pane per bay between the posts, point-fixed by clamps; metal stands
    // slim posts on baseplates with slender plumb balusters between its rails.
    const common = {
      railHeight: height,
      postSpacing: GUARD_POST_SPACING,
      topPost: stair.railingTopPost !== false,
      postThrough: stair.railingPostThrough === true,
      reach: stair.railingTopReach ?? 0,
    }
    if (style === 'glass') {
      const { frame, panels } = buildGlassGuard(path.points, { ...common, insideWalk })
      for (const box of frame) add(guardBoxGeometry(box))
      for (const panel of panels) add(glassPanelGeometry(panel), true)
      continue
    }
    const boxes =
      style === 'post-and-rail'
        ? buildPostAndRailGuard(path.points, common)
        : style === 'cable'
          ? buildCableGuard(path.points, common)
          : style === 'boards'
            ? buildBoardsGuard(path.points, common)
            : style === 'metal'
              ? buildMetalGuard(path.points, common)
              : buildBalusterGuard(path.points, { ...common, pickets: GUARD_PICKET_PITCH })
    for (const box of boxes) add(guardBoxGeometry(box))
  }
  const guardCount = parts.reduce(
    (sum, geometry) => sum + (geometry.index?.count ?? geometry.getAttribute('position').count),
    0,
  )
  const config = stair.handrail
  for (const path of config ? handrails : []) {
    const points = path.points.map((point) => new THREE.Vector3(...point))
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!,
        direction = b.clone().sub(a)
      if (direction.length() < 1e-8) continue
      add(
        bar(
          a
            .clone()

            .add(new THREE.Vector3(0, config!.height, 0)),
          b
            .clone()

            .add(new THREE.Vector3(0, config!.height, 0)),
          config!.diameter,
          config!.diameter,
          true,
        ),
      )
    }
  }
  const merge = (geometries: THREE.BufferGeometry[]) => {
    if (!geometries.length) return null
    // Normalize attributes before merging boxes, cylinders and extruded panels.
    for (const geometry of geometries) geometry.deleteAttribute('uv2')
    const result = mergeGeometries(geometries, false)
    for (const geometry of geometries) geometry.dispose()
    return result
  }
  const handrailCount =
    parts.reduce(
      (sum, geometry) => sum + (geometry.index?.count ?? geometry.getAttribute('position').count),
      0,
    ) - guardCount
  const metal = merge(parts)
  if (metal)
    metal.userData.pascalIfcParts = [
      ...(guardCount ? [{ start: 0, count: guardCount, role: 'railing' }] : []),
      ...(handrailCount ? [{ start: guardCount, count: handrailCount, role: 'handrail' }] : []),
    ]
  return [metal, merge(infill)] as const
}

export function ContinuousStairRailings({
  stair,
  material,
  guard = true,
  renderData,
}: {
  stair: StairNode
  material: THREE.Material
  guard?: boolean
  renderData: StairRenderData
}) {
  const { stair: resolvedStair, nodes: effective } = renderData
  const sceneMaterials = useScene((state) => state.materials)
  const shading = useViewer((state) => state.shading),
    textures = useViewer((state) => state.textures),
    colorPreset = useViewer((state) => state.colorPreset)
  const paths = useMemo(
    () => (guard ? resolveStairRailPaths(resolvedStair, effective) : []),
    [resolvedStair, effective, guard],
  )
  const handrails = useMemo(
    () => (resolvedStair.handrail ? resolveStairHandrailPaths(resolvedStair, effective) : []),
    [resolvedStair, effective],
  )
  const insideWalk = useMemo(
    () =>
      guard && resolvedStair.railingStyle === 'glass'
        ? resolveStairWalkInside(resolvedStair, effective)
        : undefined,
    [resolvedStair, effective, guard],
  )
  const geometry = useMemo(
    () => buildRails(stair, paths, handrails, guard, insideWalk),
    [stair, paths, handrails, guard, insideWalk],
  )
  useEffect(
    () => () => {
      for (const part of geometry) part?.dispose()
    },
    [geometry],
  )
  const glass = useMemo(
    () =>
      resolveStairSlotMaterial(
        stair,
        'infill',
        'library:preset-glass',
        getStairRailingMaterial(stair, shading, textures, colorPreset),
        sceneMaterials,
        shading,
        textures,
      ),
    [stair, shading, textures, colorPreset, sceneMaterials],
  )
  return (
    <group name="stair-continuous-railing" userData={{ pascalIfcRole: 'railing' }}>
      {geometry[0] ? (
        <mesh
          dispose={null}
          name="stair-railing"
          geometry={geometry[0]}
          material={material}
          castShadow
          receiveShadow
          userData={{
            slotId: 'railing',
            pascalIfcRole: 'railing',
            pascalIfcParts: geometry[0].userData.pascalIfcParts,
          }}
        />
      ) : null}
      {geometry[1] ? (
        <mesh
          dispose={null}
          name="stair-railing-infill"
          geometry={geometry[1]}
          material={glass}
          castShadow
          receiveShadow
          userData={{ slotId: 'infill', pascalIfcRole: 'railing' }}
        />
      ) : null}
    </group>
  )
}
