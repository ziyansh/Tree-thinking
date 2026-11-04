"""ORM 模型：画布（Project）与对话节点（ConversationNode）。"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _uuid() -> str:
    """生成 32 位十六进制字符串主键。"""
    return uuid.uuid4().hex


def _now() -> datetime:
    """统一使用带时区的 UTC 当前时间。"""
    return datetime.now(timezone.utc)


class Project(Base):
    """画布：一个项目，含唯一根节点与视口信息。"""

    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120), default="新画布")
    # 用户是否手动改过名字；只自动命名未手动改名的画布
    name_is_custom: Mapped[bool] = mapped_column(Boolean, default=False)
    # 视口 {x,y,zoom}，存 JSON 字符串；可空表示尚未保存
    viewport: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now)
    updated_at: Mapped[datetime] = mapped_column(default=_now, onupdate=_now)


class ConversationNode(Base):
    """对话节点：一张问答卡片，通过 parent_id 自引用组成树。"""

    __tablename__ = "nodes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id"), index=True
    )
    parent_id: Mapped[str | None] = mapped_column(
        ForeignKey("nodes.id"), nullable=True, index=True
    )
    question: Mapped[str] = mapped_column(Text, default="")
    answer: Mapped[str] = mapped_column(Text, default="")
    reasoning: Mapped[str] = mapped_column(Text, default="")
    # 来源：root（元问题）/ user（自定义输入）/ suggestion（点选建议）
    origin: Mapped[str] = mapped_column(String(16), default="user")
    suggestion_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # 状态：input / pending / streaming / done / error
    status: Mapped[str] = mapped_column(String(16), default="input")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 候选方向，存 JSON 数组 [{"id","text"}] 的字符串
    suggestions: Mapped[str] = mapped_column(Text, default="[]")
    # 本组候选方向是否已被选择（单选后整组隐藏）
    suggestions_consumed: Mapped[bool] = mapped_column(Boolean, default=False)
    # 是否固定：固定后不能被直接拖起（元问题根节点默认固定）
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    # 节点类型：chat（问答卡片）/ note（笔记卡片，不参与连线与建议）
    node_type: Mapped[str] = mapped_column(String(16), default="chat")
    # 笔记卡片的独立宽高；聊天卡片为空，沿用全局卡片尺寸
    width: Mapped[float | None] = mapped_column(Float, nullable=True)
    height: Mapped[float | None] = mapped_column(Float, nullable=True)
    x: Mapped[float] = mapped_column(Float, default=0)
    y: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(default=_now)
    updated_at: Mapped[datetime] = mapped_column(default=_now, onupdate=_now)


class AppSetting(Base):
    """应用内设置：固定只有一行（id=1）。

    字段为空时回落到环境变量（backend/.env）里的默认值，
    这样用户既可以在页面里改，也保留了 .env 作为兜底配置。
    """

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # 当前服务商：deepseek / openai；为空表示 deepseek
    provider: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # 前端提交的 DeepSeek Key；为空表示沿用环境变量
    api_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # 为空表示沿用环境变量；用布尔类型便于直接存 true/false
    thinking_enabled: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # OpenAI 独立保存的一套配置；Key 为空表示沿用环境变量
    openai_api_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    openai_base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    openai_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # 组织与项目 ID 可选；为空表示不发送
    openai_organization: Mapped[str | None] = mapped_column(String(120), nullable=True)
    openai_project: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # 是否发送 temperature（推理模型不支持该参数，默认关闭）
    openai_temperature_enabled: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    openai_temperature: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 最大输出 tokens；0 表示不发送（按 max_completion_tokens 传递）
    openai_max_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 推理强度：default / low / medium / high；default 表示不发送
    openai_reasoning_effort: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # 请求超时秒数
    openai_timeout_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    suggestion_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 全局卡片尺寸；为空表示使用默认值 400×560
    card_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    card_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 卡片间距（px）：新建卡片与自动整理共用；为空表示 80
    card_gap: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 分支连线方式：direct（直接分支）/ bus（共用母线）；为空表示 direct
    connection_style: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # 指针手势：双击间隔、拖动漂移延迟与漂移距离
    double_click_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    drag_drift_delay_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    drag_drift_distance: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 旧版长按设置列保留但不再使用（避免旧库删除列）
    long_press_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 卡片正文字号（px）；为空表示 14
    card_font_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 自动保存间隔（分钟，0 表示关闭）；为空表示 5
    autosave_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 撤销栈深度；为空表示 10
    undo_steps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 主题色相（0–360）；为空表示 173
    theme_hue: Mapped[float | None] = mapped_column(Float, nullable=True)
    # 连线粗细与颜色；为空表示 1.5 与 #3a3f4a
    edge_width: Mapped[float | None] = mapped_column(Float, nullable=True)
    edge_color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # 主题模式：system / light / dark；为空表示 system
    theme_mode: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # 时间制式：24h / 12h；为空表示 24h
    time_format: Mapped[str | None] = mapped_column(String(8), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(default=_now, onupdate=_now)
