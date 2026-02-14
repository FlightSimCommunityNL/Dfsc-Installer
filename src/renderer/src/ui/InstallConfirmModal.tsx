import React, { useEffect, useMemo, useState } from 'react'

type DiskSpace = { freeBytes: number; totalBytes: number }

function formatBytes(bytes: number): string {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '0 B'

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const
  let u = 0
  let v = n
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }

  const decimals = u === 0 ? 0 : u === 1 ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 2
  const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: decimals })
  return `${fmt.format(v)} ${units[u]}`
}

export function InstallConfirmModal(props: {
  open: boolean
  t: (k: any) => string
  action: 'install' | 'update'
  installPath: string | null
  downloadUrl: string | null
  isInstalling?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const [disk, setDisk] = useState<DiskSpace | null>(null)
  const [diskError, setDiskError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [downloadBytes, setDownloadBytes] = useState<number | null>(null)
  const [downloadLoading, setDownloadLoading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  useEffect(() => {
    if (!props.open) return
    if (!props.installPath) return

    setLoading(true)
    setDisk(null)
    setDiskError(null)

    window.dfsc.system
      .getDiskSpace(props.installPath)
      .then((res) => setDisk(res))
      .catch((e: any) => setDiskError(e?.message ?? String(e)))
      .finally(() => setLoading(false))
  }, [props.open, props.installPath])

  useEffect(() => {
    if (!props.open) return
    if (!props.downloadUrl) {
      setDownloadBytes(null)
      setDownloadError(null)
      setDownloadLoading(false)
      return
    }

    setDownloadLoading(true)
    setDownloadBytes(null)
    setDownloadError(null)

    window.dfsc.system
      .getRemoteFileSize(props.downloadUrl)
      .then((res: any) => {
        const raw = res?.sizeBytes
        // Content-Length is a string in HTTP, but our IPC normalizes to number|null.
        // Still guard against accidental string/NaN.
        const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : NaN
        setDownloadBytes(Number.isFinite(n) && n >= 0 ? n : null)
      })
      .catch((e: any) => setDownloadError(e?.message ?? String(e)))
      .finally(() => setDownloadLoading(false))
  }, [props.open, props.downloadUrl])

  const freeBytes = disk?.freeBytes ?? 0

  const requiredBytes = useMemo(() => {
    // Simple + predictable (user-trustworthy):
    // - if we know download size: require download + 200 MiB
    // - else: conservative 700 MiB
    const buffer = 200 * 1024 * 1024
    const fallback = 700 * 1024 * 1024
    if (typeof downloadBytes === 'number') return Math.ceil(downloadBytes + buffer)
    return fallback
  }, [downloadBytes])

  const afterBytes = useMemo(() => {
    if (!disk) return null
    return Math.max(0, freeBytes - requiredBytes)
  }, [disk, freeBytes, requiredBytes])

  // Deterministic disabled logic for the confirm action.
  const hasEnoughSpace = freeBytes >= requiredBytes
  const isDisabled = !hasEnoughSpace || props.isInstalling === true

  if (!props.open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={props.onCancel} />
      <div className="absolute left-1/2 top-1/2 w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-bg-900 overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">{props.t('installConfirm.title')}</div>
            <div className="text-xs text-text-400 mt-1">
              {props.action === 'install' ? props.t('installConfirm.subtitleInstall') : props.t('installConfirm.subtitleUpdate')}
            </div>
          </div>
          <button onClick={props.onCancel} className="text-text-400 hover:text-text-100">
            {props.t('common.close')}
          </button>
        </div>

        <div className="p-4 grid grid-cols-12 gap-3">
          <div className="col-span-12">
            <div className="text-xs text-text-400 mb-1">{props.t('installConfirm.installTo')}</div>
            <div className="bg-bg-800 border border-border rounded-md px-3 py-2 text-sm text-text-200 truncate" title={props.installPath ?? ''}>
              {props.installPath ?? props.t('common.notSet')}
            </div>
          </div>

          <div className="col-span-6">
            <Stat
              label={props.t('installConfirm.freeSpace')}
              value={disk ? formatBytes(disk.freeBytes) : loading ? props.t('installConfirm.loading') : '—'}
            />
          </div>
          <div className="col-span-6">
            <Stat label={props.t('installConfirm.required')} value={formatBytes(requiredBytes)} accent />
          </div>

          <div className="col-span-12">
            <Stat
              label={props.t('installConfirm.downloadSize')}
              value={
                downloadLoading
                  ? props.t('installConfirm.loading')
                  : typeof downloadBytes === 'number'
                    ? formatBytes(downloadBytes)
                    : props.t('installConfirm.unknown')
              }
            />
          </div>
          <div className="col-span-12">
            <Stat
              label={props.t('installConfirm.afterInstall')}
              value={afterBytes == null ? '—' : formatBytes(afterBytes)}
              warn={disk != null && freeBytes < requiredBytes}
            />
          </div>

          {diskError ? (
            <div className="col-span-12 text-[11px] text-highlight bg-highlight/10 border border-highlight/30 rounded-xl px-3 py-2">
              {props.t('installConfirm.diskError')}: {diskError}
            </div>
          ) : null}

          {downloadError ? (
            <div className="col-span-12 text-[11px] text-highlight bg-highlight/10 border border-highlight/30 rounded-xl px-3 py-2">
              {props.t('installConfirm.downloadProbeError')}: {downloadError}
            </div>
          ) : null}

          {downloadBytes == null && !downloadLoading ? (
            <div className="col-span-12 text-[11px] text-text-400 border border-border rounded-xl px-3 py-2 bg-bg-800">
              {props.t('installConfirm.downloadUnknownWarn')}
            </div>
          ) : null}

          {!hasEnoughSpace && disk ? (
            <div className="col-span-12 text-[11px] text-highlight bg-highlight/10 border border-highlight/30 rounded-xl px-3 py-2">
              {props.t('installConfirm.notEnough')}
            </div>
          ) : null}
        </div>

        <div className="p-4 border-t border-border flex gap-2 justify-end">
          <button onClick={props.onCancel} className="px-4 py-2 rounded-xl border border-accent2/40 bg-accent2/20 text-sm hover:bg-accent2/30">
            {props.t('common.cancel')}
          </button>
          <button
            disabled={isDisabled}
            onClick={() => {
              if (isDisabled) return
              props.onConfirm()
            }}
            className={
              `px-4 py-2 rounded-md font-medium transition-colors ` +
              (isDisabled
                ? 'bg-gray-600 text-gray-300 opacity-50 cursor-not-allowed'
                : 'bg-accent text-white hover:bg-accent/90 cursor-pointer')
            }
          >
            {props.action === 'install' ? props.t('installConfirm.confirmInstall') : props.t('installConfirm.confirmUpdate')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat(props: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-bg-800 px-3 py-3">
      <div className="text-[11px] text-text-400">{props.label}</div>
      <div className={
        `mt-1 text-sm font-semibold ` +
        (props.warn ? 'text-highlight' : props.accent ? 'text-accent' : 'text-text-100')
      }>
        {props.value}
      </div>
    </div>
  )
}
