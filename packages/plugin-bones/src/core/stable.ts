/**
 * Platform-stable numbers at the engine boundary.
 *
 * JavaScriptCore takes sin/cos/atan2 from the platform's libm, so a rotated
 * member's position or length can come out 1e-16 apart between macOS and
 * Windows. That is invisible on paper but it breaks the byte-equality pins
 * that guard the engines' blast radius (the roof valley pin and the E5 master
 * baseline were captured on one platform and could never match on the
 * other), and it is what prints "1.0000000000000002" on a schedule. Every
 * length in metres is rounded to a nanometre here; a value that is already
 * exact keeps its shortest representation, and -0 becomes 0. Rotations are
 * left alone: they come straight from atan2 of the inputs, and the host's
 * yaw handling compares them to the same platform's atan2 exactly.
 */
import type { Fixture, Member } from './types'

export function q(value: number): number {
  return Math.round(value * 1e9) / 1e9 + 0
}

export function q3(v: readonly [number, number, number]): [number, number, number] {
  return [q(v[0]), q(v[1]), q(v[2])]
}

export function stableMembers(list: readonly Member[]): Member[] {
  return list.map((m) => ({
    ...m,
    dims: q3(m.dims),
    length: q(m.length),
    position: q3(m.position),
  }))
}

export function stableFixtures(list: readonly Fixture[]): Fixture[] {
  return list.map((f) => ({ ...f, position: q3(f.position) }))
}
