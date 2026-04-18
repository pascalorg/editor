import { dirname, resolve as pathResolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const HTTP_URL = new URL('http://localhost:3917/mcp')

// Fallback path: launch a fresh stdio binary if HTTP is locked. The MCP HTTP
// server runs a single shared StreamableHTTPServerTransport whose `_initialized`
// + `sessionId` are claimed by the first connecting client and never released
// when other agents hold the slot — see SDK
// `webStandardStreamableHttp.js:425` (rejects re-init in stateful mode).
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const STDIO_BIN = pathResolve(__dirname, '../../dist/bin/pascal-mcp.js')

type Outcome = { name: string; pass: boolean; detail: string }

function ok(name: string, detail: string): Outcome {
  return { name, pass: true, detail }
}
function fail(name: string, detail: string): Outcome {
  return { name, pass: false, detail }
}

function safeStringify(value: unknown, max = 400): string {
  let out: string
  try {
    out = JSON.stringify(value)
  } catch (err) {
    out = `<unserializable: ${err instanceof Error ? err.message : String(err)}>`
  }
  if (out.length > max) out = `${out.slice(0, max)}...<truncated>`
  return out
}

/**
 * Connect with bounded retry. The MCP HTTP server is shared with T2/T3/T4,
 * so we may transiently see "Server already initialized" while another agent
 * holds the in-flight session. Retry with backoff for up to ~30 s.
 */
async function connectWithRetry(): Promise<{
  client: Client
  transport: StreamableHTTPClientTransport
}> {
  const maxAttempts = 30
  let lastErr: unknown = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const transport = new StreamableHTTPClientTransport(HTTP_URL)
    const client = new Client({ name: 't5-resources-prompts', version: '0.0.0' })
    try {
      await client.connect(transport)
      if (attempt > 1) console.log(`[t5] connected on attempt ${attempt}`)
      return { client, transport }
    } catch (err) {
      lastErr = err
      try {
        await client.close()
      } catch {
        // ignore
      }
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[t5] connect attempt ${attempt} failed: ${msg.slice(0, 200)}`)
      // Brief backoff with jitter — keep total under ~30 s.
      await new Promise((r) => setTimeout(r, 800 + Math.floor(Math.random() * 400)))
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`failed to connect after ${maxAttempts} attempts`)
}

async function main(): Promise<void> {
  const { client } = await connectWithRetry()

  const resourceOutcomes: Outcome[] = []
  const promptOutcomes: Outcome[] = []
  let listResourcesCount = 0
  let listPromptsCount = 0

  try {
    console.log(`[t5] connected to ${HTTP_URL.href}`)

    // ---------------- listResources ----------------
    try {
      const list = await client.listResources()
      listResourcesCount = Array.isArray(list.resources) ? list.resources.length : 0
      console.log(`[t5] listResources count = ${listResourcesCount}`)
      console.log(
        `[t5] listResources names = ${(list.resources ?? [])
          .map((r) => r.name ?? r.uri)
          .join(', ')}`,
      )
    } catch (err) {
      console.error(`[t5] listResources error: ${err instanceof Error ? err.message : String(err)}`)
    }

    // ---------------- Resource 1: pascal://scene/current ----------------
    try {
      const result = await client.readResource({ uri: 'pascal://scene/current' })
      const c = result.contents?.[0]
      if (!c) {
        resourceOutcomes.push(fail('scene/current', 'no contents returned'))
      } else if (c.mimeType !== 'application/json') {
        resourceOutcomes.push(fail('scene/current', `wrong mime type: ${String(c.mimeType)}`))
      } else {
        const text = typeof c.text === 'string' ? c.text : ''
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch (err) {
          resourceOutcomes.push(
            fail(
              'scene/current',
              `invalid json: ${err instanceof Error ? err.message : String(err)}`,
            ),
          )
          parsed = null
        }
        const obj = parsed as { nodes?: unknown; rootNodeIds?: unknown } | null
        if (!obj) {
          resourceOutcomes.push(fail('scene/current', 'empty payload'))
        } else if (!obj.nodes || typeof obj.nodes !== 'object') {
          resourceOutcomes.push(fail('scene/current', 'missing nodes object'))
        } else if (!Array.isArray(obj.rootNodeIds)) {
          resourceOutcomes.push(fail('scene/current', 'missing rootNodeIds array'))
        } else {
          const nodeCount = Object.keys(obj.nodes as Record<string, unknown>).length
          const rootCount = (obj.rootNodeIds as unknown[]).length
          resourceOutcomes.push(
            ok('scene/current', `application/json, nodes=${nodeCount}, rootNodeIds=${rootCount}`),
          )
        }
      }
    } catch (err) {
      resourceOutcomes.push(
        fail('scene/current', `threw: ${err instanceof Error ? err.message : String(err)}`),
      )
    }

    // ---------------- Resource 2: pascal://scene/current/summary ----------------
    try {
      const result = await client.readResource({ uri: 'pascal://scene/current/summary' })
      const c = result.contents?.[0]
      if (!c) {
        resourceOutcomes.push(fail('scene/current/summary', 'no contents returned'))
      } else if (c.mimeType !== 'text/markdown') {
        resourceOutcomes.push(
          fail('scene/current/summary', `wrong mime type: ${String(c.mimeType)}`),
        )
      } else {
        const text = typeof c.text === 'string' ? c.text : ''
        const hasHeading = /^# /m.test(text)
        const hasZoneOrLevel = /level/i.test(text) || /zone/i.test(text)
        if (!hasHeading) {
          resourceOutcomes.push(fail('scene/current/summary', 'no markdown # heading found'))
        } else if (!hasZoneOrLevel) {
          resourceOutcomes.push(fail('scene/current/summary', 'no level/zone references'))
        } else {
          // Extract a few first lines as preview
          const preview = text.split('\n').slice(0, 4).join(' | ')
          resourceOutcomes.push(
            ok(
              'scene/current/summary',
              `text/markdown, ${text.length} bytes, preview: "${preview.slice(0, 200)}"`,
            ),
          )
        }
      }
    } catch (err) {
      resourceOutcomes.push(
        fail('scene/current/summary', `threw: ${err instanceof Error ? err.message : String(err)}`),
      )
    }

    // ---------------- Resource 3: pascal://catalog/items ----------------
    try {
      const result = await client.readResource({ uri: 'pascal://catalog/items' })
      const c = result.contents?.[0]
      if (!c) {
        resourceOutcomes.push(fail('catalog/items', 'no contents returned'))
      } else if (c.mimeType !== 'application/json') {
        resourceOutcomes.push(fail('catalog/items', `wrong mime type: ${String(c.mimeType)}`))
      } else {
        const text = typeof c.text === 'string' ? c.text : ''
        const parsed = JSON.parse(text) as { status?: unknown; items?: unknown }
        if (parsed.status !== 'catalog_unavailable') {
          resourceOutcomes.push(
            fail(
              'catalog/items',
              `expected status='catalog_unavailable' got ${String(parsed.status)}`,
            ),
          )
        } else {
          resourceOutcomes.push(
            ok(
              'catalog/items',
              `application/json, status=catalog_unavailable, items.length=${
                Array.isArray(parsed.items) ? parsed.items.length : 'N/A'
              }`,
            ),
          )
        }
      }
    } catch (err) {
      resourceOutcomes.push(
        fail('catalog/items', `threw: ${err instanceof Error ? err.message : String(err)}`),
      )
    }

    // ---------------- Resource 4: pascal://constraints/{levelId} ----------------
    // Discover levelId via find_nodes tool.
    let discoveredLevelId: string | null = null
    try {
      const findResult = await client.callTool({
        name: 'find_nodes',
        arguments: { type: 'level' },
      })
      const sc = (findResult as { structuredContent?: { nodes?: unknown[] } }).structuredContent
      const nodes = Array.isArray(sc?.nodes) ? sc.nodes : []
      if (nodes.length > 0) {
        const first = nodes[0] as { id?: string }
        if (typeof first?.id === 'string') {
          discoveredLevelId = first.id
        }
      }
      console.log(`[t5] discovered levelId = ${String(discoveredLevelId)}`)
    } catch (err) {
      console.error(`[t5] find_nodes threw: ${err instanceof Error ? err.message : String(err)}`)
    }

    if (!discoveredLevelId) {
      resourceOutcomes.push(
        fail('constraints/{levelId}', 'no level node discovered via find_nodes'),
      )
    } else {
      try {
        const uri = `pascal://constraints/${discoveredLevelId}`
        const result = await client.readResource({ uri })
        const c = result.contents?.[0]
        if (!c) {
          resourceOutcomes.push(fail('constraints/{levelId}', 'no contents returned'))
        } else if (c.mimeType !== 'application/json') {
          resourceOutcomes.push(
            fail('constraints/{levelId}', `wrong mime type: ${String(c.mimeType)}`),
          )
        } else {
          const text = typeof c.text === 'string' ? c.text : ''
          const parsed = JSON.parse(text) as {
            slabs?: unknown
            wallPolygons?: unknown
            error?: unknown
          }
          if (parsed.error) {
            resourceOutcomes.push(
              fail('constraints/{levelId}', `error in payload: ${safeStringify(parsed.error)}`),
            )
          } else if (!Array.isArray(parsed.slabs)) {
            resourceOutcomes.push(fail('constraints/{levelId}', 'missing slabs array'))
          } else if (!Array.isArray(parsed.wallPolygons)) {
            resourceOutcomes.push(fail('constraints/{levelId}', 'missing wallPolygons array'))
          } else {
            resourceOutcomes.push(
              ok(
                'constraints/{levelId}',
                `levelId=${discoveredLevelId}, slabs=${parsed.slabs.length}, wallPolygons=${parsed.wallPolygons.length}`,
              ),
            )
          }
        }
      } catch (err) {
        resourceOutcomes.push(
          fail(
            'constraints/{levelId}',
            `threw: ${err instanceof Error ? err.message : String(err)}`,
          ),
        )
      }
    }

    // ---------------- listPrompts ----------------
    try {
      const list = await client.listPrompts()
      listPromptsCount = Array.isArray(list.prompts) ? list.prompts.length : 0
      console.log(`[t5] listPrompts count = ${listPromptsCount}`)
      console.log(`[t5] listPrompts names = ${(list.prompts ?? []).map((p) => p.name).join(', ')}`)
    } catch (err) {
      console.error(`[t5] listPrompts error: ${err instanceof Error ? err.message : String(err)}`)
    }

    // ---------------- Prompt 1: from_brief ----------------
    try {
      const result = await client.getPrompt({
        name: 'from_brief',
        arguments: {
          brief: 'A small studio apartment',
          constraints: 'max 40 m^2',
        },
      })
      const messages = result.messages ?? []
      const userMsgs = messages.filter((m) => m.role === 'user')
      if (userMsgs.length === 0) {
        promptOutcomes.push(fail('from_brief', 'no user messages returned'))
      } else {
        const firstText =
          userMsgs[0]?.content && 'text' in userMsgs[0].content
            ? String(userMsgs[0].content.text)
            : ''
        const mentionsBrief = /studio apartment/i.test(firstText)
        promptOutcomes.push(
          ok(
            'from_brief',
            `messages=${messages.length}, userMsgs=${userMsgs.length}, brief-included=${mentionsBrief}, preview: "${firstText.slice(0, 120).replace(/\n/g, ' ')}"`,
          ),
        )
      }
    } catch (err) {
      promptOutcomes.push(
        fail('from_brief', `threw: ${err instanceof Error ? err.message : String(err)}`),
      )
    }

    // ---------------- Prompt 2: iterate_on_feedback ----------------
    try {
      const result = await client.getPrompt({
        name: 'iterate_on_feedback',
        arguments: { feedback: 'the kitchen is too small' },
      })
      const messages = result.messages ?? []
      const userMsgs = messages.filter((m) => m.role === 'user')
      if (userMsgs.length === 0) {
        promptOutcomes.push(fail('iterate_on_feedback', 'no user messages returned'))
      } else {
        const firstText =
          userMsgs[0]?.content && 'text' in userMsgs[0].content
            ? String(userMsgs[0].content.text)
            : ''
        const mentionsFeedback = /kitchen is too small/i.test(firstText)
        promptOutcomes.push(
          ok(
            'iterate_on_feedback',
            `messages=${messages.length}, userMsgs=${userMsgs.length}, feedback-included=${mentionsFeedback}, preview: "${firstText.slice(0, 120).replace(/\n/g, ' ')}"`,
          ),
        )
      }
    } catch (err) {
      promptOutcomes.push(
        fail('iterate_on_feedback', `threw: ${err instanceof Error ? err.message : String(err)}`),
      )
    }

    // ---------------- Prompt 3: renovation_from_photos ----------------
    try {
      const result = await client.getPrompt({
        name: 'renovation_from_photos',
        arguments: {
          currentPhotos: 'https://example.com/a.jpg,https://example.com/b.jpg',
          referencePhotos: 'https://example.com/c.jpg',
          goals: 'open-plan kitchen',
        },
      })
      const messages = result.messages ?? []
      const userMsgs = messages.filter((m) => m.role === 'user')
      if (userMsgs.length === 0) {
        promptOutcomes.push(fail('renovation_from_photos', 'no user messages returned'))
      } else {
        // Look across all message content for the URLs we passed.
        const allText = messages
          .map((m) =>
            m.content && typeof m.content === 'object' && 'text' in m.content
              ? String((m.content as { text?: unknown }).text ?? '')
              : '',
          )
          .join('\n')
        const hasAUrl = /example\.com\/a\.jpg/.test(allText)
        const hasBUrl = /example\.com\/b\.jpg/.test(allText)
        const hasCUrl = /example\.com\/c\.jpg/.test(allText)
        const hasGoals = /open-plan kitchen/i.test(allText)
        promptOutcomes.push(
          ok(
            'renovation_from_photos',
            `messages=${messages.length}, userMsgs=${userMsgs.length}, urls(a/b/c)=${hasAUrl}/${hasBUrl}/${hasCUrl}, goals-included=${hasGoals}`,
          ),
        )
      }
    } catch (err) {
      promptOutcomes.push(
        fail(
          'renovation_from_photos',
          `threw: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
    }
  } finally {
    try {
      await client.close()
    } catch {
      // Ignore close errors.
    }
  }

  // ---------------- Print summary ----------------
  console.log('\n========== T5 SUMMARY ==========')
  console.log(`listResources count: ${listResourcesCount}`)
  console.log(`listPrompts count:   ${listPromptsCount}`)

  console.log('\n--- Resource results ---')
  let resPass = 0
  for (const o of resourceOutcomes) {
    console.log(`${o.pass ? 'PASS' : 'FAIL'}  ${o.name}  —  ${o.detail}`)
    if (o.pass) resPass++
  }
  console.log(`Resources pass: ${resPass}/${resourceOutcomes.length}`)

  console.log('\n--- Prompt results ---')
  let promPass = 0
  for (const o of promptOutcomes) {
    console.log(`${o.pass ? 'PASS' : 'FAIL'}  ${o.name}  —  ${o.detail}`)
    if (o.pass) promPass++
  }
  console.log(`Prompts pass: ${promPass}/${promptOutcomes.length}`)

  console.log('================================\n')
}

main().catch((err) => {
  console.error('[t5] fatal:', err instanceof Error ? (err.stack ?? err.message) : err)
  process.exit(1)
})
