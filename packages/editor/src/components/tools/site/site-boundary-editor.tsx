import { emitter, type SiteNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { SCENE_LAYER } from '@pascal-app/viewer'
import { useGLTF } from '@react-three/drei/core/Gltf'
import { useFrame } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Color,
  CylinderGeometry,
  DoubleSide,
  type Group,
  type Mesh,
  type Object3D,
  RingGeometry,
} from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../../lib/constants'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { SITE_BOUNDARY_DRAG_LABEL } from '../../../lib/site-boundary'
import useEditor, { selectSiteFloorplanContext } from '../../../store/use-editor'
import useInteractionScope from '../../../store/use-interaction-scope'
import {
  ARROW_COLOR,
  ARROW_HOVER_COLOR,
  NO_RAYCAST,
  useInvisibleHitAreaMaterial,
} from '../../editor/node-arrow-handles'
import {
  PolygonEditor,
  type PolygonHandleHandlers,
  type PolygonMidpointHandleRenderProps,
  type PolygonVertexHandleRenderProps,
} from '../shared/polygon-editor'
import { SITE_FLAG_MODEL_URL } from './site-flag-model'

const SITE_FLAG_BASE_Y = 0
const SITE_FLAG_HIT_HEIGHT = 0.5
const SITE_FLAG_HIT_RADIUS = 0.24
const SITE_FLAG_HIT_Y = SITE_FLAG_BASE_Y + SITE_FLAG_HIT_HEIGHT / 2
const SITE_FLAG_MODEL_MIN_Y = -0.034798760316334665
const SITE_FLAG_SCALE = 0.5
const SITE_FLAG_ACTIVE_LIFT = 0.08
const SITE_FLAG_MODEL_Y = SITE_FLAG_BASE_Y - SITE_FLAG_MODEL_MIN_Y * SITE_FLAG_SCALE
const SITE_FLAG_HALO_INNER_RADIUS = 0.08
const SITE_FLAG_HALO_OUTER_RADIUS = SITE_FLAG_HIT_RADIUS * 0.95
const SITE_FLAG_HALO_Y = SITE_FLAG_BASE_Y + 0.002
const SITE_FLAG_HALO_COLOR = '#6366f1'

type TintableMaterial = {
  color?: Color
  depthTest: boolean
  depthWrite: boolean
  opacity: number
  needsUpdate: boolean
  transparent: boolean
}

function SiteFlagModel({
  active,
  hovered,
  opacity = 1,
  scale = SITE_FLAG_SCALE,
}: {
  active: boolean
  hovered: boolean
  opacity?: number
  scale?: number
}) {
  const { scene } = useGLTF(SITE_FLAG_MODEL_URL, true)
  const modelRef = useRef<Object3D>(null)
  const flagScene = useMemo(() => {
    const cloned = scene.clone(true)

    cloned.traverse((object) => {
      object.layers.set(SCENE_LAYER)

      if ((object as Mesh).isMesh) {
        const mesh = object as Mesh
        mesh.castShadow = false
        mesh.frustumCulled = false
        mesh.raycast = NO_RAYCAST
        mesh.receiveShadow = false
        mesh.material = new MeshBasicNodeMaterial({
          color: new Color(ARROW_COLOR),
          depthTest: true,
          depthWrite: opacity >= 0.999,
          opacity,
          transparent: opacity < 0.999,
        })
      }
    })

    return cloned
  }, [opacity, scene])

  useEffect(() => {
    const color = new Color(active || hovered ? ARROW_HOVER_COLOR : ARROW_COLOR)

    flagScene.traverse((object) => {
      if ((object as Mesh).isMesh) {
        const mesh = object as Mesh
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]

        for (const material of materials as Array<MeshBasicNodeMaterial & TintableMaterial>) {
          material.color?.copy(color)
          material.depthTest = true
          material.opacity = opacity
          material.transparent = opacity < 0.999
          material.depthWrite = opacity >= 0.999
          material.needsUpdate = true
        }
      }
    })
  }, [active, flagScene, hovered, opacity])

  useFrame((_, delta) => {
    const model = modelRef.current
    if (!model) return

    const smoothing = 1 - Math.exp(-delta * 18)
    const targetY = SITE_FLAG_MODEL_Y + (active ? SITE_FLAG_ACTIVE_LIFT : 0)
    model.position.y += (targetY - model.position.y) * smoothing
  })

  useEffect(
    () => () => {
      flagScene.traverse((object) => {
        if ((object as Mesh).isMesh) {
          const materials = (object as Mesh).material
          if (Array.isArray(materials)) {
            materials.forEach((material) => {
              material.dispose()
            })
          } else {
            materials.dispose()
          }
        }
      })
    },
    [flagScene],
  )

  return (
    <primitive
      object={flagScene}
      position={[0, SITE_FLAG_MODEL_Y, 0]}
      ref={modelRef}
      scale={scale}
    />
  )
}

function SiteFlagHoverHalo({ visible }: { visible: boolean }) {
  const haloRef = useRef<Mesh>(null)
  const geometry = useMemo(() => {
    const nextGeometry = new RingGeometry(
      SITE_FLAG_HALO_INNER_RADIUS,
      SITE_FLAG_HALO_OUTER_RADIUS,
      56,
    )
    nextGeometry.rotateX(-Math.PI / 2)
    return nextGeometry
  }, [])
  const material = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: new Color(SITE_FLAG_HALO_COLOR),
        depthTest: true,
        depthWrite: false,
        opacity: 0,
        side: DoubleSide,
        transparent: true,
      }),
    [],
  )

  useFrame((_, delta) => {
    const mesh = haloRef.current
    if (!mesh) return

    const smoothing = 1 - Math.exp(-delta * 18)
    const targetOpacity = visible ? 0.52 : 0
    const targetScale = visible ? 1 : 0.08
    const nextOpacity = material.opacity + (targetOpacity - material.opacity) * smoothing
    const nextScale = mesh.scale.x + (targetScale - mesh.scale.x) * smoothing

    material.opacity = nextOpacity
    mesh.scale.setScalar(nextScale)
    mesh.visible = visible || nextOpacity > 0.01
  })

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  return (
    <mesh
      frustumCulled={false}
      geometry={geometry}
      layers={SCENE_LAYER}
      material={material}
      position={[0, SITE_FLAG_HALO_Y, 0]}
      raycast={NO_RAYCAST}
      ref={haloRef}
      renderOrder={1009}
      scale={0.08}
      visible={false}
    />
  )
}

function SiteFlagFallback({
  active,
  hovered,
  opacity = 1,
}: {
  active: boolean
  hovered: boolean
  opacity?: number
}) {
  const color = active || hovered ? ARROW_HOVER_COLOR : ARROW_COLOR

  return (
    <group position={[0, SITE_FLAG_BASE_Y + (active ? SITE_FLAG_ACTIVE_LIFT : 0), 0]}>
      <mesh layers={SCENE_LAYER} position={[0, 0.16, 0]} raycast={NO_RAYCAST}>
        <cylinderGeometry args={[0.11, 0.16, 0.32, 24]} />
        <meshBasicMaterial
          color={color}
          depthTest
          depthWrite={opacity >= 0.999}
          opacity={opacity}
          transparent={opacity < 0.999}
        />
      </mesh>
      <mesh layers={SCENE_LAYER} position={[0, 0.34, 0]} raycast={NO_RAYCAST}>
        <cylinderGeometry args={[0.04, 0.11, 0.14, 24]} />
        <meshBasicMaterial
          color={color}
          depthTest
          depthWrite={opacity >= 0.999}
          opacity={opacity}
          transparent={opacity < 0.999}
        />
      </mesh>
    </group>
  )
}

function SiteBoundaryFlagHandle({
  active = false,
  baseY,
  handleProps,
  hovered,
  modelOpacity = 1,
  modelScale = SITE_FLAG_SCALE,
  modelVisible = true,
  point,
}: {
  active?: boolean
  baseY: number
  handleProps: PolygonHandleHandlers
  hovered: boolean
  modelOpacity?: number
  modelScale?: number
  modelVisible?: boolean
  point: [number, number]
}) {
  const hitGeometry = useMemo(
    () =>
      new CylinderGeometry(SITE_FLAG_HIT_RADIUS, SITE_FLAG_HIT_RADIUS, SITE_FLAG_HIT_HEIGHT, 24),
    [],
  )
  const hitMaterial = useInvisibleHitAreaMaterial()

  useEffect(() => () => hitGeometry.dispose(), [hitGeometry])

  return (
    <group position={[point[0], baseY, point[1]]}>
      <SiteFlagHoverHalo visible={active || hovered} />
      {(modelVisible || active || hovered) && (
        <Suspense
          fallback={<SiteFlagFallback active={active} hovered={hovered} opacity={modelOpacity} />}
        >
          <SiteFlagModel
            active={active}
            hovered={hovered}
            opacity={modelOpacity}
            scale={modelScale}
          />
        </Suspense>
      )}
      <mesh
        frustumCulled={false}
        geometry={hitGeometry}
        layers={EDITOR_LAYER}
        material={hitMaterial}
        position={[0, SITE_FLAG_HIT_Y, 0]}
        renderOrder={1012}
        {...handleProps}
      />
    </group>
  )
}

export const SiteBoundaryEditor: React.FC = () => {
  const nodes = useScene((state) => state.nodes)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const updateNode = useScene((state) => state.updateNode)
  const phase = useEditor((state) => state.phase)
  const mode = useEditor((state) => state.mode)
  const [hoveredVertex, setHoveredVertex] = useState<number | null>(null)
  const [hoveredMidpoint, setHoveredMidpoint] = useState<number | null>(null)

  const siteNode = rootNodeIds[0] ? nodes[rootNodeIds[0]] : null
  const site = siteNode?.type === 'site' ? (siteNode as SiteNode) : null
  const siteId = site?.id
  const isSiteEditing = phase === 'site'
  const showSiteHandles = isSiteEditing || mode === 'select'
  const isSiteBoundaryHighlighted =
    isSiteEditing || hoveredVertex !== null || hoveredMidpoint !== null
  const [isDraggingSiteBoundary, setIsDraggingSiteBoundary] = useState(false)
  const isDraggingSiteBoundaryRef = useRef(false)
  const livePolygon = useLiveNodeOverrides(
    useCallback(
      (state) => {
        if (!siteId) return null
        return (state.overrides.get(siteId)?.polygon as SiteNode['polygon'] | undefined) ?? null
      },
      [siteId],
    ),
  )
  const displayPolygon =
    !(isDraggingSiteBoundary || isDraggingSiteBoundaryRef.current) && livePolygon?.points
      ? livePolygon.points
      : site?.polygon?.points

  const handlePolygonChange = useCallback(
    (newPolygon: Array<[number, number]>) => {
      if (site) {
        updateNode(site.id, {
          polygon: {
            type: 'polygon',
            points: newPolygon,
          },
        })
      }
    },
    [site, updateNode],
  )

  const handlePolygonPreview = useCallback(
    (previewPolygon: ReadonlyArray<readonly [number, number]> | null) => {
      if (!siteId) return

      if (!previewPolygon) {
        useLiveNodeOverrides.getState().clearFields(siteId, ['polygon'])
        return
      }

      useLiveNodeOverrides.getState().set(siteId, {
        polygon: {
          type: 'polygon',
          points: previewPolygon.map(([x, z]) => [x, z] as [number, number]),
        },
      })
    },
    [siteId],
  )

  const handleSiteBoundaryDragChange = useCallback(
    (isDragging: boolean) => {
      isDraggingSiteBoundaryRef.current = isDragging
      setIsDraggingSiteBoundary(isDragging)

      if (!siteId) return

      if (isDragging) {
        useInteractionScope
          .getState()
          .begin({ kind: 'handle-drag', nodeId: siteId, handle: SITE_BOUNDARY_DRAG_LABEL })
      } else {
        const scope = useInteractionScope.getState().scope
        const activeHandleDrag =
          scope.kind === 'handle-drag' ? { nodeId: scope.nodeId, label: scope.handle } : null
        if (
          activeHandleDrag?.nodeId === siteId &&
          activeHandleDrag.label === SITE_BOUNDARY_DRAG_LABEL
        ) {
          useInteractionScope.getState().endIf((sc) => sc.kind === 'handle-drag')
        }
      }

      if (!isDragging) {
        useLiveNodeOverrides.getState().clearFields(siteId, ['polygon'])
      }
    },
    [siteId],
  )

  useEffect(
    () => () => {
      if (!siteId) return
      const scope = useInteractionScope.getState().scope
      const activeHandleDrag =
        scope.kind === 'handle-drag' ? { nodeId: scope.nodeId, label: scope.handle } : null
      if (
        activeHandleDrag?.nodeId === siteId &&
        activeHandleDrag.label === SITE_BOUNDARY_DRAG_LABEL
      ) {
        useInteractionScope.getState().endIf((sc) => sc.kind === 'handle-drag')
      }
      useLiveNodeOverrides.getState().clearFields(siteId, ['polygon'])
      isDraggingSiteBoundaryRef.current = false
    },
    [siteId],
  )

  useEffect(() => {
    if (isSiteEditing && siteId) {
      selectSiteFloorplanContext()
    }
  }, [isSiteEditing, siteId])

  // The flag models render on SCENE_LAYER (scene-depth occlusion), so unlike
  // EDITOR_LAYER affordances the thumbnail camera can't filter them — hide
  // them around captures (preset/snapshot/auto-save thumbnails), same as
  // `handle-arrow.tsx`.
  const handlesRootRef = useRef<Group>(null)
  useEffect(() => {
    const hideForCapture = () => {
      if (handlesRootRef.current) handlesRootRef.current.visible = false
    }
    const restoreAfterCapture = () => {
      if (handlesRootRef.current) handlesRootRef.current.visible = true
    }
    emitter.on('thumbnail:before-capture', hideForCapture)
    emitter.on('thumbnail:after-capture', restoreAfterCapture)
    return () => {
      emitter.off('thumbnail:before-capture', hideForCapture)
      emitter.off('thumbnail:after-capture', restoreAfterCapture)
    }
  }, [])

  const activateSiteEditing = useCallback(() => {
    isDraggingSiteBoundaryRef.current = true
    setIsDraggingSiteBoundary(true)
    if (useEditor.getState().phase !== 'site') {
      useEditor.setState({ catalogCategory: null, mode: 'select', phase: 'site', tool: null })
    }
    selectSiteFloorplanContext()
  }, [])

  const exitSiteEditing = useCallback(() => {
    const editor = useEditor.getState()
    editor.setPhase('structure')
    editor.setStructureLayer('elements')
    editor.setMode('select')
  }, [])

  useEffect(() => {
    if (!isSiteEditing) return

    const onGridClick = () => {
      if (useEditor.getState().phase !== 'site') return
      exitSiteEditing()
    }

    emitter.on('grid:click', onGridClick)
    return () => {
      emitter.off('grid:click', onGridClick)
    }
  }, [exitSiteEditing, isSiteEditing])

  const renderSiteFlagVertex = useCallback(
    ({
      handleProps,
      height,
      isDragging,
      isHovered,
      point,
      position,
    }: PolygonVertexHandleRenderProps) => {
      const baseY = position[1] - height / 2

      return (
        <SiteBoundaryFlagHandle
          active={isDragging}
          baseY={baseY}
          handleProps={handleProps}
          hovered={isHovered}
          point={point}
        />
      )
    },
    [],
  )
  const renderSiteFlagMidpoint = useCallback(
    ({ handleProps, height, isHovered, point, position }: PolygonMidpointHandleRenderProps) => {
      const baseY = position[1] - height / 2

      return (
        <SiteBoundaryFlagHandle
          baseY={baseY}
          handleProps={handleProps}
          hovered={isHovered}
          modelOpacity={0.48}
          modelScale={SITE_FLAG_SCALE * 0.92}
          modelVisible={isHovered}
          point={point}
        />
      )
    },
    [],
  )

  if (!displayPolygon || displayPolygon.length < 3) return null
  if (!showSiteHandles) return null

  return (
    <group ref={handlesRootRef}>
      <PolygonEditor
        color={isSiteBoundaryHighlighted ? ARROW_COLOR : '#10b981'}
        minVertices={3}
        onBeforeVertexDrag={activateSiteEditing}
        onDragCommit={() => {
          sfxEmitter.emit('sfx:item-place')
          exitSiteEditing()
        }}
        onDragStart={() => sfxEmitter.emit('sfx:item-pick')}
        onDragStateChange={handleSiteBoundaryDragChange}
        onMidpointHoverChange={setHoveredMidpoint}
        onPolygonChange={handlePolygonChange}
        onPolygonPreview={handlePolygonPreview}
        onVertexHoverChange={setHoveredVertex}
        polygon={displayPolygon}
        renderMidpointHandle={renderSiteFlagMidpoint}
        renderVertexHandle={renderSiteFlagVertex}
        showBorderLine={isSiteBoundaryHighlighted}
        showMidpointHandles={showSiteHandles}
      />
    </group>
  )
}
