'use client'

import { RoofSystem } from '@pascal-app/viewer'
import { glazedRoofGeometryAdapter } from './glazed-geometry'

export default function RoofSystems() {
  return <RoofSystem geometryAdapter={glazedRoofGeometryAdapter} />
}
