import Store from 'electron-store'
import type { LocalState } from '@shared/types'

const defaults: LocalState = {
  settings: {
    communityPath: null,

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
  return store.store
}

export function setSettings(patch: Partial<LocalState['settings']>): LocalState {
  const current = store.store
  store.set('settings', { ...current.settings, ...patch })
  return store.store
}

export function setInstalled(addonId: string, record: LocalState['installed'][string] | null): LocalState {
  const installed = { ...store.get('installed') }
  if (record) installed[addonId] = record
  else delete installed[addonId]
  store.set('installed', installed)
  return store.store
}
