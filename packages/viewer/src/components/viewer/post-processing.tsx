import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Color, UnsignedByteType } from 'three'
import { outline } from 'three/addons/tsl/display/OutlineNode.js'
import { ssgi } from 'three/addons/tsl/display/SSGINode.js'
import { traa } from 'three/addons/tsl/display/TRAANode.js'
import {
  add,
  colorToDirection,
  diffuseColor,
  directionToColor,
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

const MAX_PIPELINE_RETRIES = 3
const RETRY_DELAY_MS = 500

const PostProcessingPasses = () => {
  const { gl: renderer, scene, camera } = useThree()
  const renderPipelineRef = useRef<RenderPipeline | null>(null)
  const hasPipelineErrorRef = useRef(false)
  const retryCountRef = useRef(0)
  const [isInitialized, setIsInitialized] = useState(false)

  // Subscribe to projectId so the pipeline rebuilds on project switch
  const projectId = useViewer((s) => s.projectId)

  // Bump this to force a pipeline rebuild (used by retry logic)
  const [pipelineVersion, setPipelineVersion] = useState(0)

  const requestPipelineRebuild = useCallback(() => {
    setPipelineVersion((v) => v + 1)
  }, [])

  // Renderer initialization
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

  // Reset retry count when project changes
  useEffect(() => {
    retryCountRef.current = 0
  }, [projectId])

  // Build / rebuild the post-processing pipeline
  useEffect(() => {
    if (!renderer || !scene || !camera || !isInitialized) {
      return
    }

    hasPipelineErrorRef.current = false

    // Clear outliner arrays synchronously to prevent stale Object3D refs
    // from the previous project leaking into the new pipeline's outline passes.
    const outliner = useViewer.getState().outliner
    outliner.selectedObjects.length = 0
    outliner.hoveredObjects.length = 0

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

      // Composite: scene * AO + diffuse * GI
      const compositePass = vec4(
        add(scenePassColor.rgb.mul(ao), scenePassDiffuse.rgb.mul(gi)),
        scenePassColor.a,
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
      const finalOutput = traa(compositeWithOutlines, scenePassDepth, scenePassVelocity, camera)

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
  }, [renderer, scene, camera, isInitialized, projectId, pipelineVersion])

  useFrame(() => {
    if (hasPipelineErrorRef.current || !renderPipelineRef.current) {
      return
    }

    try {
      renderPipelineRef.current.render()
    } catch (error) {
      hasPipelineErrorRef.current = true
      console.error(
        '[viewer] Post-processing render pass failed.',
        error,
      )
      if (renderPipelineRef.current) {
        renderPipelineRef.current.dispose()
      }
      renderPipelineRef.current = null

      // Auto-retry: schedule a pipeline rebuild if we haven't exceeded the retry limit
      if (retryCountRef.current < MAX_PIPELINE_RETRIES) {
        retryCountRef.current++
        console.warn(
          `[viewer] Scheduling post-processing rebuild (attempt ${retryCountRef.current}/${MAX_PIPELINE_RETRIES})`,
        )
        setTimeout(requestPipelineRebuild, RETRY_DELAY_MS)
      } else {
        console.error(
          '[viewer] Post-processing retries exhausted. Rendering without post FX for this session.',
        )
      }
    }
  }, 1)

  return null
}

export default PostProcessingPasses
