import type { RemoteManifest } from '@shared/types'
import { app } from 'electron'
import { dirname, join } from 'path'
import fse from 'fs-extra'
import { request } from 'undici'

const IS_DEV = !app.isPackaged

let memCache: { url: string; at: number; manifest: RemoteManifest } | null = null

export type FetchManifestResult = { manifest: RemoteManifest; mode: 'online' | 'offline' }

function emptyManifest(): RemoteManifest {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    categories: [],
    addons: [],
  }
}

function validateManifestShape(m: any): { ok: true } | { ok: false; reason: string } {
  if (!m || typeof m !== 'object') return { ok: false, reason: 'manifest is not an object' }
  if (typeof m.schemaVersion !== 'number') return { ok: false, reason: 'schemaVersion is not a number' }
  if (!Array.isArray(m.categories)) return { ok: false, reason: 'categories is not an array' }
  if (!Array.isArray(m.addons)) return { ok: false, reason: 'addons is not an array' }
  return { ok: true }
}

function getCachePath(): string {
  return join(app.getPath('userData'), 'cache', 'manifest.json')
}

export async function fetchManifest(
  manifestUrl: string,
  maxAgeMs = 15_000,
  timeoutMs?: number
): Promise<FetchManifestResult> {
  if (memCache && memCache.url === manifestUrl && Date.now() - memCache.at < maxAgeMs) {
    return { manifest: memCache.manifest, mode: 'online' }
  }

  try {
    if (IS_DEV) {
      console.log(`[manifest] GET ${manifestUrl}`)
    }

    const controller = timeoutMs ? new AbortController() : null
    const t =
      timeoutMs && controller
        ? setTimeout(() => {
            controller.abort()
          }, timeoutMs)
        : null

    const res = await request(manifestUrl, { method: 'GET', signal: controller?.signal as any })

    if (t) clearTimeout(t)

    const contentType = String(res.headers['content-type'] ?? '')
    if (IS_DEV) {
      console.log(`[manifest] status=${res.statusCode} content-type=${contentType || '(missing)'}`)
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Manifest fetch failed: HTTP ${res.statusCode}`)
    }

    // Guardrail: many NAS/web setups return an HTML login/portal page instead of the JSON.
    // We detect that early to produce a clear error.
    if (!contentType.toLowerCase().includes('application/json')) {
      const preview = await res.body.text()
      const head = preview.trimStart().slice(0, 64).toLowerCase()
      const looksHtml = head.startsWith('<!doctype') || head.startsWith('<html')

      if (IS_DEV) {
        console.log(`[manifest] non-json response preview: ${preview.slice(0, 300).replace(/\s+/g, ' ')}`)
      }

      if (looksHtml) {
        throw new Error('Manifest URL returned HTML instead of JSON. Check Synology Web Station configuration.')
      }

      throw new Error(`Manifest fetch failed: expected application/json but got ${contentType || '(missing content-type)'}`)
    }

    const json = (await res.body.json()) as any
    const v = validateManifestShape(json)
    if (!v.ok) {
      const keys = json && typeof json === 'object' ? Object.keys(json).slice(0, 20).join(', ') : String(json)
      console.error(`[manifest] invalid schema (${v.reason}); keys=${keys}`)

      const empty = emptyManifest()
      memCache = { url: manifestUrl, at: Date.now(), manifest: empty }
      return { manifest: empty, mode: 'online' }
    }

    if (IS_DEV) {
      for (const a of json.addons ?? []) {
        const anyAddon = a as any
        console.log(`[manifest] addon id=${a.id} allowRawInstall=${anyAddon?.allowRawInstall === true ? 'true' : 'false'}`)
      }
    }

    memCache = { url: manifestUrl, at: Date.now(), manifest: json }

    // persist cache
    const p = getCachePath()
    await fse.ensureDir(dirname(p))
    await fse.writeJson(p, { url: manifestUrl, cachedAt: new Date().toISOString(), manifest: json }, { spaces: 2 })

    return { manifest: json, mode: 'online' }
  } catch (err) {
    // offline fallback
    const p = getCachePath()
    if (await fse.pathExists(p)) {
      const cached = await fse.readJson(p)
      const json = cached?.manifest as any
      const v = validateManifestShape(json)
      if (v.ok) {
        memCache = { url: manifestUrl, at: Date.now(), manifest: json }
        return { manifest: json, mode: 'offline' }
      }

      console.warn(`[manifest] cached manifest invalid (${v.reason}); falling back to empty`) 
    }

    // No cache available; fail-open with a safe empty manifest so reconcile/render never crash.
    const empty = emptyManifest()
    memCache = { url: manifestUrl, at: Date.now(), manifest: empty }
    console.warn(`[manifest] fetch failed and no valid cache; using empty manifest. error=${(err as any)?.message ?? String(err)}`)
    return { manifest: empty, mode: 'offline' }
  }
}
