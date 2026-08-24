'use client'

import { WarehouseStatsTab } from '@ovurrsl/plugin-warehouse'
import { Editor } from '@pascal-app/editor'
import { AccountSettingsSection } from '@/components/account-settings-section'
import { EDITOR_SIDEBAR_TABS } from '@/components/editor-sidebar-tabs'
import {
  CommunityViewerToolbarLeft,
  CommunityViewerToolbarRight,
} from '@/components/viewer-toolbar'

const PROJECT_ID = 'local-editor'

/**
 * The full editor experience. Mounted by the root route for a signed-in
 * session, so the address bar shows just the domain; `/editor` survives only
 * as a redirect for old links.
 *
 * Upstream floats a "scenes are not saved" banner over the canvas here, with
 * links to open and create one. It sat across the 2D/3D/Split tabs, and the
 * Scenes rail now answers both links from inside the editor, so it is gone.
 */
export function EditorApp() {
  return (
    <div className="relative h-screen w-screen">
      <Editor
        layoutVersion="v2"
        projectId={PROJECT_ID}
        settingsPanelProps={{ accountSection: <AccountSettingsSection /> }}
        sitePanelProps={{ children: <WarehouseStatsTab /> }}
        sidebarTabs={EDITOR_SIDEBAR_TABS}
        viewerToolbarLeft={<CommunityViewerToolbarLeft />}
        viewerToolbarRight={<CommunityViewerToolbarRight />}
      />
    </div>
  )
}
