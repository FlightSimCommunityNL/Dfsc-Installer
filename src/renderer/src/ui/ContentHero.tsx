import React, { useEffect, useMemo, useState } from 'react'
import type { AddonChannelKey, ManifestAddon } from '@shared/types'
import fallbackBanner from '../assets/default-banner.jpg'

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

export function ContentHero(props: { addon: ManifestAddon | null; selectedChannel: AddonChannelKey }) {
  const a = props.addon

  const cacheKey = useMemo(() => {
    const selected: any = a?.channels?.[props.selectedChannel]
    if (typeof selected?.version === 'string' && selected.version.trim()) return selected.version

    const anyAddon = a as any
    if (typeof anyAddon?.schemaVersion === 'number' && Number.isFinite(anyAddon.schemaVersion)) {
      return String(anyAddon.schemaVersion)
    }

    return '1'
  }, [a, props.selectedChannel])

  const computedBanner = useMemo(() => {
    const url = a?.bannerUrl
    if (!url) return fallbackBanner
    return buildCacheBustedUrl(url, cacheKey)
  }, [a?.bannerUrl, cacheKey])

  const [bannerSrc, setBannerSrc] = useState<string>(computedBanner)
  useEffect(() => {
    setBannerSrc(computedBanner)
  }, [computedBanner])

  return (
    <div className="w-full min-w-0 overflow-hidden">
      <div className="w-full aspect-[16/6] relative">
        <img
          src={bannerSrc}
          loading="lazy"
          onError={() => {
            if (bannerSrc !== fallbackBanner) setBannerSrc(fallbackBanner)
          }}
          className="absolute inset-0 w-full h-full object-cover"
          alt={`${a?.name ?? 'Addon'} banner`}
        />
      </div>
    </div>
  )
}
