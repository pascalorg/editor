import { create } from 'zustand'

export type UploadStatus = 'preparing' | 'uploading' | 'confirming' | 'done' | 'error'

export interface UploadEntry {
  status: UploadStatus
  assetType: 'scan' | 'guide'
  fileName: string
  progress: number // 0-100
  error: string | null
  resultUrl: string | null
}

interface UploadState {
  uploads: Record<string, UploadEntry>
  startUpload: (levelId: string, assetType: 'scan' | 'guide', fileName: string) => void
  setProgress: (levelId: string, progress: number) => void
  setStatus: (levelId: string, status: UploadStatus) => void
  setError: (levelId: string, error: string) => void
  setResult: (levelId: string, url: string) => void
  clearUpload: (levelId: string) => void
}

export const useUploadStore = create<UploadState>((set) => ({
  uploads: {},

  startUpload: (levelId, assetType, fileName) =>
    set((s) => ({
      uploads: {
        ...s.uploads,
        [levelId]: { status: 'preparing', assetType, fileName, progress: 0, error: null, resultUrl: null },
      },
    })),

  setProgress: (levelId, progress) =>
    set((s) => {
      const entry = s.uploads[levelId]
      if (!entry) return s
      return { uploads: { ...s.uploads, [levelId]: { ...entry, progress } } }
    }),

  setStatus: (levelId, status) =>
    set((s) => {
      const entry = s.uploads[levelId]
      if (!entry) return s
      return { uploads: { ...s.uploads, [levelId]: { ...entry, status } } }
    }),

  setError: (levelId, error) =>
    set((s) => {
      const entry = s.uploads[levelId]
      if (!entry) return s
      return { uploads: { ...s.uploads, [levelId]: { ...entry, status: 'error' as const, error } } }
    }),

  setResult: (levelId, url) =>
    set((s) => {
      const entry = s.uploads[levelId]
      if (!entry) return s
      return { uploads: { ...s.uploads, [levelId]: { ...entry, status: 'done' as const, resultUrl: url } } }
    }),

  clearUpload: (levelId) =>
    set((s) => {
      const { [levelId]: _, ...rest } = s.uploads
      return { uploads: rest }
    }),
}))
