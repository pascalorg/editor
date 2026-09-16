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
    <input
      aria-label={`In ${unitName}`}
      checked={checked}
      className="mr-2 h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
      onChange={onToggle}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      type="checkbox"
    />
  )
}

