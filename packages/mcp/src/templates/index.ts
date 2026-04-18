import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import * as emptyStudio from './empty-studio'
import * as gardenHouse from './garden-house'
import * as twoBedroom from './two-bedroom'

export type TemplateMetadata = {
  id: string
  name: string
  description: string
}

export type TemplateEntry = {
  /** Stable template id used by `create_from_template`. */
  id: string
  name: string
  description: string
  /** Static SceneGraph — ids are placeholders; regenerate via `cloneSceneGraph`. */
  template: SceneGraph
}

function makeEntry(template: SceneGraph, metadata: TemplateMetadata): TemplateEntry {
  return {
    id: metadata.id,
    name: metadata.name,
    description: metadata.description,
    template,
  }
}

export const TEMPLATES = {
  'empty-studio': makeEntry(emptyStudio.template, emptyStudio.metadata),
  'two-bedroom': makeEntry(twoBedroom.template, twoBedroom.metadata),
  'garden-house': makeEntry(gardenHouse.template, gardenHouse.metadata),
} as const

export type TemplateId = keyof typeof TEMPLATES

/** Type guard for external callers that receive arbitrary string ids. */
export function isTemplateId(id: string): id is TemplateId {
  return Object.hasOwn(TEMPLATES, id)
}
