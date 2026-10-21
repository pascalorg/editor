'use client'

import { type AnyNode, nodeRegistry, useScene } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Vector3 } from 'three'

export default function DuctCollarInspector({ node }: { node: AnyNode }) {
  const nodes = useScene((state) => state.nodes)
  const ports = nodeRegistry.get(node.type)?.ports?.(node) ?? []
  const others = Object.values(nodes)
    .filter((other) => other.id !== node.id && other.parentId === node.parentId)
    .flatMap((other) => nodeRegistry.get(other.type)?.ports?.(other) ?? [])
  const airPorts = ports.filter((port) => port.system === 'supply' || port.system === 'return')
  if (!airPorts.length) return null
  return (
    <section className="space-y-2 border-t pt-3">
      <h3 className="text-sm font-medium">Connect duct</h3>
      {airPorts.map((port) => {
        const occupied = others.some(
          (other) =>
            new Vector3(...other.position).distanceTo(new Vector3(...port.position)) < 0.005 &&
            new Vector3(...other.direction).dot(new Vector3(...port.direction)) < -0.99,
        )
        const size =
          port.shape && port.shape !== 'round'
            ? `${port.width} × ${port.height}`
            : `${port.diameter}`
        return (
          <button
            key={port.id}
            type="button"
            disabled={occupied}
            className="block w-full rounded border px-2 py-1 text-left text-xs disabled:opacity-50"
            onClick={() => {
              const editor = useEditor.getState()
              editor.setToolDefaults('duct-segment', {
                ...editor.toolDefaults['duct-segment'],
                continuation: { nodeId: node.id, portId: port.id },
                shape: port.shape ?? 'round',
                diameter: port.diameter,
                width: port.width ?? 14,
                height: port.height ?? 8,
                system: port.system,
                ductMaterial: 'sheet-metal',
                elevation: port.position[1],
                routingMode:
                  Math.hypot(port.direction[0], port.direction[2]) < 1e-6
                    ? 'vertical'
                    : 'horizontal',
                targetElevation: port.position[1] + Math.sign(port.direction[1] || 1),
                crossingMode: 'connect',
              })
              useViewer.getState().setSelection({ selectedIds: [] })
              editor.setTool('duct-segment')
            }}
          >
            {port.system === 'return' ? 'Return' : 'Supply'} · {size} in ·{' '}
            {occupied ? 'Connected' : 'Draw from collar'}
          </button>
        )
      })}
    </section>
  )
}
