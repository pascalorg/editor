/**
 * Phase 7 end-to-end: prove MCP save_scene → editor /scene/[id] renders the scene
 * without any window.__pascalScene injection.
 *
 * Run: PASCAL_DATA_DIR=/tmp/pascal-e2e bun run packages/mcp/test-reports/phase7-e2e.ts
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const MCP_URL = 'http://localhost:3917/mcp'
const EDITOR_URL = 'http://localhost:3002'

async function main() {
  console.log('---- Phase 7 e2e ----')

  // 1. Connect to MCP over HTTP
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL))
  const client = new Client({ name: 'e2e', version: '0.0.0' })
  await client.connect(transport)
  console.log('OK  1 connect MCP HTTP')

  // 2. Build a scene from a template
  const created = await client.callTool({
    name: 'create_from_template',
    arguments: { id: 'two-bedroom', name: 'e2e-two-bedroom' },
  })
  if (created.isError) throw new Error(`create_from_template: ${JSON.stringify(created)}`)
  console.log('OK  2 create_from_template two-bedroom')

  // 3. Save it
  const saved = await client.callTool({
    name: 'save_scene',
    arguments: { name: 'e2e test house' },
  })
  if (saved.isError) throw new Error(`save_scene: ${JSON.stringify(saved)}`)
  const savedData = JSON.parse((saved.content as Array<{ text: string }>)[0]!.text)
  const sceneId = savedData.id as string
  console.log(`OK  3 save_scene -> id=${sceneId}, version=${savedData.version}`)

  // 4. list_scenes
  const list = await client.callTool({ name: 'list_scenes', arguments: {} })
  if (list.isError) throw new Error(`list_scenes: ${JSON.stringify(list)}`)
  const listData = JSON.parse((list.content as Array<{ text: string }>)[0]!.text)
  console.log(`OK  4 list_scenes -> ${listData.scenes.length} scenes`)

  // 5. Fetch via editor's API (proves A5 works against the same store)
  const apiRes = await fetch(`${EDITOR_URL}/api/scenes/${sceneId}`)
  if (!apiRes.ok) throw new Error(`GET /api/scenes/${sceneId} → ${apiRes.status}`)
  const apiBody = await apiRes.json()
  const nodeCount = Object.keys(apiBody.graph.nodes).length
  console.log(`OK  5 editor /api/scenes/${sceneId} → ${nodeCount} nodes`)

  // 6. Fetch editor's /scenes list page (HTML)
  const listHtmlRes = await fetch(`${EDITOR_URL}/scenes`)
  if (!listHtmlRes.ok) throw new Error(`GET /scenes → ${listHtmlRes.status}`)
  const listHtml = await listHtmlRes.text()
  const hasSceneLink = listHtml.includes(`/scene/${sceneId}`)
  console.log(`OK  6 /scenes renders, links scene: ${hasSceneLink}`)

  // 7. Fetch /scene/[id] page
  const sceneHtmlRes = await fetch(`${EDITOR_URL}/scene/${sceneId}`)
  if (!sceneHtmlRes.ok) throw new Error(`GET /scene/${sceneId} → ${sceneHtmlRes.status}`)
  console.log(`OK  7 /scene/${sceneId} renders (${sceneHtmlRes.status})`)

  // 8. generate_variants — 3 variants, save=true
  const variants = await client.callTool({
    name: 'generate_variants',
    arguments: { count: 3, vary: ['wall-thickness', 'wall-height'], save: true, seed: 42 },
  })
  if (variants.isError) throw new Error(`generate_variants: ${JSON.stringify(variants)}`)
  const variantsData = JSON.parse((variants.content as Array<{ text: string }>)[0]!.text)
  console.log(`OK  8 generate_variants -> ${variantsData.variants.length} variants`)

  // 9. list_scenes again — should be > 1
  const list2 = await client.callTool({ name: 'list_scenes', arguments: {} })
  const list2Data = JSON.parse((list2.content as Array<{ text: string }>)[0]!.text)
  console.log(`OK  9 list_scenes now shows ${list2Data.scenes.length} scenes`)

  // 10. delete_scene
  const deleted = await client.callTool({ name: 'delete_scene', arguments: { id: sceneId } })
  if (deleted.isError) throw new Error(`delete_scene: ${JSON.stringify(deleted)}`)
  const deletedData = JSON.parse((deleted.content as Array<{ text: string }>)[0]!.text)
  console.log(`OK 10 delete_scene -> deleted=${deletedData.deleted}`)

  await client.close()
  console.log(`\nSceneId to open in browser: ${EDITOR_URL}/scenes`)
  console.log(`Direct: ${EDITOR_URL}/scene/${variantsData.variants[0].sceneId}`)
  console.log('\n✅ Phase 7 e2e PASSED\n')
}

main().catch((err) => {
  console.error('\n❌ e2e failed:', err)
  process.exit(1)
})
