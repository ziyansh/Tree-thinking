/** 启动提示弹窗的统一开关：修改这里的布尔值即可开启 / 关闭对应弹窗 */
export const NOTICE_SWITCHES = {
  /** 服务器模式首次登录的「开发中版本」提示 */
  wip: true,
  /** 非 Windows 设备与 Linux 本地模式的兼容性提示 */
  compatibility: true,
}

/** 提示弹窗内容 */
export interface NoticeContent {
  title: string
  body: string
}

/** 「开发中版本」提示文案 */
export const WIP_NOTICE: NoticeContent = {
  title: '开发中版本',
  body: '这是一个正在开发中的项目，功能和界面仍会调整，不代表最终品质。遇到问题或数据异常请及时反馈。',
}

/** 兼容性提示文案：按设备类型区分正文 */
const COMPATIBILITY_NOTICES = {
  macos: {
    title: '兼容性提示',
    body: '当前版本对 macOS 的兼容性一般，建议在 Windows 系统下使用。',
  },
  mobile: {
    title: '兼容性提示',
    body: '当前版本对手机端的兼容较差，建议在 Windows 系统下使用。',
  },
  linuxLocal: {
    title: '兼容性提示',
    body: 'Linux 本地模式尚未实测。',
  },
} satisfies Record<string, NoticeContent>

/**
 * 判断是否需要展示兼容性提示：返回 null 表示无需提示。
 * 手机端优先判断，避免 Android 的 UA 同时命中 Linux；Linux 提示仅在本地模式下出现。
 */
export function detectCompatibilityNotice(
  mode: 'local' | 'server',
  userAgent: string,
): NoticeContent | null {
  if (/iPhone|iPod|Android|Windows Phone|IEMobile|BlackBerry|Opera Mini/i.test(userAgent)) {
    return COMPATIBILITY_NOTICES.mobile
  }
  if (/Macintosh|Mac OS X/i.test(userAgent)) {
    return COMPATIBILITY_NOTICES.macos
  }
  if (mode === 'local' && /Linux/i.test(userAgent)) {
    return COMPATIBILITY_NOTICES.linuxLocal
  }
  return null
}
