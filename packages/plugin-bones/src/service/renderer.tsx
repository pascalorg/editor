'use client'

import { useLiveNodeOverrides, useLiveTransforms, useRegistry, useScene } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import { CanvasTexture, DoubleSide, type Group } from 'three'
import { resolveServicePlacement, SERVICE_BODY, servicePresentation } from './placement'
import { resolveHeatPumpProxy } from './proxy'
import type { ServiceNode } from './schema'

/**
 * Renderer for a `bones:service` point: an equipment box per type plus an
 * identifying SIGN plate (canvas-texture label, double-sided) offset off the
 * wall face. A non-default `position` (a live drag override or a manual
 * inspector/MCP write) OUTRANKS the wall anchor (wall types snap to the
 * nearest wall — during a parentFrame drag the override point rides the
 * wall axis, so the box slides along its wall live); otherwise wall-mounted
 * types resolve from `wallId + wallT + heightAff` (wall start/end lerp —
 * live, so sliding `wallT` moves the node along its wall; drags re-arm this
 * anchor on commit). No usable anchor → a bare selectable stub. The engines
 * consume the same node as a routing override, so wherever this renders,
 * the wires/pipes follow.
 */

/** Draw the sign label (+ bolt glyph for the panel) onto a canvas texture. */
function makeSignTexture(text: string, bolt: boolean): CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#1e2126'
  ctx.fillRect(0, 0, 256, 128)
  ctx.strokeStyle = '#f5c518'
  ctx.lineWidth = 6
  ctx.strokeRect(5, 5, 246, 118)
  if (bolt) {
    // Lightning bolt drawn as a path — never rely on an emoji glyph.
    ctx.fillStyle = '#f5c518'
    ctx.beginPath()
    ctx.moveTo(52, 18)
    ctx.lineTo(30, 70)
    ctx.lineTo(44, 70)
    ctx.lineTo(36, 110)
    ctx.lineTo(66, 56)
    ctx.lineTo(50, 56)
    ctx.lineTo(64, 18)
    ctx.closePath()
    ctx.fill()
  }
  ctx.fillStyle = '#f2f2f2'
  ctx.font = 'bold 44px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, bolt ? 156 : 128, 64, bolt ? 170 : 226)
  const texture = new CanvasTexture(canvas)
  texture.anisotropy = 4
  return texture
}

const SIGN_W = 0.26
const SIGN_H = 0.13
const SIGN_GAP = 0.03

export const ServiceRenderer = ({ node: rawNode }: { node: ServiceNode }) => {
  const ref = useRef<Group>(null!)
  const liveOverride = useLiveNodeOverrides((s) => s.overrides.get(rawNode.id))
  const node = useMemo<ServiceNode>(
    () => (liveOverride ? ({ ...rawNode, ...liveOverride } as ServiceNode) : rawNode),
    [rawNode, liveOverride],
  )
  const handlers = useNodeEvents(node as never, node.type as never)
  const liveTransform = useLiveTransforms((state) => state.get(node.id))
  useRegistry(node.id, node.type, ref)

  // Live wall lookup: editing the wall (or wallT) re-resolves the spot.
  const nodes = useScene((s) => s.nodes)
  const placement = useMemo(
    () => resolveServicePlacement(nodes as Record<string, Record<string, unknown>>, node),
    [nodes, node],
  )
  // View-mode presentation (advisory 2026-08-21; heat-pump A/B 2026-08-22):
  // in the level's 'off' (finished house) mode the hazard-yellow sign plates
  // hide everywhere and only PHYSICAL equipment keeps its body; in 'xray'
  // the kinds whose physical counterpart the ENGINE renders at the same
  // anchor (heat-pump condenser / WH tank / meter socket) drop the
  // placeholder body — the engine's render owns the spot, the sign plate
  // stays (placement.ts states the call); basement — and levels with no
  // X-ray node — show box + sign.
  const presentation = useMemo(
    () => servicePresentation(nodes as Record<string, Record<string, unknown>>, node),
    [nodes, node],
  )
  // X-ray heat pump: the engine renders the unit and the body yields — an
  // INVISIBLE pick proxy at the unit's own footprint keeps the equipment
  // hoverable/clickable (proxy.ts owns the doctrine + geometry; resolution
  // is the memoized computeLevel the framing renderer already ran, so a
  // suppressed-body frame costs no extra derivation).
  const proxy = useMemo(
    () =>
      presentation.pickProxy
        ? resolveHeatPumpProxy(nodes as Record<string, Record<string, unknown>>, node)
        : null,
    [presentation.pickProxy, nodes, node],
  )

  const body = SERVICE_BODY[node.serviceType]
  const texture = useMemo(
    () => makeSignTexture(body.sign, node.serviceType === 'panel'),
    [body.sign, node.serviceType],
  )
  // Dispose the texture when the sign changes AND on unmount — as an effect
  // cleanup, never in the render body (React may re-render without
  // committing, and a render-body dispose leaks the final texture on
  // unmount).
  useEffect(() => {
    return () => {
      texture?.dispose()
    }
  }, [texture])

  if (node.visible === false) return null
  // Nothing to draw at all (finished-house conceptual markers: body AND
  // sign hidden) → the whole node steps aside (switch to X-ray/Basement to
  // see or manage it — nothing here is pickable). An X-ray-suppressed body
  // with its sign still up stays IN the tree: the sign plates keep the node
  // pickable where the engine draws the physical equipment — and the
  // heat pump ADDITIONALLY mounts the invisible unit-footprint pick proxy
  // (Julien 2026-08-23: click the equipment itself, kitchen-island style).
  if (!presentation.body && !presentation.sign) return null

  // Unresolvable anchor (missing/curved/foreign wall + never-moved position):
  // render only a small selectable stub — the node stays pickable/deletable
  // via the gizmo, but no equipment is drawn and the engines auto-place.
  if (!placement) {
    const sx = Number.isFinite(node.position?.[0]) ? node.position[0] : 0
    const sz = Number.isFinite(node.position?.[2]) ? node.position[2] : 0
    return (
      <group position={[sx, 0, sz]} ref={ref} {...handlers}>
        <mesh position={[0, 0.08, 0]}>
          <boxGeometry args={[0.16, 0.16, 0.16]} />
          <meshStandardMaterial color="#9aa0a6" roughness={0.85} />
        </mesh>
      </group>
    )
  }

  // Gizmo drags override the plan position live (floor-placed nodes).
  const position: readonly [number, number, number] =
    !placement.wallMounted && liveTransform?.position
      ? [liveTransform.position[0], placement.position[1], liveTransform.position[2]]
      : placement.position

  // Sign plates sit proud of both wall faces (interior side unknown here);
  // floor types wear one flag above the body. The exterior-facing plate
  // (-Z) turns 180° around Y so its text reads correctly — a DoubleSide
  // back face renders MIRRORED.
  const signZ = placement.wallThickness / 2 + body.dims[2] / 2 + SIGN_GAP
  const signY = body.dims[1] / 2 + SIGN_H / 2
  const signPlates: { offset: [number, number, number]; rotY: number }[] =
    placement.wallMounted
      ? [
          { offset: [0, signY + 0.02, signZ], rotY: 0 },
          { offset: [0, signY + 0.02, -signZ], rotY: Math.PI },
        ]
      : [{ offset: [0, signY + 0.06, 0], rotY: 0 }]
  return (
    <group
      position={[position[0], 0, position[2]]}
      ref={ref}
      rotation={[0, placement.rotationY, 0]}
      {...handlers}
    >
      {presentation.body && (
        <mesh castShadow position={[0, position[1], 0]} receiveShadow>
          <boxGeometry args={[body.dims[0], body.dims[1], body.dims[2]]} />
          <meshStandardMaterial color={body.color} roughness={0.7} />
        </mesh>
      )}
      {proxy && (
        <mesh
          position={[0, proxy.centerY, 0]}
          rotation={[0, proxy.rotationY - placement.rotationY, 0]}
        >
          <boxGeometry args={[proxy.dims[0], proxy.dims[1], proxy.dims[2]]} />
          {/* Rendered-but-writes-NOTHING (browser QA 2026-08-23: the old
              opacity-0.03 recipe read as a faint 'glass case' against dark
              X-ray drywall — killed at the property level, both proxies):
              `visible` stays true so the mesh keeps its render-list
              membership — the raycast reliability the original ghost was
              built for AND the outline mask pass, which only reaches
              render-list members before swapping in its OWN material
              (projectObject culls on object/material `visible` alone,
              never colorWrite — three Renderer.js). colorWrite:false
              writes zero pixels; depthWrite:false stays LOAD-BEARING
              (colorWrite kills color, not depth — a phantom depth box
              would punch AO/ink-edge artifacts around the unit).
              transparent/opacity dropped: dead knobs with no color
              writes, and the proxy leaves the back-to-front sort.
              DELIBERATE exception to the X-ray raycast-no-op convention
              (A6/F2): this is a SERVICE mesh under the node's registered
              group — picking it IS picking the node, exactly like the
              sign plates and the visible bodies; the engine-drawn asset
              meshes stay raycast-disabled (Mesh.raycast consults only
              material presence + side, never write masks). Rotation: the
              engine yaw is world-frame, the group already carries the
              node's own rotation — apply the delta. */}
          <meshBasicMaterial colorWrite={false} depthWrite={false} />
        </mesh>
      )}
      {presentation.sign &&
        texture &&
        signPlates.map(({ offset: [sx, sy, sz], rotY }, i) => (
          <mesh key={String(i)} position={[sx, position[1] + sy, sz]} rotation={[0, rotY, 0]}>
            <planeGeometry args={[SIGN_W, SIGN_H]} />
            <meshBasicMaterial map={texture} side={DoubleSide} toneMapped={false} />
          </mesh>
        ))}
    </group>
  )
}

export default ServiceRenderer
