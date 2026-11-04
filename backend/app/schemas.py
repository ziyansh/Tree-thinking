"""Pydantic 模型：请求体与响应 DTO。

Python 侧字段用下划线命名，输出 JSON 时统一转 camelCase。
"""

import json
import re
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, field_validator

# 连线颜色格式：#rrggbb（大小写均可，入库统一转小写）
EDGE_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")


def to_camel(name: str) -> str:
    """下划线命名转小驼峰，用于输出 JSON 字段名。"""
    head, *tail = name.split("_")
    return head + "".join(part.capitalize() for part in tail)


def _to_iso(value: datetime) -> str:
    """datetime 转 ISO 字符串；无时区信息时按 UTC 补齐，保证前后端解析一致。"""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


class CamelModel(BaseModel):
    """统一配置：camelCase 别名、允许按字段名填充、可直接从 ORM 对象校验。"""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class Suggestion(CamelModel):
    """一条候选方向。"""

    id: str
    text: str


class ProjectOut(CamelModel):
    """画布详情（含创建/更新时间）。"""

    id: str
    name: str
    viewport: dict[str, Any] | None = None
    created_at: str
    updated_at: str

    @field_validator("viewport", mode="before")
    @classmethod
    def _parse_viewport(cls, value: Any) -> Any:
        """数据库里是 JSON 字符串，转成对象输出；非法内容按空视口处理。"""
        if isinstance(value, str):
            try:
                return json.loads(value)
            except ValueError:
                return None
        return value

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _parse_time(cls, value: Any) -> Any:
        """ORM 的 datetime 统一转 ISO 字符串。"""
        return _to_iso(value) if isinstance(value, datetime) else value


class ProjectListItem(CamelModel):
    """侧边栏列表项：名称、根问题摘要、节点数、更新时间。"""

    id: str
    name: str
    viewport: dict[str, Any] | None = None
    root_question: str
    node_count: int
    updated_at: str

    @field_validator("viewport", mode="before")
    @classmethod
    def _parse_viewport(cls, value: Any) -> Any:
        """同 ProjectOut，把 JSON 字符串转成对象。"""
        if isinstance(value, str):
            try:
                return json.loads(value)
            except ValueError:
                return None
        return value

    @field_validator("updated_at", mode="before")
    @classmethod
    def _parse_time(cls, value: Any) -> Any:
        """ORM 的 datetime 统一转 ISO 字符串。"""
        return _to_iso(value) if isinstance(value, datetime) else value


class NodeOut(CamelModel):
    """节点 DTO，字段顺序与 spec「接口一览」一致。"""

    id: str
    project_id: str
    parent_id: str | None = None
    question: str
    answer: str
    reasoning: str
    origin: str
    suggestion_id: str | None = None
    status: str
    error: str | None = None
    suggestions: list[Suggestion] = []
    suggestions_consumed: bool = False
    # 是否固定（元问题根节点默认固定）
    pinned: bool = False
    # 节点类型：chat（问答卡片）/ note（笔记卡片）
    node_type: str = "chat"
    # 笔记卡片的独立宽高；聊天卡片为空
    width: float | None = None
    height: float | None = None
    x: float
    y: float
    created_at: str
    updated_at: str

    @field_validator("suggestions", mode="before")
    @classmethod
    def _parse_suggestions(cls, value: Any) -> Any:
        """数据库里是 JSON 数组字符串，解析后输出数组；非法内容返回空数组。"""
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except ValueError:
                return []
            return parsed if isinstance(parsed, list) else []
        return value

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _parse_time(cls, value: Any) -> Any:
        """ORM 的 datetime 统一转 ISO 字符串。"""
        return _to_iso(value) if isinstance(value, datetime) else value


class ProjectCreate(CamelModel):
    """新建画布请求，名称可选。"""

    name: str | None = None


class ProjectPatch(CamelModel):
    """更新画布请求，仅重命名或保存视口。"""

    name: str | None = None
    viewport: dict[str, Any] | None = None


class NodeCreate(CamelModel):
    """创建子节点请求。"""

    parent_id: str
    question: str
    origin: Literal["user", "suggestion"] = "user"
    suggestion_id: str | None = None


class NodePatch(CamelModel):
    """更新节点请求：坐标、固定状态、标题、正文、笔记尺寸与候选方向。

    标题写入 question，正文仅对笔记生效（写入 answer），
    宽高仅对笔记生效；候选方向整组覆盖（用于撤销「换一个方向」），
    非法字段在接口层忽略或夹取。
    """

    x: float | None = None
    y: float | None = None
    pinned: bool | None = None
    title: str | None = None
    content: str | None = None
    width: float | None = None
    height: float | None = None
    suggestions: list[Suggestion] | None = None


class NoteCreate(CamelModel):
    """新建笔记卡片请求：画布坐标。"""

    x: float
    y: float


class NodeRestoreItem(CamelModel):
    """批量恢复的单个节点：前端此前拿到的完整节点结构（camelCase）。

    projectId 由路径决定、createdAt/updatedAt 由服务端重建，
    这里不声明它们，多余字段会被忽略。
    """

    id: str
    parent_id: str | None = None
    question: str = ""
    answer: str = ""
    reasoning: str = ""
    origin: str = "user"
    suggestion_id: str | None = None
    status: str = "done"
    error: str | None = None
    suggestions: list[Suggestion] = []
    suggestions_consumed: bool = False
    pinned: bool = False
    node_type: str = "chat"
    width: float | None = None
    height: float | None = None
    x: float = 0
    y: float = 0


class RestoreRequest(CamelModel):
    """批量恢复节点请求，用于前端撤销「删除」。"""

    nodes: list[NodeRestoreItem] = []


class NodeQuestion(CamelModel):
    """写入节点问题请求。"""

    question: str


class SuggestionRequest(CamelModel):
    """重新生成候选方向请求，数量可选（后端会夹到 2–6）。"""

    count: int | None = None


class SettingsPatch(CamelModel):
    """更新应用设置：字段均可选，只提交需要修改的项。

    apiKey 留空或不传表示保持原 Key，避免只改模型时误清空。
    """

    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None
    thinking_enabled: bool | None = None
    # 服务商：deepseek / openai；非法值在服务层回落默认，不在这里拦截
    provider: str | None = None
    # OpenAI 独立配置：Key 留空表示保持原值
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    openai_model: str | None = None
    openai_organization: str | None = None
    openai_project: str | None = None
    openai_temperature_enabled: bool | None = None
    # 以下数值在服务层夹取到合法范围，不返回 422
    openai_temperature: float | None = None
    openai_max_tokens: int | None = None
    openai_reasoning_effort: str | None = None
    openai_timeout_seconds: int | None = None
    suggestion_count: int | None = None
    card_width: int | None = None
    card_height: int | None = None
    # 画布：分支连线方式
    connection_style: Literal["direct", "bus"] | None = None
    # 指针手势：双击间隔、拖动漂移延迟与漂移距离（服务层夹取范围）
    double_click_ms: int | None = None
    drag_drift_delay_ms: int | None = None
    drag_drift_distance: int | None = None
    # 外观：卡片正文字号（12–24，非法值返回 422）
    card_font_size: int | None = None
    # 保存：自动保存间隔（分钟，0=关闭）与撤销栈深度（最小 1）
    autosave_minutes: int | None = None
    undo_steps: int | None = None
    # 外观：主题色相（0–360，超出夹取）、连线粗细与颜色、主题模式、时间制式
    theme_hue: float | None = None
    edge_width: float | None = None
    edge_color: str | None = None
    theme_mode: Literal["system", "light", "dark"] | None = None
    time_format: Literal["24h", "12h"] | None = None

    @field_validator("edge_color")
    @classmethod
    def _check_edge_color(cls, value: str | None) -> str | None:
        """连线颜色只接受 #rrggbb，统一转小写；其它写法按非法处理。"""
        if value is None:
            return value
        text = value.strip().lower()
        if not EDGE_COLOR_PATTERN.match(text):
            raise ValueError("连线颜色需为 #rrggbb 形式")
        return text

    @field_validator("base_url", "openai_base_url")
    @classmethod
    def _check_base_url(cls, value: str | None) -> str | None:
        """接口地址必须是 http/https，空串表示恢复环境变量默认值。"""
        if value is None:
            return value
        text = value.strip()
        if text and not text.startswith(("http://", "https://")):
            raise ValueError("接口地址需以 http:// 或 https:// 开头")
        return text

    @field_validator("model", "openai_model")
    @classmethod
    def _check_model(cls, value: str | None) -> str | None:
        """去掉首尾空白；空串表示恢复环境变量默认值。"""
        return value.strip() if value is not None else value

    @field_validator("openai_organization", "openai_project")
    @classmethod
    def _check_optional_text(cls, value: str | None) -> str | None:
        """组织 / 项目 ID 去空白；空串表示不发送。"""
        return value.strip() if value is not None else value

    @field_validator("suggestion_count")
    @classmethod
    def _check_count(cls, value: int | None) -> int | None:
        """候选方向数量限定在 2–6，与前端输入框范围一致。"""
        if value is not None and not 2 <= value <= 6:
            raise ValueError("候选方向数量需在 2–6 之间")
        return value
