import { usePascalI18n } from '@pascal-app/core'
import { Checkbox } from './../../../primitives/checkbox'

/** Membership toggle shown on zone rows while a unit is focused. */
export function ZoneMembershipCheckbox({
  checked,
  onToggle,
  unitName,
}: {
  checked: boolean
  onToggle: () => void
  unitName: string
}) {
  const i18n = usePascalI18n()
  return (
    <Checkbox
      aria-label={i18n._({ id: 'editor.sidebar.panels.sitePanel.zoneMembershipCheckbox.inUnitname', message: 'In {unitName}', values: { unitName } })}
      checked={checked}
      className="mr-2"
      onCheckedChange={onToggle}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  )
}
