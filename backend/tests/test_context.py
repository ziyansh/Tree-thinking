"""分支上下文拼接测试：纯函数 build_messages，不查库。"""

from types import SimpleNamespace

import pytest

from app.services.context import SYSTEM_PROMPT, build_messages


def _node(question: str, answer: str, reasoning: str = "") -> SimpleNamespace:
    """构造未入库的朴素节点（字段名与 ConversationNode 一致）。"""
    return SimpleNamespace(question=question, answer=answer, reasoning=reasoning)


# 四个路径共用的测试数据：每一层问题的文本都唯一，便于断言「含/不含」
ROOT = _node(
    "元问题：如何系统学习机器学习？",
    "元回答：先补数学与编程基础，再做小项目。",
    "元思考过程：先确认用户的基础。",
)
B = _node(
    "分支 B 问题：数学基础具体学哪些？",
    "分支 B 回答：线性代数、概率论与微积分。",
    "分支 B 思考过程：按课程顺序列举。",
)
C = _node(
    "分支 C 问题：概率论要学到什么程度？",
    "分支 C 回答：掌握常见分布与贝叶斯公式即可。",
    "分支 C 思考过程：给出难度分档。",
)
D = _node(
    "分支 D 问题：从哪个项目开始练手？",
    "分支 D 回答：先做房价预测这类表格数据项目。",
    "分支 D 思考过程：选门槛最低的项目。",
)
E = _node("分支 E 问题：表格数据项目要注意什么？", "", "")


@pytest.mark.parametrize(
    ("path", "roles"),
    [
        ([ROOT], ["system", "user"]),
        ([ROOT, B], ["system", "user", "assistant", "user"]),
        ([ROOT, B, C], ["system", "user", "assistant", "user", "assistant", "user"]),
        (
            [ROOT, B, D, E],
            [
                "system",
                "user",
                "assistant",
                "user",
                "assistant",
                "user",
                "assistant",
                "user",
            ],
        ),
    ],
)
def test_build_messages_order(path, roles):
    """messages 顺序为 system → 各祖先 Q/A → 当前节点问题，且不含 reasoning。"""
    messages = build_messages(path)

    assert [message["role"] for message in messages] == roles
    assert messages[0] == {"role": "system", "content": SYSTEM_PROMPT}
    assert messages[-1] == {"role": "user", "content": path[-1].question}

    # 祖先按「问题、回答」成对出现：第 i 个祖先对应 1+2i 与 2+2i
    for index, ancestor in enumerate(path[:-1]):
        assert messages[2 * index + 1] == {
            "role": "user",
            "content": ancestor.question,
        }
        assert messages[2 * index + 2] == {
            "role": "assistant",
            "content": ancestor.answer,
        }

    # 思考过程绝不进入上下文：既没有 reasoning 字段，也没有思考文本
    assert all("reasoning" not in message for message in messages)
    joined = "\n".join(message["content"] for message in messages)
    assert "reasoning_content" not in joined
    for ancestor in path:
        if ancestor.reasoning:
            assert ancestor.reasoning not in joined


def test_c_path_excludes_siblings():
    """请求 C 时只含 元、B、C，不含兄弟分支 D/E 的内容。"""
    messages = build_messages([ROOT, B, C])
    joined = "\n".join(message["content"] for message in messages)

    assert ROOT.question in joined
    assert B.question in joined
    assert C.question in joined

    assert D.question not in joined
    assert D.answer not in joined
    assert E.question not in joined


def test_e_path_excludes_sibling_c():
    """请求 E 时只含 元、B、D、E，不含兄弟分支 C 的内容。"""
    messages = build_messages([ROOT, B, D, E])
    joined = "\n".join(message["content"] for message in messages)

    assert B.question in joined
    assert D.question in joined
    assert E.question in joined

    assert C.question not in joined
    assert C.answer not in joined
