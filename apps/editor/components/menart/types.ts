export type MenartTheme = 'dark' | 'light'

export type ViewMode = '3d' | '2d' | 'split'

/** The right-hand toolbar tools are mutually exclusive; `null` means none armed. */
export type CanvasTool = 'section' | 'measure' | null
