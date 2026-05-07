import { type AnyNodeId, type DoorNode, emitter, useInteractive, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'

const easeDoorAnimation = (value: number) => value * value * (3 - 2 * value)

function markDoorDirty(doorId: AnyNodeId) {
  const scene = useScene.getState()
  const node = scene.nodes[doorId]
  scene.dirtyNodes.add(doorId)
  if (node?.parentId) scene.dirtyNodes.add(node.parentId as AnyNodeId)
}

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
      interactive.setDoorOpenState(typedDoorId, { [animation.field]: value })
      markDoorDirty(typedDoorId)

      if (progress < 1) continue

      interactive.cancelDoorAnimation(typedDoorId)
      if (animation.persist) {
        scene.updateNode(typedDoorId, { [animation.field]: animation.to })
        interactive.removeDoorOpenState(typedDoorId)
        markDoorDirty(typedDoorId)
      } else {
        interactive.setDoorOpenState(typedDoorId, { [animation.field]: animation.to })
      }
      emitter.emit('door:animation-completed', {
        doorId: typedDoorId as DoorNode['id'],
        field: animation.field,
      })
    }
  }, 2)

  return null
}
