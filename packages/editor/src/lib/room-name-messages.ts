import type { MessageDescriptor } from '@pascal-app/core'
import { type DescriptorTranslator, displayRoomName } from '@pascal-app/viewer/ui'
import type { RoomNameSection } from './room-name-catalog'

export const ROOM_NAME_SECTION_TITLES: Record<string, MessageDescriptor> = {
  living: /* i18n */ { id: 'editor.roomName.section.living', message: 'Living' },
  sleeping: /* i18n */ { id: 'editor.roomName.section.sleeping', message: 'Sleeping' },
  bathrooms: /* i18n */ { id: 'editor.roomName.section.bathrooms', message: 'Bathrooms' },
  work: /* i18n */ { id: 'editor.roomName.section.work', message: 'Work & hobbies' },
  circulation: /* i18n */ { id: 'editor.roomName.section.circulation', message: 'Circulation' },
  utility: /* i18n */ { id: 'editor.roomName.section.utility', message: 'Utility & storage' },
  outdoor: /* i18n */ { id: 'editor.roomName.section.outdoor', message: 'Outdoor' },
  mezzanine: /* i18n */ { id: 'editor.roomName.section.mezzanine', message: 'Mezzanine' },
}

export function localizedRoomNameSections(
  sections: readonly RoomNameSection[],
  i18n: DescriptorTranslator,
): RoomNameSection[] {
  return sections.map((section) => {
    const title = Object.hasOwn(ROOM_NAME_SECTION_TITLES, section.id)
      ? ROOM_NAME_SECTION_TITLES[section.id]
      : undefined
    return {
      ...section,
      title: title ? i18n._(title) : section.title,
      labels: section.names.map((name) => displayRoomName(name, i18n)),
    }
  })
}
