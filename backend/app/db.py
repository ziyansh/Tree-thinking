"""数据库连接：SQLAlchemy 2.0 + SQLite，服务启动时建表。"""

from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app import config

# SQLite 文件位于 backend/data/app.db，允许多线程访问（FastAPI 工作线程）
engine = create_engine(
    f"sqlite:///{config.DB_PATH}", connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    """全部 ORM 模型的基类。"""


def get_db() -> Iterator[Session]:
    """FastAPI 依赖：每个请求一个会话，请求结束后关闭。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """建表（表已存在时跳过），可重复调用。"""
    # 导入模型以把表注册到 Base.metadata
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _ensure_new_columns()


# 后加的列定义：仅用于旧库补列，新库由模型直接建出
_EXTRA_COLUMNS = {
    "projects": {
        # 用户是否手动改过画布名
        "name_is_custom": "BOOLEAN NOT NULL DEFAULT 0",
    },
    "nodes": {
        "suggestions_consumed": "BOOLEAN NOT NULL DEFAULT 0",
        "pinned": "BOOLEAN NOT NULL DEFAULT 0",
        "node_type": "VARCHAR(16) NOT NULL DEFAULT 'chat'",
        "width": "FLOAT",
        "height": "FLOAT",
        # 联网搜索来源与附件元数据，均为 JSON 数组字符串
        "sources": "TEXT",
        "attachments": "TEXT",
    },
    "app_settings": {
        # 服务商与 OpenAI 独立配置（旧库补列）
        "provider": "VARCHAR(16)",
        "openai_api_key": "TEXT",
        "openai_base_url": "VARCHAR(500)",
        "openai_model": "VARCHAR(120)",
        "openai_organization": "VARCHAR(120)",
        "openai_project": "VARCHAR(120)",
        "openai_temperature_enabled": "BOOLEAN",
        "openai_temperature": "FLOAT",
        "openai_max_tokens": "INTEGER",
        "openai_reasoning_effort": "VARCHAR(16)",
        "openai_timeout_seconds": "INTEGER",
        "card_width": "INTEGER",
        "card_height": "INTEGER",
        "card_gap": "INTEGER",
        "connection_style": "VARCHAR(16)",
        # 指针手势三项；long_press_ms 为旧列，保留但不再使用
        "double_click_ms": "INTEGER",
        "drag_drift_delay_ms": "INTEGER",
        "drag_drift_distance": "INTEGER",
        "wheel_mode": "VARCHAR(16)",
        "long_press_ms": "INTEGER",
        "card_font_size": "INTEGER",
        "autosave_minutes": "INTEGER",
        "undo_steps": "INTEGER",
        "theme_hue": "FLOAT",
        "edge_width": "FLOAT",
        "edge_color": "VARCHAR(16)",
        "theme_mode": "VARCHAR(16)",
        "time_format": "VARCHAR(8)",
        # 联网搜索开关
        "web_search_enabled": "BOOLEAN",
        # 来源抽屉高度比例（旧库补列）
        "sources_panel_ratio": "FLOAT",
    },
}


def _ensure_new_columns() -> None:
    """给已有的旧数据库补上后加的列（SQLite 的 create_all 不会改已有表结构）。

    补上 nodes.pinned 后，顺手把旧库里的根节点（parent_id 为空）置为固定；
    只在本次真正新增该列时执行一次，避免每次启动都把用户解除的固定又改回来。
    """
    with engine.begin() as conn:
        for table, columns in _EXTRA_COLUMNS.items():
            existing = {
                row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))
            }
            if not existing:
                continue
            for name, definition in columns.items():
                if name not in existing:
                    conn.execute(
                        text(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
                    )
                    if table == "nodes" and name == "pinned":
                        conn.execute(
                            text(
                                "UPDATE nodes SET pinned = 1 "
                                "WHERE parent_id IS NULL AND pinned = 0"
                            )
                        )
