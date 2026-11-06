import { useEffect, useState } from 'react'

/** 画布提示：出现时上浮 8px，消失前先淡出 160ms 再卸载 */
export function Toast({ message }: { message: string | null }) {
  const [shown, setShown] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (message) {
      setShown(message)
      setLeaving(false)
      return
    }
    // 消息被清空：保留 160ms 播放退场动画
    setLeaving(true)
    const timer = window.setTimeout(() => {
      setShown(null)
      setLeaving(false)
    }, 160)
    return () => window.clearTimeout(timer)
  }, [message])

  if (!shown) return null

  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 -translate-x-1/2">
      <div
        className={[
          'rounded-full border border-subtle bg-panel px-4 py-1.5 text-[12px] text-ink shadow-lg',
          leaving ? 'toast-out' : 'toast-in',
        ].join(' ')}
      >
        {shown}
      </div>
    </div>
  )
}
