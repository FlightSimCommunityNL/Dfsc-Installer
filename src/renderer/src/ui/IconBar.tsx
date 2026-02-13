import React from 'react'
import dfscLogo from '../assets/dfsc-logo.png'

export type IconCategory = {
  id: string
  label: string
  tooltip: string
}

type IconKind = 'paint' | 'plane' | 'wrench' | 'map' | 'default'

const CATEGORY_ICON_MAP: Record<string, IconKind> = {
  liveries: 'paint',
  aircraft: 'plane',
  tools: 'wrench',
  scenery: 'map',
}

export function IconBar(props: {
  categories: IconCategory[]
  selectedCategoryId: string | null
  onSelectCategory: (id: string) => void
  onOpenSettings: () => void
  status?: 'loading' | 'offline' | 'ready'
}) {
  return (
    <div className="h-full min-h-0 min-w-0 w-[76px] bg-bg-900 border-r border-border flex flex-col overflow-hidden">
      {/* Top: logo */}
      <div className="pt-3 pb-2 flex flex-col items-center gap-3">
        <img src={dfscLogo} alt="DFSC" className="h-8 w-auto" draggable={false} />

        <div className="h-3 flex items-center justify-center">
          {props.status === 'loading' ? (
            <div title="Loading" className="w-2 h-2 rounded-full bg-accent2/60" />
          ) : props.status === 'offline' ? (
            <div title="Offline" className="w-2 h-2 rounded-full bg-highlight/70" />
          ) : null}
        </div>
      </div>

      {/* Middle: categories (scrollable if needed) */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col items-center gap-3 py-2">
        {props.categories.map((c) => {
          const selected = props.selectedCategoryId === c.id
          return (
            <button
              key={c.id}
              title={c.tooltip}
              onClick={() => props.onSelectCategory(c.id)}
              className={
                `w-11 h-11 rounded-xl border flex items-center justify-center transition ` +
                (selected
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-transparent hover:border-border hover:bg-bg-800 text-text-400')
              }
            >
              <CategoryGlyph id={c.id} />
            </button>
          )
        })}
      </div>

      {/* Bottom: pinned controls */}
      <div className="mt-auto pb-4 pt-2 flex-shrink-0 flex flex-col items-center gap-2">
        <button
          title="Settings"
          onClick={props.onOpenSettings}
          className="dsfc-no-drag w-11 h-11 rounded-xl border border-transparent hover:border-border hover:bg-bg-800 text-text-400 flex items-center justify-center"
        >
          <GearIcon />
        </button>
      </div>
    </div>
  )
}

function CategoryGlyph(props: { id: string }) {
  const kind = CATEGORY_ICON_MAP[String(props.id ?? '').toLowerCase()] ?? 'default'
  switch (kind) {
    case 'paint':
      return <PaintIcon />
    case 'plane':
      return <PlaneIcon />
    case 'wrench':
      return <WrenchIcon />
    case 'map':
      return <MapPinIcon />
    default:
      return <GridIcon />
  }
}

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M19.4 15a7.96 7.96 0 0 0 .1-1 7.96 7.96 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a8.1 8.1 0 0 0-1.7-1L15 2h-6l-.3 2.5a8.1 8.1 0 0 0-1.7 1l-2.4-1-2 3.5L4.6 13a7.96 7.96 0 0 0-.1 1 7.96 7.96 0 0 0 .1 1l-2 1.5 2 3.5 2.4-1a8.1 8.1 0 0 0 1.7 1L9 22h6l.3-2.5a8.1 8.1 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5Z" />
    </svg>
  )
}

function PlaneIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 12 3 8v2l6 4-6 4v2l7-4" />
      <path d="M14 12 21 8v2l-6 4 6 4v2l-7-4" />
      <path d="M12 2v20" />
    </svg>
  )
}

function PaintIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 11c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3Z" />
      <path d="M2 22s6-1 9-4 4-9 4-9" />
      <path d="M7 17l-2 5" />
    </svg>
  )
}

function WrenchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a4 4 0 0 0-5.7 5.7l-6.5 6.5a2 2 0 0 0 2.8 2.8l6.5-6.5a4 4 0 0 0 5.7-5.7l-3 3-3-3 3-3Z" />
    </svg>
  )
}

function MapPinIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s7-5 7-12a7 7 0 1 0-14 0c0 7 7 12 7 12Z" />
      <path d="M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h7v7H4z" />
      <path d="M13 4h7v7h-7z" />
      <path d="M4 13h7v7H4z" />
      <path d="M13 13h7v7h-7z" />
    </svg>
  )
}
