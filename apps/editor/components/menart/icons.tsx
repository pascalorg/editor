import type { ReactNode, SVGProps } from 'react'

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number }

/**
 * The shell's line icons are inlined rather than pulled from `lucide-react`
 * so the geometry matches `Menart 3D.dc.html` exactly — several of them are
 * hand-tuned variants that no lucide export reproduces.
 */
function Icon({
  size = 16,
  strokeWidth = 2,
  children,
  ...props
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {children}
    </svg>
  )
}

export function RulerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4Z" />
      <path d="m7.5 10.5 2 2" />
      <path d="m10.5 7.5 2 2" />
      <path d="m13.5 4.5 2 2" />
    </Icon>
  )
}

export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.9 4.9 1.4 1.4" />
      <path d="m17.7 17.7 1.4 1.4" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.3 17.7-1.4 1.4" />
      <path d="m19.1 4.9-1.4 1.4" />
    </Icon>
  )
}

export function AssistantIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3v4" />
      <path d="m5.5 5.5 2.8 2.8" />
      <path d="M3 12h4" />
      <path d="M12 21a5 5 0 0 0 5-5c0-2-1-3-1-5a4 4 0 0 0-8 0c0 2-1 3-1 5a5 5 0 0 0 5 5Z" />
    </Icon>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </Icon>
  )
}

export function MoreIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
    </Icon>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </Icon>
  )
}

export function ChevronIcon(props: IconProps) {
  return (
    <Icon strokeWidth={2.5} {...props}>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon strokeWidth={3} {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  )
}

export function ChevronsLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m11 17-5-5 5-5" />
      <path d="m18 17-5-5 5-5" />
    </Icon>
  )
}

export function SplitIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="18" width="18" x="3" y="3" />
      <path d="M12 3v18" />
    </Icon>
  )
}

export function StackIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 8h16" />
      <path d="M4 13h16" />
      <path d="M4 18h16" />
    </Icon>
  )
}

export function SlidersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 5H3" />
      <path d="M12 19H3" />
      <path d="M14 3v4" />
      <path d="M16 17v4" />
      <path d="M21 12h-9" />
      <path d="M21 19h-5" />
      <path d="M21 5h-7" />
      <path d="M8 10v4" />
      <path d="M9 12H3" />
    </Icon>
  )
}

export function MagnetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 16v-2.5a2.5 2.5 0 0 1 5 0V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M4 11V6.5a2.5 2.5 0 0 1 5 0V11" />
      <path d="M15 20v-2.5a2.5 2.5 0 0 1 5 0V20a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2z" />
      <path d="M15 15v-4.5a2.5 2.5 0 0 1 5 0V15" />
    </Icon>
  )
}

export function EyeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  )
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon strokeWidth={2.5} {...props}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </Icon>
  )
}
