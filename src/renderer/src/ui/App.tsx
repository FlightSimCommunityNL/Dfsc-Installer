import React, { useEffect, useMemo, useState } from 'react'
import type { AddonChannelKey, LocalState, ManifestAddon, RemoteManifest } from '@shared/types'

import { IconBar, type IconCategory } from './IconBar'
import { SelectionPane } from './SelectionPane'
import { ContentPane } from './ContentPane'
import { ActionsPane } from './ActionsPane'
import { SettingsModal } from './SettingsModal'
import { InstallConfirmModal } from './InstallConfirmModal'
import { CommunityPathRequiredModal } from './CommunityPathRequiredModal'
import { TitleBar } from './TitleBar'
import { createT, mapLocaleToLang, type SupportedLang } from '../i18n'

type Category = { id: string; name: string }

export function App() {
  const [state, setState] = useState<LocalState | null>(null)
  const [manifest, setManifest] = useState<RemoteManifest | null>(null)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [selectedAddonId, setSelectedAddonId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [logLines, setLogLines] = useState<string[]>([])
  const [updateState, setUpdateState] = useState<
    | { status: 'idle' }
    | { status: 'checking' }
    | { status: 'available'; version: string; releaseNotes?: string; releaseUrl?: string }
    | { status: 'not-available' }
    | { status: 'progress'; percent: number; transferred: number; total: number; bytesPerSecond: number }
    | { status: 'downloaded'; version: string }
    | { status: 'error'; message: string }
  >({ status: 'idle' })
  const [installProgress, setInstallProgress] = useState<
    Record<string, { phase: string; percent?: number; transferredBytes?: number; totalBytes?: number }>
  >({})
  const [offlineMode, setOfflineMode] = useState(false)

  const [showSettings, setShowSettings] = useState(false)
  const [autoDetectResult, setAutoDetectResult] = useState<string | null>(null)
  const [installPathResult, setInstallPathResult] = useState<string | null>(null)
  const [languageModeDraft, setLanguageModeDraft] = useState<'system' | 'en' | 'nl'>('system')

  const [systemLocale, setSystemLocale] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [appIsPackaged, setAppIsPackaged] = useState<boolean | null>(null)

  const [channel, setChannel] = useState<AddonChannelKey>('stable')

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'install' | 'update'>('install')
  const [communityRequiredOpen, setCommunityRequiredOpen] = useState(false)

  useEffect(() => {
    window.dfsc.system.getLocale().then((l) => setSystemLocale(typeof l === 'string' ? l : null)).catch(() => {
      // renderer fallback
      setSystemLocale(typeof navigator !== 'undefined' ? navigator.language : null)
    })

    window.dfsc.system
      .getAppVersion()
      .then((res: any) => {
        setAppVersion(typeof res?.version === 'string' ? res.version : null)
        setAppIsPackaged(typeof res?.isPackaged === 'boolean' ? res.isPackaged : null)
      })
      .catch(() => {
        setAppVersion(null)
        setAppIsPackaged(null)
      })

    window.dfsc.settings.get().then((s) => {
      setState(s)
      setLanguageModeDraft((s.settings.languageMode ?? 'system') as 'system' | 'en' | 'nl')
    })

    window.dfsc.manifest.fetch().then((res) => {
      setManifest(res.manifest)
      setOfflineMode(res.mode === 'offline')

      // Only auto-select if user hasn't selected anything yet.
      const m = res.manifest
      setSelectedCategoryId((prev) => (prev ? prev : m.categories[0]?.id ?? null))
    })

    const off1 = window.dfsc.onLog((l) => setLogLines((prev) => [...prev.slice(-400), l]))
    const off2 = window.dfsc.onInstallProgress((evt) => {
      setInstallProgress((prev) => ({
        ...prev,
        [evt.addonId]: {
          phase: evt.phase,
          percent: evt.percent,
          transferredBytes: evt.transferredBytes,
          totalBytes: evt.totalBytes,
        },
      }))
    })

    const offU1 = window.dfsc.onUpdateChecking(() => setUpdateState({ status: 'checking' }))
    const offU2 = window.dfsc.onUpdateAvailable((p: any) => setUpdateState({ status: 'available', ...p }))
    const offU3 = window.dfsc.onUpdateNotAvailable(() => setUpdateState({ status: 'not-available' }))
    const offU4 = window.dfsc.onUpdateProgress((p: any) => setUpdateState({ status: 'progress', ...p }))
    const offU5 = window.dfsc.onUpdateDownloaded((p: any) => setUpdateState({ status: 'downloaded', ...p }))
    const offU6 = window.dfsc.onUpdateError((p: any) => setUpdateState({ status: 'error', message: p?.message ?? String(p) }))

    // reconcile in background
    window.dfsc.addon.reconcile().then(setState).catch(() => {})

    return () => {
      off1()
      off2()
      offU1(); offU2(); offU3(); offU4(); offU5(); offU6()
    }
  }, [])

  const categories: Category[] = useMemo(() => {
    return manifest?.categories?.map((c) => ({ id: c.id, name: c.name })) ?? []
  }, [manifest])

  const selectedCategoryName = useMemo(() => {
    return categories.find((c) => c.id === selectedCategoryId)?.name ?? 'Addons'
  }, [categories, selectedCategoryId])

  const activeLang: SupportedLang = useMemo(() => {
    if (languageModeDraft === 'system') return mapLocaleToLang(systemLocale)
    return languageModeDraft
  }, [languageModeDraft, systemLocale])

  const t = useMemo(() => createT(activeLang), [activeLang])

  const addons: ManifestAddon[] = useMemo(() => {
    const all = manifest?.addons ?? []
    const byCat = selectedCategoryId ? all.filter((a) => a.categoryId === selectedCategoryId) : all
    const q = search.trim().toLowerCase()
    return q ? byCat.filter((a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)) : byCat
  }, [manifest, selectedCategoryId, search])

  // Auto-select first addon for the selected category only when none is selected.
  useEffect(() => {
    if (selectedAddonId) return
    if (!addons.length) return
    setSelectedAddonId(addons[0]!.id)
  }, [selectedAddonId, addons])

  const selectedAddon = useMemo(
    () => addons.find((a) => a.id === selectedAddonId) ?? addons[0] ?? null,
    [addons, selectedAddonId]
  )

  useEffect(() => {
    if (!selectedAddon) return
    // dev-friendly debug hint: confirm allowRawInstall value from manifest makes it to UI
    console.log(
      `[ui] selected addon id=${selectedAddon.id} allowRawInstall=${selectedAddon.allowRawInstall === true ? 'true' : 'false'}`
    )
  }, [selectedAddon?.id])

  const installedRec = selectedAddon && state ? state.installed[selectedAddon.id] : undefined

  useEffect(() => {
    // When selection changes, default channel to installed channel if present.
    const installedChannel = (installedRec as any)?.installedChannel
    if (installedChannel === 'stable' || installedChannel === 'beta' || installedChannel === 'dev') {
      setChannel(installedChannel)
    }
  }, [(installedRec as any)?.installedChannel])

  const onInstallOrUpdate = async () => {
    if (!selectedAddon) return
    try {
      await window.dfsc.addon.install({ addonId: selectedAddon.id, channel })
      const next = await window.dfsc.settings.get()
      setState(next)
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      setLogLines((prev) => [...prev, `[install] ERROR: ${msg}`])

      const looksLikePackageDetectionFailure =
        typeof msg === 'string' &&
        (msg.includes('No package folders found') || msg.includes('Expected folder') || msg.includes('Detected packages:'))

      if (selectedAddon && !selectedAddon.allowRawInstall && looksLikePackageDetectionFailure) {
        setLogLines((prev) => [...prev, `[install] HINT: ${t('install.rawInstallHint')}`])
      }
    }
  }

  const requiredBytes = useMemo(() => {
    const ch = selectedAddon?.channels?.[channel]
    const sizeBytes = Number(ch?.sizeBytes ?? 0)
    const installedSizeBytes = typeof ch?.installedSizeBytes === 'number' ? ch.installedSizeBytes : undefined

    const base = installedSizeBytes ?? sizeBytes * 3
    const buffer = 200 * 1024 * 1024
    // temp extraction overhead + buffer
    return Math.ceil(base * 1.2 + buffer)
  }, [selectedAddon, channel])

  const requestInstallOrUpdate = (action: 'install' | 'update') => {
    setConfirmAction(action)

    const installPath = (state?.settings.installPath ?? state?.settings.communityPath) ?? null
    if (!installPath) {
      setCommunityRequiredOpen(true)
      return
    }

    setConfirmOpen(true)
  }

  const onUninstall = async () => {
    if (!selectedAddon) return
    try {
      await window.dfsc.addon.uninstall({ addonId: selectedAddon.id })
      const next = await window.dfsc.settings.get()
      setState(next)
    } catch (e: any) {
      setLogLines((prev) => [...prev, `[uninstall] ERROR: ${e?.message ?? String(e)}`])
    }
  }

  const onSaveSettings = async () => {
    await window.dfsc.settings.set({
      languageMode: languageModeDraft,
    })

    const next = await window.dfsc.settings.get()
    setState(next)
    setShowSettings(false)
  }

  const iconCategories: IconCategory[] = useMemo(() => {
    // IconBar must never be empty.
    const cats = manifest?.categories?.length
      ? manifest.categories
      : [{ id: 'liveries', name: 'Liveries' }]

    return cats.map((c) => ({
      id: c.id,
      label: c.name,
      tooltip: c.name,
    }))
  }, [manifest])

  const onBrowseCommunity = async () => {
    try {
      await window.dfsc.community.browse()
      const next = await window.dfsc.settings.get()
      setState(next)
    } catch (e: any) {
      setLogLines((prev) => [...prev, `[community] ERROR: ${e?.message ?? String(e)}`])
    }
  }

  const onBrowseInstallPath = async () => {
    try {
      const picked = await window.dfsc.installPath.browse()
      const next = await window.dfsc.settings.get()
      setState(next)
      if (typeof picked === 'string' && picked) {
        setInstallPathResult(`${t('settings.installPath.found')} ${picked}`)
      }
    } catch (e: any) {
      setInstallPathResult(t('settings.installPath.notFound'))
      setLogLines((prev) => [...prev, `[installPath] ERROR: ${e?.message ?? String(e)}`])
    }
  }

  const onUseCommunityForInstallPath = async () => {
    try {
      await window.dfsc.installPath.useCommunityFolder()
      const next = await window.dfsc.settings.get()
      setState(next)
      const resolved = (next.settings.installPath ?? next.settings.communityPath) as string | null
      if (resolved) setInstallPathResult(`${t('settings.installPath.found')} ${resolved}`)
    } catch (e: any) {
      setLogLines((prev) => [...prev, `[installPath] ERROR: ${e?.message ?? String(e)}`])
    }
  }


  const onAutoDetectCommunity = async () => {
    try {
      const detected = await window.dfsc.community.detect()
      const next = await window.dfsc.settings.get()
      setState(next)

      if (typeof detected === 'string' && detected) {
        setAutoDetectResult(`${t('settings.autoDetect.found')} ${detected}`)
      } else {
        setAutoDetectResult(t('settings.autoDetect.notFound'))
      }
    } catch (e: any) {
      setAutoDetectResult(t('settings.autoDetect.notFound'))
      setLogLines((prev) => [...prev, `[community] ERROR: ${e?.message ?? String(e)}`])
    }
  }


  const currentProgress = selectedAddon ? installProgress[selectedAddon.id] : undefined

  return (
    <div className="h-screen w-screen bg-bg-800 text-text-100 overflow-hidden grid grid-rows-[auto_1fr]">
      <TitleBar title="Dfsc Installer" offline={offlineMode} version={appVersion} />

      <div className="min-h-0 min-w-0 grid grid-cols-[76px_340px_1fr_220px]">
        <div className="min-h-0 min-w-0">
          <IconBar
            categories={iconCategories}
            selectedCategoryId={selectedCategoryId ?? iconCategories[0]?.id ?? null}
            onSelectCategory={(id) => {
              setSelectedCategoryId(id)
              setSelectedAddonId(null)
            }}
            onOpenSettings={() => setShowSettings(true)}
            status={!manifest ? 'loading' : offlineMode ? 'offline' : 'ready'}
          />
        </div>

        <div className="min-h-0 min-w-0">
          <SelectionPane
            categoryName={selectedCategoryName}
            t={t}
            addons={addons}
            selectedAddonId={selectedAddon?.id ?? null}
            onSelectAddon={(id) => setSelectedAddonId(id)}
            search={search}
            onSearch={setSearch}
          />
        </div>

        <div className="min-h-0 min-w-0 w-full overflow-hidden">
          <ContentPane addon={selectedAddon} selectedChannel={channel} onSelectChannel={setChannel} t={t} />
        </div>

        <div className="min-h-0 min-w-0">
          <ActionsPane
          addon={selectedAddon}
          t={t}
          selectedChannel={channel}
          installed={installedRec}
          installPathSet={!!(state?.settings.installPath ?? state?.settings.communityPath)}
          progress={currentProgress ? { phase: currentProgress.phase, percent: currentProgress.percent } : undefined}
          onRequestInstallOrUpdate={requestInstallOrUpdate}
          onUninstall={onUninstall}
          logs={logLines}
          updateState={updateState}
          onCheckUpdates={() => window.dfsc.updates.check()}
          onDownloadUpdate={() => window.dfsc.updates.download()}
          onRestartToInstall={() => window.dfsc.updates.quitAndInstall()}
        />
        </div>
      </div>

      <InstallConfirmModal
        open={confirmOpen}
        t={t}
        action={confirmAction}
        installPath={(state?.settings.installPath ?? state?.settings.communityPath) ?? null}
        requiredBytes={requiredBytes}
        isInstalling={currentProgress != null && currentProgress.phase !== 'done'}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setConfirmOpen(false)
          await onInstallOrUpdate()
        }}
      />

      <CommunityPathRequiredModal
        open={communityRequiredOpen}
        t={t}
        onCancel={() => setCommunityRequiredOpen(false)}
        onOpenSettings={() => {
          setCommunityRequiredOpen(false)
          setShowSettings(true)
        }}
      />

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        t={t}
        appVersion={appVersion}
        appIsPackaged={appIsPackaged}
        communityPath={state?.settings.communityPath ?? null}
        installPath={(state?.settings.installPath ?? state?.settings.communityPath) ?? null}
        installPathMode={(state?.settings.installPathMode as any) ?? 'followCommunity'}
        autoDetectResult={autoDetectResult}
        installPathResult={installPathResult}
        onBrowseCommunity={onBrowseCommunity}
        onAutoDetectCommunity={onAutoDetectCommunity}
        onBrowseInstallPath={onBrowseInstallPath}
        onUseCommunityForInstallPath={onUseCommunityForInstallPath}
        languageMode={languageModeDraft}
        setLanguageMode={setLanguageModeDraft}
        onSave={onSaveSettings}
      />
    </div>
  )
}
