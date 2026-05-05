export function cn(...classes: Array<boolean | null | string | undefined>) {
  return classes.filter(Boolean).join(' ')
}
