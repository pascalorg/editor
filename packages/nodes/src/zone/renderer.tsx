'use client'

import {
  polygonInteriorPoint,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import {
  createZoneShape,
  createZoneWallGeometry,
  useNodeEvents,
  useViewer,
  ZONE_LAYER,
} from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import { Color, DoubleSide, type Group } from 'three'
import { color, float, uniform, uv } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { owningUnitForZone } from './unit-membership'

const Y_OFFSET = 0.01

/**
 * Creates a gradient material for zone walls using TSL
 * Gradient goes from zone color at bottom to transparent at top
 */
const createWallGradientMaterial = (zoneColor: string) => {
  const baseColor = color(new Color(zoneColor))

  // Use UV y coordinate for vertical gradient (0 at bottom, 1 at top)
  const gradientT = uv().y

  const opacity = uniform(0)
  // Fade opacity from 0.6 at bottom to 0 at top
  const finalOpacity = float(0.6).mul(float(1).sub(gradientT)).mul(opacity)

  return new MeshBasicNodeMaterial({
    transparent: true,
    colorNode: baseColor,
    opacityNode: finalOpacity,
    side: DoubleSide,
    depthWrite: true,
    depthTest: false,
    userData: {
      uOpacity: opacity,
    },
  })
}

/**
 * Creates a floor material for zones using TSL
 */
const createFloorMaterial = (zoneColor: string) => {
  const baseColor = color(new Color(zoneColor))
  const opacity = uniform(0)
  return new MeshBasicNodeMaterial({
    transparent: true,
    colorNode: baseColor,
    opacityNode: float(0.25).mul(opacity),
    side: DoubleSide,
    depthWrite: false,
    depthTest: false,
    userData: { uOpacity: opacity },
  })
}

export const ZoneRenderer = ({ node }: { node: ZoneNode }) => {
  const ref = useRef<Group>(null!)
  useRegistry(node.id, 'zone', ref)
  const showZones = useViewer((state) => state.showZones)
  return (
    <group ref={ref} visible={node.visible !== false}>
      {showZones ? <ZoneVisuals node={node} /> : null}
    </group>
  )
}

function ZoneVisuals({ node }: { node: ZoneNode }) {
  // Group-transform drags publish a translated/rotated polygon to
  // `useLiveNodeOverrides`; merge it so the zone previews live instead of
  // snapping only on commit (slab/ceiling get this via their systems'
  // `getEffectiveNode`). Per-node subscription — unrelated overrides don't
  // re-render this zone.
  const live = useLiveNodeOverrides((s) => s.overrides.get(node.id))
  const polygon = (live?.polygon as ZoneNode['polygon'] | undefined) ?? node.polygon
  const holes = (live?.holes as ZoneNode['holes'] | undefined) ?? node.holes

  // The selector returns the unit node itself, so only edits to that unit
  // or its membership re-render this zone.
  const unit = useScene((s) => owningUnitForZone(node, (id) => s.nodes[id]))
  const tintColor = unit?.color ?? node.color

  const floorShape = useMemo(
    () => (polygon.length >= 3 ? createZoneShape({ polygon, holes }) : null),
    [polygon, holes],
  )
  const wallGeometry = useMemo(
    () => (polygon.length >= 3 ? createZoneWallGeometry({ polygon, holes }) : null),
    [polygon, holes],
  )
  const centroid = useMemo(() => polygonInteriorPoint({ polygon, holes }), [polygon, holes])

  // Create materials
  const floorMaterial = useMemo(() => {
    if (!tintColor) return null
    return createFloorMaterial(tintColor)
  }, [tintColor])

  const wallMaterial = useMemo(() => {
    if (!node.color) return null
    return createWallGradientMaterial(node.color)
  }, [node.color])

  useEffect(() => () => wallGeometry?.dispose(), [wallGeometry])
  useEffect(() => () => floorMaterial?.dispose(), [floorMaterial])
  useEffect(() => () => wallMaterial?.dispose(), [wallMaterial])
  const handlers = useNodeEvents(node, 'zone')

  if (!(node && floorShape && wallGeometry && floorMaterial && wallMaterial)) {
    return null
  }

  return (
    <group {...handlers} userData={{ labelPosition: [centroid[0], 1, centroid[1]] }}>
      <Html
        name="label"
        position={[centroid[0], 1, centroid[1]]}
        style={{ pointerEvents: 'none' }}
        zIndexRange={[10, 0]}
      >
        <div
          id={`${node.id}-label`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            transform: 'translate3d(-50%, -50%, 0)',
            opacity: 0,
            transition: 'opacity 0.3s ease-in-out',
          }}
        >
          <div
            style={{
              width: 'max-content',
              color: 'white',
              textShadow: `-1px -1px 0 ${node.color}, 1px -1px 0 ${node.color}, -1px 1px 0 ${node.color}, 1px 1px 0 ${node.color}`,
              textAlign: 'center',
            }}
          >
            <span>{node.name}</span>
          </div>
          {unit && (
            <div
              style={{
                marginTop: '2px',
                padding: '1px 6px',
                borderRadius: '999px',
                backgroundColor: tintColor,
                color: 'white',
                fontSize: '10px',
                lineHeight: '14px',
                whiteSpace: 'nowrap',
              }}
            >
              {unit.name}
            </div>
          )}
          <div
            className="label-pin"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              marginTop: '2px',
              opacity: 0,
              transition: 'opacity 0.5s ease-in-out',
            }}
          >
            <div
              style={{
                width: '2px',
                height: '40px',
                backgroundColor: node.color,
              }}
            />
            <div
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: node.color,
                border: '1px solid white',
              }}
            />
          </div>
        </div>
      </Html>

      {/* Floor fill */}
      <mesh
        layers={ZONE_LAYER}
        material={floorMaterial}
        name="floor"
        position={[0, Y_OFFSET, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <shapeGeometry args={[floorShape]} />
      </mesh>

      {/* Wall borders with gradient */}
      <mesh geometry={wallGeometry} layers={ZONE_LAYER} material={wallMaterial} name="walls" />
    </group>
  )
}

export default ZoneRenderer
