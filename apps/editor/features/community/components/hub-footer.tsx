import Link from 'next/link'

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  )
}

function NpmIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 256 256">
      <rect width="256" height="256" rx="0" fill="#C12127" />
      <polygon points="48,48 208,48 208,208 176,208 176,80 128,80 128,208 48,208" fill="#FFFFFF" />
    </svg>
  )
}

export function HubFooter() {
  return (
    <footer className="border-t border-border mt-16">
      <div className="container mx-auto px-6 py-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-muted-foreground text-sm">
            Editor by{' '}
            <a
              href="https://pascal.app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground hover:underline"
            >
              Pascal
            </a>
          </p>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/pascalorg/editor"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm"
            >
              <GitHubIcon className="h-4 w-4" />
              GitHub
            </a>
            <a
              href="https://www.npmjs.com/package/@pascal-app/viewer"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm"
            >
              <NpmIcon className="h-4 w-4" />
              Viewer
            </a>
            <a
              href="https://www.npmjs.com/package/@pascal-app/core"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm"
            >
              <NpmIcon className="h-4 w-4" />
              Core
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
