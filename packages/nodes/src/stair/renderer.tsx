'use client'

import {
  computeSegmentTransforms,
  measureStairDetail,
  resolveArcStairConstruction,
  resolveStairArcLayout,
  resolveStairRailPaths,
  resolveStairWalkingPaths,
  rotateXZ,
  STAIR_RAILING_SLOT_DEFAULT,
  type StairNode,
  type StairSegmentNode,
  type StairSlotId,
  stairArcSliceCount,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  getStairBodyMaterials,
  getStairRailingMaterial,
  NodeRenderer,
  OVERLAY_LAYER,
  type StairBodyMaterials,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { createPlaceholderGeometry } from '../shared/placeholder-geometry'
import { mergeGuardBoxes } from './baluster-geometry'
import { balusterGuardRails, buildBalusterGuard } from './baluster-guard'
import { boardsGuardRails, buildBoardsGuard } from './boards-guard'
import { buildCableGuard, cableGuardRails } from './cable-guard'
import { ContinuousStairRailings } from './continuous-railings'
import {
  barBox,
  GUARD_PICKET_PITCH,
  GUARD_POST_SPACING,
  type GuardBox,
  type GuardRail,
} from './guard-path'
import {
  resolveStairBodySlotMaterials,
  resolveStairSegmentMaterials,
  resolveStairSlotMaterial,
} from './materials'
import { buildPostAndRailGuard, postAndRailGuardRails } from './post-and-rail-guard'
import { type StairRenderData, useStairRenderData } from './use-stair-render-data'

type StairRailPathSide = 'left' | 'right' | 'front'

type StairRailSidePath = {
  side: StairRailPathSide
  points: [number, number, number][]
}

type StairSegmentRailPath = {
  layout: StairRailLayout
  sidePaths: StairRailSidePath[]
  connectFromPrevious: boolean
}

type StairRailLayout = {
  center: [number, number]
  elevation: number
  rotation: number
  segment: StairSegmentNode
}

type LandingChainNextStair = {
  nextStairLayout?: StairRailLayout
  isTerminalLandingBeforeStair: boolean
}

export const StairRenderer = ({ node: rawNode }: { node: StairNode }) => {
  const ref = useRef<THREE.Group>(null!)
  // Merge any live drag override into the node so curved/spiral geometry
  // (built declaratively in JSX below) rebuilds on every drag tick. The
  // resize arrows publish to `useLiveNodeOverrides` and only commit to
  // zustand on release — subscribing here turns those override writes
  // into the React re-renders that drive the visible mesh update.
  const liveOverride = useLiveNodeOverrides((s) => s.overrides.get(rawNode.id))
  const node = useMemo<StairNode>(
    () => (liveOverride ? ({ ...rawNode, ...liveOverride } as StairNode) : rawNode),
    [rawNode, liveOverride],
  )
  const isSegmentBasedStair = node.stairType === 'straight'

  useRegistry(node.id, 'stair', ref)

  useLayoutEffect(() => {
    useScene.getState().markDirty(node.id)
  }, [node.id])

  const handlers = useNodeEvents(node, 'stair')
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset = useViewer((s) => s.colorPreset)
  const sceneMaterials = useScene((s) => s.materials)

  const baseBodyMaterials = useMemo(
    () => getStairBodyMaterials(node, shading, textures, colorPreset),
    [node, shading, textures, colorPreset],
  )

  const bodyMaterials = useMemo<StairBodyMaterials>(
    () => resolveStairBodySlotMaterials(node, baseBodyMaterials, sceneMaterials, shading, textures),
    [baseBodyMaterials, node, sceneMaterials, shading, textures],
  )
  const renderData = useStairRenderData(node)
  const { segments, totalRise } = renderData
  useLayoutEffect(() => {
    for (const id of node.children) useScene.getState().markDirty(id)
  }, [node.children, node.construction])
  const detail = useMemo(() => measureStairDetail(node, segments), [node, segments])
  const mergedMaterials = useMemo(
    () =>
      segments.length
        ? segments.flatMap((segment) =>
            resolveStairSegmentMaterials(
              segment,
              node,
              bodyMaterials,
              sceneMaterials,
              shading,
              textures,
              colorPreset,
            ),
          )
        : bodyMaterials,
    [segments, node, bodyMaterials, sceneMaterials, shading, textures, colorPreset],
  )
  const mergedSlotData = useMemo(
    () => ({
      surfaceNodeIds: segments.flatMap((segment) => [segment.id, segment.id]),
      segmentIds: segments.flatMap((segment) => [segment.id, segment.id]),
      slotIds: Array.from({ length: Math.max(1, segments.length) }, () => [
        'treads',
        'body',
      ]).flat(),
    }),
    [segments],
  )

  const baseRailingMaterial = useMemo(
    () => getStairRailingMaterial(node, shading, textures, colorPreset),
    [node, shading, textures, colorPreset],
  )

  const railingMaterial = useMemo(
    () =>
      resolveStairSlotMaterial(
        node,
        'railing',
        STAIR_RAILING_SLOT_DEFAULT,
        baseRailingMaterial,
        sceneMaterials,
        shading,
        textures,
      ),
    [baseRailingMaterial, node, sceneMaterials, shading, textures],
  )

  // Each flight contributes tread and body material groups to the merged mesh.
  const straightPlaceholderGeometry = useMemo(() => createPlaceholderGeometry(2), [])

  useEffect(() => {
    return () => {
      straightPlaceholderGeometry.dispose()
    }
  }, [straightPlaceholderGeometry])

  return (
    <group
      position-x={node.position[0]}
      position-z={node.position[2]}
      ref={ref}
      rotation-y={node.rotation}
      visible={node.visible}
      userData={{ pascalExportRefusal: detail.error }}
      {...handlers}
    >
      {isSegmentBasedStair ? (
        <mesh
          castShadow
          geometry={straightPlaceholderGeometry}
          material={mergedMaterials}
          name="merged-stair"
          receiveShadow
          userData={mergedSlotData}
        />
      ) : null}
      {isSegmentBasedStair || detail.error ? null : (
        <CurvedStairBody bodyMaterials={bodyMaterials} stair={node} rise={totalRise} />
      )}
      {detail.error ? null : segments.some((segment) => segment.winder) ||
        node.railingPath === 'continuous' ||
        node.railingStyle === 'glass' ||
        node.railingStyle === 'metal' ? (
        <ContinuousStairRailings material={railingMaterial} stair={node} renderData={renderData} />
      ) : (
        <>
          <StairRailings material={railingMaterial} stair={node} renderData={renderData} />
          {node.handrail ? (
            <ContinuousStairRailings
              material={railingMaterial}
              stair={node}
              renderData={renderData}
              guard={false}
            />
          ) : null}
        </>
      )}
      <StairWalkingLine stair={node} segments={segments} totalRise={totalRise} />
      {isSegmentBasedStair && !detail.error ? (
        <group name="segments-wrapper" visible={false}>
          {(node.children ?? []).map((childId) => (
            <NodeRenderer key={childId} nodeId={childId} />
          ))}
        </group>
      ) : null}
    </group>
  )
}

function StairWalkingLine({
  stair,
  segments,
  totalRise,
}: {
  stair: StairNode
  segments: StairSegmentNode[]
  totalRise: number
}) {
  const selected = useViewer((state) => state.selection.selectedIds.includes(stair.id))
  const lines = useMemo(() => {
    if (!selected) return []
    return resolveStairWalkingPaths(stair, segments, totalRise).map((points) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(
        points.map(([x, y, z]) => new THREE.Vector3(x, y + 0.02, z)),
      )
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: '#2563eb', depthTest: false }),
      )
      line.name = 'stair-walking-line'
      line.layers.set(OVERLAY_LAYER)
      line.userData.pascalExport = 'strip'
      line.raycast = () => {}
      return line
    })
  }, [selected, stair, segments, totalRise])
  useEffect(
    () => () => {
      for (const line of lines) {
        line.geometry.dispose()
        line.material.dispose()
      }
    },
    [lines],
  )
  return (
    <group name="stair-walking-lines">
      {lines.map((line) => (
        <primitive key={line.uuid} object={line} dispose={null} />
      ))}
    </group>
  )
}

function StairRailings({
  stair,
  material,
  renderData,
}: {
  stair: StairNode
  material: THREE.Material
  renderData: StairRenderData
}) {
  const { stair: resolvedStair, segments, nodes } = renderData

  const railPaths = useMemo(
    () =>
      buildStairRailPaths(segments, stair.railingMode ?? 'none')
        .map((path, index) => ({
          ...path,
          connectFromPrevious: path.connectFromPrevious && segments[index - 1]?.visible !== false,
        }))
        .filter((path) => path.layout.segment.visible !== false),
    [segments, stair.railingMode],
  )

  const railHeight = stair.railingHeight ?? 0.92
  const style = stair.railingStyle ?? 'balusters'
  // Every style — balusters, post-and-rail, cable and the board-infill deck
  // guard — is a merged `GuardMesh` built on the shared path chassis, so each
  // reads as one coherent guard across straight, chained, winder, curved and
  // spiral layouts.

  if ((stair.railingMode ?? 'none') === 'none') {
    return null
  }

  if (stair.stairType === 'curved' || stair.stairType === 'spiral') {
    // The arc rail follows the same analytic ≤5° path the continuous guard and
    // the exporters read (`resolveStairRailPaths`): one shared source for the
    // signed, possibly multi-turn sweep, the inner/outer radius per side and the
    // integrated landing arrival — not a per-step polyline that facets the curve
    // and drops the landing. `GuardMesh` then spaces pickets by run, so the
    // density tracks the arc length instead of the step count — for the deck
    // post-and-rail guard as well as the balusters.
    const arcPaths = resolveStairRailPaths(resolvedStair, nodes, stair.railingMode ?? 'none')
    if (arcPaths.length === 0) return null
    return (
      <group name="stair-railing" userData={{ pascalIfcRole: 'railing' }}>
        {arcPaths.map((path, index) => (
          <GuardMesh
            key={`${stair.id}-arc-railing-${path.side}-${index}`}
            material={material}
            points={path.points}
            postThrough={stair.railingPostThrough === true}
            railHeight={railHeight}
            reach={stair.railingTopReach ?? 0}
            style={style}
            topPost={stair.railingTopPost !== false}
          />
        ))}
      </group>
    )
  }

  if (railPaths.length === 0) {
    return null
  }

  // `topPost`/`reach` describe the top of the whole stair, so they apply only
  // to the flight whose guard reaches the highest point; the rest keep their
  // newel at the junction with the next flight.
  const topY = Math.max(
    ...railPaths.flatMap((segmentPath) =>
      segmentPath.sidePaths.map(
        (sidePath) =>
          segmentPath.layout.elevation + Math.max(...sidePath.points.map((point) => point[1])),
      ),
    ),
  )

  // The rails bridging consecutive flights, as metre-UV boxes in the stair's
  // local frame, merged into one mesh (E-009) like the per-flight guards. The
  // bridge carries the same rails as the guard style it joins.
  const connectorRails: GuardRail[] =
    style === 'post-and-rail'
      ? postAndRailGuardRails(railHeight)
      : style === 'cable'
        ? cableGuardRails(railHeight)
        : style === 'boards'
          ? boardsGuardRails(railHeight)
          : balusterGuardRails(railHeight)
  const connectorBoxes = railPaths.slice(1).flatMap((segmentPath, index) => {
    const previousPath = railPaths[index]
    if (!(previousPath && segmentPath.connectFromPrevious)) return []
    if (previousPath.layout.segment.segmentType === 'landing') return []
    if (segmentPath.layout.segment.segmentType === 'landing') return []
    return segmentPath.sidePaths.flatMap((sidePath) => {
      const currentPoint = sidePath.points[0]
      if (!currentPoint) return []
      const currentWorldPoint = toWorldRailPoint(segmentPath.layout, currentPoint)
      const previousSidePath = [...previousPath.sidePaths]
        .map((entry) => {
          const lastPoint = entry.points[entry.points.length - 1]
          return {
            entry,
            distance: lastPoint
              ? distance3(toWorldRailPoint(previousPath.layout, lastPoint), currentWorldPoint)
              : Number.POSITIVE_INFINITY,
          }
        })
        .sort((left, right) => left.distance - right.distance)[0]?.entry
      const previousPoint = previousSidePath?.points.length
        ? previousSidePath.points[previousSidePath.points.length - 1]
        : null
      if (!previousPoint) return []
      const previousWorldPoint = toWorldRailPoint(previousPath.layout, previousPoint)
      return connectorRails
        .map((rail) =>
          barBox(
            [previousWorldPoint[0], previousWorldPoint[1] + rail.y, previousWorldPoint[2]],
            [currentWorldPoint[0], currentWorldPoint[1] + rail.y, currentWorldPoint[2]],
            rail.across,
            rail.vertical,
          ),
        )
        .filter((box): box is GuardBox => box !== null)
    })
  })

  return (
    <group name="stair-railing" userData={{ pascalIfcRole: 'railing' }}>
      {railPaths.map((segmentPath) => (
        <group
          key={`${segmentPath.layout.segment.id}-railing`}
          position={[
            segmentPath.layout.center[0],
            segmentPath.layout.elevation,
            segmentPath.layout.center[1],
          ]}
          rotation-y={segmentPath.layout.rotation}
        >
          {segmentPath.sidePaths.map((sidePath, sideIndex) => {
            const points = sidePath.points.map(
              (p) => [p[2], p[1], p[0]] as [number, number, number],
            )
            const guardTopY = segmentPath.layout.elevation + Math.max(...points.map((p) => p[1]))
            const terminal = guardTopY >= topY - 1e-4
            // The builder treats the last point as the run's top, so a terminal
            // flight whose points descend is reversed before `reach`/`topPost`.
            const oriented =
              terminal && (points[0]?.[1] ?? 0) > (points.at(-1)?.[1] ?? 0)
                ? [...points].reverse()
                : points
            return (
              <GuardMesh
                key={`${segmentPath.layout.segment.id}-${sidePath.side}-${sideIndex}`}
                material={material}
                points={oriented}
                postThrough={stair.railingPostThrough === true}
                railHeight={railHeight}
                reach={terminal ? (stair.railingTopReach ?? 0) : 0}
                style={style}
                topPost={terminal ? stair.railingTopPost !== false : true}
              />
            )
          })}
        </group>
      ))}
      <ConnectorRails boxes={connectorBoxes} material={material} />
    </group>
  )
}

// Shared, module-level geometries: every mesh that uses one carries
// `dispose={null}` — R3F disposes a mesh's geometry on unmount, and a
// regenerated house unmounts its stairs, after which the next stair drew a
// disposed buffer (WebGPU: "Vertex buffer slot 0 … was not set").
const STAIR_TREAD_MATERIAL_INDEX = 0
const STAIR_SIDE_MATERIAL_INDEX = 1
const STAIR_BODY_SLOT_IDS: StairSlotId[] = ['treads', 'body']
const STAIR_BODY_SLOT_USER_DATA = { slotIds: STAIR_BODY_SLOT_IDS }
const STAIR_BODY_SINGLE_SLOT_USER_DATA = { slotId: 'body' satisfies StairSlotId }
const STAIR_RAILING_SLOT_USER_DATA = { slotId: 'railing' satisfies StairSlotId }

/**
 * A guard for one rail path — a run of posts, rails and infill spaced by run
 * length (not one per path vertex), merged into a single metre-UV mesh (E-009)
 * so a finish tiles the same as the continuous guard and the whole guard is one
 * draw call. `style` picks the members: 'post-and-rail' and 'boards' build the
 * DCA 6 deck guard (4x4 posts, a flat cap) with square pickets or a stack of
 * flat board courses respectively, 'cable' spans chords between the posts, and
 * every other style builds the balusters. Spacing by run keeps the infill
 * density coherent whether the path is a straight flight's nosing line or a
 * densely sampled arc. `topPost`/`reach` describe the run's terminal end
 * and so are passed only on the flight that reaches the top of the stair; every
 * other flight keeps its post where it meets the next.
 */
function GuardMesh({
  points,
  railHeight,
  postThrough,
  topPost = true,
  reach = 0,
  style,
  material,
}: {
  points: [number, number, number][]
  railHeight: number
  postThrough: boolean
  topPost?: boolean
  reach?: number
  style: StairNode['railingStyle']
  material: THREE.Material
}) {
  const geometry = useMemo(
    () =>
      mergeGuardBoxes(
        style === 'post-and-rail'
          ? buildPostAndRailGuard(points, {
              railHeight,
              postSpacing: GUARD_POST_SPACING,
              postThrough,
              topPost,
              reach,
            })
          : style === 'cable'
            ? buildCableGuard(points, {
                railHeight,
                postSpacing: GUARD_POST_SPACING,
                postThrough,
                topPost,
                reach,
              })
            : style === 'boards'
              ? buildBoardsGuard(points, {
                  railHeight,
                  postSpacing: GUARD_POST_SPACING,
                  postThrough,
                  topPost,
                  reach,
                })
              : buildBalusterGuard(points, {
                  railHeight,
                  pickets: GUARD_PICKET_PITCH,
                  postSpacing: GUARD_POST_SPACING,
                  postThrough,
                  topPost,
                  reach,
                }),
      ),
    [points, railHeight, postThrough, topPost, reach, style],
  )
  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null
  return (
    <mesh
      castShadow
      dispose={null}
      geometry={geometry}
      material={material}
      name={
        style === 'post-and-rail'
          ? 'stair-railing-post-and-rail'
          : style === 'cable'
            ? 'stair-railing-cable'
            : style === 'boards'
              ? 'stair-railing-boards'
              : 'stair-railing-baluster'
      }
      receiveShadow
      userData={STAIR_RAILING_SLOT_USER_DATA}
    />
  )
}

/** The rails bridging consecutive flights, merged into one metre-UV mesh. */
function ConnectorRails({ boxes, material }: { boxes: GuardBox[]; material: THREE.Material }) {
  const geometry = useMemo(() => mergeGuardBoxes(boxes), [boxes])
  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null
  return (
    <mesh
      castShadow
      dispose={null}
      geometry={geometry}
      material={material}
      name="stair-railing-baluster"
      receiveShadow
      userData={STAIR_RAILING_SLOT_USER_DATA}
    />
  )
}

function CurvedStairBody({
  stair,
  bodyMaterials,
  rise,
}: {
  stair: StairNode
  bodyMaterials: StairBodyMaterials
  rise: number
}) {
  const sideMaterial = bodyMaterials[1]
  const totalRise = Math.max(rise, 0.001)
  const isSpiral = stair.stairType === 'spiral'
  const layout = resolveStairArcLayout(stair, totalRise)
  const { innerRadius, outerRadius, thickness } = layout
  const spiralColumnRadius = Math.min(
    innerRadius * 0.72,
    Math.max(innerRadius - 0.03, innerRadius * 0.5),
  )
  const spiralColumnHeight = totalRise + thickness
  const explicitPieces = resolveArcStairConstruction(stair, totalRise)

  return (
    <group name={isSpiral ? 'spiral-stair' : 'curved-stair'}>
      {isSpiral && (stair.showCenterColumn ?? true) ? (
        <SpiralColumnMesh
          height={spiralColumnHeight}
          material={sideMaterial}
          radius={spiralColumnRadius}
        />
      ) : null}
      {explicitPieces ? (
        <>
          {explicitPieces.map((piece, index) => (
            <CurvedStepMesh
              key={`${stair.id}-construction-${index}`}
              innerRadius={piece.innerRadius}
              outerRadius={piece.outerRadius}
              startAngle={piece.startAngle}
              endAngle={piece.endAngle}
              positionY={piece.bottomStart}
              stepHeight={piece.top - piece.bottomStart}
              bottomDelta={piece.bottomEnd - piece.bottomStart}
              ifcRole={piece.index === layout.stepCount ? 'landing' : undefined}
              surfaceRole={piece.role}
              material={bodyMaterials}
            />
          ))}
          {isSpiral && (stair.showStepSupports ?? true)
            ? layout.steps.map((step, index) => (
                <group
                  key={`${stair.id}-support-${index}`}
                  position-y={
                    step.top -
                    (stair.construction!.finishThickness + stair.construction!.treadThickness)
                  }
                >
                  <SpiralStepSupportMesh
                    innerRadius={innerRadius}
                    spiralColumnRadius={spiralColumnRadius}
                    midAngle={(step.startAngle + step.endAngle) / 2}
                    thickness={stair.construction!.treadThickness}
                    material={sideMaterial}
                  />
                </group>
              ))
            : null}
        </>
      ) : (
        layout.steps.map((step, index) => {
          const { startAngle, endAngle } = step
          const midAngle = (startAngle + endAngle) / 2
          return (
            <group
              key={`${stair.id}-${isSpiral ? 'spiral' : 'curved'}-step-${index}`}
              position-y={step.bottom}
            >
              {isSpiral && (stair.showStepSupports ?? true) ? (
                <SpiralStepSupportMesh
                  innerRadius={innerRadius}
                  material={sideMaterial}
                  midAngle={midAngle}
                  spiralColumnRadius={spiralColumnRadius}
                  thickness={thickness}
                />
              ) : null}
              <CurvedStepMesh
                endAngle={endAngle}
                innerRadius={innerRadius}
                material={bodyMaterials}
                outerRadius={outerRadius}
                positionY={0}
                startAngle={startAngle}
                stepHeight={step.top - step.bottom}
              />
            </group>
          )
        })
      )}
      {layout.landing && !explicitPieces ? (
        <CurvedStepMesh
          ifcRole="landing"
          endAngle={layout.landing.endAngle}
          innerRadius={innerRadius}
          material={bodyMaterials}
          outerRadius={outerRadius}
          positionY={layout.landing.bottom}
          startAngle={layout.landing.startAngle}
          stepHeight={thickness}
        />
      ) : null}
    </group>
  )
}

function CurvedStepMesh({
  innerRadius,
  outerRadius,
  startAngle,
  endAngle,
  stepHeight,
  positionY,
  material,
  bottomDelta = 0,
  surfaceRole = 'mixed',
  ifcRole,
}: {
  innerRadius: number
  outerRadius: number
  startAngle: number
  endAngle: number
  stepHeight: number
  positionY: number
  material: THREE.Material | THREE.Material[]
  bottomDelta?: number
  surfaceRole?: 'body' | 'tread' | 'mixed'
  ifcRole?: 'landing'
}) {
  const geometry = useMemo(
    () =>
      buildCurvedStepGeometry(
        innerRadius,
        outerRadius,
        startAngle,
        endAngle,
        stepHeight,
        bottomDelta,
        surfaceRole,
      ),
    [endAngle, innerRadius, outerRadius, startAngle, stepHeight, bottomDelta, surfaceRole],
  )

  // Dispose the prior BufferGeometry as soon as a new one supersedes it.
  // Resize drags (in 2D or 3D) rebuild this geometry every pointer move;
  // without explicit disposal, WebGPU keeps a stale pipeline reference to
  // the old vertex buffer and flags "Vertex buffer slot 0 required by
  // [RenderPipeline ...MeshLambertNodeMaterial...] was not set" on the
  // submit after the swap. Same mitigation as guide/renderer.tsx.
  useEffect(
    () => () => {
      geometry.dispose()
    },
    [geometry],
  )

  return (
    <mesh
      castShadow
      geometry={geometry}
      material={material}
      position-y={positionY}
      receiveShadow
      userData={{ ...STAIR_BODY_SLOT_USER_DATA, ...(ifcRole ? { pascalIfcRole: ifcRole } : {}) }}
    />
  )
}

/**
 * Spiral center column. The cylinder is rebuilt whenever
 * `spiralColumnRadius` changes — i.e. on every tick of an inner-radius
 * drag. We pass the geometry as a prop (avoiding R3F's empty-placeholder
 * frame from inline JSX) and dispose the prior one on swap, matching the
 * pattern in guide/renderer.tsx. Without this WebGPU flags
 * "Vertex buffer slot 0 ... was not set" on Lambert mid-resize.
 */
function SpiralColumnMesh({
  radius,
  height,
  material,
}: {
  radius: number
  height: number
  material: THREE.Material | THREE.Material[]
}) {
  const geometry = useMemo(
    () => new THREE.CylinderGeometry(radius, radius, height, 10),
    [radius, height],
  )
  useEffect(
    () => () => {
      geometry.dispose()
    },
    [geometry],
  )
  return (
    <mesh
      castShadow
      geometry={geometry}
      material={material}
      name="stair-side"
      position={[0, height / 2, 0]}
      receiveShadow
      userData={STAIR_BODY_SINGLE_SLOT_USER_DATA}
    />
  )
}

/**
 * Spiral step support — the small box wedged between the column and the
 * inner rim of each step. Same prop-+-dispose pattern as
 * `SpiralColumnMesh`: the box dimensions change every inner-radius tick
 * (`innerRadius - spiralColumnRadius`), so inline-JSX geometry would
 * trigger the Lambert vertex-buffer error.
 */
function SpiralStepSupportMesh({
  innerRadius,
  spiralColumnRadius,
  midAngle,
  thickness,
  material,
}: {
  innerRadius: number
  spiralColumnRadius: number
  midAngle: number
  thickness: number
  material: THREE.Material | THREE.Material[]
}) {
  const sizeX = Math.max(0.04, innerRadius - spiralColumnRadius + 0.04)
  const sizeY = Math.max(thickness * 0.55, 0.025)
  const sizeZ = Math.max(0.04, Math.min(0.12, sizeY * 1.5))
  const geometry = useMemo(() => new THREE.BoxGeometry(sizeX, sizeY, sizeZ), [sizeX, sizeY, sizeZ])
  useEffect(
    () => () => {
      geometry.dispose()
    },
    [geometry],
  )
  const radial = spiralColumnRadius + sizeX / 2 - 0.02
  return (
    <mesh
      castShadow
      geometry={geometry}
      material={material}
      name="stair-side"
      position={[Math.cos(midAngle) * radial, sizeY / 2, Math.sin(midAngle) * radial]}
      receiveShadow
      rotation-y={-midAngle}
      userData={STAIR_BODY_SINGLE_SLOT_USER_DATA}
    />
  )
}

function buildCurvedStepGeometry(
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  authoredEndAngle: number,
  height: number,
  bottomDelta = 0,
  surfaceRole: 'body' | 'tread' | 'mixed' = 'mixed',
) {
  const clampedHeight = Math.max(height, Number.EPSILON)
  const y0 = 0
  const y1 = clampedHeight
  const endAngle =
    startAngle +
    Math.sign(authoredEndAngle - startAngle || 1) *
      Math.min(Math.abs(authoredEndAngle - startAngle), Math.PI * 2)
  const sweepAngle = endAngle - startAngle
  const sweepDirection = Math.sign(sweepAngle) || 1
  const segmentCount = stairArcSliceCount(innerRadius, outerRadius, sweepAngle)

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const triangleMaterialIndices: number[] = []

  const pointOnArc = (radius: number, angle: number, y: number) =>
    new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius)

  const pushUv = (point: THREE.Vector3, normal: THREE.Vector3) => {
    if (normal.y > 0.999999) {
      uvs.push(point.x, point.z)
    } else if (normal.y < -0.000001) {
      // Each faceted underside triangle has its own physical plane.
      const u = new THREE.Vector3(1, 0, 0).addScaledVector(normal, -normal.x).normalize()
      const v = new THREE.Vector3().crossVectors(normal, u).normalize()
      uvs.push(point.dot(u), point.dot(v))
    } else {
      const u = new THREE.Vector3(normal.z, 0, -normal.x).normalize()
      uvs.push(point.dot(u), point.y)
    }
  }

  const pushTriangle = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    normal: THREE.Vector3,
    materialIndex: number,
  ) => {
    const edgeAB = b.clone().sub(a)
    const edgeAC = c.clone().sub(a)
    const faceNormal = edgeAB.cross(edgeAC)
    const ordered = faceNormal.dot(normal) >= 0 ? [a, b, c] : [a, c, b]
    for (const point of ordered) {
      positions.push(point.x, point.y, point.z)
      const shadingNormal =
        normal.y < 0
          ? faceNormal.normalize().multiplyScalar(faceNormal.dot(normal) < 0 ? -1 : 1)
          : normal
      normals.push(shadingNormal.x, shadingNormal.y, shadingNormal.z)
      pushUv(point, shadingNormal)
    }
    triangleMaterialIndices.push(
      surfaceRole === 'mixed'
        ? materialIndex
        : surfaceRole === 'tread'
          ? STAIR_TREAD_MATERIAL_INDEX
          : STAIR_SIDE_MATERIAL_INDEX,
    )
  }

  const pushQuad = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    normal: THREE.Vector3,
    materialIndex: number,
  ) => {
    pushTriangle(a, b, c, normal, materialIndex)
    pushTriangle(a, c, d, normal, materialIndex)
  }

  const upNormal = new THREE.Vector3(0, 1, 0)
  const downNormal = new THREE.Vector3(0, -1, 0)

  for (let index = 0; index < segmentCount; index++) {
    const t0 = index / segmentCount
    const t1 = (index + 1) / segmentCount
    const segStart = startAngle + sweepAngle * t0
    const segEnd = startAngle + sweepAngle * t1
    const midAngle = (segStart + segEnd) / 2

    const innerStartBottom = pointOnArc(innerRadius, segStart, y0 + bottomDelta * t0)
    const innerEndBottom = pointOnArc(innerRadius, segEnd, y0 + bottomDelta * t1)
    const outerStartBottom = pointOnArc(outerRadius, segStart, y0 + bottomDelta * t0)
    const outerEndBottom = pointOnArc(outerRadius, segEnd, y0 + bottomDelta * t1)
    const innerStartTop = pointOnArc(innerRadius, segStart, y1)
    const innerEndTop = pointOnArc(innerRadius, segEnd, y1)
    const outerStartTop = pointOnArc(outerRadius, segStart, y1)
    const outerEndTop = pointOnArc(outerRadius, segEnd, y1)

    const outerNormal = new THREE.Vector3(Math.cos(midAngle), 0, Math.sin(midAngle)).normalize()
    const innerNormal = new THREE.Vector3(-Math.cos(midAngle), 0, -Math.sin(midAngle)).normalize()

    pushQuad(
      innerStartTop,
      outerStartTop,
      outerEndTop,
      innerEndTop,
      upNormal,
      STAIR_TREAD_MATERIAL_INDEX,
    )
    pushQuad(
      innerStartBottom,
      innerEndBottom,
      outerEndBottom,
      outerStartBottom,
      downNormal,
      STAIR_SIDE_MATERIAL_INDEX,
    )
    pushQuad(
      innerStartBottom,
      innerStartTop,
      innerEndTop,
      innerEndBottom,
      innerNormal,
      STAIR_SIDE_MATERIAL_INDEX,
    )
    pushQuad(
      outerStartBottom,
      outerEndBottom,
      outerEndTop,
      outerStartTop,
      outerNormal,
      STAIR_SIDE_MATERIAL_INDEX,
    )
  }

  const startInnerBottom = pointOnArc(innerRadius, startAngle, y0)
  const startOuterBottom = pointOnArc(outerRadius, startAngle, y0)
  const startInnerTop = pointOnArc(innerRadius, startAngle, y1)
  const startOuterTop = pointOnArc(outerRadius, startAngle, y1)
  const endInnerBottom = pointOnArc(innerRadius, endAngle, y0 + bottomDelta)
  const endOuterBottom = pointOnArc(outerRadius, endAngle, y0 + bottomDelta)
  const endInnerTop = pointOnArc(innerRadius, endAngle, y1)
  const endOuterTop = pointOnArc(outerRadius, endAngle, y1)
  const startNormal = new THREE.Vector3(
    sweepDirection * Math.sin(startAngle),
    0,
    -sweepDirection * Math.cos(startAngle),
  ).normalize()
  const endNormal = new THREE.Vector3(
    -sweepDirection * Math.sin(endAngle),
    0,
    sweepDirection * Math.cos(endAngle),
  ).normalize()

  pushQuad(
    startInnerBottom,
    startOuterBottom,
    startOuterTop,
    startInnerTop,
    startNormal,
    STAIR_SIDE_MATERIAL_INDEX,
  )
  pushQuad(
    endInnerBottom,
    endInnerTop,
    endOuterTop,
    endOuterBottom,
    endNormal,
    STAIR_SIDE_MATERIAL_INDEX,
  )

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.clearGroups()

  let currentMaterial = triangleMaterialIndices[0]
  let groupStart = 0

  for (let triangleIndex = 1; triangleIndex < triangleMaterialIndices.length; triangleIndex++) {
    const materialIndex = triangleMaterialIndices[triangleIndex]
    if (materialIndex === currentMaterial) continue

    geometry.addGroup(groupStart * 3, (triangleIndex - groupStart) * 3, currentMaterial)
    groupStart = triangleIndex
    currentMaterial = materialIndex
  }

  if (triangleMaterialIndices.length > 0) {
    geometry.addGroup(
      groupStart * 3,
      (triangleMaterialIndices.length - groupStart) * 3,
      currentMaterial ?? STAIR_SIDE_MATERIAL_INDEX,
    )
  }
  geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs.slice(), 2))
  geometry.computeVertexNormals()
  return geometry
}

function buildStairRailPaths(
  segments: StairSegmentNode[],
  railingMode: StairNode['railingMode'],
): StairSegmentRailPath[] {
  if (!segments.length || railingMode === 'none') return []

  const layouts = computeStairRailLayouts(segments)
  const landingInset = 0.08

  if (railingMode === 'both') {
    const isStraightLineDoubleLandingLayout =
      layouts.length === 4 &&
      layouts[0]?.segment.segmentType === 'stair' &&
      layouts[1]?.segment.segmentType === 'landing' &&
      layouts[2]?.segment.segmentType === 'stair' &&
      layouts[2]?.segment.attachmentSide === 'front' &&
      layouts[3]?.segment.segmentType === 'landing' &&
      layouts[3]?.segment.attachmentSide === 'front'

    return layouts.map((layout, index) => {
      const previousLayout = index > 0 ? layouts[index - 1] : undefined
      const nextLayout = layouts[index + 1]
      const { nextStairLayout, isTerminalLandingBeforeStair } = resolveLandingChainNextStair(
        layouts,
        index,
      )
      const hideLandingRailing =
        layout.segment.segmentType === 'landing' &&
        previousLayout?.segment.segmentType === 'stair' &&
        nextLayout?.segment.segmentType === 'stair'
      const visualTurnSide =
        isTerminalLandingBeforeStair && nextStairLayout?.segment.attachmentSide
          ? nextStairLayout.segment.attachmentSide
          : nextLayout?.segment.attachmentSide
      const sideCandidates =
        isTerminalLandingBeforeStair && layout.segment.segmentType === 'landing'
          ? visualTurnSide === 'left'
            ? (['front', 'right'] as const)
            : visualTurnSide === 'right'
              ? (['front', 'left'] as const)
              : (['left', 'right'] as const)
          : hideLandingRailing
            ? visualTurnSide === 'left'
              ? (['front', 'right'] as const)
              : visualTurnSide === 'right'
                ? (['front', 'left'] as const)
                : (['left', 'right'] as const)
            : layout.segment.segmentType === 'landing'
              ? nextLayout?.segment.segmentType === 'landing' && visualTurnSide === 'left'
                ? (['front', 'right'] as const)
                : nextLayout?.segment.segmentType === 'landing' && visualTurnSide === 'right'
                  ? (['front', 'left'] as const)
                  : visualTurnSide === 'left'
                    ? (['right'] as const)
                    : visualTurnSide === 'right'
                      ? (['left'] as const)
                      : (['left', 'right'] as const)
              : (['left', 'right'] as const)

      return {
        layout,
        sidePaths:
          isStraightLineDoubleLandingLayout && index === 1
            ? (['left', 'right'] as const).map((side) =>
                buildSegmentRailPath(layouts, index, side, landingInset),
              )
            : sideCandidates.map((side) =>
                buildSegmentRailPath(layouts, index, side, landingInset),
              ),
        connectFromPrevious:
          index > 0 &&
          !(
            previousLayout?.segment.segmentType === 'landing' &&
            layout.segment.segmentType === 'landing'
          ),
      }
    })
  }

  const isStraightLineDoubleLandingLayout =
    layouts.length === 4 &&
    layouts[0]?.segment.segmentType === 'stair' &&
    layouts[1]?.segment.segmentType === 'landing' &&
    layouts[2]?.segment.segmentType === 'stair' &&
    layouts[2]?.segment.attachmentSide === 'front' &&
    layouts[3]?.segment.segmentType === 'landing' &&
    layouts[3]?.segment.attachmentSide === 'front'

  return layouts.map((layout, index) => {
    const previousLayout = index > 0 ? layouts[index - 1] : undefined
    const nextLayout = layouts[index + 1]
    const { nextStairLayout, isTerminalLandingBeforeStair } = resolveLandingChainNextStair(
      layouts,
      index,
    )
    const isMiddleLandingBetweenFlights =
      layout.segment.segmentType === 'landing' &&
      previousLayout?.segment.segmentType === 'stair' &&
      nextLayout?.segment.segmentType === 'stair'
    const nextAttachmentSide = nextLayout?.segment.attachmentSide
    const terminalNextAttachmentSide = nextStairLayout?.segment.attachmentSide
    const suppressMiddleLandingOnPreferredTurnSide =
      isMiddleLandingBetweenFlights &&
      nextAttachmentSide != null &&
      nextAttachmentSide !== 'front' &&
      nextAttachmentSide === railingMode
    const suppressLandingRailing =
      (layout.segment.segmentType === 'landing' &&
        nextLayout?.segment.segmentType === 'landing' &&
        nextAttachmentSide === railingMode) ||
      suppressMiddleLandingOnPreferredTurnSide
    const landingContinuesOnPreferredSide =
      layout.segment.segmentType === 'landing'
        ? nextAttachmentSide == null ||
          nextAttachmentSide === 'front' ||
          nextAttachmentSide === railingMode
        : true

    const sideCandidates = suppressLandingRailing
      ? ([] as StairRailPathSide[])
      : layout.segment.segmentType !== 'landing'
        ? [railingMode]
        : isTerminalLandingBeforeStair
          ? railingMode === 'left'
            ? terminalNextAttachmentSide === 'right'
              ? (['front', 'left'] as const)
              : terminalNextAttachmentSide === 'front' || terminalNextAttachmentSide == null
                ? (['left'] as const)
                : ([] as StairRailPathSide[])
            : railingMode === 'right'
              ? terminalNextAttachmentSide === 'left'
                ? (['front', 'right'] as const)
                : terminalNextAttachmentSide === 'front' || terminalNextAttachmentSide == null
                  ? (['right'] as const)
                  : ([] as StairRailPathSide[])
              : [railingMode]
          : isStraightLineDoubleLandingLayout
            ? [railingMode]
            : isMiddleLandingBetweenFlights && railingMode === 'left'
              ? nextAttachmentSide === 'right'
                ? (['front', 'left'] as const)
                : (['left'] as const)
              : isMiddleLandingBetweenFlights && railingMode === 'right'
                ? nextAttachmentSide === 'left'
                  ? (['front', 'right'] as const)
                  : (['right'] as const)
                : nextLayout?.segment.segmentType === 'landing' &&
                    nextAttachmentSide != null &&
                    nextAttachmentSide !== 'front' &&
                    nextAttachmentSide !== railingMode
                  ? (['front', railingMode] as StairRailPathSide[])
                  : [railingMode]

    return {
      layout,
      sidePaths: sideCandidates.map((side) =>
        buildSegmentRailPath(layouts, index, side, landingInset),
      ),
      connectFromPrevious:
        index > 0 &&
        !suppressLandingRailing &&
        sideCandidates.length > 0 &&
        (layout.segment.segmentType === 'landing' ? landingContinuesOnPreferredSide : true),
    }
  })
}

function resolveLandingChainNextStair(
  layouts: StairRailLayout[],
  index: number,
): LandingChainNextStair {
  const layout = layouts[index]
  if (layout?.segment.segmentType !== 'landing') {
    return { isTerminalLandingBeforeStair: false }
  }

  let cursor = index
  while (cursor + 1 < layouts.length && layouts[cursor + 1]?.segment.segmentType === 'landing') {
    cursor += 1
  }

  const nextStairLayout =
    cursor + 1 < layouts.length && layouts[cursor + 1]?.segment.segmentType === 'stair'
      ? layouts[cursor + 1]
      : undefined

  return {
    nextStairLayout,
    isTerminalLandingBeforeStair: Boolean(nextStairLayout) && cursor === index,
  }
}

function computeStairRailLayouts(segments: StairSegmentNode[]): StairRailLayout[] {
  const transforms = computeSegmentTransforms(segments)
  return segments.map((segment, index) => {
    const transform = transforms[index]!
    const [centerOffsetX, centerOffsetZ] = rotateXZ(0, segment.length / 2, transform.rotation)
    return {
      center: [transform.position[0] + centerOffsetX, transform.position[2] + centerOffsetZ],
      elevation: transform.position[1],
      rotation: transform.rotation,
      segment,
    }
  })
}

function buildSegmentRailPath(
  layouts: StairRailLayout[],
  layoutIndex: number,
  side: StairRailPathSide,
  landingInset: number,
): StairRailSidePath {
  const layout = layouts[layoutIndex]!
  const segment = layout.segment
  const previousLayout = layoutIndex > 0 ? layouts[layoutIndex - 1] : undefined
  const nextLayout = layoutIndex >= 0 ? layouts[layoutIndex + 1] : undefined
  const steps = Math.max(1, segment.segmentType === 'landing' ? 1 : segment.stepCount)
  const stepDepth = segment.length / steps
  const stepHeight = segment.segmentType === 'landing' ? 0 : segment.height / steps
  const flightSideOffset = side === 'left' ? segment.width / 2 - 0.045 : -segment.width / 2 + 0.045
  const flightStartX =
    previousLayout?.segment.segmentType === 'landing'
      ? -segment.length / 2 + landingInset
      : -segment.length / 2
  const flightEndX =
    nextLayout?.segment.segmentType === 'landing'
      ? segment.length / 2 - landingInset
      : segment.length / 2
  const landingFrontX =
    previousLayout?.segment.segmentType === 'stair' &&
    segment.attachmentSide &&
    segment.attachmentSide !== 'front'
      ? -segment.length / 2 + landingInset
      : segment.length / 2 - landingInset

  if (segment.segmentType === 'landing') {
    const backX = -segment.length / 2 + landingInset
    const frontX = segment.length / 2 - landingInset
    const leftZ = segment.width / 2 - landingInset
    const rightZ = -segment.width / 2 + landingInset

    return {
      side,
      points:
        side === 'left'
          ? [
              [backX, 0, leftZ],
              [frontX, 0, leftZ],
            ]
          : side === 'right'
            ? [
                [backX, 0, rightZ],
                [frontX, 0, rightZ],
              ]
            : [
                [landingFrontX, 0, leftZ],
                [landingFrontX, 0, rightZ],
              ],
    }
  }

  return {
    side,
    points: [
      ...(previousLayout?.segment.segmentType === 'landing'
        ? []
        : ([[flightStartX, stepHeight > 0 ? stepHeight : 0, flightSideOffset]] as [
            number,
            number,
            number,
          ][])),
      ...Array.from({ length: steps }).map(
        (_, index) =>
          [
            -segment.length / 2 + stepDepth * index + stepDepth / 2,
            stepHeight * (index + 1),
            flightSideOffset,
          ] as [number, number, number],
      ),
      ...(nextLayout?.segment.segmentType === 'landing'
        ? []
        : ([[flightEndX, segment.height, flightSideOffset]] as [number, number, number][])),
    ],
  }
}

function toWorldRailPoint(
  layout: StairRailLayout,
  point: [number, number, number],
): [number, number, number] {
  const [localX, localY, localZ] = point
  const [offsetX, offsetZ] = rotateXZ(localZ, localX, layout.rotation)
  return [layout.center[0] + offsetX, layout.elevation + localY, layout.center[1] + offsetZ]
}

function distance3(a: [number, number, number], b: [number, number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

export default StairRenderer
