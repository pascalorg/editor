import {
  context,
  diffuseColor,
  float,
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
 * `screenAO` is the high tier's GTAO (indirect light only); null on the other tiers.
 *
 * Materials flagged `userData.noRooms` (the grounds) skip the room system: the dilated room
 * map reaches ~20 cm past the walls and would light a strip of lawn.
 */
export function daylightRoomContext(screenAO: N | null): N {
  const rooms = daylightRooms
  const roomNode = rooms.lightingNode()
  const enclosure = roomNode.w
  const outsideMask = rooms.exteriorMaskNode()
  // GI is later × albedo, so near-black paving would swallow the pools: lift dark receivers for
  // the spill term only (like a light decal).
  const lum = diffuseColor.rgb.dot(vec3(0.2126, 0.7152, 0.0722)).max(1e-3)
  const albedoLift = lum.max(spillAlbedoFloor).div(lum)
  const spill = rooms.exteriorSpillNode(positionWorld, normalWorld).mul(albedoLift)
  const exteriorLamps = rooms.exteriorLampsNode(positionWorld, normalWorld)

  const aoTerm = screenAO ? screenAO.mul(enclosure) : enclosure
  const aoNoRoom = screenAO ?? float(1)

  return context({
    getAO: (input: N, { material }: N) => {
      if (material.transparent === true) return input
      const ao = material.userData.noRooms ? aoNoRoom : aoTerm
      return input !== null ? input.mul(ao) : ao
    },
    getGI: (input: N, { material }: N) => {
      if (material.transparent === true) return input
      // The lighting model multiplies GI by the AO term again: undo it so room light keeps only
      // the contact AO, and outside terms aren't dimmed by an enclosure they don't sit in.
      let gi: N
      if (material.userData.noRooms) {
        const ao = max(aoNoRoom, 1e-3)
        gi = spill.add(exteriorLamps).div(ao)
      } else {
        const ao = max(aoTerm, 1e-3)
        gi = spill
          .add(exteriorLamps)
          .mul(outsideMask)
          .div(ao)
          .add(roomNode.xyz.div(max(enclosure, 1e-3)))
      }
      return input !== null ? input.add(gi) : gi
    },
  })
}
