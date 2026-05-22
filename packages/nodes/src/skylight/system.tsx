'use client'

import { type AnyNodeId, useInteractive, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'

const easeSkylightAnimation = (value: number) => value * value * (3 - 2 * value)

const SkylightAnimationSystem = () => {
  useFrame(({ clock }) => {
    const interactive = useInteractive.getState()
    const entries = Object.entries(interactive.skylightAnimations)
    if (entries.length === 0) return

    const now = clock.getElapsedTime() * 1000

    for (const [skylightId, animation] of entries) {
      const typedSkylightId = skylightId as AnyNodeId
      const scene = useScene.getState()
      const node = scene.nodes[typedSkylightId]
      if (node?.type !== 'skylight') {
        interactive.cancelSkylightAnimation(typedSkylightId)
        interactive.removeSkylightOpenState(typedSkylightId)
        continue
      }

      const startedAt = animation.startedAt ?? now
      if (animation.startedAt === null) {
        interactive.startSkylightAnimation(typedSkylightId, { ...animation, startedAt })
      }

      const progress = Math.min(1, (now - startedAt) / animation.durationMs)
      const value =
        animation.from + (animation.to - animation.from) * easeSkylightAnimation(progress)
      // No scene dirty per tick — the renderer subscribes to useInteractive
      // directly and re-renders the glass when operationState changes. Dirtying
      // the skylight makes RoofSystem mark the parent segment dirty, which
      // queues a full merged-roof CSG rebuild every frame. The cut geometry
      // doesn't depend on operationState — only frame/width/curb/position do.
      interactive.setSkylightOpenState(typedSkylightId, { [animation.field]: value })

      if (progress < 1) continue

      interactive.cancelSkylightAnimation(typedSkylightId)
      if (animation.persist) {
        // updateNode dirties the skylight via the scene store; the roof
        // re-cut runs once at the end of the tween, not every frame.
        scene.updateNode(typedSkylightId, { [animation.field]: animation.to })
        interactive.removeSkylightOpenState(typedSkylightId)
      } else {
        interactive.setSkylightOpenState(typedSkylightId, { [animation.field]: animation.to })
      }
    }
  }, 2)

  return null
}

export default SkylightAnimationSystem
