/** mdast 的最小结构定义：只为高亮改写服务，避免引入额外依赖 */
interface MdastNode {
  type: string
  value?: string
  children?: MdastNode[]
  data?: Record<string, unknown>
}

/** 生成高亮节点：hName 覆盖默认的 em，渲染成带 class 的 mark */
function markNode(value: string): MdastNode {
  return {
    type: 'emphasis',
    data: { hName: 'mark', hProperties: { className: 'search-flash' } },
    children: [{ type: 'text', value }],
  }
}

/** 把一段文本按关键词切分成文本与高亮节点；未命中返回 null */
function splitText(value: string, needle: string): MdastNode[] | null {
  const lower = value.toLowerCase()
  if (!lower.includes(needle)) return null
  const parts: MdastNode[] = []
  let start = 0
  let index = lower.indexOf(needle)
  while (index >= 0) {
    if (index > start) parts.push({ type: 'text', value: value.slice(start, index) })
    parts.push(markNode(value.slice(index, index + needle.length)))
    start = index + needle.length
    index = lower.indexOf(needle, start)
  }
  if (start < value.length) parts.push({ type: 'text', value: value.slice(start) })
  return parts
}

/** 递归改写文本节点；代码块与公式内部保持原样 */
function rewrite(node: MdastNode, needle: string): void {
  if (!node.children) return
  if (node.type === 'code' || node.type === 'math') return
  const next: MdastNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && child.value) {
      const parts = splitText(child.value, needle)
      if (parts) next.push(...parts)
      else next.push(child)
      continue
    }
    // 行内代码与行内公式不改写，避免破坏内容
    if (child.type !== 'inlineCode' && child.type !== 'inlineMath') rewrite(child, needle)
    next.push(child)
  }
  node.children = next
}

/**
 * remark 插件：把正文中的搜索关键词包成 <mark class="search-flash">。
 * 用于点击搜索结果后，在卡片正文里高亮并闪烁命中内容。
 */
export function remarkSearchFlash(term: string) {
  const needle = term.trim().toLowerCase()
  return () => (tree: unknown) => {
    if (!needle || typeof tree !== 'object' || tree === null) return
    rewrite(tree as MdastNode, needle)
  }
}
