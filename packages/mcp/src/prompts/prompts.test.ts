// Side-effect import MUST come first: installs RAF polyfill before core loads.
import '../bridge/node-shims'

import { beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import useScene from '@pascal-app/core/store'
import { SceneBridge } from '../bridge/scene-bridge'
import { buildFromBriefPrompt, registerFromBrief } from './from-brief'
import { buildIterateOnFeedbackPrompt, registerIterateOnFeedback } from './iterate-on-feedback'
import { buildRenovationMessages, registerRenovationFromPhotos } from './renovation-from-photos'

type ClientServerPair = {
  client: Client
  server: McpServer
  bridge: SceneBridge
  close: () => Promise<void>
}

async function spinUp(
  register: (server: McpServer, bridge: SceneBridge) => void,
): Promise<ClientServerPair> {
  const bridge = new SceneBridge()
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  register(server, bridge)
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return {
    client,
    server,
    bridge,
    close: async () => {
      await client.close()
      await server.close()
    },
  }
}

function resetScene(): void {
  useScene.getState().unloadScene()
  useScene.temporal.getState().clear()
}

describe('from_brief', () => {
  beforeEach(() => resetScene())

  test('includes brief in the returned user message', async () => {
    const pair = await spinUp(registerFromBrief)
    try {
      const res = await pair.client.getPrompt({
        name: 'from_brief',
        arguments: { brief: 'A 60 sqm studio with a kitchenette' },
      })
      expect(res.messages).toHaveLength(1)
      const m = res.messages[0]
      expect(m).toBeDefined()
      if (!m) return
      expect(m.role).toBe('user')
      expect(m.content.type).toBe('text')
      if (m.content.type === 'text') {
        expect(m.content.text).toContain('60 sqm studio')
        expect(m.content.text).toContain('apply_patch')
        expect(m.content.text).toContain('create_story_shell')
        expect(m.content.text).toContain('pascal://agent/guide')
        expect(m.content.text).toContain('dedicated roof level')
      }
    } finally {
      await pair.close()
    }
  })

  test('appends constraints section when provided', async () => {
    const pair = await spinUp(registerFromBrief)
    try {
      const res = await pair.client.getPrompt({
        name: 'from_brief',
        arguments: {
          brief: 'Tiny house',
          constraints: 'footprint under 40 sqm',
        },
      })
      const m = res.messages[0]
      expect(m).toBeDefined()
      if (!m) return
      if (m.content.type === 'text') {
        expect(m.content.text).toContain('## Constraints')
        expect(m.content.text).toContain('footprint under 40 sqm')
      }
    } finally {
      await pair.close()
    }
  })

  test('buildFromBriefPrompt omits constraints section when empty', () => {
    const text = buildFromBriefPrompt({ brief: 'Studio', constraints: '' })
    expect(text).not.toContain('## Constraints')
    expect(text).toContain('Studio')
  })
})

describe('iterate_on_feedback', () => {
  beforeEach(() => resetScene())

  test('returns single user message referencing the feedback and the scene resource', async () => {
    const pair = await spinUp(registerIterateOnFeedback)
    try {
      const res = await pair.client.getPrompt({
        name: 'iterate_on_feedback',
        arguments: { feedback: 'Move the fridge to the opposite wall' },
      })
      expect(res.messages).toHaveLength(1)
      const m = res.messages[0]
      expect(m).toBeDefined()
      if (!m) return
      expect(m.role).toBe('user')
      if (m.content.type === 'text') {
        expect(m.content.text).toContain('Move the fridge')
        expect(m.content.text).toContain('pascal://scene/current')
        expect(m.content.text).toContain('apply_patch')
      }
    } finally {
      await pair.close()
    }
  })

  test('buildIterateOnFeedbackPrompt emphasises minimal diff', () => {
    const text = buildIterateOnFeedbackPrompt({ feedback: 'x' })
    expect(text.toLowerCase()).toContain('minimum')
  })
})

describe('renovation_from_photos', () => {
  beforeEach(() => resetScene())

  test('parses JSON-array photo lists and emits image/text content', async () => {
    const pair = await spinUp(registerRenovationFromPhotos)
    try {
      const longBase64 = 'A'.repeat(40) // length % 4 == 0, pure base64 chars.
      const res = await pair.client.getPrompt({
        name: 'renovation_from_photos',
        arguments: {
          currentPhotos: JSON.stringify(['https://example.com/current1.jpg', longBase64]),
          referencePhotos: JSON.stringify(['data:image/png;base64,iVBORw0K']),
          goals: 'make it look mid-century modern',
        },
      })
      expect(res.messages.length).toBeGreaterThan(1)

      // Intro text should mention goals + counts.
      const intro = res.messages[0]
      expect(intro).toBeDefined()
      if (!intro) return
      if (intro.content.type !== 'text') throw new Error('intro not text')
      expect(intro.content.text).toContain('mid-century modern')
      expect(intro.content.text).toContain('Current photos: 2')
      expect(intro.content.text).toContain('Reference photos: 1')

      // There should be at least one image content (from the base64) and one
      // URL text fallback (from the https URL).
      const kinds = res.messages.map((m) => m.content.type)
      expect(kinds).toContain('image')
      const textMessages = res.messages.filter((m) => m.content.type === 'text')
      const hasUrlFallback = textMessages.some(
        (m) => m.content.type === 'text' && m.content.text.startsWith('URL: https://'),
      )
      expect(hasUrlFallback).toBe(true)

      // Final message should be a task directive.
      const last = res.messages[res.messages.length - 1]
      expect(last).toBeDefined()
      if (!last) return
      if (last.content.type === 'text') {
        expect(last.content.text).toContain('## Task')
        expect(last.content.text).toContain('apply_patch')
      }
    } finally {
      await pair.close()
    }
  })

  test('data-URL with explicit mimeType becomes image content', () => {
    const messages = buildRenovationMessages({
      currentPhotos: JSON.stringify(['data:image/png;base64,aGVsbG8='] as string[]),
      referencePhotos: '[]',
      goals: 'test',
    })
    const imageMsg = messages.find((m) => m.content.type === 'image')
    expect(imageMsg).toBeDefined()
    if (imageMsg && imageMsg.content.type === 'image') {
      expect(imageMsg.content.mimeType).toBe('image/png')
      expect(imageMsg.content.data).toBe('aGVsbG8=')
    }
  })

  test('comma-separated fallback parses a list correctly', () => {
    const messages = buildRenovationMessages({
      currentPhotos: 'https://a.example/1.jpg, https://b.example/2.jpg',
      referencePhotos: '',
      goals: 'test',
    })
    const urlTextMsgs = messages.filter(
      (m) => m.content.type === 'text' && m.content.text.startsWith('URL: https://'),
    )
    expect(urlTextMsgs.length).toBe(2)
  })

  test('empty lists produce no per-photo sections but still include task directive', () => {
    const messages = buildRenovationMessages({
      currentPhotos: '',
      referencePhotos: '',
      goals: 'nothing to do',
    })
    // 1 intro + 1 task = 2 messages.
    expect(messages.length).toBe(2)
    const last = messages[messages.length - 1]
    expect(last).toBeDefined()
    if (last && last.content.type === 'text') {
      expect(last.content.text).toContain('## Task')
    }
  })
})
