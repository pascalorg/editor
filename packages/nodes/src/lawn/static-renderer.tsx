'use client'

import type { GeometryContext, LawnNode } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Group } from 'three'
import { buildLawnGeometry, disposeLawnGeometry } from './geometry'
import { updateLawnLOD } from './lod'

export function buildLawnReplacementGeometry(
  nodes: LawnNode[],
  resolve?: GeometryContext['resolve'],
): Group {
  const group = new Group()
  group.name = 'lawn-replacement'
  for (const node of nodes) group.add(buildLawnGeometry(node, { resolve }))
  return group
}

export default function LawnStaticRenderer({
  nodes,
  resolve,
}: {
  nodes: LawnNode[]
  resolve?: GeometryContext['resolve']
}) {
  const group = useMemo(() => buildLawnReplacementGeometry(nodes, resolve), [nodes, resolve])
  useEffect(() => () => disposeLawnGeometry(group), [group])
  useFrame(({ scene, camera, size }) => {
    updateLawnLOD(scene, camera, size.height)
  })
  return <primitive object={group} />
}
