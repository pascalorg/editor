import { Group } from 'three'
import type { AssemblyNode } from './schema'

export function buildAssemblyGeometry(_node: AssemblyNode): Group {
  return new Group()
}
