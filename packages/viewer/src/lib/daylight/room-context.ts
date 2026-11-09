import {
  context,
  diffuseColor,
  Fn,
  If,
  max,
  normalWorld,
  positionWorld,
  uniform,
  vec3,
} from 'three/tsl'
import { daylightRooms } from './rooms'

type N = any

/** Window spill only: receivers darker than this albedo are lit as if they had it (decal-style). */
const spillAlbedoFloor = uniform(0.35)

/**
 * The daylight look's scene-pass lighting hooks: room light enters the material lighting as
 * indirect irradiance (`getGI`, × albedo, × contact AO), the room enclosure dims the sky IBL
 * (`getAO`), and outside surfaces receive the window spill and exterior lamps at night.
 *
 * Materials flagged `userData.noRooms` (the grounds) skip the room system: the dilated room
 * map reaches ~20 cm past the walls and would light a strip of lawn.
 */
export function daylightRoomContext(): N {
  const rooms = daylightRooms
  const room = rooms.probeRoomNode()
  const roomNode = rooms.lightingNode(room)
  const enclosure = roomNode.w
  const outsideMask = rooms.exteriorMaskNode(room)
  // GI is later × albedo, so near-black paving would swallow the pools: lift dark receivers for
  // the spill term only (like a light decal).
  const lum = diffuseColor.rgb.dot(vec3(0.2126, 0.7152, 0.0722)).max(1e-3)
  const albedoLift = lum.max(spillAlbedoFloor).div(lum)
  const spill = rooms.exteriorSpillNode(positionWorld, normalWorld).mul(albedoLift)
  const exteriorLamps = rooms.exteriorLampsNode(positionWorld, normalWorld)
  // Inside a room the outside terms are masked to nothing anyway: skip their loops there.
  const outsideLight = Fn(() => {
    const light = vec3(0).toVar()
    If(outsideMask.greaterThan(0), () => {
      light.assign(spill.add(exteriorLamps).mul(outsideMask))
    })
    return light
  })()

  return context({
    getAO: (input: N, { material }: N) => {
      if (material.transparent === true) return input
      if (material.userData.noRooms) return input
      return input !== null ? input.mul(enclosure) : enclosure
    },
    getGI: (input: N, { material }: N) => {
      if (material.transparent === true) return input
      // The lighting model multiplies GI by the AO term again: undo it so room light keeps only
      // the contact AO, and outside terms aren't dimmed by an enclosure they don't sit in.
      let gi: N
      if (material.userData.noRooms) gi = spill.add(exteriorLamps)
      else gi = outsideLight.add(roomNode.xyz).div(max(enclosure, 1e-3))
      return input !== null ? input.add(gi) : gi
    },
  })
}
