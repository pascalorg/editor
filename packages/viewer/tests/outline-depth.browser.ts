import {
  FloatType,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGPUCoordinateSystem,
} from 'three'
import { pass } from 'three/tsl'
import { RenderPipeline, WebGPURenderer } from 'three/webgpu'
import { mergedOutline } from '../src/lib/merged-outline-node'

export async function runOutlineDepthChecks() {
  const results = []
  for (const samples of [0, 4]) {
    for (const format of ['depth24', 'depth32', 'reversed32']) {
      const renderer = new WebGPURenderer({
        antialias: true,
        reversedDepthBuffer: format === 'reversed32',
      })
      await renderer.init()
      renderer.setSize(64, 64)
      try {
        for (const projection of ['perspective', 'orthographic']) {
          for (const distance of [10, 30, 100]) {
            for (const tilt of [-0.6, 0, 0.6]) {
              for (const hidden of [false, true]) {
                const camera =
                  projection === 'perspective'
                    ? new PerspectiveCamera(50, 1, 0.1, 1000)
                    : new OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
                camera.coordinateSystem = WebGPUCoordinateSystem
                camera.updateProjectionMatrix()
                const scene = new Scene()
                const geometry = new PlaneGeometry(200, 200)
                const material = new MeshBasicMaterial()
                const surface = new Mesh(geometry, material)
                // Keep the flat 1 cm occlusion regression. Tilted occluders must
                // cover the whole MSAA footprint even at the farthest distance.
                const gap = tilt === 0 ? 0.01 : 2
                surface.position.z = -(distance + gap)
                surface.rotation.x = tilt
                scene.add(surface)
                if (hidden) {
                  const occluder = new Mesh(geometry, material)
                  occluder.position.z = -distance
                  occluder.rotation.x = tilt
                  scene.add(occluder)
                }
                // An explicit zero must override the renderer's four samples.
                const producer = pass(scene, camera, { samples })
                if (format === 'depth32') producer.getTexture('depth').type = FloatType
                const outline = mergedOutline(scene, camera, {
                  primaryObjects: [surface],
                  sceneDepthNode: producer.getTextureNode('depth'),
                })
                const pipeline = new RenderPipeline(renderer)
                pipeline.outputNode = outline.primaryVisibleEdge
                try {
                  pipeline.render()
                  const pixels = await renderer.readRenderTargetPixelsAsync(
                    (outline as any)._groupA.maskBuffer,
                    32,
                    32,
                    1,
                    1,
                  )
                  const observedHidden = pixels[1] > 127
                  results.push({
                    samples,
                    format,
                    projection,
                    distance,
                    tilt,
                    hidden,
                    observedHidden,
                    pass: observedHidden === hidden,
                  })
                } finally {
                  pipeline.dispose()
                  outline.dispose()
                  producer.dispose()
                  geometry.dispose()
                  material.dispose()
                }
              }
            }
          }
        }
      } finally {
        renderer.dispose()
      }
    }
  }
  return results
}
