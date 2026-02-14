import Store from 'electron-store'
import type { LocalState } from '@shared/types'

const defaults: LocalState = {
  settings: {
    communityPath: null,

    installPathMode: 'followCommunity',
    installPath: null,

    windowsMsStorePackageFamilyName: 'Microsoft.FlightSimulator_8wekyb3d8bbwe',
    windowsCommunityCandidates: [],

    theme: 'dark',
    languageMode: 'system',

  },
  installed: {},
}

export const store = new Store<LocalState>({
  name: 'dsfc',
  defaults,
})

export function getState(): LocalState {
  // Migration: older versions stored installed.channel instead of installedChannel.
  // Normalize on read so renderer + IPC can rely on the new shape.
  const s = store.store as any
  const installed = s.installed ?? {}
  let changed = false

  for (const [addonId, rec] of Object.entries<any>(installed)) {
    if (!rec || typeof rec !== 'object') continue

    // If already migrated, skip.
    if (rec.installed === true && 'installedChannel' in rec && 'installPath' in rec) continue

    const installedChannel = rec.installedChannel ?? rec.channel ?? null
    const installPath = rec.installPath ?? (s.settings?.installPath ?? s.settings?.communityPath ?? null)

    installed[addonId] = {
      addonId: rec.addonId ?? addonId,
      installed: true,
      installedChannel: installedChannel ?? 'unknown',
      installedVersion: rec.installedVersion ?? 'unknown',
      installPath: installPath ?? '',
      installedAt: rec.installedAt ?? new Date().toISOString(),
      installedPaths: Array.isArray(rec.installedPaths) ? rec.installedPaths : [],
    }
    changed = true
  }

  if (changed) {
    store.set('installed', installed)
  }

  return store.store
}

export function setSettings(patch: Partial<LocalState['settings']>): LocalState {
  const current = store.store
  const merged = { ...current.settings, ...patch }

  // Ensure defaults for new installPath settings.
  if (!merged.installPathMode) merged.installPathMode = 'followCommunity'

  // If mode is followCommunity, installPath mirrors communityPath.
  if (merged.installPathMode === 'followCommunity') {
    merged.installPath = merged.communityPath
  }

  store.set('settings', merged)
  return store.store
}

export function setInstalled(addonId: string, record: LocalState['installed'][string] | null): LocalState {
  const installed = { ...store.get('installed') }
  if (record) installed[addonId] = record
  else delete installed[addonId]
  store.set('installed', installed)
  return store.store
}
