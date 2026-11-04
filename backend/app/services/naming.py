"""画布自动命名：根据元问题与首轮回答生成一个简短标题。

只使用当前生效的模型服务（DeepSeek / OpenAI），失败由调用方降级为不改名。
"""

import json
import re

from app.services import llm

# 画布标题最大长度（字符数），避免侧边栏被过长名称挤爆
MAX_NAME_LENGTH = 20
# 送给模型的回答摘要长度，避免标题请求消耗过多上下文
ANSWER_SUMMARY_LENGTH = 1200


def _clean_name(raw: str) -> str:
    """从模型返回的 JSON/文本中提取标题并清理引号、标点与换行。"""
    text = (raw or "").strip()
    if not text:
        return ""

    name = ""
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            name = str(data.get("name") or "")
    except ValueError:
        # 兼容模型偶尔返回未转义或带解释的文本：优先抓 "name": "..." 片段
        match = re.search(r'"name"\s*:\s*"([^"]+)"', text)
        name = match.group(1) if match else text.splitlines()[0]

    # 去掉常见包裹符号与首尾标点，保证标题干净
    name = name.replace("\n", " ").replace("\r", " ").strip()
    name = name.strip("\"'“”‘’")
    name = name.strip(" #.,，。:：!！?？")
    return name[:MAX_NAME_LENGTH].strip()


async def generate_project_name(
    question: str, answer: str, runtime: dict | None = None
) -> str:
    """调用模型生成画布标题；返回空串表示生成失败或结果不可用。"""
    messages = [
        {
            "role": "system",
            "content": (
                "你是对话画布命名助手。根据用户提供的元问题与首轮回答，"
                "生成一个简洁、具体的中文标题用于左侧画布列表。"
                f"要求：不超过 {MAX_NAME_LENGTH} 个汉字，不要标点、引号或解释，"
                '只输出 JSON：{"name":"标题"}。'
            ),
        },
        {
            "role": "user",
            "content": (
                f"元问题：{question.strip()}\n\n"
                f"回答摘要：{answer.strip()[:ANSWER_SUMMARY_LENGTH]}"
            ),
        },
    ]
    raw = await llm.complete_json(messages, max_tokens=100, runtime=runtime)
    return _clean_name(raw)
