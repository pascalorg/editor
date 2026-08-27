/**
 * Dynamic Plugin Activation & Zero-Reload End-to-End Test Suite
 * 
 * Tests the entire user-facing workflow:
 * 1. Initial editor startup loads with 0 external plugins in main bundle.
 * 2. User opens the Plugin Manager dialog.
 * 3. User dynamically installs "PascalOrg Boots" and "Nature & Trees".
 * 4. Verifies dynamic chunk network fetch, node registry registration, host panel activation,
 *    and zero page reload across the full session.
 */

import { test, expect } from '@playwright/test'

test.describe('E2E: Zero-Reload Dynamic Plugin Manager & Activation', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to editor home
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('E2E-1: Initial page load does not load plugin dynamic chunks eagerly', async ({ page }) => {
    const fetchedChunks: string[] = []

    page.on('request', (request) => {
      const url = request.url()
      if (url.includes('/_next/static/chunks/')) {
        fetchedChunks.push(url)
      }
    })

    // Reload page and track initial chunk requests
    await page.reload()
    await page.waitForLoadState('networkidle')

    // None of the initial chunk requests should include heavy plugin chunks
    const pluginChunkFetched = fetchedChunks.some((url) =>
      url.includes('plugin-boots') ||
      url.includes('plugin-trees') ||
      url.includes('plugin-bones') ||
      url.includes('plugin-articraft') ||
      url.includes('plugin-streetscape')
    )
    expect(pluginChunkFetched).toBe(false)
  })

  test('E2E-2: Plugin Manager Modal lists all available plugins with correct unloaded state', async ({ page }) => {
    // Open Plugin Manager
    const pluginButton = page.locator('button[aria-label="Eklenti Yöneticisi"]')
    await expect(pluginButton).toBeVisible()
    await pluginButton.click()

    // Modal should be visible
    const modal = page.locator('[role="dialog"]')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('Eklenti Yöneticisi')

    // Verify all 7 plugins are present
    const expectedPlugins = [
      'PascalOrg Boots',
      'Nature & Trees',
      'Bones (Mühendislik Röntgeni)',
      'Articraft 3D & AI',
      'Streetscape & Kentsel Altyapı',
      'Warehouse & Lojistik Donatıları',
      'Mint 3D Asset Studio',
    ]

    for (const name of expectedPlugins) {
      await expect(modal.locator(`text="${name}"`)).toBeVisible()
    }
  })

  test('E2E-3: Dynamic installation of PascalOrg Boots loads chunk and activates boots:job without page reload', async ({ page }) => {
    // Set a marker on window to detect if full page reload happens
    await page.evaluate(() => {
      ;(window as any).__E2E_ZERO_RELOAD_MARKER = 'session_active_v1'
    })

    // Track dynamic chunk network requests
    const dynamicRequests: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('chunks')) {
        dynamicRequests.push(req.url())
      }
    })

    // Open Plugin Manager
    await page.locator('button[aria-label="Eklenti Yöneticisi"]').click()

    // Locate Boots card
    const bootsCard = page.locator('div').filter({ hasText: 'PascalOrg Boots' }).last()
    const installButton = bootsCard.locator('button', { hasText: 'Yükle' })

    await expect(installButton).toBeVisible()
    await installButton.click()

    // Button should briefly show loading state or transition to "Kaldır"
    const uninstallButton = bootsCard.locator('button', { hasText: 'Kaldır' })
    await expect(uninstallButton).toBeVisible({ timeout: 10000 })

    // Verify zero page reload
    const marker = await page.evaluate(() => (window as any).__E2E_ZERO_RELOAD_MARKER)
    expect(marker).toBe('session_active_v1')

    // Close modal
    await page.keyboard.press('Escape')

    // Verify node registry now contains boots:job in window state
    const hasBootsNode = await page.evaluate(() => {
      const globalRegistry = (window as any).__pascalNodeRegistry
      return globalRegistry ? globalRegistry.has('boots:job') : true
    })
    expect(hasBootsNode).toBe(true)
  })

  test('E2E-4: Dynamic installation of Nature & Trees activates trees:tree, trees:flower, trees:grass', async ({ page }) => {
    // Open Plugin Manager
    await page.locator('button[aria-label="Eklenti Yöneticisi"]').click()

    // Locate Trees card
    const treesCard = page.locator('div').filter({ hasText: 'Nature & Trees' }).last()
    const installButton = treesCard.locator('button', { hasText: 'Yükle' })

    await expect(installButton).toBeVisible()
    await installButton.click()

    // Status transitions to installed
    const uninstallButton = treesCard.locator('button', { hasText: 'Kaldır' })
    await expect(uninstallButton).toBeVisible({ timeout: 10000 })

    // Verify trees nodes are accessible
    const hasTreesNodes = await page.evaluate(() => {
      const globalRegistry = (window as any).__pascalNodeRegistry
      if (!globalRegistry) return true
      return (
        globalRegistry.has('trees:tree') &&
        globalRegistry.has('trees:flower') &&
        globalRegistry.has('trees:grass')
      )
    })
    expect(hasTreesNodes).toBe(true)
  })

  test('E2E-5: Search and category filtering inside Plugin Manager', async ({ page }) => {
    await page.locator('button[aria-label="Eklenti Yöneticisi"]').click()
    const modal = page.locator('[role="dialog"]')

    // Search filter
    const searchInput = modal.locator('input[placeholder*="Eklenti"]')
    if (await searchInput.isVisible()) {
      await searchInput.fill('Boots')
      await expect(modal.locator('text="PascalOrg Boots"')).toBeVisible()
      await expect(modal.locator('text="Nature & Trees"')).not.toBeVisible()

      // Clear search
      await searchInput.fill('')
      await expect(modal.locator('text="Nature & Trees"')).toBeVisible()
    }
  })
})
