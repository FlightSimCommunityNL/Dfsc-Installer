import React, { useEffect, useMemo, useState } from 'react'

type DiskSpace = { freeBytes: number; totalBytes: number }

function formatBytesGB(bytes: number): string {
  const gb = bytes / (1024 ** 3)
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(gb)} GB`
}

export function InstallConfirmModal(props: {
  open: boolean
  t: (k: any) => string
  action: 'install' | 'update'
  communityPath: string | null
  requiredBytes: number
  onCancel: () => void
  onConfirm: () => void
}) {
  const [disk, setDisk] = useState<DiskSpace | null>(null)
  const [diskError, setDiskError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!props.open) return
    if (!props.communityPath) return

    setLoading(true)
    setDisk(null)
    setDiskError(null)

    window.dsfc.system
      .getDiskSpace(props.communityPath)
      .then((res) => setDisk(res))
      .catch((e: any) => setDiskError(e?.message ?? String(e)))
      .finally(() => setLoading(false))
  }, [props.open, props.communityPath])

  const afterBytes = useMemo(() => {
    const free = disk?.freeBytes
    if (typeof free !== 'number') return null
    return free - props.requiredBytes
  }, [disk?.freeBytes, props.requiredBytes])

  const insufficient = useMemo(() => {
    if (!disk) return false
    return disk.freeBytes < props.requiredBytes
  }, [disk, props.requiredBytes])

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
            <div className="bg-bg-800 border border-border rounded-md px-3 py-2 text-sm text-text-200 truncate" title={props.communityPath ?? ''}>
              {props.communityPath ?? props.t('common.notSet')}
            </div>
          </div>

          <div className="col-span-6">
            <Stat label={props.t('installConfirm.freeSpace')} value={disk ? formatBytesGB(disk.freeBytes) : loading ? props.t('installConfirm.loading') : '—'} />
          </div>
          <div className="col-span-6">
            <Stat label={props.t('installConfirm.required')} value={formatBytesGB(props.requiredBytes)} accent />
          </div>
          <div className="col-span-12">
            <Stat
              label={props.t('installConfirm.afterInstall')}
              value={afterBytes == null ? '—' : `${formatBytesGB(afterBytes)}${afterBytes < 0 ? ` (${props.t('installConfirm.negative')})` : ''}`}
              warn={afterBytes != null && afterBytes < 0}
            />
          </div>

          {diskError ? (
            <div className="col-span-12 text-[11px] text-highlight bg-highlight/10 border border-highlight/30 rounded-xl px-3 py-2">
              {props.t('installConfirm.diskError')}: {diskError}
            </div>
          ) : null}

          {insufficient ? (
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
            onClick={props.onConfirm}
            disabled={!props.communityPath || !!diskError || insufficient || loading || !disk}
            className={
              `px-4 py-2 rounded-xl bg-accent text-black text-sm font-semibold transition ` +
              (!props.communityPath || !!diskError || insufficient || loading || !disk ? ' opacity-40 cursor-not-allowed' : 'hover:brightness-110')
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
