export type AddonChannelKey = 'stable' | 'beta' | 'dev'

export interface ManifestCategory {
  id: string
  name: string
  icon?: string
}

export interface ManifestAddonChannel {
  key: AddonChannelKey
  version: string
  /** Preferred download URL (zip). */
  zipUrl?: string
  /** Legacy/compat download URL (zip). */
  url?: string
  sha256: string
  /** Download size (zip). */
  sizeBytes?: number
  /** Estimated/known extracted installed size (preferred for disk space checks). */
  installedSizeBytes?: number
  releaseNotesUrl?: string
}

export interface ManifestAddon {
  id: string
  name: string
  description: string
  categoryId: string
  bannerUrl?: string
  screenshotUrl?: string
  // One addon can install one-or-more folders into the Community directory.
  // If omitted, installer will infer from extracted top-level folders.
  packageFolderNames?: string[]
  /** Allow "raw" installs for ZIPs that don't contain MSFS package manifests (manifest.json/layout.json). */
  allowRawInstall?: boolean
  channels: Record<AddonChannelKey, ManifestAddonChannel | undefined>
}

export interface RemoteManifest {
  schemaVersion: number
  generatedAt: string
  categories: ManifestCategory[]
  addons: ManifestAddon[]
}

export interface InstalledAddonRecord {
  addonId: string
  channel: AddonChannelKey
  installedVersion: string
  installedAt: string
  // Absolute paths of installed folders under Community
  installedPaths: string[]
}

export interface AppSettings {
  communityPath: string | null

  /** Install destination (defaults to Community). */
  installPath?: string | null
  installPathMode?: 'followCommunity' | 'custom'

  /** Windows-only detection knobs (still allow manual browse). */
  windowsMsStorePackageFamilyName?: string
  windowsCommunityCandidates?: string[]

  /** Optional UX preferences */
  theme?: 'dark'
  languageMode?: 'system' | 'en' | 'nl'

}

export interface LocalState {
  settings: AppSettings
  installed: Record<string, InstalledAddonRecord>
}

export type InstallStatus = 'not_installed' | 'installed' | 'update_available'

export interface InstallProgressEvent {
  addonId: string
  phase:
    | 'downloading'
    | 'verifying'
    | 'extracting'
    | 'installing'
    | 'uninstalling'
    | 'done'
  percent?: number
  transferredBytes?: number
  totalBytes?: number
  message?: string
}
