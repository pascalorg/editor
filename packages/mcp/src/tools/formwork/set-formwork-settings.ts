import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  applyFormworkSettingsPatch,
  findFormworkSettingsNode,
  formworkSettings,
  formworkSettingsPatchInput,
  SET_FORMWORK_SETTINGS_DESCRIPTION,
} from '@pascal-app/core/formwork'
import { type AnyNode, type AnyNodeId, FormworkProjectSettingsNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../../operations'
import { publishLiveSceneSnapshot } from '../live-sync'
import { formworkAssemblyCount, refusal, sceneNodeList, textResult } from './shared'

export const setFormworkSettingsOutput = {
  changed: z.array(z.string()),
  designsTo: z.object({
    riseRateMH: z.number(),
    concreteTemperatureC: z.number(),
    pressureStandard: z.string(),
  }),
  shuttersReDesigned: z.number(),
  message: z.string(),
}

/**
 * The project's pour, stated from outside the editor — the first formwork *write* on
 * this surface.
 *
 * The schema, the validation and the merge are all core's, shared with the editor's own
 * chat tools rather than restated here. That is the whole point of the module: an outside
 * agent and the in-editor one must not disagree about what `null` means, which catalog
 * ids are real, or whether an emptied rack is a claim, because the design report's
 * "assumed" versus "project" distinction is exactly what such a disagreement destroys.
 *
 * Two things are this layer's own:
 *
 * 1. **The node is parented to the site.** The store's loader sweeps any node whose
 *    parent is not in the scene, so an unparented settings node survives the reply and
 *    vanishes on reload — the pour reverting to the shipped defaults with nothing to show
 *    it ever changed. A scene with no site is refused rather than given an orphan.
 * 2. **The publish is what re-sizes the shutters on screen, and no dirty sweep is
 *    needed.** The panel's writer marks every assembly in the scene, because a design
 *    input lives outside the shutters it sizes and an incremental `updateNode` reaches
 *    only the edited node and its parent — without that sweep the report re-reads the
 *    new pour while the 3D shutters keep the spacings they were built with. This path is
 *    not incremental: `publishLiveSceneSnapshot` sends the whole graph, which the browser
 *    applies through `setScene`, rebuilding from scratch. Marking a node in *this*
 *    process would achieve nothing anyway — the MCP bridge has no renderer to notify.
 */
export function registerSetFormworkSettings(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'set_formwork_settings',
    {
      title: 'Set formwork settings',
      description: SET_FORMWORK_SETTINGS_DESCRIPTION,
      inputSchema: formworkSettingsPatchInput,
      outputSchema: setFormworkSettingsOutput,
    },
    async (patch) => {
      const nodes = sceneNodeList(bridge)
      const existing = findFormworkSettingsNode(nodes)

      // Validated before the node is created, so a refused call leaves a project that
      // has stated nothing still stating nothing.
      const result = applyFormworkSettingsPatch(existing, patch)
      if (result.error !== undefined) return refusal(result.error)

      let target = existing
      if (!target) {
        const site = nodes.find((node) => node.type === 'site')
        if (!site) {
          return refusal(
            'Error: this scene has no site, so there is nowhere to store project settings.',
          )
        }
        // Parsed rather than hand-built: the schema generates the id and fills the base
        // node's defaults, and a `formwork-settings_`-prefixed id is what it checks.
        target = FormworkProjectSettingsNode.parse({ parentId: site.id })
        bridge.createNode(target as unknown as AnyNode, site.id as AnyNodeId)
      }

      bridge.updateNode(target.id as AnyNodeId, result.writes as Partial<AnyNode>)
      await publishLiveSceneSnapshot(bridge, 'set_formwork_settings')

      const after = sceneNodeList(bridge)
      const resolved = formworkSettings(findFormworkSettingsNode(after))
      const shutters = formworkAssemblyCount(after)
      const designsTo = `the scene now designs to ${resolved.riseRateMH} m/h at ${resolved.concreteTemperatureC} °C under ${resolved.pressureStandard}`
      return textResult({
        changed: result.changed,
        designsTo: {
          riseRateMH: resolved.riseRateMH,
          concreteTemperatureC: resolved.concreteTemperatureC,
          pressureStandard: resolved.pressureStandard as string,
        },
        shuttersReDesigned: shutters,
        // Re-solved on read rather than on write: the parts and the design report both
        // solve from the settings each time they are asked, so there is nothing to
        // regenerate and asking for a re-attach would discard every per-part decision
        // on a shutter to rebuild what had not changed.
        message:
          shutters === 0
            ? `ok — ${result.changed.join(', ')} set; ${designsTo}`
            : `ok — ${result.changed.join(', ')} set; ${designsTo}, and ${shutters === 1 ? 'the existing shutter is' : `all ${shutters} existing shutters are`} re-designed to it — nothing to regenerate. Re-read inspect_project_formwork if you have already quoted a spacing or a count.`,
      })
    },
  )
}
