/** A small mark beside a name: the plan a plugin needs ("Pro"), as the plugin manager shows it. */
export function Badge({ label }: { label: string }) {
  return (
    <span className="rounded-[5px] border border-border px-1.5 py-px font-mono font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
      {label}
    </span>
  )
}
