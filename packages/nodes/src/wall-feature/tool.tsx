'use client'
import {
  type AnyNodeId,
  emitter,
  getWallFaceOffsets,
  isCurvedWall,
  resolveWallFeaturePlacement,
  sceneRegistry,
  useScene,
  type WallFeatureNode,
} from '@pascal-app/core'
import {
  clearPlacementSurface,
  consumePlacementDragRelease,
  isGridSnapActive,
  isMagneticSnapActive,
  markToolCancelConsumed,
  publishPlacementSurface,
  swallowNextClick,
  triggerSFX,
  useEditor,
  useInteractionScope,
  useOpeningGuides,
  usePlacementPreview,
  useRegistryToolContext,
} from '@pascal-app/editor'
import { Html } from '@react-three/drei'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BoxGeometry,
  EdgesGeometry,
  type Group,
  type LineBasicMaterial,
  type Mesh,
  type MeshBasicMaterial,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import { createWallFeaturePlacementSession, type WallFeatureHit } from './placement'
import { getWallFeaturePlacement, getWallFeatureWallContext } from './runtime'

export function WallFeatureGesture({
  node,
  moving = false,
}: {
  node: WallFeatureNode
  moving?: boolean
}) {
  const { activeLevelId, sceneApi, selectNode, isCameraDragging } = useRegistryToolContext()
  const { camera, gl, scene } = useThree()
  const ghost = useRef<Group>(null!),
    box = useRef<Mesh>(null!),
    frame = useRef<Group>(null!)
  const material = useRef<MeshBasicMaterial>(null!)
  const edges = useRef<LineBasicMaterial>(null!)
  const [error, setError] = useState<string | null>(null)
  const edgeGeometry = useMemo(() => {
    const geometry = new BoxGeometry(1, 1, 1)
    const edges = new EdgesGeometry(geometry)
    geometry.dispose()
    return edges
  }, [])
  useEffect(() => () => edgeGeometry.dispose(), [edgeGeometry])
  const inputView = useInteractionScope((state) =>
    (state.scope.kind === 'placing' || state.scope.kind === 'moving') &&
    state.scope.nodeId === node.id
      ? state.scope.view
      : null,
  )
  useFrame(() => {
    if (inputView !== '2d') return
    const preview = usePlacementPreview.getState().node
    if (preview?.type !== 'wall-feature' || preview.id !== node.id) {
      ghost.current.visible = false
      return
    }
    try {
      const effective = { ...useScene.getState().nodes, [preview.id]: preview }
      let p = resolveWallFeaturePlacement(effective, preview)
      p = resolveWallFeaturePlacement(effective, preview, getWallFeatureWallContext(p.wall.id))
      const root = sceneRegistry.nodes.get(p.wall.id)
      if (!root) return
      root.updateWorldMatrix(true, false)
      ghost.current.matrix.copy(root.matrixWorld)
      ghost.current.matrixWorldNeedsUpdate = true
      ghost.current.visible = true
      box.current.position.set(
        p.u,
        p.bottom - root.position.y + preview.height / 2,
        (p.mountOffset + p.surfaceOffset) / 2,
      )
      box.current.scale.set(preview.width, preview.height, preview.depth)
      material.current.color.set('#8b5cf6')
      edges.current.color.copy(material.current.color)
    } catch {
      ghost.current.visible = false
    }
  })
  const acceptsInput = moving || inputView !== '2d'
  useEffect(() => {
    if (!acceptsInput) return
    const scope = useInteractionScope.getState().scope
    if (scope.kind === 'idle')
      useInteractionScope.getState().begin(
        moving
          ? { kind: 'moving', node, nodeId: node.id, nodeType: node.type, view: '3d' }
          : {
              kind: 'placing',
              node,
              nodeId: node.id,
              nodeType: node.type,
              view: '3d',
              pressDrag: false,
              driver: 'registry-tool',
            },
      )
    const session = createWallFeaturePlacementSession(node, sceneApi, moving)
    const raycaster = new Raycaster(),
      pointer = new Vector2()
    let scheduled: number | null = null
    let finished = false,
      last: PointerEvent | null = null,
      down: PointerEvent | null = null
    const owns = () => {
      const scope = useInteractionScope.getState().scope
      return (scope.kind === 'placing' || scope.kind === 'moving') && scope.nodeId === node.id
    }
    const hide = () => {
      if (scheduled !== null) {
        cancelAnimationFrame(scheduled)
        scheduled = null
      }
      ghost.current.visible = false
      setError(null)
      session.update(null)
      useOpeningGuides.getState().clear()
      usePlacementPreview.getState().clear()
      clearPlacementSurface()
    }
    const finish = () => {
      if (finished || !owns() || useScene.getState().readOnly) return
      try {
        const id = session.commit()
        if (!id) return
        finished = true
        usePlacementPreview.getState().clear()
        swallowNextClick()
        selectNode(id)
        triggerSFX('sfx:item-place')
        if (moving) useEditor.getState().setMovingNode(null)
        else {
          useInteractionScope.getState().endIf((s) => s.kind === 'placing' && s.nodeId === node.id)
          useEditor.getState().setTool(null)
        }
      } catch {
        cancel()
      }
    }
    const cancel = () => {
      if (finished) return
      finished = true
      if (scheduled !== null) cancelAnimationFrame(scheduled)
      session.cancel()
      markToolCancelConsumed()
      if (owns()) {
        if (moving) useEditor.getState().setMovingNode(null)
        else {
          useInteractionScope.getState().endIf((s) => s.kind === 'placing' && s.nodeId === node.id)
          useEditor.getState().setTool(null)
        }
      }
    }
    const update = (event: PointerEvent) => {
      if (finished || !owns() || isCameraDragging()) return
      if (moving) useInteractionScope.getState().update({ view: '3d' })
      last = event
      const rect = gl.domElement.getBoundingClientRect()
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(pointer, camera)
      const hits = [] as ReturnType<Raycaster['intersectObject']>
      for (const candidate of Object.values(sceneApi.nodes())) {
        if (
          candidate.type !== 'wall' ||
          candidate.parentId !== activeLevelId ||
          candidate.visible === false ||
          candidate.wallType === 'curtain' ||
          isCurvedWall(candidate)
        )
          continue
        if (!moving && node.parentId?.startsWith('wall_') && candidate.id !== node.parentId)
          continue
        const mesh = sceneRegistry.nodes.get(candidate.id) as Mesh | undefined
        if (mesh?.isMesh) {
          mesh.updateWorldMatrix(true, false)
          raycaster.intersectObject(mesh, false, hits)
        }
      }
      hits.sort((a, b) => a.distance - b.distance)
      const picked = hits[0]
      if (!picked?.face) {
        hide()
        return
      }
      const wall = Object.values(sceneApi.nodes()).find(
        (n) => n.type === 'wall' && sceneRegistry.nodes.get(n.id) === picked.object,
      )
      if (wall?.type !== 'wall' || Math.abs(picked.face.normal.z) < 0.7) {
        hide()
        return
      }
      const root = picked.object as Mesh
      const point = root.worldToLocal(picked.point.clone())
      const face = picked.face.normal.z >= 0 ? 'a' : 'b'
      let bumpId: string | undefined
      const requested =
        !moving && node.parentId?.startsWith('wall-feature_')
          ? sceneApi.get(node.parentId as AnyNodeId)
          : undefined
      if (requested?.type === 'wall-feature') {
        const host = getWallFeaturePlacement(requested.id)
        if (host?.wall.id !== wall.id || host.face !== face) {
          hide()
          return
        }
        bumpId = requested.id
      }
      if (moving && node.mode === 'niche') {
        for (const candidate of Object.values(sceneApi.nodes())) {
          if (
            candidate.type !== 'wall-feature' ||
            candidate.mode !== 'bump' ||
            candidate.parentId !== wall.id
          )
            continue
          const host = getWallFeaturePlacement(candidate.id)
          if (
            host?.face === face &&
            point.x >= host.bounds.u0 &&
            point.x <= host.bounds.u1 &&
            point.y + root.position.y >= host.bottom &&
            point.y + root.position.y <= host.bottom + host.node.height &&
            point.z >= host.bounds.n0 - 0.003 &&
            point.z <= host.bounds.n1 + 0.003
          ) {
            bumpId = candidate.id
            break
          }
        }
      }
      const hit: WallFeatureHit = {
        wallId: wall.id,
        face,
        u: point.x,
        elevation: point.y + root.position.y,
        bumpId,
        context: getWallFeatureWallContext(wall.id),
      }
      const proposal = session.update(hit, {
        gridStep: isGridSnapActive() ? useEditor.getState().gridSnapStep : undefined,
        magnetic: isMagneticSnapActive(),
        force: event.altKey,
      })
      if (!proposal) {
        hide()
        return
      }
      const placement = proposal.placement
      const mount =
        placement?.mountOffset ??
        (bumpId
          ? getWallFeaturePlacement(bumpId)?.surfaceOffset
          : getWallFaceOffsets(wall)[face]) ??
        0
      const surface =
        placement?.surfaceOffset ??
        mount + (face === 'a' ? 1 : -1) * (node.mode === 'bump' ? node.depth : -node.depth)
      ghost.current.matrix.copy(root.matrixWorld)
      ghost.current.matrixWorldNeedsUpdate = true
      ghost.current.visible = true
      box.current.position.set(
        placement?.u ?? point.x,
        placement ? placement.bottom - root.position.y + node.height / 2 : point.y,
        (mount + surface) / 2,
      )
      box.current.scale.set(node.width, node.height, node.depth)
      material.current.color.set(placement ? '#8b5cf6' : '#ef4444')
      edges.current.color.copy(material.current.color)
      setError(proposal.error)
      usePlacementPreview.getState().set(proposal.node, wall)
      const world = root.localToWorld(
        new Vector3(placement?.u ?? point.x, box.current.position.y, mount),
      )
      const normal = new Vector3(0, 0, face === 'a' ? 1 : -1).transformDirection(root.matrixWorld)
      publishPlacementSurface(world, normal, 'fixed-plane')
      if (placement) {
        frame.current.updateWorldMatrix(true, false)
        const toGuide = (x: number, y: number) =>
          frame.current.worldToLocal(root.localToWorld(new Vector3(x, y, mount))).toArray() as [
            number,
            number,
            number,
          ]
        const y = placement.bottom - root.position.y
        useOpeningGuides.getState().set([
          {
            kind: 'dimension',
            id: 'feature:width',
            from: toGuide(placement.bounds.u0, y),
            to: toGuide(placement.bounds.u1, y),
            value: node.width,
          },
          {
            kind: 'dimension',
            id: 'feature:height',
            from: toGuide(placement.bounds.u1, y),
            to: toGuide(placement.bounds.u1, y + node.height),
            value: node.height,
          },
        ])
      } else useOpeningGuides.getState().clear()
    }
    const queueMove = (event: PointerEvent) => {
      last = event
      if (scheduled !== null) return
      scheduled = requestAnimationFrame(() => {
        scheduled = null
        if (last) update(last)
      })
    }
    const press = (event: PointerEvent) => {
      if (event.button === 0) down = event
    }
    const release = (event: PointerEvent) => {
      if (event.button !== 0 || finished || isCameraDragging()) return
      const pressDrag = consumePlacementDragRelease(event)
      if (
        !pressDrag &&
        (!down || Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY) > 4)
      )
        return
      down = null
      update(event)
      if (session.getProposal()?.placement) {
        event.stopImmediatePropagation()
        event.stopPropagation()
        finish()
      }
    }
    const refresh = (event: KeyboardEvent) => {
      if (last && (event.key === 'Alt' || event.key === 'Shift'))
        update({
          ...last,
          clientX: last.clientX,
          clientY: last.clientY,
          altKey: event.altKey,
        } as PointerEvent)
    }
    const stopScene = useScene.subscribe((state) => {
      if (
        state.readOnly ||
        !state.nodes[node.parentId as AnyNodeId] ||
        (moving && !state.nodes[node.id])
      )
        cancel()
    })
    gl.domElement.addEventListener('pointermove', queueMove)
    gl.domElement.addEventListener('pointerdown', press)
    gl.domElement.addEventListener('pointerup', release, true)
    gl.domElement.addEventListener('pointerleave', hide)
    window.addEventListener('keydown', refresh)
    window.addEventListener('keyup', refresh)
    emitter.on('tool:cancel', cancel)
    return () => {
      finished = true
      if (scheduled !== null) cancelAnimationFrame(scheduled)
      if (!moving || useInteractionScope.getState().scope.kind === 'idle' || session.ownsPreview())
        session.cancel()
      stopScene()
      clearPlacementSurface()
      useOpeningGuides.getState().clear()
      if (session.ownsPreview() || !moving || useInteractionScope.getState().scope.kind === 'idle')
        usePlacementPreview.getState().clear()
      gl.domElement.removeEventListener('pointermove', queueMove)
      gl.domElement.removeEventListener('pointerdown', press)
      gl.domElement.removeEventListener('pointerup', release, true)
      gl.domElement.removeEventListener('pointerleave', hide)
      window.removeEventListener('keydown', refresh)
      window.removeEventListener('keyup', refresh)
      emitter.off('tool:cancel', cancel)
      useInteractionScope
        .getState()
        .endIf(
          (s) =>
            (s.kind === 'placing' || s.kind === 'moving') &&
            s.nodeId === node.id &&
            s.view === '3d',
        )
    }
  }, [
    activeLevelId,
    camera,
    gl,
    node,
    moving,
    sceneApi,
    selectNode,
    isCameraDragging,
    acceptsInput,
  ])
  return (
    <>
      <group ref={frame} />
      {createPortal(
        <group
          ref={ghost}
          matrixAutoUpdate={false}
          visible={false}
          userData={{ pascalExport: 'strip' }}
        >
          <mesh ref={box} raycast={() => {}}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial ref={material} transparent opacity={0.2} depthWrite={false} />
            {error && (
              <Html center position={[0, 0.6, 0]} style={{ pointerEvents: 'none' }}>
                <p
                  role="status"
                  className="w-64 rounded bg-background p-2 text-xs text-destructive"
                >
                  {error}
                </p>
              </Html>
            )}
            <lineSegments geometry={edgeGeometry} raycast={() => {}}>
              <lineBasicMaterial ref={edges} color="#a78bfa" depthTest={false} depthWrite={false} />
            </lineSegments>
          </mesh>
        </group>,
        scene,
      )}
    </>
  )
}
export default function WallFeatureTool() {
  const node = useInteractionScope((state) =>
    state.scope.kind === 'placing' && state.scope.node.type === 'wall-feature'
      ? state.scope.node
      : null,
  )
  return node ? <WallFeatureGesture key={node.id} node={node} /> : null
}
