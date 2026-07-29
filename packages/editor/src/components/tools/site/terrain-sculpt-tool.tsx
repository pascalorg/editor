'use client'

import {
  advanceStroke,
  applyHeightPatch,
  beginStroke,
  detachStrokeAnchor,
  emitter,
  minBrushRadius,
  raycastTerrain,
  type SiteNode,
  type TerrainField,
  type TerrainStroke,
  useLiveTerrain,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Raycaster, Vector2 } from 'three'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { commitStroke, resolveFlattenTarget, sculptFieldForSite } from '../../../lib/terrain-sculpt'
import useEditor from '../../../store/use-editor'
import { strokePointerAction } from './stroke-pointer-ownership'
import { TerrainBrushContextMenu } from './terrain-brush-context-menu'
import { TerrainBrushCursor } from './terrain-brush-cursor'
import { TerrainSculptGrid } from './terrain-sculpt-grid'

/**
 * The sculpt tool: pointer motion → terrain, while `mode === 'terrain-sculpt'`.
 *
 * Pointer handling is DOM-level on the canvas rather than R3F mesh events, for
 * the same reason `useGridEvents` is: a mesh handler can be swallowed by any
 * geometry that calls `stopPropagation`, and the ground is precisely the surface
 * that everything else sits on top of. Sculpting must reach it even with a wall
 * under the cursor.
 *
 * Four properties are what keep this from fighting the rest of the editor:
 *
 * - It is a *mode*, so it is mutually exclusive with select/build/delete/paint
 *   by construction. Nothing else can be armed at the same time.
 * - The selection managers all early-return unless `mode === 'select'`, so while
 *   the brush is armed a click cannot select, move, or reshape a node — no
 *   matter what geometry is under it.
 * - The `sculpting` interaction scope is held by the mode, not by this
 *   component's drag, so every other object's handles and the floating action
 *   menu stay stepped back between dabs rather than flickering back.
 * - Camera drags are respected: `cameraDragging` suppresses dabs at pointer-down
 *   *and* per dab, so neither starting a drag as an orbit nor zooming mid-stroke
 *   carves the terrain. The stroke commits once, as one undo step, on pointer-up.
 */
export const TerrainSculptTool: React.FC = () => {
  const { camera, gl } = useThree()
  const [brushMenuAnchor, setBrushMenuAnchor] = useState<{
    clientX: number
    clientY: number
  } | null>(null)
  const handleBrushMenuAnchorChange = useCallback(
    (anchor: { clientX: number; clientY: number } | null) => setBrushMenuAnchor(anchor),
    [],
  )
  const nodes = useScene((state) => state.nodes)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const verb = useEditor((state) => state.terrainVerb)
  const brush = useEditor((state) => state.terrainBrush)
  const flattenTarget = useEditor((state) => state.terrainFlattenTarget)
  const sampling = useEditor((state) => state.terrainSampling)

  const siteNode = rootNodeIds[0] ? nodes[rootNodeIds[0]] : null
  const site = siteNode?.type === 'site' ? (siteNode as SiteNode) : null

  // Everything the pointer handlers need, mirrored into refs so the listener
  // effect depends only on the canvas and camera. Re-attaching listeners because
  // the brush radius changed would drop an in-flight stroke.
  const latest = useRef({ site, verb, brush, flattenTarget, sampling })
  latest.current = { site, verb, brush, flattenTarget, sampling }

  const strokeRef = useRef<{
    stroke: TerrainStroke
    field: TerrainField
    siteId: string
    /** The pointer that owns this stroke; every other one is ignored. */
    pointerId: number
  } | null>(null)
  const raycaster = useRef(new Raycaster())
  const pointer = useRef(new Vector2())

  useEffect(() => {
    const canvas = gl.domElement

    /**
     * Where the pointer meets the ground, through the terrain raycast.
     *
     * `field` is passed in rather than read from the store so a stroke keeps
     * hitting the surface it started on. Using the live (already-sculpted) field
     * would make the cursor climb the hill it is building — raise the ground and
     * the aim point walks toward the camera, which reads as the brush sliding
     * out from under the mouse.
     */
    const groundPoint = (
      event: PointerEvent | MouseEvent,
      field: TerrainField,
    ): [number, number] | null => {
      const rect = canvas.getBoundingClientRect()
      pointer.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.current.setFromCamera(pointer.current, camera)
      const { origin, direction } = raycaster.current.ray
      const hit = raycastTerrain(
        field,
        [origin.x, origin.y, origin.z],
        [direction.x, direction.y, direction.z],
      )
      return hit ? [hit.x, hit.z] : null
    }

    /** Which pointer owns the stroke in flight, for `strokePointerAction`. */
    const ownerPointerId = () => strokeRef.current?.pointerId ?? null

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      // A second pointer means the gesture was navigation, not sculpting: one
      // finger paints (`editorOwnsOneFingerDrag` gives the editor one-finger
      // priority in this mode) but two fingers always pinch-zoom, and by the time
      // the second lands the first has already deposited a dab. Abandoning is what
      // makes "pinch to look closer" free of an accidental bump — the dabs so far
      // were never committed, so dropping the live stroke restores the ground
      // exactly, the same as Escape.
      if (
        strokePointerAction({
          event: 'down',
          pointerId: event.pointerId,
          ownerPointerId: ownerPointerId(),
        }) === 'abandon'
      ) {
        abandonStroke()
        return
      }
      // Orbiting over the ground must not carve it. `cameraDragging` is the same
      // flag the grid events and node events gate on, so a middle/right-drag or a
      // modifier orbit behaves identically here.
      if (useViewer.getState().cameraDragging) return
      const {
        site: target,
        verb: activeVerb,
        brush: settings,
        flattenTarget: explicit,
      } = latest.current
      if (!target) return

      const field = sculptFieldForSite(target)
      const point = groundPoint(event, field)
      if (!point) return

      // Eyedropper: sample and consume the click. Sampling *is* the gesture, so
      // it must not also deposit a dab.
      if (latest.current.sampling) {
        useEditor.getState().setTerrainFlattenTarget(resolveFlattenTarget(field, null, ...point))
        return
      }

      // Last line of defence on the radius. The controls clamp to the same floor,
      // but the *stored default* is 2 m and the floor scales with the field's
      // spacing — so a coarse lot (`fieldExtentForSite` stretches it past 1.3 m
      // once a lot passes ~300 m) would meet a first-ever stroke that resolves to
      // no samples and paints nothing, before the user has touched any control.
      // Clamping against the field in hand rather than the node means this is
      // right even for an imported DEM at its own resolution.
      const stroke = beginStroke({
        field,
        verb: activeVerb,
        settings: { ...settings, radius: Math.max(settings.radius, minBrushRadius(field)) },
        target:
          activeVerb === 'flatten' ? resolveFlattenTarget(field, explicit, ...point) : undefined,
      })
      strokeRef.current = { stroke, field, siteId: target.id, pointerId: event.pointerId }
      useLiveTerrain.getState().begin(target.id, field)

      // Capture so a stroke that leaves the canvas still ends. Without this a
      // drag released outside the viewport would leave the live stroke armed and
      // the terrain uncommitted.
      canvas.setPointerCapture(event.pointerId)
      applyDab(event)
    }

    const applyDab = (event: PointerEvent) => {
      const active = strokeRef.current
      if (!active) return
      // Re-checked per dab, not just at pointer-down: a wheel or trackpad zoom
      // mid-stroke sets `cameraDragging` and releases it on a 500 ms timer
      // (`scheduleEnd`), all while the pointer is still down and painting. The
      // camera moves under a held brush, so every dab in that window lands
      // somewhere the user did not aim — a smear across the lot from one scroll.
      // Skipping the dab rather than ending the stroke keeps zoom-then-continue
      // working, which is how anyone sculpts a slope they need to see closer.
      //
      // Dropping the anchor is the other half, and skipping alone would be worse
      // than not skipping: dab spacing is an arc length, so `advanceStroke` would
      // bridge from the pre-zoom centre to wherever the pointer resurfaced and
      // paint the entire smear in one call.
      if (useViewer.getState().cameraDragging) {
        detachStrokeAnchor(active.stroke)
        return
      }
      const point = groundPoint(event, active.field)
      if (!point) return
      const patch = advanceStroke(active.stroke, point[0], point[1])
      if (!patch) return
      const next = applyHeightPatch(active.field, patch)
      // The stroke's *snapshot* stays the pointer-down field (that is what makes
      // it saturating); `active.field` is only the running result the mesh shows.
      active.field = next
      useLiveTerrain.getState().advance(active.siteId, next, patch)
    }

    const handlePointerMove = (event: PointerEvent) => {
      // Only the owning pointer paints. A second finger resting on the glass
      // still emits `pointermove`, and letting those through would drag the
      // stroke between two contact points on every frame.
      const action = strokePointerAction({
        event: 'move',
        pointerId: event.pointerId,
        ownerPointerId: ownerPointerId(),
      })
      if (action !== 'apply') return
      applyDab(event)
    }

    const handlePointerUp = (event: PointerEvent) => {
      const active = strokeRef.current
      // Lifting a non-owning finger must not commit the owner's stroke, which is
      // still in progress under the finger that is still down.
      if (
        !active ||
        strokePointerAction({
          event: 'up',
          pointerId: event.pointerId,
          ownerPointerId: ownerPointerId(),
        }) !== 'commit'
      ) {
        return
      }
      strokeRef.current = null
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)

      // Commit before ending the live stroke: `terrainFieldOf` prefers the live
      // field, so ending first would flash one frame of the pre-stroke ground
      // between the two writes.
      commitStroke(active.siteId as SiteNode['id'], active.field)
      useLiveTerrain.getState().end(active.siteId)
    }

    /**
     * Drop the in-flight stroke, leaving the scene untouched — nothing was
     * committed, so ending the live stroke restores the pre-stroke ground exactly.
     *
     * Shared by Escape/⌘Z and by a second pointer arriving. Releasing the capture
     * matters as much as clearing the ref: the canvas keeps routing that pointer's
     * events here until it is released, and the owning `pointerup` now early-
     * returns on a null ref, so without this the capture outlived the gesture.
     */
    const abandonStroke = () => {
      const active = strokeRef.current
      if (!active) return false
      strokeRef.current = null
      if (canvas.hasPointerCapture(active.pointerId)) {
        canvas.releasePointerCapture(active.pointerId)
      }
      useLiveTerrain.getState().end(active.siteId)
      return true
    }

    /**
     * On the `tool:cancel` bus rather than a raw `keydown`, and that detail is
     * the fix rather than a style choice: the global Escape handler also listens
     * on `window`, is registered first (it mounts at the app root, this tool
     * mounts later), and its fall-through is `setMode('select')`. A window
     * listener here would therefore run *after* the mode had already been
     * exited. `tool:cancel` is emitted synchronously *before* that check, so
     * `markToolCancelConsumed` still lands in time.
     *
     * The result is the two meanings of Escape stay separate: mid-stroke it
     * abandons the dab and keeps the brush armed; with no stroke live it falls
     * through and leaves terrain mode. Same contract every drafting tool uses
     * (`slab/tool.tsx`). It also covers ⌘Z mid-stroke, which routes through the
     * same emit — undoing a stroke in flight cancels it rather than jumping
     * history to a baseline the stroke was never part of.
     */
    const onCancel = () => {
      // Only claim the key when there was something to abandon, or Escape with no
      // stroke live would be swallowed and never exit the mode.
      if (abandonStroke()) markToolCancelConsumed()
    }

    // `pointercancel` abandons rather than commits, unlike `pointerup`: the
    // browser fires it when it takes the gesture away (an OS edge swipe, palm
    // rejection, the pointer being captured elsewhere), which means the user never
    // finished the stroke. Committing there would persist a half-drag nobody
    // released — and it was wired to `handlePointerUp` before, so it did.
    const handlePointerCancel = (event: PointerEvent) => {
      const action = strokePointerAction({
        event: 'cancel',
        pointerId: event.pointerId,
        ownerPointerId: ownerPointerId(),
      })
      if (action === 'abandon') abandonStroke()
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', handlePointerUp)
    canvas.addEventListener('pointercancel', handlePointerCancel)
    emitter.on('tool:cancel', onCancel)

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('pointercancel', handlePointerCancel)
      emitter.off('tool:cancel', onCancel)
      // Unmounting mid-stroke (mode switch, hot reload) must not leave the live
      // stroke armed — every reader prefers it over the persisted terrain, so a
      // leaked stroke is a scene that shows ground the scene graph does not have.
      abandonStroke()
    }
  }, [camera, gl])

  if (!site) return null

  return (
    <>
      <TerrainSculptGrid site={site} />
      <TerrainBrushCursor lockedPointer={brushMenuAnchor} site={site} />
      <TerrainBrushContextMenu
        canvas={gl.domElement}
        onAnchorChange={handleBrushMenuAnchorChange}
        site={site}
      />
    </>
  )
}

export default TerrainSculptTool
