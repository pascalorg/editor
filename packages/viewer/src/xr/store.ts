import {
  createXRStore,
  type XRStore,
  type XRStoreOptions,
} from '@react-three/xr'
import { VisibleXRController, VisibleXRHand } from './input-visuals'

export type ViewerXRStore = XRStore

export function createViewerXRStore(options: XRStoreOptions = {}): ViewerXRStore {
  return createXRStore({
    controller: VisibleXRController,
    hand: VisibleXRHand,
    offerSession: false,
    ...options,
  })
}
