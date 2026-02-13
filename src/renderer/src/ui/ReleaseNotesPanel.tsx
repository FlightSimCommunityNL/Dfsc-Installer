import React, { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

type Props = {
  t: (k: any) => string
  open: boolean
  addonId: string
  channelVersion: string | null
  releaseNotesUrl: string | null
  onClose: () => void
}

type CacheKey = string

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

export function ReleaseNotesPanel(props: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [html, setHtml] = useState<string>('')

  const cacheRef = useRef<Map<CacheKey, string>>(new Map())
  const key = useMemo(() => `${props.addonId}::${props.channelVersion ?? 'unknown'}`, [props.addonId, props.channelVersion])

  const canFetch = !!props.releaseNotesUrl

  const fetchNotes = async () => {
    if (!props.releaseNotesUrl) return

    const cached = cacheRef.current.get(key)
    if (cached) {
      setHtml(cached)
      setStatus('ready')
      setError(null)
      return
    }

    setStatus('loading')
    setError(null)

    try {
      const res = await window.dsfc.releaseNotes.fetch(props.releaseNotesUrl)
      const body = String(res?.body ?? '')
      const contentType = String(res?.contentType ?? '')

      let rendered: string
      if (contentType.toLowerCase().includes('text/markdown') || (!contentType && !looksLikeHtml(body))) {
        rendered = marked.parse(body) as string
      } else if (looksLikeHtml(body)) {
        rendered = body
      } else {
        // treat as plain text
        rendered = `<pre>${escapeHtml(body)}</pre>`
      }

      const safe = sanitizeHtml(rendered)
      cacheRef.current.set(key, safe)
      setHtml(safe)
      setStatus('ready')
    } catch (e: any) {
      setStatus('error')
      setError(e?.message ?? String(e))
    }
  }

  // Fetch when opened.
  useEffect(() => {
    if (!props.open) return
    if (!canFetch) return
    void fetchNotes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, key, props.releaseNotesUrl])

  const bodyRef = useRef<HTMLDivElement | null>(null)

  // Smooth expand/collapse: animate max-height.
  const containerStyle = useMemo(() => {
    return {
      maxHeight: props.open ? 360 : 0,
      opacity: props.open ? 1 : 0,
    } as React.CSSProperties
  }, [props.open])

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
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-text-400">{props.t('actions.releaseNotes')}</div>
        {props.open ? (
          <button className="dsfc-no-drag text-xs text-text-400 hover:text-text-100" onClick={props.onClose}>
            {props.t('releaseNotes.close')}
          </button>
        ) : null}
      </div>

      <div
        className={
          "mt-2 rounded-xl border border-border bg-bg-700 overflow-hidden transition-all duration-200 " +
          (props.open ? '' : 'pointer-events-none')
        }
        style={containerStyle}
      >
        <div className="max-h-[360px] overflow-auto p-4" onClick={onClickContent}>
          {!canFetch ? (
            <div className="text-sm text-text-400">—</div>
          ) : status === 'loading' ? (
            <div className="text-sm text-text-400">{props.t('releaseNotes.loading')}</div>
          ) : status === 'error' ? (
            <div>
              <div className="text-sm text-highlight">{props.t('releaseNotes.error')}</div>
              <div className="mt-1 text-[11px] text-text-400">{error}</div>
              <button
                className="dsfc-no-drag mt-3 px-3 py-2 rounded-lg border border-accent2/40 bg-accent2/20 text-xs text-text-200 hover:bg-accent2/30"
                onClick={fetchNotes}
              >
                {props.t('releaseNotes.retry')}
              </button>
            </div>
          ) : (
            <div
              ref={bodyRef}
              className="prose prose-invert max-w-none text-text-200 prose-a:text-accent prose-headings:text-accent"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
