'use client'

import {
  type AnimationEffect,
  type AnyNodeId,
  type Interactive,
  useInteractive,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  type AnimationAction,
  type AnimationClip,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  Object3D,
} from 'three'

/** Actions keyed by the clip names the script wrote (`open`, `loop`, `Princess twirl`). */
export type ScriptedClipActions = Record<string, AnimationAction | null | undefined>

/** Own the action cache so replacing clips cannot retain bindings to an old artifact. */
export function useClipActions(clips: AnimationClip[], root: RefObject<Object3D | null>) {
  const { mixer, actions, cached, lifecycle } = useMemo(() => {
    const mixer = new AnimationMixer(new Object3D())
    const cached = new Map<string, AnimationAction>()
    const lifecycle = { active: true }
    const actions: Record<string, AnimationAction | null> = {}
    for (const clip of clips) {
      Object.defineProperty(actions, clip.name, {
        enumerable: true,
        configurable: true,
        get: () => {
          if (!lifecycle.active || !root.current) return null
          let action = cached.get(clip.name)
          if (!action) {
            action = mixer.clipAction(clip, root.current)
            cached.set(clip.name, action)
          }
          return action
        },
      })
    }
    return { mixer, actions, cached, lifecycle }
  }, [clips, root])
  useFrame((_, delta) => mixer.update(delta))
  useLayoutEffect(() => {
    lifecycle.active = true
    return () => {
      // React's development prop diff can read old getters after cleanup.
      lifecycle.active = false
      mixer.stopAllAction()
      const roots = new Set([...cached.values()].map((action) => action.getRoot()))
      cached.clear()
      for (const object of roots) mixer.uncacheRoot(object)
    }
  }, [mixer, cached, lifecycle])
  return actions
}

/** Whether an effect's toggle is on; an effect without one always runs. */
const useEffectControl = (nodeId: AnyNodeId, control: number | undefined) =>
  useInteractive((s) =>
    control === undefined ? true : Boolean(s.items[nodeId]?.controlValues[control]),
  )

/**
 * An authored object's clips, each driven by its own toggle: an open-close
 * effect plays `open` once and holds, closing plays `close` or `open` reversed;
 * an ambient effect plays its clip while its toggle is on (always, for `loop`).
 * Shared by the live item renderer and the baked viewer.
 */
export function ScriptedClips({
  nodeId,
  interactive,
  actions,
}: {
  nodeId: AnyNodeId
  interactive: Interactive
  actions: ScriptedClipActions
}) {
  const effects = interactive.effects.filter(
    (effect): effect is AnimationEffect => effect.kind === 'animation',
  )
  return (
    <>
      {effects.map((effect) =>
        effect.mode === 'open-close' ? (
          <OpenCloseClip actions={actions} effect={effect} key={effect.clips.on} nodeId={nodeId} />
        ) : (
          <PlayClip
            actions={actions}
            effect={effect}
            key={effect.clips.on ?? effect.clips.loop}
            nodeId={nodeId}
          />
        ),
      )}
    </>
  )
}

const PlayClip = ({
  nodeId,
  effect,
  actions,
}: {
  nodeId: AnyNodeId
  effect: AnimationEffect
  actions: ScriptedClipActions
}) => {
  const on = useEffectControl(nodeId, effect.control)
  const name = effect.clips.on ?? effect.clips.loop
  useEffect(() => {
    const action = name ? actions[name] : undefined
    return () => {
      action?.stop()
    }
  }, [actions, name])
  useEffect(() => {
    const action = name ? actions[name] : undefined
    if (!action) return
    if (on) {
      action.setLoop(LoopRepeat, Number.POSITIVE_INFINITY)
      action.clampWhenFinished = false
      action.paused = false
      action.play()
    } else {
      // Hold the pose where it was, like pausing a music box.
      action.paused = true
    }
  }, [actions, name, on])
  return null
}

const OpenCloseClip = ({
  nodeId,
  effect,
  actions,
}: {
  nodeId: AnyNodeId
  effect: AnimationEffect
  actions: ScriptedClipActions
}) => {
  const isOpen = useEffectControl(nodeId, effect.control)
  const mounted = useRef(false)
  useEffect(() => {
    const open = effect.clips.on ? actions[effect.clips.on] : undefined
    const close = effect.clips.off ? actions[effect.clips.off] : undefined
    return () => {
      open?.stop()
      close?.stop()
      mounted.current = false
    }
  }, [actions, effect.clips.on, effect.clips.off])
  useEffect(() => {
    const open = effect.clips.on ? actions[effect.clips.on] : undefined
    const close = effect.clips.off ? actions[effect.clips.off] : undefined
    if (!open) return
    const first = !mounted.current
    mounted.current = true
    for (const action of [open, close]) {
      if (!action) continue
      action.setLoop(LoopOnce, 1)
      action.clampWhenFinished = true
    }
    if (isOpen) {
      close?.stop()
      open.paused = false
      open.timeScale = 1
      if (!open.isRunning()) open.reset()
      open.play()
      // Already open when the scene loads: hold the open pose, no swing.
      if (first) open.time = open.getClip().duration
      return
    }
    if (first) return
    if (close) {
      open.stop()
      close.reset().play()
      return
    }
    open.paused = false
    open.timeScale = -1
    open.play()
  }, [actions, effect.clips.on, effect.clips.off, isOpen])
  return null
}
