"""用户输入中的链接提取与提示词拼装。

DeepSeek 的 deepseek_read_url 只识别最后一条用户消息中的 URL（最多前 10 个，
重复只算一个）。这里统一负责把链接按出现顺序编号，并生成中文说明注入上下文，
保证前端胶囊编号、模型理解与正文角标三者不混淆。
"""

import re

# 裸域名只在这些常见顶级域名下视为链接，避免把普通文字或数字误判成网址
_TLDS = (
    "com|cn|org|net|io|dev|ai|co|edu|gov"
    "|info|me|app|xyz|top|cc|tv|tech|site|online|store|wiki"
)

# URL 正文允许的字符：排除空白、中文/全角标点与引号，防止把后续中文吞进链接
_BODY = r"[^\s\u3000-\u303f\u2018-\u201d\u2026\u4e00-\u9fff\uff00-\uffef<>\"'`]"

# 带协议的链接，或无协议的裸域名（如 github.com/owner/repo、www.example.com/page）
_URL_RE = re.compile(
    rf"https?://{_BODY}+"
    rf"|(?<![@A-Za-z0-9_])(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+(?:{_TLDS})"
    rf"(?![A-Za-z0-9-])(?::\d{{1,5}})?(?:[/?#]{_BODY}*)?",
    re.IGNORECASE,
)

# 链接尾部可能粘连的标点（中英文都要处理）
_TRAILING = ".,;:!?，。；：！？、)）》】\"']}"


def _strip_trailing(text: str) -> str:
    """去掉链接末尾的标点，可能连续多个（如 `）。`）。"""
    return text.rstrip(_TRAILING)


def extract_urls(text: str, limit: int = 10) -> list[str]:
    """按出现顺序提取文本中的链接：去尾部标点、重复只保留首次，最多 limit 个。"""
    if not text:
        return []
    found: list[str] = []
    seen: set[str] = set()
    for match in _URL_RE.finditer(text):
        url = _strip_trailing(match.group(0))
        if not url or url in seen:
            continue
        seen.add(url)
        found.append(url)
        if len(found) >= limit:
            break
    return found


def build_url_prompt(urls: list[str]) -> str:
    """生成链接编号说明（system）：明确编号映射，并区分正文来源角标编号。"""
    lines = [
        "用户在最后一条消息中提到了以下链接，请按编号理解并回答：",
    ]
    for index, url in enumerate(urls, start=1):
        lines.append(f"链接{index} 是 {url}")
    lines.append(
        "请按编号对应理解用户提到的链接，不要混淆或编造链接内容；"
        "无法读取的链接如实说明，不要臆测其内容。"
    )
    lines.append(
        "正文引用来源时仍使用 [n] 角标，该角标的 n 对应联网搜索来源的编号，"
        "与上面的输入链接编号是两套编号，不要混用。"
    )
    return "\n".join(lines)
