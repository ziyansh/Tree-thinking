import { useEscapeHandler } from '../lib/escapeStack'

/** 服务器模式首次登录后的开发中提示：应用内弹窗，不使用浏览器 alert */
export function WipNotice({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEscapeHandler(open, onClose)
  if (!open) return null

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'color-mix(in srgb, var(--bg-canvas) 72%, transparent)' }}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="开发中版本提示"
        data-modal-open="true"
        className="dialog-panel w-[440px] max-w-[calc(100vw-48px)] rounded-xl border border-subtle bg-panel p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-[16px] font-semibold text-ink">开发中版本</h2>
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          这是一个正在开发中的项目，功能和界面仍会调整，不代表最终品质。遇到问题或数据异常请及时反馈。
        </p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-on-accent transition-opacity duration-150 hover:opacity-90"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  )
}
