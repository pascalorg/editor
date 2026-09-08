/**
 * Prueba de humo del plano 3D: abre el editor de verdad en un navegador,
 * le manda cada escena del agente por `postMessage` y comprueba que la
 * geometría existe en la escena, no solo en el store.
 *
 * Es la prueba que faltaba. El bug que arregla —el lienzo negro— no rompía
 * ningún import: `setScene` guardaba la escena sin quejarse y el fallo ocurría
 * después, dentro del `useFrame` de `DoorSystem`, matando el bucle de render.
 * Contra el store todo parecía correcto; solo mirando la geometría dibujada se
 * ve la diferencia.
 *
 *   bun run --cwd apps/editor dev        # en otra terminal (o usa --start)
 *   node apps/editor/scripts/holtmont-smoke.mjs
 *
 * Opciones:
 *   --base-url=http://localhost:3002   dónde escucha el editor
 *   --scene=<nombre>                   solo esa escena
 *   --screenshots=<directorio>         guarda una captura por escena
 *   --executable=<ruta>                Chromium a usar (o PLAYWRIGHT_CHROMIUM_EXECUTABLE),
 *                                      para entornos con el navegador ya instalado aparte
 */

import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const AQUI = dirname(fileURLToPath(import.meta.url))
const FIXTURES = resolve(AQUI, '..', 'public', 'holtmont-fixtures')

const opciones = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [clave, ...resto] = a.slice(2).split('=')
      return [clave, resto.join('=') || 'true']
    }),
)

const BASE_URL = opciones['base-url'] ?? 'http://localhost:3002'
const CAPTURAS = opciones.screenshots ? resolve(opciones.screenshots) : null

// Lo que cada escena tiene que llegar a dibujar. Los números salen del propio
// generador: un cuarto tiene cuatro muros, una casa de dos pisos ocho.
const ESPERADO = {
  'cuarto-5x4-con-puerta': { wall: 4, door: 1, slab: 1, ceiling: 1 },
  'bodega-12x8-dos-puertas-cuatro-ventanas': { wall: 4, door: 2, window: 4, slab: 1 },
  'oficina-sin-vanos': { wall: 4, slab: 1, ceiling: 1 },
  'casa-dos-pisos-ventanas-frente-y-atras': {
    wall: 8,
    window: 4,
    door: 1,
    slab: 2,
    stair: 1,
    roof: 1,
  },
  'cuarto-amueblado': { wall: 4, door: 1, window: 1, item: 2 },
}

const escenas = JSON.parse(readFileSync(join(FIXTURES, 'index.json'), 'utf-8')).filter(
  (nombre) => !opciones.scene || opciones.scene === nombre,
)

if (escenas.length === 0) {
  console.error(`No hay ninguna escena que coincida con --scene=${opciones.scene}`)
  process.exit(1)
}

if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true })

const EJECUTABLE = opciones.executable ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE

const navegador = await chromium.launch({
  ...(EJECUTABLE ? { executablePath: EJECUTABLE } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

let fallos = 0

for (const escena of escenas) {
  const contexto = await navegador.newContext({ viewport: { width: 1400, height: 900 } })
  const pagina = await contexto.newPage()
  // Solo interesan los errores de código: una excepción dentro de un `useFrame`
  // mata el bucle de render de react-three-fiber sin decir nada, y eso es lo
  // que dejaba el plano en negro. El ruido de red del servidor de desarrollo
  // (HMR, favicons) no dice nada del dibujo.
  const RUIDO_DE_RED =
    /Failed to load resource|ERR_CONNECTION|ERR_ABORTED|favicon|^Event$|blocked by CORS policy|unpkg\.com|react-scan/
  const erroresDeConsola = []
  pagina.on('pageerror', (err) => erroresDeConsola.push(`excepción: ${err}`))
  pagina.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const texto = msg.text().trim()
    if (!RUIDO_DE_RED.test(texto)) erroresDeConsola.push(texto)
  })

  try {
    await pagina.goto(`${BASE_URL}/test-holtmont?scene=${escena}`, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    })

    // El banco de pruebas envía la escena en cuanto el editor manda PASCAL_READY.
    await pagina.waitForFunction(
      () => window.__holtmontTest?.ack || window.__holtmontTest?.error,
      null,
      { timeout: 120_000 },
    )

    const estado = await pagina.evaluate(() => window.__holtmontTest)
    if (estado.error) {
      throw new Error(`el puente rechazó la escena: ${estado.error.reason}`)
    }

    const descartesRaros = (estado.ack.dropped ?? []).filter(
      (d) => !String(d.reason).startsWith('sin asset'),
    )
    if (descartesRaros.length > 0) {
      throw new Error(`nodos descartados: ${JSON.stringify(descartesRaros)}`)
    }

    // La geometría tarda algunos cuadros en generarse (los sistemas trabajan
    // sobre el conjunto de nodos sucios).
    const marco = pagina.frameLocator('iframe[title="Pascal Editor"]')
    await marco.locator('canvas').first().waitFor({ timeout: 120_000 })

    const cuadro = pagina.frames().find((f) => f.url().endsWith('/'))
    await cuadro.waitForFunction(
      () => {
        const sonda = window.__holtmontProbe?.()
        return sonda && (sonda.porTipo.wall?.conGeometria ?? 0) > 0
      },
      null,
      { timeout: 120_000 },
    )
    const sonda = await cuadro.evaluate(() => window.__holtmontProbe())

    const esperado = ESPERADO[escena] ?? {}
    const problemas = []
    for (const [tipo, minimo] of Object.entries(esperado)) {
      const dibujados = sonda.porTipo[tipo]?.conGeometria ?? 0
      if (dibujados < minimo) {
        problemas.push(`${tipo}: ${dibujados} con geometría, se esperaban ${minimo}`)
      }
    }
    if (sonda.mayorLado < 1) {
      problemas.push(`la escena mide ${sonda.mayorLado.toFixed(3)} m: no hay nada dibujado`)
    }
    // Un error de render mata el bucle de react-three-fiber sin decir nada:
    // esto es lo que dejaba el plano en negro.
    if (erroresDeConsola.length > 0) {
      problemas.push(`errores en consola: ${erroresDeConsola.slice(0, 3).join(' | ')}`)
    }

    if (CAPTURAS) {
      await pagina.screenshot({ path: join(CAPTURAS, `${escena}.png`) })
    }

    if (problemas.length > 0) throw new Error(problemas.join('; '))

    const resumen = Object.entries(sonda.porTipo)
      .map(([tipo, v]) => `${tipo} ${v.conGeometria}/${v.total}`)
      .join(', ')
    console.log(`OK   ${escena} — ${resumen}`)
  } catch (err) {
    fallos += 1
    console.error(`FALLA ${escena} — ${err.message}`)
    if (CAPTURAS) {
      await pagina.screenshot({ path: join(CAPTURAS, `${escena}-FALLA.png`) }).catch(() => {})
    }
  } finally {
    await contexto.close()
  }
}

await navegador.close()

if (fallos > 0) {
  console.error(`\n${fallos} escena(s) no se dibujan.`)
  process.exit(1)
}
console.log(`\n${escenas.length} escena(s) se dibujan correctamente.`)
