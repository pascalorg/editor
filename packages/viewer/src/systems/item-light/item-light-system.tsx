import type { AnyNodeId, LevelNode } from '@pascal-app/core'
import { sceneRegistry, useInteractive, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { MathUtils, type PointLight, Vector3 } from 'three'
import { useItemLightPool } from '../../store/use-item-light-pool'
import useViewer from '../../store/use-viewer'

const POOL_SIZE = 12
// How often (in seconds) to re-evaluate which items have lights assigned (fallback timer)
const REASSIGN_INTERVAL = 0.2

// Hysteresis: a currently-assigned slot keeps its key unless an unassigned
// candidate beats it by at least this much (prevents flickering at the boundary)
const HYSTERESIS = 0.15

// Camera movement thresholds that trigger an early re-evaluation
const CAM_MOVE_DIST = 0.5 // units
const CAM_ROT_DOT = 0.995 // cos(~5.7°)

type SlotRuntime = {
  // The key currently driving this slot (null = idle)
  key: string | null
  // A pending reassignment waiting for the fade-out to finish
  pendingKey: string | null
  isFadingOut: boolean
}

// Module-level temp vectors reused every frame (avoids GC pressure)
const _dir = new Vector3()
const _camPos = new Vector3()
const _camFwd = new Vector3()
const _itemPos = new Vector3()

type SceneNodes = ReturnType<typeof useScene.getState>['nodes']
type InteractiveState = ReturnType<typeof useInteractive.getState>

function scoreRegistration(
  reg: import('../../store/use-item-light-pool').LightRegistration,
  nodes: SceneNodes,
  selectedLevelId: string | null,
  levelMode: string,
  interactiveState: InteractiveState,
): number {
  // Skip lights that are toggled off — they contribute no illumination
  if (reg.toggleIndex >= 0) {
    const values = interactiveState.items[reg.nodeId]?.controlValues
    const isOn = Boolean(values?.[reg.toggleIndex])
    if (!isOn) return Number.POSITIVE_INFINITY
  }

  const { nodeId, effect } = reg
  const obj = sceneRegistry.nodes.get(nodeId)
  if (!obj) return Number.POSITIVE_INFINITY

  obj.getWorldPosition(_itemPos)
  _itemPos.x += effect.offset[0]
  _itemPos.y += effect.offset[1]
  _itemPos.z += effect.offset[2]

  _dir.copy(_itemPos).sub(_camPos).normalize()
  const dot = _camFwd.dot(_dir) // 1 = ahead, -1 = behind

  // Angular component (0 = dead ahead, 2 = directly behind)
  const angular = 1 - dot
  // Normalised distance component (assumes scenes < 200 units)
  const dist = _camPos.distanceTo(_itemPos) / 200

  // ── Level factor ──────────────────────────────────────────────────────────
  const node = nodes[nodeId]
  const itemLevelId = node?.parentId ?? null

  let levelPenalty = 0
  if (selectedLevelId) {
    if (itemLevelId !== selectedLevelId) {
      // In solo mode items on other levels are invisible — deprioritize strongly
      levelPenalty = levelMode === 'solo' ? 100 : 0.8
    }
  } else if (itemLevelId) {
    // No level selected — lightly prefer items on level index 0
    const levelNode = nodes[itemLevelId as AnyNodeId] as LevelNode | undefined
    const levelIndex = levelNode?.level ?? 0
    if (levelIndex !== 0) levelPenalty = 0.3
  }

  return angular * 0.7 + dist * 0.3 + levelPenalty
}

export function ItemLightSystem() {
  const lightRefs = useRef<Array<PointLight | null>>(Array.from({ length: POOL_SIZE }, () => null))
  const slots = useRef<SlotRuntime[]>(
    Array.from({ length: POOL_SIZE }, () => ({ key: null, pendingKey: null, isFadingOut: false })),
  )
  const reassignTimer = useRef(0)

  // Track camera state at last reassignment to detect meaningful movement
  const prevReassignCamPos = useRef(new Vector3())
  const prevReassignCamFwd = useRef(new Vector3(0, 0, -1))

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.1)
    const { registrations } = useItemLightPool.getState()
    const interactiveState = useInteractive.getState()

    // ── 1. Throttled priority reassignment ──────────────────────────────────
    camera.getWorldPosition(_camPos)
    camera.getWorldDirection(_camFwd)

    const camMoved =
      _camPos.distanceTo(prevReassignCamPos.current) > CAM_MOVE_DIST ||
      _camFwd.dot(prevReassignCamFwd.current) < CAM_ROT_DOT

    reassignTimer.current -= delta
    const shouldReassign = reassignTimer.current <= 0 || camMoved

    if (shouldReassign) {
      reassignTimer.current = REASSIGN_INTERVAL
      prevReassignCamPos.current.copy(_camPos)
      prevReassignCamFwd.current.copy(_camFwd)

      // Read level/scene state once for the whole tick
      const nodes = useScene.getState().nodes
      const viewerState = useViewer.getState()
      const selectedLevelId = viewerState.selection.levelId
      const levelMode = viewerState.levelMode

      // Score every registration
      const scored: Array<{ key: string; score: number }> = []
      for (const [key, reg] of registrations) {
        scored.push({
          key,
          score: scoreRegistration(reg, nodes, selectedLevelId, levelMode, interactiveState),
        })
      }
      scored.sort((a, b) => a.score - b.score)

      // Build the desired assignment (top POOL_SIZE keys)
      const desired = scored.slice(0, POOL_SIZE).map((s) => s.key)

      // Build a map of currently-assigned keys → slot index for hysteresis
      const currentlyAssigned = new Map<string, number>()
      for (let i = 0; i < POOL_SIZE; i++) {
        const s = slots.current[i]
        if (!s) continue
        const k = s.key ?? s.pendingKey
        if (k) currentlyAssigned.set(k, i)
      }

      // Assign desired keys to slots — prefer keeping existing assignments
      const usedSlots = new Set<number>()
      const assignedKeys = new Set<string>()

      // Pass 1: keep existing slots where the key is still in desired
      for (const key of desired) {
        const existingSlot = currentlyAssigned.get(key)
        if (existingSlot !== undefined && !usedSlots.has(existingSlot)) {
          usedSlots.add(existingSlot)
          assignedKeys.add(key)
        }
      }

      // Pass 2: assign remaining desired keys to free slots
      let freeSlot = 0
      for (const key of desired) {
        if (assignedKeys.has(key)) continue
        while (freeSlot < POOL_SIZE && usedSlots.has(freeSlot)) freeSlot++
        if (freeSlot >= POOL_SIZE) break

        // Hysteresis: only evict the current occupant if the new key scores
        // meaningfully better than it
        const freeSlotData = slots.current[freeSlot]
        const currentKey = freeSlotData ? (freeSlotData.key ?? freeSlotData.pendingKey) : null
        if (currentKey && !desired.includes(currentKey)) {
          const currentScore =
            scored.find((s) => s.key === currentKey)?.score ?? Number.POSITIVE_INFINITY
          const newScore = scored.find((s) => s.key === key)?.score ?? 0
          if (currentScore - newScore < HYSTERESIS) {
            freeSlot++
            continue
          }
        }

        usedSlots.add(freeSlot)
        assignedKeys.add(key)

        const slot = slots.current[freeSlot]
        if (slot && slot.key !== key) {
          slot.pendingKey = key
          slot.isFadingOut = slot.key !== null
          if (!slot.isFadingOut) {
            // Slot was idle — skip fade-out, assign immediately
            slot.key = key
            slot.pendingKey = null
            const light = lightRefs.current[freeSlot]
            const reg = registrations.get(key)
            if (light && reg) {
              light.color.set(reg.effect.color)
              light.distance = reg.effect.distance ?? 0
            }
          }
        }
        freeSlot++
      }

      // Clear slots whose key is no longer in desired and not pending
      for (let i = 0; i < POOL_SIZE; i++) {
        if (!usedSlots.has(i)) {
          const slot = slots.current[i]
          if (slot?.key && !desired.includes(slot.key)) {
            slot.pendingKey = null
            slot.isFadingOut = true
          }
        }
      }
    }

    // ── 2. Per-frame light updates ───────────────────────────────────────────
    for (let i = 0; i < POOL_SIZE; i++) {
      const light = lightRefs.current[i]
      if (!light) continue

      const slot = slots.current[i]
      if (!slot) continue

      // Fade-out phase: lerp intensity → 0, then complete the transition
      if (slot.isFadingOut) {
        light.intensity = MathUtils.lerp(light.intensity, 0, dt * 12)
        if (light.intensity < 0.01) {
          light.intensity = 0
          slot.isFadingOut = false
          slot.key = slot.pendingKey
          slot.pendingKey = null

          if (slot.key) {
            const reg = registrations.get(slot.key)
            if (reg) {
              light.color.set(reg.effect.color)
              light.distance = reg.effect.distance ?? 0
            }
          }
        }
        continue
      }

      if (!slot.key) {
        // Idle slot — keep dark
        light.intensity = 0
        continue
      }

      const reg = registrations.get(slot.key)
      if (!reg) {
        slot.key = null
        light.intensity = 0
        continue
      }

      // Snap world position each frame
      const obj = sceneRegistry.nodes.get(reg.nodeId)
      if (obj) {
        obj.getWorldPosition(_itemPos)
        const [ox, oy, oz] = reg.effect.offset
        light.position.set(_itemPos.x + ox, _itemPos.y + oy, _itemPos.z + oz)
      }

      // Compute target intensity
      const values = interactiveState.items[reg.nodeId]?.controlValues
      const isOn = reg.toggleIndex >= 0 ? Boolean(values?.[reg.toggleIndex]) : true
      let t = 1
      if (reg.hasSlider) {
        const raw = (values?.[reg.sliderIndex] as number) ?? reg.sliderMin
        t = (raw - reg.sliderMin) / (reg.sliderMax - reg.sliderMin)
      }
      const targetIntensity = isOn
        ? MathUtils.lerp(reg.effect.intensityRange[0], reg.effect.intensityRange[1], t)
        : reg.effect.intensityRange[0]

      light.intensity = MathUtils.lerp(light.intensity, targetIntensity, dt * 12)
    }
  })

  return (
    <>
      {Array.from({ length: POOL_SIZE }, (_, i) => (
        <pointLight
          castShadow={false}
          intensity={0}
          key={i}
          ref={(el) => {
            lightRefs.current[i] = el
          }}
        />
      ))}
    </>
  )
}
