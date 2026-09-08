'use client'

import { sceneRegistry, useScene } from '@pascal-app/core'
import { CATALOG_ITEMS } from '@pascal-app/editor'
import { useEffect } from 'react'
import { Box3 } from 'three'
import { HoltmontImportError, normalizeHoltmontScene } from '../lib/holtmont-import'

export function HoltmontBridge() {
  useEffect(() => {
    const isIframe = window.parent !== window.self

    function postToParent(payload: Record<string, unknown>) {
      if (isIframe) {
        window.parent.postMessage(payload, '*')
      }
    }

    function handleMessage(event: MessageEvent) {
      const data = event.data as Record<string, unknown> | null
      if (!data || data.type !== 'HOLTMONT_3D_IMPORT') return

      let scene: ReturnType<typeof normalizeHoltmontScene>
      try {
        // Valida contra el esquema real del editor antes de tocar el store: un
        // nodo mal formado revienta después, dentro del bucle de render, y ahí
        // ya no hay forma de avisar — solo queda el lienzo en negro.
        scene = normalizeHoltmontScene(data.projectData, CATALOG_ITEMS)
      } catch (err) {
        const reason = err instanceof HoltmontImportError ? err.message : String(err)
        console.error('[HoltmontBridge] HOLTMONT_3D_IMPORT rechazado:', reason)
        // La escena que ya estaba montada se queda como está: sustituirla por
        // una vacía convierte un import fallido en una pantalla negra.
        postToParent({ type: 'HOLTMONT_3D_IMPORT_ERROR', reason, dropped: [] })
        return
      }

      try {
        console.log('[HoltmontBridge] HOLTMONT_3D_IMPORT recibido:', {
          nodeCount: Object.keys(scene.nodes).length,
          rootNodeIds: scene.rootNodeIds,
          dropped: scene.dropped,
        })

        // setScene corre migraciones, quita huérfanos, marca todo sucio y avisa
        // a los suscriptores.
        useScene.getState().setScene(scene.nodes, scene.rootNodeIds)

        // setScene siempre deja collections en {}; se restauran si venían.
        if (Object.keys(scene.collections).length > 0) {
          useScene.setState({ collections: scene.collections as never })
        }

        postToParent({
          type: 'HOLTMONT_3D_IMPORT_ACK',
          nodeCount: Object.keys(scene.nodes).length,
          dropped: scene.dropped,
        })
      } catch (err) {
        console.error('[HoltmontBridge] No se pudo aplicar la escena importada:', err)
        postToParent({
          type: 'HOLTMONT_3D_IMPORT_ERROR',
          reason: String(err),
          dropped: scene.dropped,
        })
      }
    }

    window.addEventListener('message', handleMessage)

    // Sonda de diagnóstico: dice qué se dibujó de verdad, no qué se guardó.
    // La usa la prueba de humo (`scripts/holtmont-smoke.mjs`) para distinguir
    // «la escena está en el store» de «la escena tiene geometría en pantalla»,
    // que es justo la diferencia entre el bug del lienzo negro y el arreglo.
    ;(window as unknown as Record<string, unknown>).__holtmontProbe = () => {
      const nodes = useScene.getState().nodes
      const resumen: Record<string, { total: number; conGeometria: number }> = {}
      let mayorLado = 0

      for (const [tipo, ids] of Object.entries(sceneRegistry.byType)) {
        const entrada = { total: 0, conGeometria: 0 }
        for (const id of ids) {
          if (!nodes[id as keyof typeof nodes]) continue
          entrada.total += 1
          const objeto = sceneRegistry.nodes.get(id)
          if (!objeto) continue
          const caja = new Box3().setFromObject(objeto)
          if (caja.isEmpty()) continue
          const lado = Math.max(
            caja.max.x - caja.min.x,
            caja.max.y - caja.min.y,
            caja.max.z - caja.min.z,
          )
          if (lado > 0.01) {
            entrada.conGeometria += 1
            mayorLado = Math.max(mayorLado, lado)
          }
        }
        if (entrada.total > 0) resumen[tipo] = entrada
      }

      return { nodos: Object.keys(nodes).length, porTipo: resumen, mayorLado }
    }

    // Avisa al padre que el editor ya puede recibir escenas.
    postToParent({ type: 'PASCAL_READY' })
    console.log('[HoltmontBridge] Listener montado — PASCAL_READY enviado')

    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [])

  return null
}
