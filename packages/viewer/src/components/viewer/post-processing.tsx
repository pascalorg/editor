import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { Color, Layers, UnsignedByteType } from 'three'
import { outline } from 'three/addons/tsl/display/OutlineNode.js'
import { ssgi } from 'three/addons/tsl/display/SSGINode.js'
import { traa } from 'three/addons/tsl/display/TRAANode.js'
import {
  add,
  colorToDirection,
  diffuseColor,
  directionToColor,
  float,
  mix,
  mrt,
  normalView,
  oscSine,
  output,
  pass,
  sample,
  time,
  uniform,
  vec4,
  velocity,
} from 'three/tsl'

import { RenderPipeline, type WebGPURenderer } from 'three/webgpu'
import useViewer from '../../store/use-viewer'

// SSGI Parameters - adjust these to fine-tune global illumination and ambient occlusion
export const SSGI_PARAMS = {
  enabled: true,
  sliceCount: 2,
  stepCount: 8,
  radius: 1,
  expFactor: 1.5,
  thickness: 0.5,
  backfaceLighting: 0.5,
  aoIntensity: 1.5,
  giIntensity: 0.5,
  useLinearThickness: false,
  useScreenSpaceSampling: true,
  useTemporalFiltering: true,
}

const DARK_BG = '#1f2433'
const LIGHT_BG = '#ffffff'

const PostProcessingPasses = () => {
  const { gl: renderer, scene, camera } = useThree()
  const renderPipelineRef = useRef<RenderPipeline | null>(null)
  const hasPipelineErrorRef = useRef(false)
  const [isInitialized, setIsInitialized] = useState(false)

  const theme = useViewer((s) => s.theme)

  // Background color uniform — updated every frame via lerp, read by the TSL pipeline.
  // Initialised from the current theme so there's no flash on first render.
  const initBg = theme === 'dark' ? DARK_BG : LIGHT_BG
  const bgUniform = useRef(uniform(new Color(initBg)))
  const bgCurrent = useRef(new Color(initBg))
  const bgTarget = useRef(new Color())

  useEffect(() => {
    let mounted = true

    const initRenderer = async () => {
      try {
        if (renderer && (renderer as any).init) {
          await (renderer as any).init()
        }

        if (mounted) {
          setIsInitialized(true)
        }
      } catch (error) {
        console.error('[viewer] Failed to initialize renderer for post-processing.', error)
        if (mounted) {
          setIsInitialized(false)
        }
      }
    }

    initRenderer()

    return () => {
      mounted = false
    }
  }, [renderer])

  useEffect(() => {
    if (!renderer || !scene || !camera || !isInitialized) {
      return
    }

    hasPipelineErrorRef.current = false

    try {
      // Scene pass with MRT for SSGI
      const scenePass = pass(scene, camera)
      scenePass.setMRT(
        mrt({
          output: output,
          diffuseColor: diffuseColor,
          normal: directionToColor(normalView),
          velocity: velocity,
        }),
      )

      // Get texture outputs
      const scenePassColor = scenePass.getTextureNode('output')
      const scenePassDiffuse = scenePass.getTextureNode('diffuseColor')
      const scenePassDepth = scenePass.getTextureNode('depth')
      const scenePassNormal = scenePass.getTextureNode('normal')
      const scenePassVelocity = scenePass.getTextureNode('velocity')

      // Optimize texture bandwidth
      const diffuseTexture = scenePass.getTexture('diffuseColor')
      diffuseTexture.type = UnsignedByteType

      const normalTexture = scenePass.getTexture('normal')
      normalTexture.type = UnsignedByteType

      // Extract normal from color-encoded texture
      const sceneNormal = sample((uv) => {
        return colorToDirection(scenePassNormal.sample(uv))
      })

      // camera.layers.disable(0)
      // camera.layers.disable(1)
      // camera.layers.enable(2) // Enable layer 2 for zone rendering
      const zonePass = pass(scene, camera)
      // camera.layers.enable(0) // Disable layer 2 for main scene rendering
      // camera.layers.enable(1) // Disable layer 2 for main scene rendering
      // camera.layers.disable(2) // Disable layer 2 for main scene rendering

      const layers: Layers = new Layers()
      layers.enable(2) // Enable layer 2 for zone rendering
      layers.disable(0)
      zonePass.setLayers(layers)
      // SSGI Pass (cast to PerspectiveCamera for SSGI)
      const giPass = ssgi(scenePassColor, scenePassDepth, sceneNormal, camera as any)

      giPass.sliceCount.value = SSGI_PARAMS.sliceCount
      giPass.stepCount.value = SSGI_PARAMS.stepCount
      giPass.radius.value = SSGI_PARAMS.radius
      giPass.expFactor.value = SSGI_PARAMS.expFactor
      giPass.thickness.value = SSGI_PARAMS.thickness
      giPass.backfaceLighting.value = SSGI_PARAMS.backfaceLighting
      giPass.aoIntensity.value = SSGI_PARAMS.aoIntensity
      giPass.giIntensity.value = SSGI_PARAMS.giIntensity
      giPass.useLinearThickness.value = SSGI_PARAMS.useLinearThickness
      giPass.useScreenSpaceSampling.value = SSGI_PARAMS.useScreenSpaceSampling
      giPass.useTemporalFiltering = SSGI_PARAMS.useTemporalFiltering

      // Extract GI and AO from SSGI pass
      const gi = giPass.rgb
      const ao = giPass.a

      // Background detection via alpha: renderer clears with alpha=0 (setClearAlpha(0) in useFrame),
      // so background pixels have scenePassColor.a=0 while geometry pixels have output.a=1.
      // WebGPU only applies clearColorValue to MRT attachment 0 (output), so scenePassColor.a
      // is the reliable geometry mask — no normals, no flicker.
      const hasGeometry = scenePassColor.a
      const contentAlpha = hasGeometry.max(zonePass.a)

      // Composite: scene * AO + diffuse * GI
      const compositePass = vec4(
        add(scenePassColor.rgb.mul(ao), add(zonePass.rgb, scenePassDiffuse.rgb.mul(gi))),
        contentAlpha,
      )

      function generateSelectedOutlinePass() {
        const edgeStrength = uniform(3)
        const edgeGlow = uniform(0)
        const edgeThickness = uniform(1)
        const visibleEdgeColor = uniform(new Color(0xffffff))
        const hiddenEdgeColor = uniform(new Color(0xf3ff47))

        const outlinePass = outline(scene, camera, {
          selectedObjects: useViewer.getState().outliner.selectedObjects,
          edgeGlow,
          edgeThickness,
        })
        const { visibleEdge, hiddenEdge } = outlinePass

        const outlineColor = visibleEdge
          .mul(visibleEdgeColor)
          .add(hiddenEdge.mul(hiddenEdgeColor))
          .mul(edgeStrength)

        return outlineColor
      }

      function generateHoverOutlinePass() {
        const edgeStrength = uniform(5)
        const edgeGlow = uniform(0.5)
        const edgeThickness = uniform(1.5)
        const pulsePeriod = uniform(3)
        const visibleEdgeColor = uniform(new Color(0x00aaff))
        const hiddenEdgeColor = uniform(new Color(0xf3ff47))

        const outlinePass = outline(scene, camera, {
          selectedObjects: useViewer.getState().outliner.hoveredObjects,
          edgeGlow,
          edgeThickness,
        })
        const { visibleEdge, hiddenEdge } = outlinePass

        const period = time.div(pulsePeriod).mul(2)
        const osc = oscSine(period).mul(0.5).add(0.5) // osc [ 0.5, 1.0 ]

        const outlineColor = visibleEdge
          .mul(visibleEdgeColor)
          .add(hiddenEdge.mul(hiddenEdgeColor))
          .mul(edgeStrength)
        const outlinePulse = pulsePeriod.greaterThan(0).select(outlineColor.mul(osc), outlineColor)

        return outlinePulse
      }

      const selectedOutlinePass = generateSelectedOutlinePass()
      const hoverOutlinePass = generateHoverOutlinePass()

      // Combine composite with outlines BEFORE applying TRAA
      const compositeWithOutlines = SSGI_PARAMS.enabled
        ? vec4(add(compositePass.rgb, selectedOutlinePass.add(hoverOutlinePass)), compositePass.a)
        : vec4(add(scenePassColor.rgb, selectedOutlinePass.add(hoverOutlinePass)), scenePassColor.a)

      // TRAA (Temporal Reprojection Anti-Aliasing) - applied AFTER combining everything
      const traaOutput = traa(compositeWithOutlines, scenePassDepth, scenePassVelocity, camera)

      // For zone-over-background pixels, scenePassDepth=1.0 (no scene geometry) causes TRAA
      // to output black. Use hasGeometry to blend: geometry pixels use traaRgb, all others
      // (zones over background, pure background) use compositePass.rgb directly.
      const traaRgb = (traaOutput as any).rgb
      const colorSource = mix(compositePass.rgb, traaRgb, hasGeometry)
      const finalOutput = vec4(
        mix(bgUniform.current, colorSource, contentAlpha),
        float(1),
      )

      const renderPipeline = new RenderPipeline(renderer as unknown as WebGPURenderer)
      renderPipeline.outputNode = finalOutput
      renderPipelineRef.current = renderPipeline
    } catch (error) {
      hasPipelineErrorRef.current = true
      console.error(
        '[viewer] Failed to set up post-processing pipeline. Rendering without post FX.',
        error,
      )
      if (renderPipelineRef.current) {
        renderPipelineRef.current.dispose()
      }
      renderPipelineRef.current = null
    }

    return () => {
      if (renderPipelineRef.current) {
        renderPipelineRef.current.dispose()
      }
      renderPipelineRef.current = null
    }
  }, [renderer, scene, camera, isInitialized])

  useFrame((_, delta) => {
    // Animate background colour toward the current theme target (same lerp as AnimatedBackground)
    bgTarget.current.set(theme === 'dark' ? DARK_BG : LIGHT_BG)
    bgCurrent.current.lerp(bgTarget.current, Math.min(delta, 0.1) * 4)
    bgUniform.current.value.copy(bgCurrent.current)

    if (hasPipelineErrorRef.current || !renderPipelineRef.current) {
      return
    }

    try {
      // Clear alpha=0 so background pixels in the output MRT attachment (index 0) get a=0,
      // making scenePassColor.a a reliable geometry mask (geometry pixels write a=1 via output node).
      ;(renderer as any).setClearAlpha(0)
      renderPipelineRef.current.render()
    } catch (error) {
      hasPipelineErrorRef.current = true
      console.error(
        '[viewer] Post-processing render pass failed. Disabling post FX for this session.',
        error,
      )
      renderPipelineRef.current.dispose()
      renderPipelineRef.current = null
    }
  }, 1)

  return null
}

export default PostProcessingPasses
