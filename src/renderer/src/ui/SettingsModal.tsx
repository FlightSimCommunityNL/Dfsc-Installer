import React, { useEffect } from 'react'
import { RefreshCw, FolderSearch, FolderOpen, Download } from 'lucide-react'

function SectionCard(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-bg-900/60 p-3">
      <div className="text-[11px] uppercase tracking-wide text-text-400 mb-2">{props.title}</div>
      {props.children}
    </section>
  )
}

function ReadonlyPath(props: { value: string | null; fallback: string }) {
  return (
    <div
      className="w-full bg-bg-800 border border-border rounded-xl px-3 py-1.5 text-sm text-text-200 truncate"
      title={props.value ?? ''}
    >
      {props.value ?? props.fallback}
    </div>
  )
}

const buttonBase =
  'h-8 px-3 rounded-xl border border-border bg-bg-800 text-sm text-text-100 hover:bg-bg-700 inline-flex items-center gap-2'

export function SettingsModal(props: {
  open: boolean
  onClose: () => void
  t: (k: any) => string

  appVersion: string | null
  appIsPackaged: boolean | null

  updateState:
    | { status: 'idle' }
    | { status: 'checking' }
    | { status: 'available'; version: string; releaseNotes?: string; releaseUrl?: string }
    | { status: 'not-available' }
    | { status: 'progress'; percent: number; transferred: number; total: number; bytesPerSecond: number }
    | { status: 'downloaded'; version: string }
    | { status: 'error'; message: string }

  onCheckUpdates: () => Promise<any>
  onInstallUpdate: () => Promise<any>

  communityPath: string | null
  installPath: string | null
  installPathMode: 'followCommunity' | 'custom'

  autoDetectResult: string | null
  installPathResult: string | null

  onBrowseCommunity: () => void
  onAutoDetectCommunity: () => void

  onBrowseInstallPath: () => void
  onUseCommunityForInstallPath: () => void

  languageMode: 'system' | 'en' | 'nl'
  setLanguageMode: (v: 'system' | 'en' | 'nl') => void

  onSave: () => void
}) {
  if (!props.open) return null

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [props])

  const isUpdateBusy = props.updateState.status === 'checking' || props.updateState.status === 'progress'
  const updateButtonLabel =
    props.updateState.status === 'checking'
      ? props.t('settings.updates.checking')
      : props.updateState.status === 'progress'
        ? `${props.t('settings.updates.downloading')} ${(props.updateState.percent ?? 0).toFixed(0)}%`
        : props.updateState.status === 'available' || props.updateState.status === 'downloaded'
          ? props.t('settings.updates.install')
          : props.t('settings.updates.check')

  return (
    <div className="fixed inset-0 z-50 dsfc-no-drag" style={{ WebkitAppRegion: 'no-drag' as any }}>
      <div
        className="absolute inset-0 bg-black/60 z-0"
        onMouseDown={props.onClose}
        role="button"
        aria-label="Close"
      />

      <div
        className="absolute z-10 left-1/2 top-1/2 w-[820px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-24px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-bg-900 overflow-hidden flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header (fixed) */}
        <div className="flex-shrink-0 px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="text-sm font-semibold">{props.t('settings.title')}</div>
          <button
            onClick={props.onClose}
            className="dsfc-no-drag text-text-400 hover:text-text-100"
            style={{ WebkitAppRegion: 'no-drag' as any }}
            type="button"
          >
            {props.t('common.close')}
          </button>
        </div>

        {/* Body (scrollable) */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          <div className="grid grid-cols-12 gap-3">
            {/* 1) MSFS Community-map */}
            <div className="col-span-12">
              <SectionCard title={props.t('settings.communityFolder')}>
                <div className="flex flex-col gap-2">
                  <ReadonlyPath value={props.communityPath} fallback={props.t('common.notSet')} />
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={props.onAutoDetectCommunity} className={`dsfc-no-drag ${buttonBase}`} style={{ WebkitAppRegion: 'no-drag' as any }} type="button">
                      <FolderSearch size={15} className="text-text-300" />
                      {props.t('settings.autoDetect')}
                    </button>
                    <button onClick={props.onBrowseCommunity} className={`dsfc-no-drag ${buttonBase}`} style={{ WebkitAppRegion: 'no-drag' as any }} type="button">
                      <FolderOpen size={15} className="text-text-300" />
                      {props.t('settings.browse')}
                    </button>
                  </div>
                  {props.autoDetectResult ? (
                    <div className="text-xs text-text-400">{props.autoDetectResult}</div>
                  ) : null}
                </div>
              </SectionCard>
            </div>

            {/* 2) Installatiepad */}
            <div className="col-span-12">
              <SectionCard title={props.t('settings.installPath')}>
                <div className="flex flex-col gap-2">
                  <ReadonlyPath value={props.installPath} fallback={props.t('common.notSet')} />

                  <div className="flex items-center justify-end gap-2">
                    <button onClick={props.onBrowseInstallPath} className={`dsfc-no-drag ${buttonBase}`} style={{ WebkitAppRegion: 'no-drag' as any }} type="button">
                      <FolderOpen size={15} className="text-text-300" />
                      {props.t('settings.browse')}
                    </button>
                    <button
                      onClick={props.onUseCommunityForInstallPath}
                      disabled={!props.communityPath}
                      className={`dsfc-no-drag ${buttonBase}` + (!props.communityPath ? ' opacity-50 cursor-not-allowed' : '')}
                      style={{ WebkitAppRegion: 'no-drag' as any }}
                      type="button"
                    >
                      {props.t('settings.useCommunityFolder')}
                    </button>
                  </div>

                  {props.installPathResult ? (
                    <div className="text-xs text-text-400">{props.installPathResult}</div>
                  ) : null}
                </div>
              </SectionCard>
            </div>

            {/* 3) Taal */}
            <div className="col-span-12">
              <SectionCard title={props.t('settings.language')}>
                <select
                  value={props.languageMode}
                  onChange={(e) => props.setLanguageMode(e.target.value as any)}
                  className="w-full h-9 bg-bg-800 border border-border rounded-xl px-3 text-sm outline-none focus:border-accent"
                >
                  <option value="system">{props.t('settings.language.system')}</option>
                  <option value="en">{props.t('settings.language.en')}</option>
                  <option value="nl">{props.t('settings.language.nl')}</option>
                </select>
              </SectionCard>
            </div>

            {/* 4) App-updates */}
            <div className="col-span-12">
              <SectionCard title={props.t('settings.updates.title')}>
                <div className="flex flex-col gap-3">
                  <button
                    disabled={isUpdateBusy}
                    onClick={() => {
                      if (props.updateState.status === 'available' || props.updateState.status === 'downloaded') {
                        void props.onInstallUpdate()
                        return
                      }
                      void props.onCheckUpdates()
                    }}
                    className={
                      `dsfc-no-drag w-full h-9 px-4 rounded-xl text-sm font-semibold transition inline-flex items-center justify-center gap-2 ` +
                      (isUpdateBusy
                        ? 'bg-gray-600 text-gray-300 opacity-50 cursor-not-allowed'
                        : 'bg-accent text-black hover:brightness-110')
                    }
                    style={{ WebkitAppRegion: 'no-drag' as any }}
                    type="button"
                  >
                    {props.updateState.status === 'available' || props.updateState.status === 'downloaded' ? (
                      <Download size={15} />
                    ) : (
                      <RefreshCw size={15} />
                    )}
                    {updateButtonLabel}
                  </button>

                  <div className="text-xs text-text-400">{props.t('settings.updates.helper')}</div>

                  {props.updateState.status === 'progress' ? (
                    <div>
                      <div className="h-2 bg-bg-900 rounded overflow-hidden">
                        <div className="h-2 bg-accent" style={{ width: `${props.updateState.percent}%` }} />
                      </div>
                    </div>
                  ) : null}

                  <div className="text-[11px] text-text-400">
                    {props.updateState.status === 'not-available'
                      ? props.t('settings.updates.uptodate')
                      : props.updateState.status === 'available'
                        ? `${props.t('settings.updates.available')} v${props.updateState.version}`
                        : props.updateState.status === 'downloaded'
                          ? props.t('settings.updates.ready')
                          : props.updateState.status === 'progress'
                            ? `${props.t('settings.updates.downloading')} ${(props.updateState.percent ?? 0).toFixed(0)}%`
                            : props.updateState.status === 'error'
                              ? `${props.t('settings.updates.error')}: ${props.updateState.message}`
                              : ''}
                  </div>
                </div>
              </SectionCard>
            </div>

            {/* 5) Over */}
            <div className="col-span-12">
              <SectionCard title={props.t('settings.aboutTitle')}>
                <div className="rounded-xl border border-border bg-bg-800 px-3 py-2">
                  <div className="text-[11px] text-text-400">{props.t('settings.installedVersion')}</div>
                  <div className="mt-1 text-sm font-semibold text-text-100">
                    {props.appVersion ? `v${props.appVersion}` : '—'}
                    {props.appIsPackaged === false
                      ? ` (${props.t('settings.channel.dev')})`
                      : props.appIsPackaged === true
                        ? ` (${props.t('settings.channel.release')})`
                        : ''}
                  </div>
                </div>
              </SectionCard>
            </div>
          </div>
        </div>

        {/* Footer (fixed) */}
        <div className="flex-shrink-0 px-4 py-3 border-t border-border flex gap-2 justify-end bg-bg-900">
          <button
            onClick={props.onClose}
            className="dsfc-no-drag h-9 px-4 rounded-xl border border-accent2/40 bg-accent2/20 text-sm hover:bg-accent2/30"
            style={{ WebkitAppRegion: 'no-drag' as any }}
            type="button"
          >
            {props.t('common.cancel')}
          </button>
          <button
            onClick={props.onSave}
            className="dsfc-no-drag h-9 px-4 rounded-xl bg-accent text-black text-sm font-semibold hover:brightness-110"
            style={{ WebkitAppRegion: 'no-drag' as any }}
            type="button"
          >
            {props.t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
