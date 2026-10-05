import { expect, test } from 'bun:test'
import { type RootState, useThree } from '@react-three/fiber'
import { create } from '@react-three/test-renderer'
import { useLayoutEffect } from 'react'
import { type Intersection, Object3D } from 'three'
import { EDITOR_HANDLE_HIT_AREA_USER_DATA_KEY } from '../../../lib/direct-manipulation'
import { EditorHandleHitPriority, prioritizeEditorHandleHits } from './handle-hit-priority'

function hit(name: string, distance: number, handle = false): Intersection {
  const object = new Object3D()
  object.name = name
  if (handle) object.userData[EDITOR_HANDLE_HIT_AREA_USER_DATA_KEY] = true
  return { object, distance, point: undefined as never }
}
const names = (hits: Intersection[]) => hits.map((entry) => entry.object.name)

test('a handle behind a wall comes first, so the hover goes where the press goes', () => {
  const hits = [hit('wall', 3), hit('floor', 5), hit('up', 6, true), hit('cube', 6.2, true)]
  expect(names(prioritizeEditorHandleHits(hits))).toEqual(['up', 'cube', 'wall', 'floor'])
})

test('without a handle on the ray the order is untouched', () => {
  const hits = [hit('wall', 3), hit('floor', 5)]
  expect(prioritizeEditorHandleHits(hits)).toBe(hits)
})

test('mounted, it is the canvas event filter; unmounted, the previous one comes back', async () => {
  let state: RootState | null = null
  const Probe = () => {
    state = useThree((root) => root)
    return null
  }
  const previous = (hits: Intersection[]) => hits.filter((entry) => entry.object.name !== 'grid')
  const Previous = () => {
    const setEvents = useThree((root) => root.setEvents)
    useLayoutEffect(() => setEvents({ filter: previous }), [setEvents])
    return null
  }
  const before = await create(
    <>
      <Probe />
      <Previous />
    </>,
  )
  await before.update(
    <>
      <Probe />
      <Previous />
      <EditorHandleHitPriority />
    </>,
  )
  const hits = [hit('grid', 1), hit('wall', 3), hit('cube', 6, true)]
  const filter = (state as RootState | null)?.events.filter
  expect(names(filter!(hits, state!))).toEqual(['cube', 'wall'])
  await before.update(
    <>
      <Probe />
      <Previous />
    </>,
  )
  expect((state as RootState | null)?.events.filter).toBe(previous)
  await before.unmount()
})
