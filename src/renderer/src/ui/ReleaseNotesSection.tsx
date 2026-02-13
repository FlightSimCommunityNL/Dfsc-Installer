import React, { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import type { AddonChannelKey } from '@shared/types'

type Props = {
  t: (k: any) => string
  addonId: string
  channelKey: AddonChannelKey
  channelVersion: string | null
  releaseNotesUrl: string | null
}

type CacheKey = string

type Status =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; html: string }

function looksLikeHtml(text: string): boolean {
  const s = text.trimStart().slice(0, 64).toLowerCase()
  return s.startsWith('<!doctype') || s.startsWith('<html') || s.startsWith('<div') || s.startsWith('<p')
}

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  })
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function ReleaseNotesSection(props: Props) {
  const cacheRef = useRef<Map<CacheKey, string>>(new Map())
  const cacheKey = useMemo(
    () => `${props.addonId}::${props.channelKey}::${props.channelVersion ?? 'unknown'}`,
    [props.addonId, props.channelKey, props.channelVersion]
  )

  const [status, setStatus] = useState<Status>(() => {
    return props.releaseNotesUrl ? { kind: 'loading' } : { kind: 'empty' }
  })

  const fetchNotes = async () => {
    if (!props.releaseNotesUrl) {
      setStatus({ kind: 'empty' })
      return
    }

    const cached = cacheRef.current.get(cacheKey)
    if (cached) {
      setStatus({ kind: 'ready', html: cached })
      return
    }

    setStatus({ kind: 'loading' })

    try {
      const res = await window.dsfc.releaseNotes.fetch(props.releaseNotesUrl)
      const body = String(res?.body ?? '')
      const contentType = String(res?.contentType ?? '')
      const statusCode = Number(res?.statusCode ?? 0)

      const trimmed = body.trim()

      if (statusCode === 404 || !trimmed) {
        if (import.meta.env.DEV && statusCode === 404) {
          console.warn('[release-notes] 404', props.releaseNotesUrl)
        }
        setStatus({ kind: 'empty' })
        return
      }

      if (statusCode < 200 || statusCode >= 300) {
        setStatus({ kind: 'failed' })
        return
      }

      let rendered: string
      if (contentType.toLowerCase().includes('text/markdown') || (!contentType && !looksLikeHtml(body))) {
        rendered = marked.parse(body) as string
      } else if (looksLikeHtml(body)) {
        rendered = body
      } else {
        rendered = `<pre>${escapeHtml(body)}</pre>`
      }

      const safe = sanitizeHtml(rendered)
      cacheRef.current.set(cacheKey, safe)
      setStatus({ kind: 'ready', html: safe })
    } catch (e: any) {
      if (import.meta.env.DEV) console.warn('[release-notes] fetch failed', props.releaseNotesUrl, e)
      setStatus({ kind: 'failed' })
    }
  }

  // Auto-fetch on addon change OR channel change.
  useEffect(() => {
    void fetchNotes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.releaseNotesUrl, cacheKey])

  const onClickContent = (evt: React.MouseEvent) => {
    const el = evt.target as HTMLElement | null
    const a = el?.closest?.('a') as HTMLAnchorElement | null
    if (!a) return

    const href = a.getAttribute('href') || ''
    if (/^https?:\/\//i.test(href)) {
      evt.preventDefault()
      window.dsfc.external.open(href)
    }
  }

  return (
    <div className="mt-6">
      <div className="text-sm text-text-400">{props.t('releaseNotes.title')}</div>

      <div className="mt-2 rounded-xl border border-border bg-bg-700 overflow-hidden">
        <div className="max-h-[280px] overflow-auto p-4" onClick={onClickContent}>
          {status.kind === 'empty' ? (
            <div className="text-sm text-text-400">{props.t('releaseNotes.noneAvailable')}</div>
          ) : status.kind === 'loading' ? (
            <div className="text-sm text-text-400">{props.t('releaseNotes.loading')}</div>
          ) : status.kind === 'failed' ? (
            <div>
              <div className="text-sm text-highlight">{props.t('releaseNotes.loadFailed')}</div>
              <button
                className="dsfc-no-drag mt-3 px-3 py-2 rounded-lg border border-accent2/40 bg-accent2/20 text-xs text-text-200 hover:bg-accent2/30"
                onClick={fetchNotes}
              >
                {props.t('releaseNotes.retry')}
              </button>
            </div>
          ) : (
            <div
              className="prose prose-invert max-w-none text-text-200 prose-a:text-accent prose-headings:text-accent"
              dangerouslySetInnerHTML={{ __html: status.html }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
