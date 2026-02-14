import React from 'react'

export function SettingsModal(props: {
  open: boolean
  onClose: () => void
  t: (k: any) => string

  appVersion: string | null
  appIsPackaged: boolean | null

  communityPath: string | null
  installPath: string | null
  installPathMode: 'followCommunity' | 'custom'

  autoDetectResult: string | null
  installPathResult: string | null

  onBrowseCommunity: () => void
  onAutoDetectCommunity: () => void
  onTestCommunity: () => void

  onBrowseInstallPath: () => void
  onUseCommunityForInstallPath: () => void
  onTestInstallPath: () => void

  msStorePackageFamilyName: string
  setMsStorePackageFamilyName: (v: string) => void
  candidates: string
  setCandidates: (v: string) => void

  theme: 'dark'
  setTheme: (v: 'dark') => void
  languageMode: 'system' | 'en' | 'nl'
  setLanguageMode: (v: 'system' | 'en' | 'nl') => void

  onSave: () => void
}) {
  if (!props.open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={props.onClose} />
      <div className="absolute left-1/2 top-1/2 w-[780px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-bg-900 overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">{props.t('settings.title')}</div>
            <div className="text-xs text-text-400 mt-1">{props.t('settings.subtitle')}</div>
          </div>
          <button onClick={props.onClose} className="text-text-400 hover:text-text-100">{props.t('common.close')}</button>
        </div>

        <div className="p-4 grid grid-cols-12 gap-3">
          <div className="col-span-12">
            <div className="text-xs text-text-400 mb-1">{props.t('settings.communityFolder')}</div>
            <div className="flex items-center gap-2">
              <div
                className="flex-1 bg-bg-800 border border-border rounded-md px-3 py-2 text-sm text-text-200 truncate"
                title={props.communityPath ?? ''}
              >
                {props.communityPath ?? props.t('common.notSet')}
              </div>
              <button
                onClick={props.onAutoDetectCommunity}
                className="px-3 py-2 rounded-md border border-border bg-bg-800 text-sm hover:bg-bg-700"
              >
                {props.t('settings.autoDetect')}
              </button>
              <button
                onClick={props.onBrowseCommunity}
                className="px-3 py-2 rounded-md border border-border bg-bg-800 text-sm hover:bg-bg-700"
              >
                {props.t('settings.browse')}
              </button>
              <button
                onClick={props.onTestCommunity}
                className="px-3 py-2 rounded-md border border-accent2/40 bg-accent2/20 text-sm hover:bg-accent2/30"
              >
                {props.t('settings.testPath')}
              </button>
            </div>
            {props.autoDetectResult ? (
              <div className="mt-2 text-xs text-text-400">{props.autoDetectResult}</div>
            ) : null}
          </div>

          <div className="col-span-12">
            <div className="text-xs text-text-400 mb-1">{props.t('settings.installPath')}</div>
            <div className="flex items-center gap-2">
              <div
                className="flex-1 bg-bg-800 border border-border rounded-md px-3 py-2 text-sm text-text-200 truncate"
                title={props.installPath ?? ''}
              >
                {props.installPath ?? props.t('common.notSet')}
              </div>
              <button
                onClick={props.onBrowseInstallPath}
                className="px-3 py-2 rounded-md border border-border bg-bg-800 text-sm hover:bg-bg-700"
              >
                {props.t('settings.browse')}
              </button>
              <button
                onClick={props.onUseCommunityForInstallPath}
                disabled={!props.communityPath}
                className={
                  `px-3 py-2 rounded-md border border-border bg-bg-800 text-sm hover:bg-bg-700 ` +
                  (!props.communityPath ? 'opacity-50 cursor-not-allowed' : '')
                }
              >
                {props.t('settings.useCommunityFolder')}
              </button>
              <button
                onClick={props.onTestInstallPath}
                className="px-3 py-2 rounded-md border border-accent2/40 bg-accent2/20 text-sm hover:bg-accent2/30"
              >
                {props.t('settings.installPath.test')}
              </button>
            </div>
            {props.installPathMode === 'custom' ? (
              <div className="mt-2 text-xs text-text-400">{props.installPathResult ?? ''}</div>
            ) : props.installPathResult ? (
              <div className="mt-2 text-xs text-text-400">{props.installPathResult}</div>
            ) : null}
          </div>

          <label className="col-span-6">
            <div className="text-xs text-text-400 mb-1">{props.t('settings.theme')}</div>
            <select
              value={props.theme}
              onChange={(e) => props.setTheme(e.target.value as 'dark')}
              className="w-full bg-bg-800 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-accent"
            >
              <option value="dark">{props.t('settings.theme.dark')}</option>
            </select>
          </label>

          <label className="col-span-6">
            <div className="text-xs text-text-400 mb-1">{props.t('settings.language')}</div>
            <select
              value={props.languageMode}
              onChange={(e) => props.setLanguageMode(e.target.value as any)}
              className="w-full bg-bg-800 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-accent"
            >
              <option value="system">{props.t('settings.language.system')}</option>
              <option value="en">{props.t('settings.language.en')}</option>
              <option value="nl">{props.t('settings.language.nl')}</option>
            </select>
          </label>

          <label className="col-span-6">
            <div className="text-xs text-text-400 mb-1">{props.t('settings.windows.msStoreFamily')}</div>
            <input
              value={props.msStorePackageFamilyName}
              onChange={(e) => props.setMsStorePackageFamilyName(e.target.value)}
              className="w-full bg-bg-800 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-accent"
              placeholder="Microsoft.FlightSimulator_8wekyb3d8bbwe"
            />
          </label>

          <label className="col-span-6">
            <div className="text-xs text-text-400 mb-1">{props.t('settings.windows.extraCandidates')}</div>
            <textarea
              value={props.candidates}
              onChange={(e) => props.setCandidates(e.target.value)}
              className="w-full bg-bg-800 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-accent h-28"
              placeholder="D:\\MSFS\\Packages\\Community"
            />
          </label>

          {/* About / app version */}
          <div className="col-span-12 mt-2">
            <div className="text-xs text-text-400 mb-1">{props.t('settings.aboutTitle')}</div>
            <div className="rounded-xl border border-border bg-bg-800 px-3 py-3">
              <div className="text-[11px] text-text-400">{props.t('settings.installedVersion')}</div>
              <div className="mt-1 text-sm font-semibold text-text-100">
                {props.appVersion ? `v${props.appVersion}` : '—'}
                {props.appIsPackaged === false ? ` (${props.t('settings.channel.dev')})` : props.appIsPackaged === true ? ` (${props.t('settings.channel.release')})` : ''}
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-border flex gap-2 justify-end">
          <button onClick={props.onClose} className="px-4 py-2 rounded-xl border border-accent2/40 bg-accent2/20 text-sm hover:bg-accent2/30">
            {props.t('common.cancel')}
          </button>
          <button onClick={props.onSave} className="px-4 py-2 rounded-xl bg-accent text-black text-sm font-semibold hover:brightness-110">
            {props.t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
