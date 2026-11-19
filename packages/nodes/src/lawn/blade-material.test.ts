import { expect, test } from 'bun:test'
import { type AnyNode, type GeometryContext, LawnNode, SiteNode } from '@pascal-app/core'
import { Mesh, PerspectiveCamera, RenderTarget, Scene } from 'three'
import { mrt, output, velocity } from 'three/tsl'
import { WebGPURenderer } from 'three/webgpu'
import { lawnBladeMaterial } from './blade-material'
import { buildLawnGeometry, disposeLawnGeometry } from './geometry'

test('tuft silhouettes use cutouts without alpha-to-coverage fringes', () => {
  const lawn = LawnNode.parse({
    outline: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
  })
  const material = lawnBladeMaterial(lawn, 20)
  try {
    expect(material.alphaToCoverage).toBe(false)
    expect(material.alphaTest).toBe(0.32)
    expect(material.opacityNode).toBeDefined()
    expect(material.maskShadowNode).toBeDefined()
  } finally {
    material.dispose()
  }
})

// The renderer's own node build of a real blade mesh, without initialising a GPU (the hedge
// test's seam). `temporal` adds the velocity attachment a temporal anti-aliasing pass asks for.
function bladeVertexShader(temporal: boolean): string {
  const lawn = LawnNode.parse({
    id: 'lawn_blades',
    parentId: 'site_blades',
    outline: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
  })
  const site = SiteNode.parse({
    id: 'site_blades',
    children: [lawn.id],
    polygon: { type: 'polygon', points: lawn.outline },
  })
  const nodes: Record<string, AnyNode> = { [site.id]: site, [lawn.id]: lawn }
  const resolve: GeometryContext['resolve'] = <N = AnyNode>(id: string) =>
    nodes[id] as N | undefined
  const group = buildLawnGeometry(lawn, { parent: site, sceneNodes: nodes, resolve })
  try {
    let blades: Mesh | undefined
    group.traverse((object) => {
      if (!blades && object instanceof Mesh && object.name.startsWith('lawn-blades-near'))
        blades = object
    })
    if (!blades) throw new Error('A lawn builds blade meshes')
    const canvas = { width: 64, height: 64, style: {}, addEventListener() {} }
    const renderer = new WebGPURenderer({ canvas: canvas as unknown as HTMLCanvasElement })
    renderer.hasFeature = () => false
    renderer.backend.capabilities.getUniformBufferLimit = () => 65536
    ;(renderer as unknown as { _bindings?: unknown })._bindings = undefined
    if (temporal) {
      renderer.setMRT(mrt({ output, velocity }))
      renderer.setRenderTarget(new RenderTarget(8, 8, { count: 2 }))
    }
    const builder = renderer.backend.createNodeBuilder(blades, renderer)
    builder.camera = new PerspectiveCamera()
    builder.scene = new Scene()
    builder.clippingContext = null
    builder.build()
    return builder.vertexShader
  } finally {
    disposeLawnGeometry(group)
  }
}

/** The last value the vertex stage writes to a position, as the shader's own expression. */
function lastWrite(shader: string, name: string): string | undefined {
  const writes = [...shader.matchAll(new RegExp(`\\b${name} = (.+);`, 'g'))]
  return writes.at(-1)?.[1]
}

test('a temporal pass gets the placed blade as its previous position, not the unplaced tuft', () => {
  const shader = bladeVertexShader(true)
  const placed = lastWrite(shader, 'positionLocal')
  const previous = lastWrite(shader, 'positionPrevious')
  expect(placed).toBeDefined()
  // three's own previous position ignores `positionNode`: left alone, a blade at rest reports a
  // motion of hundreds of pixels (from the lawn's origin) and the temporal pass loses its history.
  expect(placed).not.toBe('position')
  expect(previous).toBe(placed as string)
})

test('blades carry no previous position when no pass asks for velocity', () => {
  expect(bladeVertexShader(false)).not.toContain('positionPrevious')
})
