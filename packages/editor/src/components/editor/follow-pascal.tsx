'use client'

import { type CameraPose, emitter, useScene } from '@pascal-app/core'
import { type RevealEvent, subscribeRevealEvents, useViewer } from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import {
  Follower,
  type FollowWant,
  frameOf,
  OrbitSpring,
  type OrbitValue,
} from '../../lib/follow-pascal'
import { wantFromEvent } from '../../lib/follow-pascal-targets'
import useEditor from '../../store/use-editor'
import useFollowPascal from '../../store/use-follow-pascal'

/**
 * Follow Pascal: while a build plays, the camera eases to what the current step is working on, framed
 * at the distance its scale needs. It listens to the reveal's own words (`subscribeRevealEvents`), so
 * a step and the camera share one rhythm, and moves like a critically damped spring on an orbit about
 * what it looks at, so the horizon stays level. Touching the camera, or choosing a view, pauses it; the
 * person resumes it from the pill, or the next build takes it again. Under reduced motion it cuts.
 */

/** A build is over this long after its last word; the pill goes with it. */
const BUILD_OVER_MS = 4000
/** Close enough to its goal that the flight is over. */
const ARRIVED = { position: 0.01, angle: 0.002 }

/** Every way a person takes the camera. */
const TAKEN = [
  'camera-controls:interaction-start',
  'camera-controls:view',
  'camera-controls:focus',
  'camera-controls:top-view',
  'camera-controls:orbit-cw',
  'camera-controls:orbit-ccw',
  'camera-controls:fit-scene',
] as const

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The canvas dips and comes back, so a cut reads as a cross-fade rather than a jump. */
function dipCanvas() {
  const canvas = document.querySelector<HTMLElement>('[data-pascal-viewer-3d]')
  canvas?.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' })
}

const arrived = (value: OrbitValue, goal: OrbitValue) =>
  Math.abs(value.x - goal.x) < ARRIVED.position &&
  Math.abs(value.y - goal.y) < ARRIVED.position &&
  Math.abs(value.z - goal.z) < ARRIVED.position &&
  Math.abs(value.r - goal.r) < ARRIVED.position &&
  Math.abs(value.az - goal.az) < ARRIVED.angle &&
  Math.abs(value.el - goal.el) < ARRIVED.angle

export function FollowPascal() {
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls) as {
    getTarget?: (out: Vector3) => Vector3
  } | null
  const size = useThree((state) => state.size)
  const follower = useRef(new Follower())
  const spring = useRef<OrbitSpring | null>(null)
  const clock = useRef(0)
  const flying = useRef(false)
  const synced = useRef(false)
  const last = useRef<FollowWant | null>(null)
  const resuming = useRef(false)
  const over = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scratch = useRef(new Vector3())

  /** The camera as it is now, so a flight starts from the view the person has. */
  const currentPose = (): CameraPose => {
    const target = controls?.getTarget?.(scratch.current) ?? scratch.current.set(0, 0, 0)
    return {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [target.x, target.y, target.z],
      projection: 'perspective',
    }
  }

  const fly = (want: FollowWant) => {
    last.current = want
    if (!spring.current) {
      spring.current = new OrbitSpring({ x: 0, y: 1, z: 0, r: 20, az: 0.6, el: 0.5 })
      synced.current = false
    }
    if (!synced.current) {
      spring.current.fromPose(currentPose())
      synced.current = true
    }
    const perspective = camera as { fov?: number }
    const goal = frameOf(want, {
      fov: perspective.fov ?? 45,
      aspect: size.width / Math.max(1, size.height),
      azimuth: spring.current.value().az,
    })
    if (prefersReducedMotion()) {
      spring.current.snap(goal)
      emitter.emit('camera-controls:apply-pose', spring.current.pose())
      dipCanvas()
      flying.current = false
      return
    }
    spring.current.to(goal)
    flying.current = true
  }

  // What the build says it is doing: where to look, and when a build begins and ends.
  useEffect(() => {
    const hear = (event: RevealEvent) => {
      const store = useFollowPascal.getState()
      if (over.current) clearTimeout(over.current)
      if (!store.building) {
        store.beginBuild()
        follower.current.reset()
        synced.current = false
      }
      over.current = setTimeout(() => useFollowPascal.getState().endBuild(), BUILD_OVER_MS)
      if (event.type === 'complete') return
      const want = wantFromEvent(event, useScene.getState().nodes, clock.current)
      if (want) follower.current.want(want)
    }
    const stop = subscribeRevealEvents(hear)
    return () => {
      stop()
      if (over.current) clearTimeout(over.current)
    }
  }, [])

  // The person takes the camera: it stays theirs, and the next flight starts from where they leave it.
  useEffect(() => {
    const take = () => {
      flying.current = false
      synced.current = false
      useFollowPascal.getState().pause()
    }
    for (const name of TAKEN) emitter.on(name, take)
    return () => {
      for (const name of TAKEN) emitter.off(name, take)
    }
  }, [])

  // Resuming flies back to what it was last looking at; switching it off ends a flight.
  useEffect(
    () =>
      useFollowPascal.subscribe((state, before) => {
        if (before.paused && !state.paused && state.on) resuming.current = true
        if (before.on && !state.on) flying.current = false
      }),
    [],
  )

  useFrame((_, delta) => {
    clock.current += Math.min(delta, 0.1)
    const { on, paused } = useFollowPascal.getState()
    if (!on || paused) return
    if (useViewer.getState().cameraMode !== 'perspective' || useEditor.getState().isFirstPersonMode)
      return
    if (resuming.current) {
      resuming.current = false
      if (last.current) fly(last.current)
    }
    const due = follower.current.due(clock.current)
    if (due) fly(due)
    const orbit = spring.current
    if (!(flying.current && orbit)) return
    orbit.step(Math.min(delta, 0.05))
    emitter.emit('camera-controls:apply-pose', orbit.pose())
    if (arrived(orbit.value(), orbit.destination())) flying.current = false
  })

  return null
}
