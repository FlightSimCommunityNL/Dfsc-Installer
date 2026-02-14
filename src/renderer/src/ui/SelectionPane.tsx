import React from 'react'
import type { ManifestAddon } from '@shared/types'

const DISCORD_URL = "https://discord.gg/VaREFe3SAa"

export function SelectionPane(props: {
  t: (k: any) => string
  categoryName: string
  addons: ManifestAddon[]
  selectedAddonId: string | null
  onSelectAddon: (id: string) => void
  search: string
  onSearch: (q: string) => void
}) {
  return (
    <div className="h-full min-h-0 min-w-0 w-[320px] bg-bg-800 border-r border-border flex flex-col overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-border">
        <div className="text-xs text-text-400">{props.t('common.category') ?? 'Category'}</div>
        <div className="text-lg font-semibold">{props.categoryName}</div>

        <input
          value={props.search}
          onChange={(e) => props.onSearch(e.target.value)}
          placeholder={props.t('common.searchPlaceholder')}
          className="mt-3 w-full bg-bg-900 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-2">
        {props.addons.map((a) => {
          const selected = props.selectedAddonId === a.id
          return (
            <button
              key={a.id}
              onClick={() => props.onSelectAddon(a.id)}
              className={
                `w-full text-left rounded-xl border px-4 py-4 transition ` +
                (selected ? 'border-accent bg-bg-700' : 'border-border hover:bg-bg-700')
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] tracking-wide text-text-400">{shortCode(a.id)}</div>
                  <div className="text-base font-semibold mt-1">{a.name}</div>
                </div>
                {selected ? (
                  <div className="mt-1 text-accent">
                    <CheckIcon />
                  </div>
                ) : null}
              </div>
            </button>
          )
        })}

        {!props.addons.length ? (
          <div className="text-sm text-text-400 px-1 py-6">{props.t('common.noResults') ?? 'No addons found.'}</div>
        ) : null}
      </div>

      <div className="border-t border-border p-3">
        <FooterButton
          label={props.t('links.discord')}
          onClick={() => window.dfsc.external.open(DISCORD_URL)}
          className="w-full"
        />
      </div>
    </div>
  )
}

function FooterButton(props: { label: string; onClick?: () => void; disabled?: boolean; className?: string }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className={
        `px-3 py-2 rounded-lg border border-border bg-bg-900 text-xs text-text-200 hover:bg-bg-800 ` +
        (props.disabled ? 'opacity-50 cursor-not-allowed ' : '') +
        (props.className ?? '')
      }
    >
      {props.label}
    </button>
  )
}

function shortCode(id: string): string {
  const parts = id.split('-').filter(Boolean)
  const take = parts.slice(0, 3).join('-')
  return take.length > 18 ? take.slice(0, 18) + '…' : take
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
