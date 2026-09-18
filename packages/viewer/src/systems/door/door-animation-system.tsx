import { type AnyNodeId, type DoorNode, emitter, useInteractive, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'

const easeDoorAnimation = (value: number) => value * value * (3 - 2 * value)

export const DoorAnimationSystem = () => {
  useFrame(({ clock }) => {
    const interactive = useInteractive.getState()
    const entries = Object.entries(interactive.doorAnimations)
    if (entries.length === 0) return

    const now = clock.getElapsedTime() * 1000

    for (const [doorId, animation] of entries) {
      const typedDoorId = doorId as AnyNodeId
      const scene = useScene.getState()
      const node = scene.nodes[typedDoorId]
      if (node?.type !== 'door') {
        interactive.cancelDoorAnimation(typedDoorId)
        interactive.removeDoorOpenState(typedDoorId)
        continue
      }

      const startedAt = animation.startedAt ?? now
      if (animation.startedAt === null) {
        interactive.startDoorAnimation(typedDoorId, { ...animation, startedAt })
      }

      const progress = Math.min(1, (now - startedAt) / animation.durationMs)
      const value = animation.from + (animation.to - animation.from) * easeDoorAnimation(progress)
      // No dirty mark per tick: DoorSystem rebuilds any door with an entry in
      // `doorAnimations`, and a dirty mark is a one-shot work item, not a
      // needs-frame signal — per-tick marks kept the scene from ever settling.
      interactive.setDoorOpenState(typedDoorId, { [animation.field]: value })

      if (progress < 1) continue

      interactive.cancelDoorAnimation(typedDoorId)
      if (animation.persist) {
        scene.updateNode(typedDoorId, { [animation.field]: animation.to })
        interactive.removeDoorOpenState(typedDoorId)
      } else {
        interactive.setDoorOpenState(typedDoorId, { [animation.field]: animation.to })
      }
      // One final mark so the settled pose gets a rebuild after the animation
      // entry is gone (the persist branch's updateNode also marks, harmlessly).
      scene.markDirty(typedDoorId)
      emitter.emit('door:animation-completed', {
        doorId: typedDoorId as DoorNode['id'],
        field: animation.field,
      })
    }
  }, 2)

  return null
}
