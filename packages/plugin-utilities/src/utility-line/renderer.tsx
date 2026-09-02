'use client'

import { useLiveNodeOverrides, useRegistry, useScene } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import { CatmullRomCurve3, type Group, LineCurve3, TubeGeometry, Vector3 } from 'three'
import { sampleOverheadPath, type Vec3 } from '../geometry/catenary'
import { dashIntervals } from '../geometry/dash'
import { gradeElevationAt, TRENCH_HEIGHT_ABOVE_GRADE } from '../geometry/grade'
import type { UtilityLineNode } from '../schema'
import { SYSTEM_COLOR } from '../schema'
import { resolveFrame, siteToLocal } from '../site-frame'
import { resolveLineEndpoints } from './endpoints'

/** Cable / conduit radius, metres. A drawing radius, not a conductor size. */
const OVERHEAD_RADIUS = 0.022
const BURIED_RADIUS = 0.05
/** Dash and gap lengths for the buried run, metres. */
const DASH = 0.7
const GAP = 0.35

/**
 * 3D renderer for a utility run.
 *
 * OVERHEAD — one tube swept along the catenary-sampled path
 * (`sampleOverheadPath`), so each span visibly sags by `sagRatio` of its
 * length; the run's own vertices are the attachment points and stay exact.
 *
 * UNDERGROUND — the run is drawn twice: a DASHED tube at the stored burial
 * depth (each dash is its own tube, so the dashing survives any camera
 * distance, unlike a line dash material), and a faint continuous trench
 * ribbon just above grade so the run is findable from a plan-ish camera
 * without digging.
 *
 * Coordinates: the node stores SITE metres and this renderer is mounted
 * under the BUILDING group, so every vertex goes through `siteToLocal`
 * first. See `site-frame.ts`.
 */
export const UtilityLineRenderer = ({ node: rawNode }: { node: UtilityLineNode }) => {
  const ref = useRef<Group>(null!)
  const liveOverride = useLiveNodeOverrides((s) => s.overrides.get(rawNode.id))
  const node = useMemo<UtilityLineNode>(
    () => (liveOverride ? ({ ...rawNode, ...liveOverride } as UtilityLineNode) : rawNode),
    [rawNode, liveOverride],
  )
  useRegistry(node.id, node.type, ref)
  const handlers = useNodeEvents(node as never, node.type as never)
  const nodes = useScene((s) => s.nodes)

  const color = SYSTEM_COLOR[node.system]

  /**
   * The run in BUILDING-LOCAL metres.
   *
   * The SITE path is RESOLVED first (`endpoints.ts`): a linked end is read
   * off the pole's crossarm or the meter's anchor every render, so moving
   * either node moves the cable, and an overhead run with no stored heights
   * gets its attachment elevations derived instead of being drawn at
   * whatever y happened to be in `path` (which is how a service drop ended
   * up lying in the floor).
   */
  const { local, localGradeY } = useMemo(() => {
    const frame = resolveFrame(
      nodes as unknown as Record<string, Record<string, unknown>>,
      node as unknown as Record<string, unknown>,
    )
    const site = resolveLineEndpoints(
      nodes as unknown as Record<string, Record<string, unknown>>,
      node,
    ).path
    return {
      local: site.map((p) => siteToLocal(frame, p)) as Vec3[],
      // Grade in the LOCAL frame. The trench ribbon rides the GROUND, not
      // the building origin — `siteToLocal` subtracts `frame.origin[1]`, so
      // a hardcoded local y floated the trench whenever the building sat
      // above grade.
      localGradeY: site.length
        ? siteToLocal(frame, [
            (site[0] as Vec3)[0],
            gradeElevationAt(null, [(site[0] as Vec3)[0], (site[0] as Vec3)[2]]) +
              TRENCH_HEIGHT_ABOVE_GRADE,
            (site[0] as Vec3)[2],
          ])[1]
        : TRENCH_HEIGHT_ABOVE_GRADE,
    }
  }, [nodes, node])

  const overheadGeometry = useMemo<TubeGeometry | null>(() => {
    if (node.routing !== 'overhead' || local.length < 2) return null
    const sampled = sampleOverheadPath(local, node.sagRatio, 24)
    const curve = new CatmullRomCurve3(
      sampled.map((p) => new Vector3(p[0], p[1], p[2])),
      false,
      'catmullrom',
      0,
    )
    return new TubeGeometry(curve, Math.max(8, sampled.length * 2), OVERHEAD_RADIUS, 6, false)
  }, [local, node.routing, node.sagRatio])

  const buriedGeometries = useMemo<TubeGeometry[]>(() => {
    if (node.routing !== 'underground' || local.length < 2) return []
    return dashIntervals(local, DASH, GAP).map(
      (interval) =>
        new TubeGeometry(
          new LineCurve3(
            new Vector3(interval.start[0], interval.start[1], interval.start[2]),
            new Vector3(interval.end[0], interval.end[1], interval.end[2]),
          ),
          1,
          BURIED_RADIUS,
          6,
          false,
        ),
    )
  }, [local, node.routing])

  const trenchGeometry = useMemo<TubeGeometry | null>(() => {
    if (node.routing !== 'underground' || local.length < 2) return null
    const points = local.map((p) => new Vector3(p[0], localGradeY, p[2]))
    const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0)
    return new TubeGeometry(curve, Math.max(8, points.length * 4), 0.03, 4, false)
  }, [local, localGradeY, node.routing])

  useEffect(
    () => () => {
      overheadGeometry?.dispose()
    },
    [overheadGeometry],
  )
  useEffect(
    () => () => {
      for (const geometry of buriedGeometries) geometry.dispose()
    },
    [buriedGeometries],
  )
  useEffect(
    () => () => {
      trenchGeometry?.dispose()
    },
    [trenchGeometry],
  )

  return (
    <group ref={ref} visible={node.visible !== false} {...handlers}>
      {overheadGeometry ? (
        <mesh geometry={overheadGeometry}>
          <meshStandardMaterial color={color} metalness={0.1} roughness={0.7} />
        </mesh>
      ) : null}
      {buriedGeometries.map((geometry, index) => (
        <mesh geometry={geometry} key={`dash-${index}-${geometry.id}`}>
          <meshStandardMaterial color={color} metalness={0.05} roughness={0.9} />
        </mesh>
      ))}
      {trenchGeometry ? (
        <mesh geometry={trenchGeometry}>
          <meshBasicMaterial color={color} opacity={0.35} transparent />
        </mesh>
      ) : null}
    </group>
  )
}

export default UtilityLineRenderer
