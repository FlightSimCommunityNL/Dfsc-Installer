import React, { useMemo } from 'react'
import type { AddonChannelKey, InstalledAddonRecord, ManifestAddon } from '@shared/types'
import { FileText, Info, Settings2 } from 'lucide-react'

export type ContentView = 'configure' | 'releaseNotes' | 'about'

export type InstallDecision = {
  canInstall: boolean
  canUninstall: boolean
  primaryLabel: 'Install' | 'Update' | 'Installed'
  updateAvailable: boolean
}

export function ActionsPane(props: {
  t: (k: any) => string
  addon: ManifestAddon | null

  contentView: ContentView
  onChangeView: (v: ContentView) => void

  selectedChannel: AddonChannelKey
  installed: InstalledAddonRecord | undefined
  installPathSet: boolean
  progress: { phase: string; percent?: number; overallPercent?: number } | undefined
  onRequestInstallOrUpdate: (action: 'install' | 'update') => void
  onUninstall: () => Promise<void>
}) {

  const decision = useMemo<InstallDecision>(() => {
    if (!props.addon) {
      return { canInstall: false, canUninstall: false, primaryLabel: 'Install', updateAvailable: false }
    }

    const ch = props.addon.channels[props.selectedChannel]
    const hasChannel = !!ch && typeof ch.version === 'string' && !!ch.version
    const hasDownloadUrl = !!(ch?.zipUrl || ch?.url)
    const available = hasChannel && hasDownloadUrl

    if (!props.installed) {
      return {
        canInstall: available,
        canUninstall: false,
        primaryLabel: 'Install',
        updateAvailable: false,
      }
    }

    const remoteVersion = ch?.version
    const installedChannel = (props.installed as any).installedChannel as any

    const sameChannel = installedChannel === props.selectedChannel
    const updateAvailable = sameChannel && !!remoteVersion && remoteVersion !== props.installed.installedVersion

    if (!updateAvailable) {
      return {
        canInstall: false,
        canUninstall: true,
        primaryLabel: 'Installed',
        updateAvailable: false,
      }
    }

    return {
      canInstall: available,
      canUninstall: true,
      primaryLabel: 'Update',
      updateAvailable: true,
    }
  }, [props.addon, props.selectedChannel, props.installed])

  const NavButton = (p: { view: ContentView; label: string; icon: React.ReactNode }) => {
    const active = props.contentView === p.view
    return (
      <button
        onClick={() => props.onChangeView(p.view)}
        className={
          `dsfc-no-drag w-full px-3 py-2 rounded-xl border text-sm flex items-center gap-2 transition ` +
          (active ? 'border-accent bg-accent/10 text-text-100' : 'border-border bg-bg-900 text-text-200 hover:bg-bg-800')
        }
        style={{ WebkitAppRegion: 'no-drag' as any }}
      >
        <span className={active ? 'text-accent' : 'text-text-400'}>{p.icon}</span>
        <span className="font-semibold">{p.label}</span>
      </button>
    )
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden bg-bg-800 border-l border-border">
      {/* Top nav */}
      <div className="flex-shrink-0 px-5 pt-5">
        <div className="flex flex-col gap-2">
          <NavButton view="configure" label={props.t('actions.configure')} icon={<Settings2 size={18} />} />
          <NavButton view="releaseNotes" label={props.t('actions.releaseNotes')} icon={<FileText size={18} />} />
          <NavButton view="about" label={props.t('actions.about')} icon={<Info size={18} />} />
        </div>
      </div>

      <div className="flex-1 min-h-0" />

      {/* Bottom pinned: install/update/uninstall always visible */}
      <div className="flex-shrink-0 px-5 pb-5 pt-4 border-t border-white/10">
        {props.addon ? (
          <div>
            {props.progress ? (
              <div className="mb-3">
                {(() => {
                  const raw = props.progress.overallPercent ?? props.progress.percent
                  const isIndeterminate = raw == null || !Number.isFinite(raw)
                  const pct = !isIndeterminate ? Math.max(0, Math.min(100, raw)) : 0

                  return (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] text-text-400">{props.progress.phase}</div>
                        <div className="text-[11px] text-text-400">{isIndeterminate ? '' : `${pct.toFixed(0)}%`}</div>
                      </div>
                      <div className="h-2 bg-bg-900 rounded mt-1 overflow-hidden relative">
                        {isIndeterminate ? (
                          <div className="dsfc-progress-indeterminate h-2 bg-accent" />
                        ) : (
                          <div className="h-2 bg-accent" style={{ width: `${pct}%` }} />
                        )}
                      </div>
                    </>
                  )
                })()}
              </div>
            ) : null}

            {decision.updateAvailable ? (
              <div className="mb-3 text-[11px] text-highlight">{props.t('install.updateAvailableHint')}</div>
            ) : null}

            {!props.installPathSet ? (
              <div className="mb-3 text-[11px] text-text-400">{props.t('install.setInstallPathHint')}</div>
            ) : null}
            {(() => {
              // Single source of truth for status-based rendering.
              const isInstalled = props.installed != null
              const installedChannel = (props.installed as any)?.installedChannel as any
              const selectedChannel = props.selectedChannel
              const channelMismatch =
                isInstalled &&
                (installedChannel === 'stable' || installedChannel === 'beta' || installedChannel === 'dev') &&
                installedChannel !== selectedChannel

              const hasUpdate = decision.updateAvailable === true
              const isBusy = props.progress != null && props.progress.phase !== 'done'

              const activeAction: 'installOrUpdate' | 'uninstall' | null =
                !isBusy ? null : props.progress?.phase === 'uninstalling' ? 'uninstall' : 'installOrUpdate'

              const hasInstallableChannel = decision.canInstall === true
              const canInstallOrUpdate = hasInstallableChannel && props.installPathSet

              if (!props.installPathSet) return null

              if (!isInstalled) {
                if (!hasInstallableChannel) return null
                return (
                  <div className="flex flex-col gap-2">
                    <button
                      disabled={isBusy || !canInstallOrUpdate}
                      onClick={() => {
                        if (isBusy || !canInstallOrUpdate) return
                        props.onRequestInstallOrUpdate('install')
                      }}
                      className={
                        `w-full px-3 py-3 rounded-xl text-sm font-semibold transition-colors ` +
                        (isBusy || !canInstallOrUpdate
                          ? 'bg-gray-600 text-gray-300 opacity-50 cursor-not-allowed'
                          : 'bg-accent text-white hover:bg-accent/90 cursor-pointer')
                      }
                    >
                      <span className="inline-flex items-center gap-2">
                        {activeAction === 'installOrUpdate' ? <Spinner /> : null}
                        {props.t('install.install')}
                      </span>
                    </button>
                  </div>
                )
              }

              if (channelMismatch) {
                return (
                  <div className="flex flex-col gap-2">
                    <button
                      disabled={isBusy}
                      onClick={() => {
                        if (isBusy) return
                        void props.onUninstall()
                      }}
                      className={
                        `w-full px-3 py-3 rounded-xl text-sm font-semibold transition-colors border ` +
                        (isBusy
                          ? 'border-red-500 text-red-300 opacity-50 cursor-not-allowed'
                          : 'border-red-500 text-red-500 hover:bg-red-500/10 cursor-pointer')
                      }
                    >
                      <span className="inline-flex items-center gap-2">
                        {activeAction === 'uninstall' ? <Spinner /> : null}
                        {props.t('install.uninstall')}
                      </span>
                    </button>
                  </div>
                )
              }

              if (isInstalled && !hasUpdate) {
                return (
                  <div className="flex flex-col gap-2">
                    <button
                      disabled={isBusy}
                      onClick={() => {
                        if (isBusy) return
                        void props.onUninstall()
                      }}
                      className={
                        `w-full px-3 py-3 rounded-xl text-sm font-semibold transition-colors border ` +
                        (isBusy
                          ? 'border-red-500 text-red-300 opacity-50 cursor-not-allowed'
                          : 'border-red-500 text-red-500 hover:bg-red-500/10 cursor-pointer')
                      }
                    >
                      <span className="inline-flex items-center gap-2">
                        {activeAction === 'uninstall' ? <Spinner /> : null}
                        {props.t('install.uninstall')}
                      </span>
                    </button>
                  </div>
                )
              }

              if (!hasInstallableChannel) {
                return (
                  <div className="flex flex-col gap-2">
                    <button
                      disabled={isBusy}
                      onClick={() => {
                        if (isBusy) return
                        void props.onUninstall()
                      }}
                      className={
                        `w-full px-3 py-3 rounded-xl text-sm font-semibold transition-colors border ` +
                        (isBusy
                          ? 'border-red-500 text-red-300 opacity-50 cursor-not-allowed'
                          : 'border-red-500 text-red-500 hover:bg-red-500/10 cursor-pointer')
                      }
                    >
                      <span className="inline-flex items-center gap-2">
                        {activeAction === 'uninstall' ? <Spinner /> : null}
                        {props.t('install.uninstall')}
                      </span>
                    </button>
                  </div>
                )
              }

              return (
                <div className="flex flex-col gap-2">
                  <button
                    disabled={isBusy || !canInstallOrUpdate}
                    onClick={() => {
                      if (isBusy || !canInstallOrUpdate) return
                      props.onRequestInstallOrUpdate('update')
                    }}
                    className={
                      `w-full px-3 py-3 rounded-xl text-sm font-semibold transition-colors ` +
                      (isBusy || !canInstallOrUpdate
                        ? 'bg-gray-600 text-gray-300 opacity-50 cursor-not-allowed'
                        : 'bg-accent text-white hover:bg-accent/90 cursor-pointer')
                    }
                  >
                    <span className="inline-flex items-center gap-2">
                      {activeAction === 'installOrUpdate' ? <Spinner /> : null}
                      {props.t('install.update')}
                    </span>
                  </button>

                  <button
                    disabled={isBusy}
                    onClick={() => {
                      if (isBusy) return
                      void props.onUninstall()
                    }}
                    className={
                      `w-full px-3 py-3 rounded-xl text-sm font-semibold transition-colors border ` +
                      (isBusy
                        ? 'border-red-500 text-red-300 opacity-50 cursor-not-allowed'
                        : 'border-red-500 text-red-500 hover:bg-red-500/10 cursor-pointer')
                    }
                  >
                    <span className="inline-flex items-center gap-2">
                      {activeAction === 'uninstall' ? <Spinner /> : null}
                      {props.t('install.uninstall')}
                    </span>
                  </button>
                </div>
              )
            })()}
          </div>
        ) : (
          <div className="text-sm text-text-400">{props.t('common.noAddonSelected')}</div>
        )}
      </div>

    </div>
  )
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
      aria-hidden="true"
    />
  )
}
