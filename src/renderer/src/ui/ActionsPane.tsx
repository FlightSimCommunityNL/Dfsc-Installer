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
    const available = !!ch

    if (!props.installed) {
      return {
        canInstall: available,
        canUninstall: false,
        primaryLabel: 'Install',
        updateAvailable: false,
      }
    }

    const installedMatchesChannel = props.installed.channel === props.selectedChannel
    const remote = ch?.version

    const updateAvailable =
      available &&
      (!installedMatchesChannel || (remote && remote !== props.installed.installedVersion))

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
  }, [props.addon, props.selectedChannel, props.installed, props.installPathSet])

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

            <div className="mt-3 flex flex-col gap-2">
              {decision.primaryLabel === 'Installed' ? (
                <div className="px-3 py-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-sm font-semibold">
                  {props.t('install.installed')}
                </div>
              ) : (
                <button
                  onClick={() => props.onRequestInstallOrUpdate(decision.primaryLabel === 'Update' ? 'update' : 'install')}
                  disabled={!decision.canInstall}
                  className={
                    `px-3 py-3 rounded-xl text-sm font-semibold transition ` +
                    (decision.primaryLabel === 'Install'
                      ? 'bg-accent text-black hover:brightness-110'
                      : 'bg-accent text-black hover:brightness-110') +
                    (!decision.canInstall ? ' opacity-40 cursor-not-allowed' : '')
                  }
                >
                  {decision.primaryLabel === 'Install'
                    ? props.t('install.install')
                    : decision.primaryLabel === 'Update'
                      ? props.t('install.update')
                      : props.t('install.installed')}
                </button>
              )}

              <button
                onClick={props.onUninstall}
                disabled={!decision.canUninstall}
                className={
                  `px-3 py-3 rounded-xl border border-border bg-bg-900 text-sm transition ` +
                  (!decision.canUninstall ? ' opacity-40 cursor-not-allowed' : 'hover:bg-bg-800')
                }
              >
                {props.t('install.uninstall')}
              </button>
            </div>

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
