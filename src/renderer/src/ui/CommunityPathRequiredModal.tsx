import React from 'react'

export function CommunityPathRequiredModal(props: {
  open: boolean
  t: (k: any) => string
  onCancel: () => void
  onOpenSettings: () => void
}) {
  if (!props.open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={props.onCancel} />
      <div className="absolute left-1/2 top-1/2 w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-bg-900 overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="text-sm font-semibold">{props.t('communityRequired.title')}</div>
          <button onClick={props.onCancel} className="text-text-400 hover:text-text-100">
            {props.t('common.close')}
          </button>
        </div>

        <div className="p-4">
          <div className="text-sm text-text-200">{props.t('communityRequired.body')}</div>
        </div>

        <div className="p-4 border-t border-border flex gap-2 justify-end">
          <button onClick={props.onCancel} className="px-4 py-2 rounded-xl border border-accent2/40 bg-accent2/20 text-sm hover:bg-accent2/30">
            {props.t('common.cancel')}
          </button>
          <button onClick={props.onOpenSettings} className="px-4 py-2 rounded-xl bg-accent text-black text-sm font-semibold hover:brightness-110">
            {props.t('communityRequired.openSettings')}
          </button>
        </div>
      </div>
    </div>
  )
}
