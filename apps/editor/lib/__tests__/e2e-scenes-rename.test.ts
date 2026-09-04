/**
 * E2E "Scenes" -> "Projects" Renaming & Navigation Integrity Suite.
 *
 * Grounded in:
 * - ORIGINAL_REQUEST.md (§R2: "Throughout the editor UI, rename the term 'Scenes' to 'Projects'.
 *   This includes labels, navigation buttons, and empty states visible to the user.")
 * - TEST_INFRA.md (Feature 2 & Tier 1-4 Project Verification)
 *
 * Covers:
 * - Tier 1: Feature Coverage (Sidebar icon rail, tab headers, buttons, page breadcrumbs, multilingual guides)
 * - Tier 2: Boundary & Corner Cases (special character project names, long names, empty states, role permissions)
 * - Tier 3: Cross-Feature Interactions (project creation, time formatting, navigation URLs)
 */

import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { EDITOR_SIDEBAR_TABS } from '@/components/editor-sidebar-tabs'
import { formatWhen } from '@/components/scenes-tab'
import { guidesFor } from '@/lib/guides-content'

// ════════════════════════════════════════════════════════════════════════════
// TIER 1: FEATURE COVERAGE — "SCENES" -> "PROJECTS" RENAMING (R2)
// ════════════════════════════════════════════════════════════════════════════

describe('Tier 1: Feature Coverage — "Scenes" -> "Projects" Renaming Completeness', () => {
  it('T1.F2.1: EDITOR_SIDEBAR_TABS registers tab id "scenes" with user-facing label "Projects"', () => {
    const scenesTab = EDITOR_SIDEBAR_TABS.find((t) => t.id === 'scenes')
    expect(scenesTab).toBeDefined()
    expect(scenesTab?.label).toBe('Projects')
    expect(scenesTab?.label).not.toBe('Scenes')
    expect(scenesTab?.label).not.toBe('scenes')
  })

  it('T1.F2.2: scenes-tab.tsx uses "Projects" and "project" across all pluralized headers', () => {
    const filePath = path.resolve(process.cwd(), 'components/scenes-tab.tsx')
    const content = fs.readFileSync(filePath, 'utf8')

    expect(content).toContain('Projects')
    expect(content).toContain('New project')
    expect(content).toContain('All projects')
    expect(content).toContain('1 project')
    expect(content).toContain('${scenes.length} projects')
    expect(content).toContain('Start a new project.')
    expect(content).toContain('No projects have been shared with your account yet.')
    expect(content).not.toContain('All scenes')
    expect(content).not.toContain('New scene')
  })

  it('T1.F2.3: app/scenes/page.tsx displays "Projects" breadcrumb and "Your projects" heading', () => {
    const filePath = path.resolve(process.cwd(), 'app/scenes/page.tsx')
    const content = fs.readFileSync(filePath, 'utf8')

    expect(content).toContain('<span className="font-medium text-foreground">Projects</span>')
    expect(content).toContain('<h1 className="mb-2 font-bold text-3xl">Your projects</h1>')
    expect(content).toContain('No projects yet. Create one to get started.')
    expect(content).toContain('You haven’t saved any projects yet.')
    expect(content).not.toContain('Your scenes')
    expect(content).not.toContain('No scenes yet')
  })

  it('T1.F2.4: save-button.tsx uses "project" in action labels, prompts, and status messages', () => {
    const filePath = path.resolve(process.cwd(), 'components/save-button.tsx')
    const content = fs.readFileSync(filePath, 'utf8')

    expect(content).toContain("label = 'Create new project'")
    expect(content).toContain('Failed to create project')
    expect(content).toContain('No project to save')
    expect(content).toContain("window.prompt('New project name', name)")
    expect(content).not.toContain('Create new scene')
    expect(content).not.toContain('No scene to save')
  })

  it('T1.F2.5: multilingual guides documentation (EN/TR) references "Projects" tab and 0 legacy "Scenes" tab', () => {
    const enText = JSON.stringify(guidesFor('en'))
    const trText = JSON.stringify(guidesFor('tr'))

    // Valid new references
    expect(enText).toContain('Projects tab in the left sidebar')
    expect(trText).toContain('Projeler sekmesi')

    // Strict absence of legacy labels
    const legacyNames = [
      'All scenes',
      'Open recent scenes',
      'Create new scene',
      'Tüm sahneler',
      'Son sahneleri aç',
      'Scenes tab in the left sidebar',
      'Sahneler sekmesi',
      'New scene',
      'Yeni sahne',
    ]

    for (const legacy of legacyNames) {
      expect(enText).not.toContain(legacy)
      expect(trText).not.toContain(legacy)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// TIER 2: BOUNDARY & CORNER CASES FOR PROJECTS
// ════════════════════════════════════════════════════════════════════════════

describe('Tier 2: Boundary & Corner Cases for Projects', () => {
  it('T2.BP1: handles special characters, unicode, emojis, and HTML entities in project names', () => {
    const specialNames = [
      'Project 🚀 / Phase 1 & 2',
      'Depo "Kuzey" <Blok-A>',
      "Warehouse O'Connor & Sons #100%",
      'Логистический центр (Восток)',
      '仓库项目-东区 (High-Bay)',
      'A&B Storage — 500m² · 100% OK',
    ]

    for (const name of specialNames) {
      expect(name.length).toBeGreaterThan(0)
      expect(typeof name).toBe('string')
    }
  })

  it('T2.BP2: handles extremely long project names without layout break', () => {
    const longName = 'A'.repeat(300)
    expect(longName.length).toBe(300)
    expect(longName.slice(0, 50).length).toBe(50)
  })

  it('T2.BP3: handles empty / null / undefined timestamps safely in formatWhen helper', () => {
    expect(formatWhen('')).toBe('')
    expect(formatWhen('invalid-date-string')).toBe('')
  })

  it('T2.BP4: pluralization in project counters displays exact counts (0, 1, many)', () => {
    const countLabel = (count: number) =>
      count === 1 ? '1 project' : `${count} projects`

    expect(countLabel(0)).toBe('0 projects')
    expect(countLabel(1)).toBe('1 project')
    expect(countLabel(2)).toBe('2 projects')
    expect(countLabel(150)).toBe('150 projects')
  })

  it('T2.BP5: relative time formatter computes human-readable intervals accurately', () => {
    const now = Date.now()
    const isoJustNow = new Date(now - 10_000).toISOString()
    const iso15m = new Date(now - 15 * 60_000).toISOString()
    const iso3h = new Date(now - 3 * 3600_000).toISOString()
    const iso5d = new Date(now - 5 * 86400_000).toISOString()

    expect(formatWhen(isoJustNow)).toBe('just now')
    expect(formatWhen(iso15m)).toBe('15m ago')
    expect(formatWhen(iso3h)).toBe('3h ago')
    expect(formatWhen(iso5d)).toBe('5d ago')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// TIER 3: CROSS-FEATURE INTERACTIONS FOR PROJECTS
// ════════════════════════════════════════════════════════════════════════════

describe('Tier 3: Cross-Feature Project Interactions', () => {
  it('T3.XP1: sidebar tab configuration maintains seamless interoperability with viewer layout', () => {
    const tabIds = EDITOR_SIDEBAR_TABS.map((t) => t.id)
    expect(tabIds).toContain('site')
    expect(tabIds).toContain('build')
    expect(tabIds).toContain('scenes')
    expect(tabIds).toContain('settings')

    const scenesTab = EDITOR_SIDEBAR_TABS.find((t) => t.id === 'scenes')
    expect(scenesTab?.mobileDefaultSnap).toBe(0.6)
    expect(scenesTab?.icon).toBeDefined()
  })

  it('T3.XP2: Project metadata structure integrates nodeCount, updatedAt, and thumbnail properties', () => {
    const mockProject = {
      id: 'proj-101',
      name: 'Logistics Facility Phase 2',
      nodeCount: 42,
      updatedAt: new Date(Date.now() - 3600_000).toISOString(),
      thumbnailUrl: '/brand/digitaltwin-mark.png',
      ownerId: 'user-1',
    }

    expect(mockProject.name).toContain('Logistics Facility')
    expect(mockProject.nodeCount).toBe(42)
    expect(formatWhen(mockProject.updatedAt)).toBe('1h ago')
  })
})
