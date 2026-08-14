'use client'

import { sortCommentThreads, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import { resolveCommentPinPosition } from '../../lib/comments'
import {
  floorplanLocalToWorldPoint,
  worldToFloorplanLocalPoint,
} from '../../lib/floorplan/geometry'
import useCommentUi from '../../store/use-comment-ui'
import useEditor from '../../store/use-editor'
import { CommentBubble, CommentPinButton } from '../editor/comment-pin'
import { useFloorplanRender } from './floorplan-render-context'

/**
 * Comment pins in the 2D floorplan, and the click that drops a new one while
 * `mode === 'comment'`.
 *
 * The 3D sibling is `comment-layer-3d.tsx`. Neither view derives its pins from
 * the other: the floorplan has no scene registry to resolve through, and a
 * session that opens in 2D never mounts the R3F tree at all. What they share is
 * the anchor's recorded world position and `resolveCommentPinPosition`, so the
 * same thread lands on the same spot in both.
 *
 * A pin dropped here records no camera — there is no pose to return to — which
 * is why `createCommentFromDraft` keys the capture off the draft's origin.
 */
export function FloorplanCommentLayer({
  buildingPosition,
  buildingRotationY,
}: {
  // Passed down rather than derived from `useViewer.selection.buildingId`:
  // that is null whenever only a level is selected, which is the ordinary
  // case, and a rotated building's pins then land off by the rotation.
  // The panel already resolves the authoritative transform.
  buildingPosition: readonly [number, number, number]
  buildingRotationY: number
}) {
  const groupRef = useRef<SVGGElement>(null)
  const mode = useEditor((state) => state.mode)
  const comments = useScene((state) => state.comments)
  const nodes = useScene((state) => state.nodes)
  const showResolved = useCommentUi((state) => state.showResolved)
  const activeId = useCommentUi((state) => state.activeId)
  const draft = useCommentUi((state) => state.draft)
  const levelId = useViewer((state) => state.selection.levelId)
  const renderContext = useFloorplanRender()

  const isCommenting = mode === 'comment'

  // Same as the 3D layer: leaving comment mode discards an unsubmitted pin.
  // Both views carry this because a session may mount only one of them.
  useEffect(() => {
    if (isCommenting) return
    if (useCommentUi.getState().draft) useCommentUi.getState().setDraft(null)
  }, [isCommenting])

  useEffect(() => {
    if (!isCommenting) return
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!(group && svg)) return

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      // The pins and the open composer live inside this SVG too. Without this
      // the capture below would eat a press on the composer's own textarea and
      // drop a second pin under it.
      if (event.target instanceof Node && group.contains(event.target)) return
      const matrix = group.getScreenCTM()
      if (!matrix) return
      const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
      const world = floorplanLocalToWorldPoint(
        { x: local.x, y: local.y },
        buildingPosition,
        buildingRotationY,
      )

      event.preventDefault()
      event.stopImmediatePropagation()
      useCommentUi.getState().setDraft({
        // The plan is a top-down slice with no depth under the cursor, so the
        // pin sits on the active storey's floor. A 2D pin never claims a Y it
        // could not have measured.
        position: [world.x, 0, world.z],
        ...(levelId && { levelId }),
        origin: '2d',
      })
    }

    // `pointerdown`, in capture, on the `<svg>`. The panel selects on
    // pointerdown, so a capture-phase `click` listener — what the quick-measure
    // layer can afford to use — still loses: the wall is already selected by
    // the time the click resolves. Capturing here is ahead of React's delegated
    // handlers at the root, and stopping propagation keeps the press from
    // reaching them at all.
    svg.addEventListener('pointerdown', onPointerDown, true)
    return () => svg.removeEventListener('pointerdown', onPointerDown, true)
  }, [buildingPosition, buildingRotationY, isCommenting, levelId])

  const visible = useMemo(() => {
    const all = sortCommentThreads(comments)
    const unresolved = showResolved ? all : all.filter((thread) => !thread.resolved)
    // The plan draws one storey; a pin from another would read as belonging to
    // this one. Threads with no level (dropped before a level was active) are
    // shown everywhere rather than nowhere.
    return unresolved.filter((thread) => !(thread.levelId && levelId) || thread.levelId === levelId)
  }, [comments, levelId, showResolved])

  // `scale(unitsPerPixel)` puts each pin's own box back into screen pixels, so
  // its width/height are plain pixel numbers and the badge keeps one size at
  // any zoom — the same trick the other floorplan layers use for handle radii.
  const unitsPerPixel = Math.max(renderContext?.unitsPerPixel ?? 0.01, 1e-6)
  // The plan's parent `<g>` is rotated; counter-rotate the pin chrome so the
  // badges and bubbles stay upright on screen.
  const counterRotation = -(renderContext?.sceneRotationDeg ?? 0)

  return (
    <g pointerEvents={isCommenting ? 'auto' : 'none'} ref={groupRef}>
      {visible.map((thread) => {
        const world = resolveCommentPinPosition(thread, nodes)
        const local = worldToFloorplanLocalPoint(
          world[0],
          world[2],
          buildingPosition,
          buildingRotationY,
        )
        const open = activeId === thread.id
        return (
          <foreignObject
            height={open ? 320 : 32}
            key={thread.id}
            style={{ overflow: 'visible', pointerEvents: 'auto' }}
            transform={`translate(${local.x} ${local.y}) rotate(${counterRotation}) scale(${unitsPerPixel})`}
            width={open ? 280 : 32}
            x={open ? -8 : -16}
            y={open ? -8 : -16}
          >
            {open ? <CommentBubble thread={thread} /> : <CommentPinButton thread={thread} />}
          </foreignObject>
        )
      })}
      {draft && draft.origin === '2d'
        ? (() => {
            const local = worldToFloorplanLocalPoint(
              draft.position[0],
              draft.position[2],
              buildingPosition,
              buildingRotationY,
            )
            return (
              <foreignObject
                height={320}
                style={{ overflow: 'visible', pointerEvents: 'auto' }}
                transform={`translate(${local.x} ${local.y}) rotate(${counterRotation}) scale(${unitsPerPixel})`}
                width={280}
                x={-8}
                y={-8}
              >
                <CommentBubble draft={draft} />
              </foreignObject>
            )
          })()
        : null}
    </g>
  )
}

export default FloorplanCommentLayer
