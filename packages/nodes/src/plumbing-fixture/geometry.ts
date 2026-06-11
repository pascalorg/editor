import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'
import type { PlumbingFixtureNode } from './schema'
import { FIXTURE_SPECS } from './spec'

const PORCELAIN = '#f4f4f2'
const STEEL = '#d7dade'
const CHROME = '#9aa1a8'
const APPLIANCE_DARK = '#3f4549'

const SEGMENTS = 20

/**
 * Pure geometry builder for a plumbing fixture, in the node's LOCAL
 * frame (origin at base center, +Z toward the room) —
 * `<ParametricNodeRenderer>` applies position + yaw.
 *
 * Deliberately simple silhouettes: enough to read each fixture at a
 * glance (tank + bowl toilet, pedestal lav, counter sink, low tub,
 * front-load washer) without item-catalog detail.
 */
export function buildPlumbingFixtureGeometry(node: PlumbingFixtureNode): Group {
  const group = new Group()
  const spec = FIXTURE_SPECS[node.fixtureType]
  const [w, h, d] = spec.size

  const porcelain = new MeshStandardMaterial({ color: PORCELAIN, metalness: 0.05, roughness: 0.3 })
  const steel = new MeshStandardMaterial({ color: STEEL, metalness: 0.6, roughness: 0.35 })
  const chrome = new MeshStandardMaterial({ color: CHROME, metalness: 0.7, roughness: 0.3 })
  const dark = new MeshStandardMaterial({ color: APPLIANCE_DARK, metalness: 0.3, roughness: 0.6 })

  const box = (
    bw: number,
    bh: number,
    bd: number,
    mat: MeshStandardMaterial,
    x: number,
    y: number,
    z: number,
    name: string,
  ) => {
    const mesh = new Mesh(new BoxGeometry(bw, bh, bd), mat)
    mesh.position.set(x, y, z)
    mesh.name = name
    group.add(mesh)
    return mesh
  }

  switch (node.fixtureType) {
    case 'toilet': {
      // Tank at the back, bowl forward, base pedestal.
      box(w, 0.4, 0.14, porcelain, 0, 0.55, -d / 2 + 0.07, 'fixture-tank')
      const bowl = new Mesh(new SphereGeometry(0.19, SEGMENTS, 12), porcelain)
      bowl.scale.set(1, 0.55, 1.25)
      bowl.position.set(0, 0.4, 0.08)
      bowl.name = 'fixture-bowl'
      group.add(bowl)
      const base = new Mesh(new CylinderGeometry(0.1, 0.13, 0.38, SEGMENTS), porcelain)
      base.position.set(0, 0.19, 0.05)
      base.name = 'fixture-base'
      group.add(base)
      break
    }
    case 'lavatory': {
      const pedestal = new Mesh(new CylinderGeometry(0.06, 0.09, h - 0.12, SEGMENTS), porcelain)
      pedestal.position.set(0, (h - 0.12) / 2, 0)
      pedestal.name = 'fixture-pedestal'
      group.add(pedestal)
      const basin = new Mesh(new CylinderGeometry(w / 2, w / 2 - 0.06, 0.12, SEGMENTS), porcelain)
      basin.position.set(0, h - 0.06, 0)
      basin.name = 'fixture-basin'
      group.add(basin)
      const spout = new Mesh(new CylinderGeometry(0.012, 0.012, 0.12, 10), chrome)
      spout.position.set(0, h + 0.05, -w / 2 + 0.08)
      spout.name = 'fixture-spout'
      group.add(spout)
      break
    }
    case 'kitchen-sink': {
      box(w, h - 0.05, d, steel, 0, (h - 0.05) / 2, 0, 'fixture-cabinet')
      // Basin recess rim on top.
      const rim = new Mesh(new BoxGeometry(w * 0.8, 0.04, d * 0.7), dark)
      rim.position.set(0, h - 0.02, 0.02)
      rim.name = 'fixture-basin'
      group.add(rim)
      const faucet = new Mesh(new CylinderGeometry(0.015, 0.015, 0.22, 10), chrome)
      faucet.position.set(0, h + 0.09, -d / 2 + 0.08)
      faucet.name = 'fixture-faucet'
      group.add(faucet)
      break
    }
    case 'tub': {
      box(w, h, d, porcelain, 0, h / 2, 0, 'fixture-tub')
      // Inner recess hint.
      const recess = new Mesh(new BoxGeometry(w - 0.12, 0.03, d - 0.12), dark)
      recess.position.set(0, h - 0.015, 0)
      recess.name = 'fixture-recess'
      group.add(recess)
      break
    }
    case 'washer': {
      box(w, h, d, steel, 0, h / 2, 0, 'fixture-body')
      const door = new Mesh(new TorusGeometry(0.16, 0.025, 10, SEGMENTS), dark)
      door.position.set(0, h * 0.5, d / 2 + 0.005)
      door.name = 'fixture-door'
      group.add(door)
      break
    }
  }

  // Drain rough-in marker — a small dark cylinder at the waste port, so
  // the connection point reads in 3D even before a pipe is drawn.
  const drain = new Mesh(new CylinderGeometry(0.03, 0.03, 0.02, 12), dark)
  drain.position.copy(new Vector3(...spec.drainLocal))
  drain.name = 'fixture-drain'
  group.add(drain)

  return group
}
