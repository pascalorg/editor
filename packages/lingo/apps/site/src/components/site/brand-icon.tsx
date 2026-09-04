type BrandIconName = 'github' | 'npm'

type BrandIconProps = React.SVGProps<SVGSVGElement> & {
  brand: BrandIconName
}

export function BrandIcon({ brand, ...props }: BrandIconProps) {
  return (
    <svg aria-hidden="true" fill="currentColor" focusable="false" viewBox="0 0 24 24" {...props}>
      {brand === 'github' ? (
        <path
          clipRule="evenodd"
          d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.85 10.92.58.11.79-.25.79-.56v-2.03c-3.2.7-3.87-1.35-3.87-1.35-.52-1.33-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.25 3.33.95.1-.74.4-1.25.72-1.53-2.55-.29-5.23-1.28-5.23-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18.91-.25 1.89-.38 2.86-.38s1.95.13 2.86.38c2.19-1.49 3.15-1.18 3.15-1.18.62 1.58.23 2.75.11 3.04.73.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.25 5.67.41.35.78 1.05.78 2.12v3.14c0 .31.21.67.8.56A11.52 11.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"
          fillRule="evenodd"
        />
      ) : (
        <path d="M1.5 7.25h21v8h-6v1.5h-5.25v-1.5H1.5v-8Zm1.5 1.5v5h3v-3.5h1.5v3.5H9v-5H3Zm7.5 0v6.5H12v-1.5h3.75v-5H10.5Zm1.5 1.5h2.25v2H12v-2Zm5.25-1.5v5h1.5v-3.5h1.5v3.5h1.25v-5h-4.25Z" />
      )}
    </svg>
  )
}
