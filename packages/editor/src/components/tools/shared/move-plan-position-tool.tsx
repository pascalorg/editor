'use client'



import '../../../three-types'



import {

  type AnyNode,

  type AnyNodeId,

  type StairNode,

  emitter,

  sceneRegistry,

  useScene,

} from '@pascal-app/core'

import { useCallback, useEffect, useMemo, useRef } from 'react'

import { lastGridMoveRef } from '../../../hooks/use-grid-events'

import { markToolCancelConsumed } from '../../../hooks/use-keyboard'

import { floorItemDragSuppressClickRef } from '../../../lib/floor-item-drag'

import {

  clearPlanDragLiveTransform,

  schedulePlanDragLiveTransform,

} from '../../../lib/plan-drag-live'

import { sfxEmitter } from '../../../lib/sfx-bus'

import useEditor from '../../../store/use-editor'

import { snapToHalf } from '../item/placement-math'



type PositionNode = Pick<AnyNode, 'id' | 'type'> & {

  position: [number, number, number]

  rotation: number | [number, number, number]

}



function getRotationY(rotation: PositionNode['rotation']): number {

  if (typeof rotation === 'number') return rotation

  return rotation[1] ?? 0

}



/**

 * Plan X/Z drag for nodes with a level-local `position` tuple (stairs, etc.).

 * Y is preserved — adjust height in the inspector.

 */

export function MovePlanPositionTool({ node }: { node: PositionNode }) {

  const originalPosition = useMemo(

    () => [...node.position] as [number, number, number],

    [node],

  )

  const originalRotationY = getRotationY(node.rotation)

  const lastPositionRef = useRef<[number, number, number]>(originalPosition)



  const exitMoveMode = useCallback(() => {

    useEditor.getState().setMovingNode(null)

  }, [])



  useEffect(() => {

    if (useEditor.getState().isFloorplanHovered) return



    useScene.temporal.getState().pause()

    let committed = false



    const mesh = sceneRegistry.nodes.get(node.id)

    const restoreRaycasts: Array<() => void> = []

    if (mesh) {

      mesh.traverse((child) => {

        const original = child.raycast

        child.raycast = () => {}

        restoreRaycasts.push(() => {

          child.raycast = original

        })

      })

    }



    const applyPosition = (position: [number, number, number]) => {

      lastPositionRef.current = position

      const liveMesh = sceneRegistry.nodes.get(node.id)

      if (liveMesh) {

        liveMesh.position.set(position[0], liveMesh.position.y, position[2])

      }

      schedulePlanDragLiveTransform(node.id, {

        position,

        rotation: originalRotationY,

      })

    }



    const onGridMove = (event: { localPosition: [number, number, number] }) => {

      const position: [number, number, number] = [

        snapToHalf(event.localPosition[0]),

        originalPosition[1],

        snapToHalf(event.localPosition[2]),

      ]

      applyPosition(position)

    }



    if (lastGridMoveRef.localPosition) {

      onGridMove({ localPosition: lastGridMoveRef.localPosition })

    }



    const commitAtCursor = () => {

      if (committed) return

      const position: [number, number, number] = [...lastPositionRef.current]



      if (useScene.getState().nodes[node.id]) {

        useScene.temporal.getState().resume()

        useScene.getState().updateNode(node.id, { position } as Partial<AnyNode>)

        useScene.getState().dirtyNodes.add(node.id as AnyNodeId)

        useScene.temporal.getState().pause()

        committed = true

      }



      applyPosition(position)

      clearPlanDragLiveTransform(node.id)

      floorItemDragSuppressClickRef.current = true

      sfxEmitter.emit('sfx:structure-build')

      exitMoveMode()

    }



    const onPointerUp = (event: PointerEvent) => {

      if (event.button !== 0) return

      commitAtCursor()

    }



    const onCancel = () => {

      const liveMesh = sceneRegistry.nodes.get(node.id)

      if (liveMesh) {

        liveMesh.position.set(originalPosition[0], liveMesh.position.y, originalPosition[2])

      }

      clearPlanDragLiveTransform(node.id)

      useScene.temporal.getState().resume()

      markToolCancelConsumed()

      exitMoveMode()

    }



    emitter.on('grid:move', onGridMove)

    window.addEventListener('pointerup', onPointerUp)

    emitter.on('tool:cancel', onCancel)



    return () => {

      emitter.off('grid:move', onGridMove)

      window.removeEventListener('pointerup', onPointerUp)

      emitter.off('tool:cancel', onCancel)

      for (const restore of restoreRaycasts) restore()

      if (!committed) {

        const liveMesh = sceneRegistry.nodes.get(node.id)

        if (liveMesh) {

          liveMesh.position.set(originalPosition[0], liveMesh.position.y, originalPosition[2])

        }

        clearPlanDragLiveTransform(node.id)

        useScene.temporal.getState().resume()

      }

    }

  }, [exitMoveMode, node, originalPosition, originalRotationY])



  return null

}



export function MovePlanStairTool({ node }: { node: StairNode }) {

  return <MovePlanPositionTool node={node} />

}

