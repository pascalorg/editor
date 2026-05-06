import type { GuideNode } from '@pascal-app/core'
import mitt from 'mitt'

type GuideEditorEvents = {
  'guide:set-reference-scale': { guideId: GuideNode['id'] }
  'guide:cancel-reference-scale': undefined
  'guide:deleted': { guideId: GuideNode['id'] }
}

export const guideEmitter = mitt<GuideEditorEvents>()
