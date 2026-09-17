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
  return (
    <Checkbox
      aria-label={`In ${unitName}`}
      checked={checked}
      className="mr-2"
      onCheckedChange={onToggle}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  )
}
