import React, { useEffect, useMemo, useState } from 'react'
import type { AddonChannelKey, ManifestAddon } from '@shared/types'
import fallbackBanner from '../assets/default-banner.jpg'
import { ReleaseNotesSection } from './ReleaseNotesSection'

function buildCacheBustedUrl(url: string, version?: string): string {
  const raw = String(url ?? '')
  if (!raw) return raw

  try {
    // Support absolute and relative URLs.
    const u = new URL(raw, window.location.href)
    const v = String(version ?? '').trim() || '1'
    u.searchParams.set('v', v)
    return u.toString()
  } catch {
    // Fallback: best-effort string concat.
    const v = encodeURIComponent(String(version ?? '').trim() || '1')
    return raw.includes('?') ? `${raw}&v=${v}` : `${raw}?v=${v}`
  }
}

export function ContentPane(props: {
  t: (k: any) => string
  addon: ManifestAddon | null
  selectedChannel: AddonChannelKey
  onSelectChannel: (c: AddonChannelKey) => void
}) {
  if (!props.addon) {
    return (
      <div className="h-screen bg-bg-800 overflow-hidden">
        <div className="h-full flex items-center justify-center">
          <div className="text-text-400 text-sm">{props.t('common.selectAddonToStart')}</div>
        </div>
      </div>
    )
  }

  const a = props.addon

  const cacheKey = useMemo(() => {
    const selected = a.channels?.[props.selectedChannel]

    // Prefer selected channel version.
    if (selected?.version) return selected.version

    // Fallback: manifest schemaVersion if some custom manifests bubble it onto the addon (best-effort).
    const anyAddon = a as any
    if (typeof anyAddon?.schemaVersion === 'number' && Number.isFinite(anyAddon.schemaVersion)) {
      return String(anyAddon.schemaVersion)
    }

    return '1'
  }, [a, props.selectedChannel])

  const computedBanner = useMemo(() => {
    if (!a.bannerUrl) return fallbackBanner
    return buildCacheBustedUrl(a.bannerUrl, cacheKey)
  }, [a.bannerUrl, cacheKey])

  const [bannerSrc, setBannerSrc] = useState<string>(computedBanner)
  useEffect(() => {
    setBannerSrc(computedBanner)
  }, [computedBanner])

  const availableChannels = useMemo(() => {
    const keys: AddonChannelKey[] = ['stable', 'beta', 'dev']
    return keys.filter((k) => {
      const ch: any = (a as any).channels?.[k]
      if (!ch) return false
      if (typeof ch.version !== 'string' || !ch.version.trim()) return false
      const url = typeof ch.zipUrl === 'string' && ch.zipUrl.trim() ? ch.zipUrl : typeof ch.url === 'string' ? ch.url : ''
      return !!url
    })
  }, [a])

  // Auto-select first available channel when addon changes or selected becomes invalid.
  useEffect(() => {
    const current = props.selectedChannel
    if (availableChannels.includes(current)) return
    const first = availableChannels[0]
    if (first) props.onSelectChannel(first)
  }, [a.id, props.selectedChannel, availableChannels, props.onSelectChannel])

  const selectedCh: any = (a as any).channels?.[props.selectedChannel]
  const releaseNotesUrl = typeof selectedCh?.releaseNotesUrl === 'string' ? selectedCh.releaseNotesUrl : null
  const channelVersion = typeof selectedCh?.version === 'string' ? selectedCh.version : null

  return (
    <div className="w-full min-w-0 h-full min-h-0 bg-bg-800 overflow-y-auto overflow-x-hidden">
      {/* BannerRow (edge-to-edge; no padding, no centering) */}
      <div className="w-full min-w-0">
        <div className="w-full min-w-0 aspect-[16/6] relative">
          <img
            src={bannerSrc}
            loading="lazy"
            onError={() => {
              if (bannerSrc !== fallbackBanner) setBannerSrc(fallbackBanner)
            }}
            className="absolute inset-0 w-full h-full object-cover"
            alt={`${a.name} banner`}
          />
        </div>
      </div>

      {/* ContentBody (padded) */}
      <div className="px-8 pt-5">
        <div className="mt-0">
          <div className="text-sm text-text-400">{props.t('content.chooseVersion')}</div>

          {availableChannels.length ? (
            <div className="mt-3 flex gap-4 items-stretch justify-start">
              {availableChannels.map((k) => {
                const ch: any = (a as any).channels?.[k]
                const selected = props.selectedChannel === k
                return (
                  <button
                    key={k}
                    onClick={() => props.onSelectChannel(k)}
                    className={
                      `flex-none w-[220px] text-left rounded-xl border p-4 transition ` +
                      (selected ? 'border-accent bg-accent/10' : 'border-border bg-bg-700 hover:bg-bg-800')
                    }
                  >
                    <div className="text-sm font-semibold">
                      {k === 'stable' ? props.t('channel.stable') : k === 'beta' ? props.t('channel.beta') : props.t('channel.dev')}
                    </div>
                    <div className="text-xs text-text-400 mt-1">{ch?.version ?? '—'}</div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="mt-3 text-sm text-text-400">—</div>
          )}

          <ReleaseNotesSection
            t={props.t}
            addonId={a.id}
            channelKey={props.selectedChannel}
            channelVersion={channelVersion}
            releaseNotesUrl={releaseNotesUrl}
          />
        </div>

        <div className="mt-6">
          <div className="text-sm text-text-400">{props.t('content.description')}</div>
          <div className="mt-2 rounded-xl border border-border bg-bg-700 p-4 text-sm text-text-200 whitespace-pre-wrap">
            {a.description}
          </div>
        </div>

        <div className="h-8" />
      </div>
    </div>
  )
}
