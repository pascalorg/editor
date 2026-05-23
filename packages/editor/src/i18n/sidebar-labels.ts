import { t } from './t'

export function lblCameraSnapshot(): string {
  return t('sidebar.cameraSnapshot', 'Camera snapshot')
}

export function lblViewSnapshot(): string {
  return t('sidebar.viewSnapshot', 'View snapshot')
}

export function lblTakeOrUpdateSnapshot(hasCamera: boolean): string {
  return hasCamera
    ? t('sidebar.updateSnapshot', 'Update snapshot')
    : t('sidebar.takeSnapshot', 'Take snapshot')
}

export function lblClearSnapshot(): string {
  return t('sidebar.clearSnapshot', 'Clear snapshot')
}

export function lblShow(): string {
  return t('sidebar.show', 'Show')
}

export function lblHide(): string {
  return t('sidebar.hide', 'Hide')
}

export function lblLevelFallback(level: number): string {
  return t('sidebar.levelFallback', { fallback: 'Level {level}', params: { level } })
}
