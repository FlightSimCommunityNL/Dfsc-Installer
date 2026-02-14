import React, { useMemo, useState } from 'react'
import type { AddonChannelKey, InstalledAddonRecord, ManifestAddon } from '@shared/types'

export type InstallDecision = {
  canInstall: boolean
  canUninstall: boolean
  primaryLabel: 'Install' | 'Update' | 'Installed'
  updateAvailable: boolean
}

export function ActionsPane(props: {
  t: (k: any) => string
  addon: ManifestAddon | null
  selectedChannel: AddonChannelKey
  installed: InstalledAddonRecord | undefined
  installPathSet: boolean
  progress: { phase: string; percent?: number } | undefined
  onRequestInstallOrUpdate: (action: 'install' | 'update') => void
  onUninstall: () => Promise<void>
  logs: string[]

  updateState:
    | { status: 'idle' }
    | { status: 'checking' }
    | { status: 'available'; version: string; releaseNotes?: string; releaseUrl?: string }
    | { status: 'not-available' }
    | { status: 'progress'; percent: number; transferred: number; total: number; bytesPerSecond: number }
    | { status: 'downloaded'; version: string }
    | { status: 'error'; message: string }

  onCheckUpdates: () => Promise<any>
  onDownloadUpdate: () => Promise<any>
  onRestartToInstall: () => Promise<any>
}) {
  const [showLogs, setShowLogs] = useState(false)

  const releaseNotesUrl = props.addon?.channels[props.selectedChannel]?.releaseNotesUrl

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

  return (
    <div className="h-full min-h-0 min-w-0 w-[220px] bg-bg-800 border-l border-border flex flex-col overflow-hidden">
      <div className="p-3 border-b border-border">
        <div className="text-xs text-text-400">{props.t('actions.title')}</div>
      </div>

      <div className="p-3 flex flex-col gap-2">
        <div className="mb-1">
          <div className="text-xs text-text-400">{props.t('updates.title')}</div>
          <div className="text-[11px] text-text-400 mt-1">
            {props.updateState.status === 'checking'
              ? props.t('updates.status.checking')
              : props.updateState.status === 'available'
                ? `${props.t('updates.status.available')}: v${props.updateState.version}`
                : props.updateState.status === 'downloaded'
                  ? `${props.t('updates.status.downloaded')}: v${props.updateState.version}`
                  : props.updateState.status === 'not-available'
                    ? props.t('updates.status.notAvailable')
                    : props.updateState.status === 'error'
                      ? `${props.t('updates.status.error')}: ${props.updateState.message}`
                      : ''}
          </div>
          {props.updateState.status === 'progress' ? (
            <div className="mt-2">
              <div className="h-2 bg-bg-900 rounded overflow-hidden">
                <div className="h-2 bg-accent" style={{ width: `${props.updateState.percent}%` }} />
              </div>
              <div className="text-[11px] text-text-400 mt-1">{props.updateState.percent.toFixed(0)}%</div>
            </div>
          ) : null}
        </div>

        <ActionButton label={props.t('updates.check')} kind="secondary" onClick={() => props.onCheckUpdates()} />
        <ActionButton
          label={props.t('updates.download')}
          kind="secondary"
          disabled={props.updateState.status !== 'available'}
          onClick={() => props.onDownloadUpdate()}
        />
        <ActionButton
          label={props.t('updates.restart')}
          kind="secondary"
          disabled={props.updateState.status !== 'downloaded'}
          onClick={() => props.onRestartToInstall()}
        />
        <ActionButton label={props.t('actions.configure')} kind="secondary" disabled />
        <ActionButton label={props.t('actions.about')} kind="secondary" disabled />
        <ActionButton label={props.t('actions.logs')} kind="secondary" onClick={() => setShowLogs(true)} />
      </div>

      <div className="flex-1" />

      <div className="p-3 border-t border-border">
        {props.addon ? (
          <div>
            <div className="text-xs text-text-400">{props.t('install.title')}</div>

            {props.progress ? (
              <div className="mt-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-text-400">{props.progress.phase}</div>
                  <div className="text-[11px] text-text-400">{(props.progress.percent ?? 0).toFixed(0)}%</div>
                </div>
                <div className="h-2 bg-bg-900 rounded mt-1 overflow-hidden">
                  <div className="h-2 bg-accent" style={{ width: `${props.progress.percent ?? 0}%` }} />
                </div>
              </div>
            ) : null}

            {decision.updateAvailable ? (
              <div className="mt-2 text-[11px] text-highlight">
                {props.t('install.updateAvailableHint')}
              </div>
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

              // Determine which button should show spinner.
              const activeAction: 'installOrUpdate' | 'uninstall' | null =
                !isBusy ? null : props.progress?.phase === 'uninstalling' ? 'uninstall' : 'installOrUpdate'

              // Edge case: channel missing or invalid -> no install/update.
              const hasInstallableChannel = decision.canInstall === true
              const canInstallOrUpdate = hasInstallableChannel && props.installPathSet

              if (!isInstalled) {
                if (!hasInstallableChannel) return null

                return (
                  <div className="mt-3 flex flex-col gap-2">
                    <button
                      disabled={isBusy || !canInstallOrUpdate}
                      onClick={() => {
                        if (isBusy || !canInstallOrUpdate) return
                        props.onRequestInstallOrUpdate('install')
                      }}
                      className={
                        `px-3 py-3 rounded-xl text-sm font-semibold transition-colors ` +
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
                  <div className="mt-3 flex flex-col gap-2">
                    <div className="text-[11px] text-text-400">
                      You have <span className="text-text-200 font-semibold">{installedChannel}</span> installed. Uninstall it before installing{' '}
                      <span className="text-text-200 font-semibold">{selectedChannel}</span>.
                    </div>
                    <button
                      disabled={isBusy}
                      onClick={() => {
                        if (isBusy) return
                        void props.onUninstall()
                      }}
                      className={
                        `px-3 py-3 rounded-xl text-sm font-semibold transition-colors border ` +
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
                  <div className="mt-3 flex flex-col gap-2">
                    <button
                      disabled={isBusy}
                      onClick={() => {
                        if (isBusy) return
                        void props.onUninstall()
                      }}
                      className={
                        `px-3 py-3 rounded-xl text-sm font-semibold transition-colors border ` +
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

              // isInstalled && hasUpdate
              // If update is available but channel isn't installable (missing url/version), fall back to uninstall-only.
              if (!hasInstallableChannel) {
                return (
                  <div className="mt-3 flex flex-col gap-2">
                    <button
                      disabled={isBusy}
                      onClick={() => {
                        if (isBusy) return
                        void props.onUninstall()
                      }}
                      className={
                        `px-3 py-3 rounded-xl text-sm font-semibold transition-colors border ` +
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
                <div className="mt-3 flex flex-col gap-2">
                  <button
                    disabled={isBusy || !canInstallOrUpdate}
                    onClick={() => {
                      if (isBusy || !canInstallOrUpdate) return
                      props.onRequestInstallOrUpdate('update')
                    }}
                    className={
                      `px-3 py-3 rounded-xl text-sm font-semibold transition-colors ` +
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
                      `px-3 py-3 rounded-xl text-sm font-semibold transition-colors border ` +
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

            {!props.installPathSet ? (
              <div className="mt-3 text-[11px] text-text-400">
                {props.t('install.setInstallPathHint')}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="text-sm text-text-400">{props.t('common.noAddonSelected')}</div>
        )}
      </div>

      {showLogs ? (
        <LogDrawer t={props.t} logs={props.logs} onClose={() => setShowLogs(false)} />
      ) : null}
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

function ActionButton(props: { label: string; kind?: 'secondary' | 'default'; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className={
        `px-3 py-2 rounded-xl border text-sm text-left transition ` +
        (props.kind === 'secondary'
          ? 'border-accent2/40 bg-accent2/20 hover:bg-accent2/30 text-text-200'
          : 'border-border bg-bg-900 hover:bg-bg-800 text-text-200') +
        (props.disabled ? ' opacity-40 cursor-not-allowed' : '')
      }
    >
      {props.label}
    </button>
  )
}

function LogDrawer(props: { t: (k: any) => string; logs: string[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={props.onClose} />
      <div className="absolute right-0 top-0 h-full w-[520px] bg-bg-900 border-l border-border flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="text-sm font-semibold">{props.t('actions.logs')}</div>
          <button onClick={props.onClose} className="text-text-400 hover:text-text-100">{props.t('common.close')}</button>
        </div>
        <div className="flex-1 overflow-auto p-3 font-mono text-xs text-text-400 whitespace-pre-wrap">
          {props.logs.join('\n')}
        </div>
      </div>
    </div>
  )
}
