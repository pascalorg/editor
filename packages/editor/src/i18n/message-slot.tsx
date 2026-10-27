import type { MessageDescriptor, PascalI18n } from '@pascal-app/core'
import { Fragment, type ReactNode } from 'react'

const SLOT = '\uE000'

/**
 * Renders a whole translated sentence with one React element (a bold name, a
 * link) where the message has `{slot}`, so translators can move it anywhere.
 */
export function messageWithSlot(
  i18n: PascalI18n,
  descriptor: MessageDescriptor,
  slot: string,
  element: ReactNode,
): ReactNode {
  const values = { ...descriptor.values, [slot]: SLOT }
  const text = i18n._(descriptor.id, values, { message: descriptor.message })
  const parts = text.split(SLOT)
  return parts.map((part, index) => (
    <Fragment key={index}>
      {index > 0 && element}
      {part}
    </Fragment>
  ))
}
