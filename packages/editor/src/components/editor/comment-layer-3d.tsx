'use client'

import {
  type AnyNodeId,
  type CommentThread,
  emitter,
  type GridEvent,
  type NodeEvent,
  sortCommentThreads,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import { resolveCommentPinPosition } from '../../lib/comments'
import { getPickableNodeKinds } from '../../lib/pickable-kinds'
import useCommentUi from '../../store/use-comment-ui'
import useEditor from '../../store/use-editor'
import { CommentBubble, CommentPinButton } from './comment-pin'

/**
 * How far above the hit point a pin floats, so it reads as a marker on the
 * surface rather than a decal buried in it.
 */
const PIN_LIFT = 0.12

/**
 * Comment pins in the 3D canvas, plus the click handling that drops a new one
 * while `mode === 'comment'`.
 *
 * Placement rides the node event bus rather than its own raycast: `<kind>:click`
 * already carries the world hit point and the node that was hit, which is
 * exactly the pin's anchor. `grid:click` covers a pin dropped on empty ground.
 *
 * The 2D sibling is `floorplan-comment-layer.tsx`; both write the same
 * `CommentDraft`, so a pin dropped in either view opens the same composer.
 */
export function CommentLayer3D() {
  const mode = useEditor((state) => state.mode)
  const comments = useScene((state) => state.comments)
  const nodes = useScene((state) => state.nodes)
  const showResolved = useCommentUi((state) => state.showResolved)
  const activeId = useCommentUi((state) => state.activeId)
  const draft = useCommentUi((state) => state.draft)
  const levelId = useViewer((state) => state.selection.levelId)

  const isCommenting = mode === 'comment'

  // Escape falls through `use-keyboard`'s unconsumed-cancel path to
  // `setMode('select')`, which is the exit from comment mode. An unsubmitted
  // pin has to go with it, or it hangs over the model with no way to reach it.
  useEffect(() => {
    if (isCommenting) return
    if (useCommentUi.getState().draft) useCommentUi.getState().setDraft(null)
  }, [isCommenting])

  useEffect(() => {
    if (!isCommenting) return

    const dropPin = (position: [number, number, number], nodeId?: AnyNodeId) => {
      const scene = useScene.getState()
      const origin = nodeId
        ? (scene.nodes[nodeId] as { position?: unknown } | undefined)?.position
        : undefined
      const canFollow =
        Array.isArray(origin) &&
        origin.length === 3 &&
        origin.every((value) => typeof value === 'number' && Number.isFinite(value))

      useCommentUi.getState().setDraft({
        position: [position[0], position[1] + PIN_LIFT, position[2]],
        ...(nodeId && { nodeId }),
        ...(nodeId &&
          canFollow && {
            offset: [
              position[0] - (origin as number[])[0]!,
              position[1] + PIN_LIFT - (origin as number[])[1]!,
              position[2] - (origin as number[])[2]!,
            ] as [number, number, number],
          }),
        ...(levelId && { levelId }),
        origin: '3d',
      })
    }

    // Which node a pin lands on is decided on `pointerdown`, not on the click
    // that commits it. Measured on a wall inside a building, one press emits:
    //
    //   building:pointerdown → wall:pointerdown → building:pointerdown
    //   building:click
    //
    // `wall:click` never arrives at all — `useNodeEvents` synthesises the click
    // on pointer-up and drops it when `inputDragging` is set, which the press
    // itself sets. So a picker that listens only for `:click` can see the
    // container and never the element, which is how a comment on a wall used to
    // be filed against the whole building.
    //
    // Containers are not useful anchors either: "about the building" says
    // nothing, and neither `building` nor `level` moves in a way a pin should
    // follow. A press that only ever hit one is recorded as a bare position.
    const CONTAINER_KINDS = new Set(['site', 'building', 'level'])
    let press: { nodeId: AnyNodeId; position: [number, number, number] } | null = null

    // Capture on `window` runs before R3F's canvas listeners, so each new press
    // starts from a clean slate without needing a timer to expire the old one.
    const onWindowPointerDown = () => {
      press = null
    }

    const onNodeDown = (event: NodeEvent) => {
      if (press) return // The first non-container hit is the most specific one.
      if (CONTAINER_KINDS.has(event.node.type)) return
      press = { nodeId: event.node.id as AnyNodeId, position: event.position }
    }

    // The grid raycasts the same press and emits `grid:click` right after the
    // node's, which would otherwise replace the anchored pin with a bare ground
    // point. `selection-manager.tsx` guards the same hazard the same way.
    let clickHandled = false
    let resetTimer: ReturnType<typeof setTimeout> | undefined
    const commit = (fallbackPosition: [number, number, number]) => {
      if (clickHandled) return
      clickHandled = true
      clearTimeout(resetTimer)
      resetTimer = setTimeout(() => {
        clickHandled = false
      }, 50)
      dropPin(press?.position ?? fallbackPosition, press?.nodeId)
    }

    const onNodeClick = (event: NodeEvent) => {
      event.stopPropagation()
      commit(event.position)
    }
    const onGridClick = (event: GridEvent) => commit(event.position)

    const kinds = getPickableNodeKinds()
    window.addEventListener('pointerdown', onWindowPointerDown, true)
    for (const kind of kinds) {
      emitter.on(`${kind}:pointerdown` as never, onNodeDown as never)
      emitter.on(`${kind}:click` as never, onNodeClick as never)
    }
    emitter.on('grid:click', onGridClick)

    return () => {
      clearTimeout(resetTimer)
      window.removeEventListener('pointerdown', onWindowPointerDown, true)
      for (const kind of kinds) {
        emitter.off(`${kind}:pointerdown` as never, onNodeDown as never)
        emitter.off(`${kind}:click` as never, onNodeClick as never)
      }
      emitter.off('grid:click', onGridClick)
    }
  }, [isCommenting, levelId])

  const visible = useMemo(() => {
    const all = sortCommentThreads(comments)
    return showResolved ? all : all.filter((thread) => !thread.resolved)
  }, [comments, showResolved])

  // Nothing to draw and nothing to catch: stay out of the tree entirely so an
  // ordinary session pays nothing for a feature it is not using.
  if (visible.length === 0 && !draft) return null

  return (
    <group>
      {visible.map((thread) => (
        <CommentPin3D
          key={thread.id}
          open={activeId === thread.id}
          position={resolveCommentPinPosition(thread, nodes)}
          thread={thread}
        />
      ))}
      {draft && draft.origin === '3d' ? (
        <Html center distanceFactor={undefined} position={draft.position} zIndexRange={[60, 50]}>
          <CommentBubble draft={draft} />
        </Html>
      ) : null}
    </group>
  )
}

function CommentPin3D({
  thread,
  position,
  open,
}: {
  thread: CommentThread
  position: [number, number, number]
  open: boolean
}) {
  return (
    <Html center position={position} zIndexRange={[50, 40]}>
      {open ? <CommentBubble thread={thread} /> : <CommentPinButton thread={thread} />}
    </Html>
  )
}
