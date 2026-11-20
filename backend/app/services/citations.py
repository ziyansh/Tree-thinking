"""引用角标标准化：把智能搜索的 annotations 转成正文中的 [n]。

服务端返回的正文没有角标，引用位置在 message.annotations 的 url_citation 中，
start_index / end_index 按正文的 Unicode 码点计数。前端只识别 [n] / 【n】，
因此需要在落库前把引用位置转换成与 sources 序号一致的角标。
"""

import re

# 插入点紧邻的前文已带角标（模型自发标注）时不再重复插入
_TRAILING_CITATION = re.compile(r"\[\d+\]\s*$")


def _source_number(sources: list[dict], url: str, title: str) -> int:
    """按 url 返回来源序号（从 1 开始）；不存在时追加一条并返回新序号。"""
    for index, item in enumerate(sources):
        if item.get("url") == url:
            return index + 1
    sources.append(
        {
            "title": title or url,
            "url": url,
            "snippet": "",
            "summary": "",
            "siteName": "",
            "date": "",
        }
    )
    return len(sources)


def apply_citations(
    answer: str, annotations: list, sources: list[dict]
) -> tuple[str, list[dict]]:
    """把 url_citation 引用写回正文，并补全缺失的来源。

    返回 (新正文, 可能追加过来源的 sources)。索引非法或越界时跳过，
    同一位置多个引用合并为 [1][2] 形式，保证序号与 sources 下标一致。
    """
    # 位置 -> {url: 序号}：同一 URL 在同一位置只插一次
    positions: dict[int, dict[str, int]] = {}
    for item in annotations if isinstance(annotations, list) else []:
        if not isinstance(item, dict):
            continue
        # 只处理 url_citation 类型；缺省 type 的兼容数据也接受
        if item.get("type") not in (None, "url_citation"):
            continue
        citation = item.get("url_citation")
        if not isinstance(citation, dict):
            continue

        url = str(citation.get("url") or "")
        start = citation.get("start_index")
        end = citation.get("end_index")
        # 索引必须是整数；负值、起点越界、区间倒置视为非法数据
        if not isinstance(start, int) or not isinstance(end, int):
            continue
        if start < 0 or end < 0 or start > len(answer) or end < start:
            continue
        # 终点越界时收敛到正文末尾，避免插入越界
        end = min(end, len(answer))
        # 插入点紧邻的前文已有角标（模型自发标注），跳过且不追加来源
        if _TRAILING_CITATION.search(answer[:end]):
            continue

        title = str(citation.get("title") or "")
        url_numbers = positions.setdefault(end, {})
        url_numbers.setdefault(url, _source_number(sources, url, title))

    if not positions:
        return answer, sources

    # 从后往前插入，避免前面的插入影响后面的位置
    for position in sorted(positions, reverse=True):
        numbers = sorted(positions[position].values())
        marker = "".join(f"[{number}]" for number in numbers)
        answer = answer[:position] + marker + answer[position:]

    return answer, sources
