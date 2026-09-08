/**
 * El contrato con el generador de escenas de HOLTMONT-PYTHON.
 *
 * Las escenas de `public/holtmont-fixtures/` las escribe
 * `scripts/generar_escenas_pascal.py` del repositorio de Holtmont, a partir de
 * las mismas descripciones que se prueban allá. Aquí se validan contra el Zod
 * de verdad del editor: si el generador vuelve a escribir un campo con la forma
 * equivocada —una puerta con `position: 0.5` en vez de `[x, y, z]`, que es lo
 * que dejaba el plano 3D en negro— esto se pone en rojo antes de que nadie
 * abra el iframe.
 *
 *   bun test apps/editor/lib/holtmont-import.test.ts
 */

import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type CatalogAsset, HoltmontImportError, normalizeHoltmontScene } from './holtmont-import'

const FIXTURES_DIR = join(import.meta.dir, '..', 'public', 'holtmont-fixtures')

const CATALOGO_DE_PRUEBA: CatalogAsset[] = [
  {
    id: 'double-bed',
    category: 'bedroom',
    name: 'Double Bed',
    thumbnail: '/items/double-bed/thumbnail.webp',
    src: '/items/double-bed/model.glb',
    dimensions: [1.6, 0.6, 2],
  },
  {
    id: 'office-table',
    category: 'office',
    name: 'Office Table',
    thumbnail: '/items/office-table/thumbnail.webp',
    src: '/items/office-table/model.glb',
    dimensions: [1.4, 0.75, 0.7],
  },
]

function leerFixture(nombre: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, `${nombre}.json`), 'utf-8'))
}

const NOMBRES_DE_FIXTURE = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith('.json') && f !== 'index.json')
  .map((f) => f.replace(/\.json$/, ''))

describe('escenas generadas por el agente de Holtmont', () => {
  test('el directorio de fixtures no está vacío', () => {
    expect(NOMBRES_DE_FIXTURE.length).toBeGreaterThan(0)
  })

  for (const nombre of NOMBRES_DE_FIXTURE) {
    test(`${nombre}: todos sus nodos pasan el esquema del editor`, () => {
      const escena = normalizeHoltmontScene(leerFixture(nombre), CATALOGO_DE_PRUEBA)

      // El único descarte tolerado es un mueble que no existe en el catálogo:
      // cualquier otro significa que el generador escribió algo que el editor
      // no sabe dibujar.
      const inesperados = escena.dropped.filter((d) => !d.reason.startsWith('sin asset'))
      expect(inesperados).toEqual([])

      expect(Object.keys(escena.nodes).length).toBeGreaterThan(0)
      expect(escena.rootNodeIds.length).toBeGreaterThan(0)
      for (const raiz of escena.rootNodeIds) {
        expect(escena.nodes[raiz]?.type).toBe('site')
      }
    })
  }

  test('cuarto-5x4-con-puerta: la puerta abre en su muro, en metros', () => {
    const escena = normalizeHoltmontScene(leerFixture('cuarto-5x4-con-puerta'), [])
    const nodos = Object.values(escena.nodes)
    const muros = nodos.filter((n) => n.type === 'wall')
    const puertas = nodos.filter((n) => n.type === 'door')

    expect(muros).toHaveLength(4)
    expect(puertas).toHaveLength(1)

    const puerta = puertas[0] as Extract<(typeof nodos)[number], { type: 'door' }>
    const muro = escena.nodes[puerta.parentId as string] as Extract<
      (typeof nodos)[number],
      { type: 'wall' }
    >
    expect(muro.type).toBe('wall')

    const largo = Math.hypot(muro.end[0] - muro.start[0], muro.end[1] - muro.start[1])
    expect(puerta.position[0]).toBeGreaterThanOrEqual(puerta.width / 2)
    expect(puerta.position[0]).toBeLessThanOrEqual(largo - puerta.width / 2)
    expect(puerta.position[1]).toBeCloseTo(puerta.height / 2, 6)
    // Los valores por defecto que `setScene` no rellena y `DoorSystem` sí usa.
    expect(puerta.segments.length).toBeGreaterThan(0)
    expect(typeof puerta.frameThickness).toBe('number')
  })

  test('casa-dos-pisos: dos niveles, escalera con tramo y techo con tramo', () => {
    const escena = normalizeHoltmontScene(leerFixture('casa-dos-pisos-ventanas-frente-y-atras'), [])
    const nodos = Object.values(escena.nodes)
    const porTipo = (tipo: string) => nodos.filter((n) => n.type === tipo)

    expect(porTipo('level')).toHaveLength(2)
    expect(porTipo('wall')).toHaveLength(8)
    expect(porTipo('window')).toHaveLength(4)
    expect(porTipo('stair')).toHaveLength(1)
    expect(porTipo('stair-segment')).toHaveLength(1)
    expect(porTipo('roof')).toHaveLength(1)
    expect(porTipo('roof-segment')).toHaveLength(1)

    // Un grupo sin tramos aparece en el árbol y no se dibuja.
    for (const grupo of [...porTipo('stair'), ...porTipo('roof')]) {
      expect((grupo as { children: string[] }).children.length).toBeGreaterThan(0)
    }
  })

  test('cuarto-amueblado: el mueble del catálogo entra y el desconocido se descarta', () => {
    const escena = normalizeHoltmontScene(leerFixture('cuarto-amueblado'), CATALOGO_DE_PRUEBA)
    const items = Object.values(escena.nodes).filter((n) => n.type === 'item')

    expect(items).toHaveLength(2)
    for (const item of items) {
      expect((item as { asset: { src: string } }).asset.src).toContain('.glb')
    }
    expect(escena.dropped.some((d) => d.reason.includes('unicornio'))).toBe(true)
    // El nivel no puede quedarse con el id del mueble descartado colgando.
    const nivel = Object.values(escena.nodes).find((n) => n.type === 'level') as {
      children: string[]
    }
    for (const hijo of nivel.children) {
      expect(escena.nodes[hijo]).toBeDefined()
    }
  })
})

describe('escenas rotas', () => {
  function escenaBase() {
    return JSON.parse(JSON.stringify(leerFixture('cuarto-5x4-con-puerta'))) as {
      nodes: Record<string, Record<string, unknown>>
      rootNodeIds: string[]
    }
  }

  test('una puerta con position numérico se descarta en vez de tumbar el render', () => {
    // Ésta es la forma exacta que generaba el plano 3D en negro: `DoorSystem`
    // hacía `node.position[0]` sobre un número y reventaba dentro del useFrame.
    const escena = escenaBase()
    const puertaId = Object.keys(escena.nodes).find((id) => escena.nodes[id].type === 'door')!
    escena.nodes[puertaId].position = 0.5

    const resultado = normalizeHoltmontScene(escena, [])
    expect(Object.values(resultado.nodes).some((n) => n.type === 'door')).toBe(false)
    expect(resultado.dropped.map((d) => d.id)).toContain(puertaId)
    // El resto de la escena sobrevive: se pierde la puerta, no el edificio.
    expect(Object.values(resultado.nodes).filter((n) => n.type === 'wall')).toHaveLength(4)
    // Y el muro ya no la lista, para que nadie intente dibujarla.
    for (const nodo of Object.values(resultado.nodes)) {
      const hijos = (nodo as { children?: unknown }).children
      if (Array.isArray(hijos)) expect(hijos).not.toContain(puertaId)
    }
  })

  test('un tipo que el editor no conoce se descarta con su motivo', () => {
    const escena = escenaBase()
    escena.nodes.staircase_viejo = {
      object: 'node',
      id: 'staircase_viejo',
      type: 'staircase',
      parentId: null,
      visible: true,
      metadata: {},
    }
    const resultado = normalizeHoltmontScene(escena, [])
    expect(resultado.nodes.staircase_viejo).toBeUndefined()
    expect(resultado.dropped.some((d) => d.id === 'staircase_viejo')).toBe(true)
  })

  test('un mensaje sin nodos se rechaza en vez de vaciar la escena', () => {
    expect(() => normalizeHoltmontScene({ rootNodeIds: [] }, [])).toThrow(HoltmontImportError)
    expect(() => normalizeHoltmontScene(null, [])).toThrow(HoltmontImportError)
    expect(() => normalizeHoltmontScene({ nodes: {}, rootNodeIds: [] }, [])).toThrow(
      HoltmontImportError,
    )
  })

  test('los huérfanos del descarte se limpian en cascada', () => {
    const escena = escenaBase()
    const muroId = Object.keys(escena.nodes).find((id) => escena.nodes[id].type === 'wall')!
    escena.nodes[muroId].start = 'no es un punto'

    const resultado = normalizeHoltmontScene(escena, [])
    expect(resultado.nodes[muroId]).toBeUndefined()
    for (const nodo of Object.values(resultado.nodes)) {
      const padre = (nodo as { parentId?: string | null }).parentId
      if (padre) expect(resultado.nodes[padre]).toBeDefined()
    }
  })
})
