import { readFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'

const fixtures = new URL('./fixtures/', import.meta.url)
const glb = readFileSync(new URL('house.glb', fixtures))
const scene = JSON.parse(readFileSync(new URL('scene.json', fixtures), 'utf8'))
const GLB_URL = 'https://fixtures.supabase.co/storage/lod0.glb'
const cors = { 'access-control-allow-origin': '*' }

function sceneBody(overrides: { expiresAt?: string; bake?: object } = {}) {
  const expiresAt = overrides.expiresAt ?? new Date(Date.now() + 10 * 60_000).toISOString()
  return JSON.stringify({
    ...scene,
    bake: overrides.bake ?? {
      ...scene.bake,
      lods: [{ ...scene.bake.lods[0], url: GLB_URL, bytes: glb.byteLength, expiresAt }],
    },
  })
}

/** Answers the scene read with `answer(n)` for the n-th request and serves the fixture GLB. */
async function mockPascal(
  page: Page,
  answer: (n: number) => { status?: number; body: string } = () => ({ body: sceneBody() }),
  glbStatus: (n: number) => number = () => 200,
) {
  const calls = { scene: 0, glb: 0 }
  await page.route('**/api/projects/*/scene*', (route) => {
    const { status = 200, body } = answer(++calls.scene)
    return route.fulfill({ status, body, contentType: 'application/json', headers: cors })
  })
  await page.route(GLB_URL, (route) => {
    const status = glbStatus(++calls.glb)
    return status === 200
      ? route.fulfill({ body: glb, contentType: 'model/gltf-binary', headers: cors })
      : route.fulfill({ status, body: 'expired', headers: cors })
  })
  return calls
}

/** Distinct colours in the rendered canvas: 1 for an empty clear colour, many for a model. */
async function canvasColours(page: Page) {
  const png = await page.locator('canvas').screenshot()
  return page.evaluate(async (base64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, image.width, image.height)
    const colours = new Set<number>()
    for (let i = 0; i < data.length; i += 4 * 7) {
      colours.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!)
    }
    return colours.size
  }, png.toString('base64'))
}

test('renders the baked model and lists its floors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
  await mockPascal(page)

  await page.goto('/?project=fixture-house')
  await expect(page.locator('main[data-state="ready"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Fixture house' })).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()
  expect(await canvasColours(page)).toBeGreaterThan(50)

  const floors = page.getByRole('group', { name: 'Floors' }).getByRole('button')
  await expect(floors).toHaveText(['All floors', 'First floor', 'Ground floor'])
  await page.getByRole('button', { name: 'Ground floor' }).click()
  await expect(page.getByRole('button', { name: 'Ground floor' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByText('Click a door or window to open it')).toBeVisible()
  expect(errors).toEqual([])
})

test('names the room under the pointer with its area', async ({ page }) => {
  await mockPascal(page)
  await page.goto('/?project=fixture-house')
  await expect(page.locator('main[data-state="ready"]')).toBeVisible()
  await page.getByRole('button', { name: 'Ground floor' }).click()

  const box = (await page.locator('canvas').boundingBox())!
  const label = page.locator('.room-label')
  const seen = new Set<string>()
  for (let y = 0.3; y <= 0.8; y += 0.1) {
    for (let x = 0.2; x <= 0.8; x += 0.1) {
      await page.mouse.move(box.x + box.width * x, box.y + box.height * y)
      if (await label.isVisible()) seen.add((await label.innerText()).replace(/\s+/g, ' '))
    }
  }
  expect([...seen]).toEqual(
    expect.arrayContaining([expect.stringMatching(/^(Living room 30|Kitchen 18) m²$/)]),
  )
})

test('opens a door on click and closes it on a second click', async ({ page }) => {
  await mockPascal(page)
  await page.goto('/?project=fixture-house')
  await expect(page.locator('main[data-state="ready"]')).toBeVisible()
  await page.getByRole('button', { name: 'Ground floor' }).click()

  const canvas = page.locator('canvas')
  const box = (await canvas.boundingBox())!
  let door: { x: number; y: number } | null = null
  // The fixture's front door faces the camera, low and left of centre.
  for (let y = 0.95; y >= 0.4 && !door; y -= 0.03) {
    for (let x = 0.3; x <= 0.7 && !door; x += 0.03) {
      const point = { x: box.x + box.width * x, y: box.y + box.height * y }
      await page.mouse.move(point.x, point.y)
      if ((await canvas.evaluate((element) => element.style.cursor)) === 'pointer') door = point
    }
  }
  expect(door).not.toBeNull()

  const closed = await canvas.screenshot()
  await page.mouse.click(door!.x, door!.y)
  await page.waitForTimeout(1300)
  const opened = await canvas.screenshot()
  expect(opened.equals(closed)).toBe(false)
  await page.mouse.click(door!.x, door!.y)
  await page.waitForTimeout(1300)
  expect((await canvas.screenshot()).equals(opened)).toBe(false)
})

test('renews an expired 3D file URL by reading the scene again', async ({ page }) => {
  const calls = await mockPascal(page, (n) => ({
    body: sceneBody(n === 1 ? { expiresAt: new Date(Date.now() - 1000).toISOString() } : {}),
  }))
  await page.goto('/?project=fixture-house')
  await expect(page.locator('main[data-state="ready"]')).toBeVisible()
  expect(calls).toEqual({ scene: 2, glb: 1 })
})

test('renews once when storage rejects the signed URL', async ({ page }) => {
  const calls = await mockPascal(page, undefined, (n) => (n === 1 ? 400 : 200))
  await page.goto('/?project=fixture-house')
  await expect(page.locator('main[data-state="ready"]')).toBeVisible()
  expect(calls).toEqual({ scene: 2, glb: 2 })
})

test('says when the 3D file is still being prepared', async ({ page }) => {
  await mockPascal(page, () => ({
    body: sceneBody({ bake: { status: 'baking', bakeVersion: null, hash: null, lods: [] } }),
  }))
  await page.goto('/?project=fixture-house')
  await expect(
    page.getByRole('heading', { name: "This project's 3D file is being prepared" }),
  ).toBeVisible()
})

test('says when the project is not published', async ({ page }) => {
  await mockPascal(page, () => ({ status: 404, body: JSON.stringify({ error: 'not_published' }) }))
  await page.goto('/?project=fixture-house')
  await expect(
    page.getByRole('heading', { name: "This project isn't published yet" }),
  ).toBeVisible()
})
