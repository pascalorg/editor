'use client'

import {
  type AnyNodeId,
  type BaseNode,
  type BuildingNode,
  type CameraPose,
  emitter,
  type LevelNode,
  resolveBuildingForLevel,
  useScene,
  type ZoneNode,
} from '@pascal-app/core'
import {
  groundVeiled,
  type RevealEvent,
  revealChangedNodeIds,
  subscribeRevealEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Vector3 } from 'three'
import {
  clearFrame,
  Follower,
  type FollowWant,
  frameOf,
  OrbitSpring,
  type OrbitValue,
} from '../../lib/follow-pascal'
import { anyExterior } from '../../lib/follow-pascal-exterior'
import { FollowPresentation, type PresentationPort } from '../../lib/follow-pascal-presentation'
import { FollowSight } from '../../lib/follow-pascal-sight'
import { stayOnLevel, wantFromEvent } from '../../lib/follow-pascal-targets'
import useEditor from '../../store/use-editor'
import useFollowPascal from '../../store/use-follow-pascal'
import { usePointAsk } from '../../store/use-point-ask'

/**
 * Follow Pascal: while a build plays, the camera eases to what the current step is working on, framed
 * at the distance its scale needs. It listens to the reveal's own words (`subscribeRevealEvents`), so
 * a step and the camera share one rhythm, and moves like a critically damped spring on an orbit about
 * what it looks at, so the horizon stays level. Touching the camera, or choosing a view, pauses it; the
 * person resumes it from the pill, or the next build takes it again. Under reduced motion it cuts.
 *
 * To see a build it changes the presentation: it cuts the walls away when no eye sees the target,
 * selects the floor being built and hides the floors above it. An edit or a move seen from outside
 * (an exterior wall bent, a window moved on one, a roof, the ground) is looked at from outdoors with
 * the walls up instead: a cutaway would hide the very wall that moves. A commit with one such change
 * in it takes the outside view for all of it. A build is followed as it always was. When Follow ends (switched off, the person takes the
 * camera, the build is over and no turn is running) it puts back what it changed, and leaves what
 * the person changed since (`FollowPresentation`).
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

/** The viewer and the editor as `FollowPresentation` reads and writes them. */
const viewPort: PresentationPort = {
  read: () => {
    const viewer = useViewer.getState()
    const { selection } = viewer
    return {
      wall: viewer.wallMode,
      levels: viewer.levelMode,
      hideAbove: viewer.hideLevelsAboveSelection,
      floor: {
        buildingId: selection.buildingId,
        levelId: selection.levelId,
        zoneId: selection.zoneId,
        selectedIds: selection.selectedIds,
        room: useEditor.getState().room,
      },
    }
  },
  setWall: (mode) => useViewer.getState().setWallMode(mode),
  setLevels: (mode) => useViewer.getState().setLevelMode(mode),
  setHideAbove: (hide) => useViewer.setState({ hideLevelsAboveSelection: hide }),
  setFloor: ({ buildingId, levelId }) => {
    useViewer.getState().setSelection({
      ...(buildingId ? { buildingId: buildingId as BuildingNode['id'] } : {}),
      levelId: levelId as LevelNode['id'],
    })
    useEditor.getState().clearRoom()
  },
  putFloor: (floor) => {
    const nodes = useScene.getState().nodes
    const exists = (id: string | null) => id !== null && !!nodes[id as AnyNodeId]
    useViewer.getState().setSelection({
      buildingId: exists(floor.buildingId) ? (floor.buildingId as BuildingNode['id']) : null,
      levelId: exists(floor.levelId) ? (floor.levelId as LevelNode['id']) : null,
      zoneId: exists(floor.zoneId) ? (floor.zoneId as ZoneNode['id']) : null,
      selectedIds: floor.selectedIds.filter(exists) as BaseNode['id'][],
    })
    const { room } = floor
    useEditor.setState({
      room: room && exists(room.zoneId) && exists(room.levelId) ? room : null,
      hoveredRoom: null,
    })
  },
}

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
  const scene = useThree((state) => state.scene)
  const sight = useMemo(() => new FollowSight(scene), [scene])
  const presentation = useMemo(() => new FollowPresentation(viewPort), [])
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
  const nextSightCheck = useRef(0)

  /** The camera as it is now, so a flight starts from the view the person has. */
  const currentPose = (): CameraPose => {
    const target = controls?.getTarget?.(scratch.current) ?? scratch.current.set(0, 0, 0)
    return {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [target.x, target.y, target.z],
      projection: 'perspective',
    }
  }

  /** The build in hand has a change seen from outside in it: all of it is looked at from outdoors. */
  const outsideBuild = useRef(false)
  /** The last word was that the play is over: the next edit is another commit's. */
  const played = useRef(false)

  const unobstructed = (want: FollowWant, goal: OrbitValue): OrbitValue => {
    sight.refresh(want)
    const clear = clearFrame(goal, (pose) => sight.clear(pose))
    if (clear) return clear
    // Seen from outside the walls stay up: a cutaway would take the wall that changes away.
    if (want.exterior || outsideBuild.current) {
      presentation.wall('up')
      return goal
    }
    presentation.wall('cutaway')
    return goal
  }

  const moveTo = (goal: OrbitValue) => {
    const orbit = spring.current!
    if (prefersReducedMotion()) {
      orbit.snap(goal)
      emitter.emit('camera-controls:apply-pose', orbit.pose())
      dipCanvas()
      flying.current = false
      return
    }
    orbit.to(goal)
    flying.current = true
  }

  const fly = (asked: FollowWant) => {
    const nodes = useScene.getState().nodes
    // A level below grade is shown, its ground open over it: the look at the whole house that follows
    // furniture landing, and every finished commit, stays on that level. Showing the floors above would
    // close the ground, and the next piece on the basement open it again, once for every commit.
    const { selection, hideLevelsAboveSelection } = useViewer.getState()
    const staying = hideLevelsAboveSelection && groundVeiled(useViewer.getState())
    const want =
      asked.kind === 'group' && !asked.levelId && staying && selection.levelId
        ? stayOnLevel(asked, nodes, selection.levelId)
        : asked
    last.current = want
    const level = want.levelId ? nodes[want.levelId as AnyNodeId] : undefined
    if (level?.type === 'level') {
      const buildingId = resolveBuildingForLevel(level.id as AnyNodeId, nodes)
      const building = buildingId ? nodes[buildingId] : undefined
      presentation.floor({
        buildingId: building?.type === 'building' ? building.id : null,
        levelId: level.id,
      })
      presentation.levels('stacked')
      presentation.hideAbove(true)
    } else if (want.kind === 'group' && !want.levelId) {
      // The finished house is looked at whole: its upper floors are not hidden.
      presentation.levels('stacked')
      presentation.hideAbove(false)
    }
    // A change seen from outside: the walls up for it, even if an earlier step cut them away.
    if (want.exterior || outsideBuild.current) presentation.wall('up')
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
    moveTo(unobstructed(want, goal))
    nextSightCheck.current = clock.current + 0.5
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
        outsideBuild.current = false
      }
      // An edit or a move is read before its first piece plays: one change seen from outside takes the
      // whole commit outdoors, until the play is over. What is waiting in the queue belongs to a later
      // commit, so a build, a deletion, or the edit that follows a finished play never inherits it.
      const edit = 'changed' in event && event.changed === true
      if (!edit) outsideBuild.current = false
      else {
        if (played.current) outsideBuild.current = false
        const changed = outsideBuild.current ? [] : revealChangedNodeIds()
        if (changed.length && anyExterior(useScene.getState().nodes, changed))
          outsideBuild.current = true
      }
      played.current = event.type === 'complete'
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
  // Follow ends when it is switched off and when the person takes the camera: what it changed to see
  // the build goes back. A build being over ends it only when no turn is running: a turn runs several
  // programs, and the view holds steady between them (the host's busy flag, below).
  useEffect(
    () =>
      useFollowPascal.subscribe((state, before) => {
        if (before.paused && !state.paused && state.on) resuming.current = true
        if (before.on && !state.on) flying.current = false
        if ((before.on && !state.on) || (!before.paused && state.paused)) presentation.restore()
        // The build is over: that ends it when no turn is running to build more.
        if (before.building && !state.building && !usePointAsk.getState().busy)
          presentation.restore()
      }),
    [presentation],
  )

  // The turn ends, or the person stops it: the host's busy flag is the editor's word on it. What the
  // reveal still plays after that is still followed, so it ends with the build, not with the turn.
  useEffect(
    () =>
      usePointAsk.subscribe((state, before) => {
        if (before.busy && !state.busy && !useFollowPascal.getState().building)
          presentation.restore()
      }),
    [presentation],
  )

  // Leaving the editor ends it too.
  useEffect(() => () => presentation.restore(), [presentation])

  useFrame((_, delta) => {
    clock.current += Math.min(delta, 0.1)
    const { on, paused, building } = useFollowPascal.getState()
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
    // Recheck as geometry lands, even after arrival; retain a clear orbit instead of hunting each frame.
    if (
      orbit &&
      last.current &&
      (building || flying.current) &&
      clock.current >= nextSightCheck.current
    ) {
      nextSightCheck.current = clock.current + 0.5
      const goal = unobstructed(last.current, orbit.destination())
      if (!arrived(goal, orbit.destination())) moveTo(goal)
    }
    if (!(flying.current && orbit)) return
    orbit.step(Math.min(delta, 0.05))
    emitter.emit('camera-controls:apply-pose', orbit.pose())
    if (arrived(orbit.value(), orbit.destination())) flying.current = false
  })

  return null
}
