"""运行时可修改的模型设置。

优先级：数据库中的 app_settings（页面「设置」里保存）> backend/.env 环境变量。
保存后下一次请求立即生效，无需重启服务。
"""

from sqlalchemy.orm import Session

from app import config
from app.models import AppSetting
from app.schemas import EDGE_COLOR_PATTERN

# 单行设置的固定主键
SETTINGS_ID = 1
# 候选方向数量的合法范围
MIN_SUGGESTION_COUNT = 2
MAX_SUGGESTION_COUNT = 6
# 全局卡片尺寸：默认值，仅限制最小值（不设上限）
DEFAULT_CARD_WIDTH = 400
DEFAULT_CARD_HEIGHT = 560
MIN_CARD_WIDTH = 280
MIN_CARD_HEIGHT = 240

# 画布 / 移动 / 保存 / 外观类设置的默认值与取值范围
DEFAULT_CONNECTION_STYLE = "direct"
CONNECTION_STYLES = ("direct", "bus")
# 指针手势：双击间隔、拖动漂移延迟与漂移距离
DEFAULT_DOUBLE_CLICK_MS = 300
MIN_DOUBLE_CLICK_MS = 100
MAX_DOUBLE_CLICK_MS = 1000
DEFAULT_DRAG_DRIFT_DELAY_MS = 0
MIN_DRAG_DRIFT_DELAY_MS = 0
MAX_DRAG_DRIFT_DELAY_MS = 500
DEFAULT_DRAG_DRIFT_DISTANCE = 10
MIN_DRAG_DRIFT_DISTANCE = 0
MAX_DRAG_DRIFT_DISTANCE = 50
# 卡片正文字号（px）：默认 14，范围 12–24
DEFAULT_CARD_FONT_SIZE = 14
MIN_CARD_FONT_SIZE = 12
MAX_CARD_FONT_SIZE = 24
DEFAULT_AUTOSAVE_MINUTES = 5
MIN_AUTOSAVE_MINUTES = 0
DEFAULT_UNDO_STEPS = 10
MIN_UNDO_STEPS = 1
DEFAULT_THEME_HUE = 173
MIN_THEME_HUE = 0
MAX_THEME_HUE = 360
DEFAULT_EDGE_WIDTH = 1.5
MIN_EDGE_WIDTH = 0.5
MAX_EDGE_WIDTH = 6
DEFAULT_EDGE_COLOR = "#3a3f4a"
DEFAULT_THEME_MODE = "system"
THEME_MODES = ("system", "light", "dark")
DEFAULT_TIME_FORMAT = "24h"
TIME_FORMATS = ("24h", "12h")

# 服务商：DeepSeek（默认）/ OpenAI
DEFAULT_PROVIDER = "deepseek"
PROVIDERS = ("deepseek", "openai")
# OpenAI 默认地址、模型与可选参数
DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
DEFAULT_OPENAI_TEMPERATURE = 1.0
MIN_OPENAI_TEMPERATURE = 0.0
MAX_OPENAI_TEMPERATURE = 2.0
DEFAULT_OPENAI_MAX_TOKENS = 0
DEFAULT_OPENAI_REASONING_EFFORT = "default"
OPENAI_REASONING_EFFORTS = ("default", "low", "medium", "high")
DEFAULT_OPENAI_TIMEOUT_SECONDS = 60
MIN_OPENAI_TIMEOUT_SECONDS = 10
MAX_OPENAI_TIMEOUT_SECONDS = 300


def _effective_size(db_value: int | None, default: int, minimum: int) -> int:
    """尺寸取值：数据库值优先，否则用默认值；非法值回落默认，再夹到最小值。"""
    try:
        value = int(db_value) if db_value is not None else default
    except (TypeError, ValueError):
        value = default
    return max(minimum, value)


def _effective_int(
    db_value: int | None, default: int, minimum: int, maximum: int | None = None
) -> int:
    """整数设置：数据库值优先，非法回落默认，再夹到 [minimum, maximum]。"""
    try:
        value = int(db_value) if db_value is not None else int(default)
    except (TypeError, ValueError):
        value = int(default)
    value = max(minimum, value)
    return value if maximum is None else min(maximum, value)


def _effective_float(
    db_value: float | None, default: float, minimum: float, maximum: float
) -> float:
    """浮点设置：数据库值优先，非法回落默认，再夹到 [minimum, maximum]。"""
    try:
        value = float(db_value) if db_value is not None else float(default)
    except (TypeError, ValueError):
        value = float(default)
    return max(minimum, min(maximum, value))


def _effective_choice(db_value: str | None, allowed: tuple[str, ...], default: str) -> str:
    """枚举设置：只接受白名单内的取值，其它一律回落到默认值。"""
    return db_value if db_value in allowed else default


def _effective_color(db_value: str | None, default: str) -> str:
    """连线颜色：必须是 #rrggbb，非法值回落到默认色。"""
    text = (db_value or "").strip().lower()
    return text if EDGE_COLOR_PATTERN.match(text) else default


def _effective_text(db_value: str | None, fallback: str) -> str:
    """数据库里有非空值就用数据库的，否则回落到环境变量默认值。"""
    if db_value and db_value.strip():
        return db_value.strip()
    return (fallback or "").strip()


def _mask(api_key: str) -> str:
    """给前端展示的脱敏 Key：保留前缀与末 4 位，中间打码。"""
    if not api_key:
        return ""
    if len(api_key) <= 8:
        return "••••"
    return f"{api_key[:3]}••••{api_key[-4:]}"


def effective(db: Session) -> dict:
    """取得当前生效的设置，供模型调用链路使用（包含明文 Key，禁止返回前端）。"""
    row = db.get(AppSetting, SETTINGS_ID)

    provider = _effective_choice(
        row.provider if row else None, PROVIDERS, DEFAULT_PROVIDER
    )

    # DeepSeek：数据库值优先，其次 .env
    deepseek_api_key = (
        (row.api_key if row and row.api_key else config.DEEPSEEK_API_KEY) or ""
    ).strip()
    deepseek_base_url = _effective_text(
        row.base_url if row else None, config.DEEPSEEK_BASE_URL
    )
    deepseek_model = _effective_text(row.model if row else None, config.DEEPSEEK_MODEL)

    if row and row.thinking_enabled is not None:
        thinking_enabled = bool(row.thinking_enabled)
    else:
        thinking_enabled = bool(config.THINKING_ENABLED)

    # OpenAI：独立保存，数据库为空时回落到 .env / 默认值
    openai_api_key = (
        (row.openai_api_key if row and row.openai_api_key else config.OPENAI_API_KEY)
        or ""
    ).strip()
    openai_base_url = _effective_text(
        row.openai_base_url if row else None,
        config.OPENAI_BASE_URL or DEFAULT_OPENAI_BASE_URL,
    )
    openai_model = _effective_text(
        row.openai_model if row else None,
        config.OPENAI_MODEL or DEFAULT_OPENAI_MODEL,
    )
    openai_organization = (
        (row.openai_organization or "").strip() if row else ""
    )
    openai_project = (row.openai_project or "").strip() if row else ""
    if row and row.openai_temperature_enabled is not None:
        temperature_enabled = bool(row.openai_temperature_enabled)
    else:
        temperature_enabled = False

    # 当前生效的一套 Key / 地址 / 模型：由服务商决定
    if provider == "openai":
        api_key, base_url, model = openai_api_key, openai_base_url, openai_model
    else:
        api_key, base_url, model = deepseek_api_key, deepseek_base_url, deepseek_model

    if row and row.suggestion_count is not None:
        count = int(row.suggestion_count)
    else:
        count = int(config.SUGGESTION_COUNT)
    count = max(MIN_SUGGESTION_COUNT, min(MAX_SUGGESTION_COUNT, count))

    return {
        "provider": provider,
        "api_key": api_key,
        "base_url": base_url,
        "model": model,
        "deepseek_api_key": deepseek_api_key,
        "deepseek_base_url": deepseek_base_url,
        "deepseek_model": deepseek_model,
        "thinking_enabled": thinking_enabled,
        "openai_api_key": openai_api_key,
        "openai_base_url": openai_base_url,
        "openai_model": openai_model,
        "openai_organization": openai_organization,
        "openai_project": openai_project,
        "openai_temperature_enabled": temperature_enabled,
        "openai_temperature": _effective_float(
            row.openai_temperature if row else None,
            DEFAULT_OPENAI_TEMPERATURE,
            MIN_OPENAI_TEMPERATURE,
            MAX_OPENAI_TEMPERATURE,
        ),
        "openai_max_tokens": _effective_int(
            row.openai_max_tokens if row else None,
            DEFAULT_OPENAI_MAX_TOKENS,
            DEFAULT_OPENAI_MAX_TOKENS,
        ),
        "openai_reasoning_effort": _effective_choice(
            row.openai_reasoning_effort if row else None,
            OPENAI_REASONING_EFFORTS,
            DEFAULT_OPENAI_REASONING_EFFORT,
        ),
        "openai_timeout_seconds": _effective_int(
            row.openai_timeout_seconds if row else None,
            DEFAULT_OPENAI_TIMEOUT_SECONDS,
            MIN_OPENAI_TIMEOUT_SECONDS,
            MAX_OPENAI_TIMEOUT_SECONDS,
        ),
        "suggestion_count": count,
        "card_width": _effective_size(
            row.card_width if row else None, DEFAULT_CARD_WIDTH, MIN_CARD_WIDTH
        ),
        "card_height": _effective_size(
            row.card_height if row else None, DEFAULT_CARD_HEIGHT, MIN_CARD_HEIGHT
        ),
        "connection_style": _effective_choice(
            row.connection_style if row else None, CONNECTION_STYLES, DEFAULT_CONNECTION_STYLE
        ),
        "double_click_ms": _effective_int(
            row.double_click_ms if row else None,
            DEFAULT_DOUBLE_CLICK_MS,
            MIN_DOUBLE_CLICK_MS,
            MAX_DOUBLE_CLICK_MS,
        ),
        "drag_drift_delay_ms": _effective_int(
            row.drag_drift_delay_ms if row else None,
            DEFAULT_DRAG_DRIFT_DELAY_MS,
            MIN_DRAG_DRIFT_DELAY_MS,
            MAX_DRAG_DRIFT_DELAY_MS,
        ),
        "drag_drift_distance": _effective_int(
            row.drag_drift_distance if row else None,
            DEFAULT_DRAG_DRIFT_DISTANCE,
            MIN_DRAG_DRIFT_DISTANCE,
            MAX_DRAG_DRIFT_DISTANCE,
        ),
        "card_font_size": _effective_int(
            row.card_font_size if row else None,
            DEFAULT_CARD_FONT_SIZE,
            MIN_CARD_FONT_SIZE,
            MAX_CARD_FONT_SIZE,
        ),
        "autosave_minutes": _effective_int(
            row.autosave_minutes if row else None, DEFAULT_AUTOSAVE_MINUTES, MIN_AUTOSAVE_MINUTES
        ),
        "undo_steps": _effective_int(
            row.undo_steps if row else None, DEFAULT_UNDO_STEPS, MIN_UNDO_STEPS
        ),
        "theme_hue": _effective_float(
            row.theme_hue if row else None, DEFAULT_THEME_HUE, MIN_THEME_HUE, MAX_THEME_HUE
        ),
        "edge_width": _effective_float(
            row.edge_width if row else None, DEFAULT_EDGE_WIDTH, MIN_EDGE_WIDTH, MAX_EDGE_WIDTH
        ),
        "edge_color": _effective_color(
            row.edge_color if row else None, DEFAULT_EDGE_COLOR
        ),
        "theme_mode": _effective_choice(
            row.theme_mode if row else None, THEME_MODES, DEFAULT_THEME_MODE
        ),
        "time_format": _effective_choice(
            row.time_format if row else None, TIME_FORMATS, DEFAULT_TIME_FORMAT
        ),
    }


def dto(db: Session) -> dict:
    """给前端的设置视图：不包含明文 Key，只给出是否已配置与脱敏值。"""
    values = effective(db)
    return {
        "provider": values["provider"],
        # DeepSeek 沿用原有字段名
        "hasKey": bool(values["deepseek_api_key"]),
        "apiKeyMasked": _mask(values["deepseek_api_key"]),
        "baseUrl": values["deepseek_base_url"],
        "model": values["deepseek_model"],
        "thinkingEnabled": values["thinking_enabled"],
        # OpenAI 独立配置
        "openaiHasKey": bool(values["openai_api_key"]),
        "openaiApiKeyMasked": _mask(values["openai_api_key"]),
        "openaiBaseUrl": values["openai_base_url"],
        "openaiModel": values["openai_model"],
        "openaiOrganization": values["openai_organization"],
        "openaiProject": values["openai_project"],
        "openaiTemperatureEnabled": values["openai_temperature_enabled"],
        "openaiTemperature": values["openai_temperature"],
        "openaiMaxTokens": values["openai_max_tokens"],
        "openaiReasoningEffort": values["openai_reasoning_effort"],
        "openaiTimeoutSeconds": values["openai_timeout_seconds"],
        "suggestionCount": values["suggestion_count"],
        "cardWidth": values["card_width"],
        "cardHeight": values["card_height"],
        "connectionStyle": values["connection_style"],
        "doubleClickMs": values["double_click_ms"],
        "dragDriftDelayMs": values["drag_drift_delay_ms"],
        "dragDriftDistance": values["drag_drift_distance"],
        "cardFontSize": values["card_font_size"],
        "autosaveMinutes": values["autosave_minutes"],
        "undoSteps": values["undo_steps"],
        "themeHue": values["theme_hue"],
        "edgeWidth": values["edge_width"],
        "edgeColor": values["edge_color"],
        "themeMode": values["theme_mode"],
        "timeFormat": values["time_format"],
    }


def update(db: Session, patch: dict) -> dict:
    """更新设置并返回最新视图。

    api_key 传空或不传表示「保持原样」，避免用户只改模型时把 Key 清掉。
    """
    row = db.get(AppSetting, SETTINGS_ID)
    if row is None:
        row = AppSetting(id=SETTINGS_ID)
        db.add(row)

    if patch.get("provider") is not None:
        row.provider = _effective_choice(
            patch["provider"], PROVIDERS, DEFAULT_PROVIDER
        )

    api_key = (patch.get("api_key") or "").strip()
    if api_key:
        row.api_key = api_key

    if patch.get("base_url") is not None:
        row.base_url = patch["base_url"].strip()
    if patch.get("model") is not None:
        row.model = patch["model"].strip()
    if patch.get("thinking_enabled") is not None:
        row.thinking_enabled = bool(patch["thinking_enabled"])

    # OpenAI 独立配置：Key 留空保持原值，其余字段按合法范围夹取
    openai_api_key = (patch.get("openai_api_key") or "").strip()
    if openai_api_key:
        row.openai_api_key = openai_api_key
    if patch.get("openai_base_url") is not None:
        row.openai_base_url = patch["openai_base_url"].strip()
    if patch.get("openai_model") is not None:
        row.openai_model = patch["openai_model"].strip()
    if patch.get("openai_organization") is not None:
        row.openai_organization = patch["openai_organization"].strip()
    if patch.get("openai_project") is not None:
        row.openai_project = patch["openai_project"].strip()
    if patch.get("openai_temperature_enabled") is not None:
        row.openai_temperature_enabled = bool(patch["openai_temperature_enabled"])
    if patch.get("openai_temperature") is not None:
        row.openai_temperature = _effective_float(
            patch["openai_temperature"],
            DEFAULT_OPENAI_TEMPERATURE,
            MIN_OPENAI_TEMPERATURE,
            MAX_OPENAI_TEMPERATURE,
        )
    if patch.get("openai_max_tokens") is not None:
        row.openai_max_tokens = _effective_int(
            patch["openai_max_tokens"], DEFAULT_OPENAI_MAX_TOKENS, DEFAULT_OPENAI_MAX_TOKENS
        )
    if patch.get("openai_reasoning_effort") is not None:
        row.openai_reasoning_effort = _effective_choice(
            patch["openai_reasoning_effort"],
            OPENAI_REASONING_EFFORTS,
            DEFAULT_OPENAI_REASONING_EFFORT,
        )
    if patch.get("openai_timeout_seconds") is not None:
        row.openai_timeout_seconds = _effective_int(
            patch["openai_timeout_seconds"],
            DEFAULT_OPENAI_TIMEOUT_SECONDS,
            MIN_OPENAI_TIMEOUT_SECONDS,
            MAX_OPENAI_TIMEOUT_SECONDS,
        )

    if patch.get("suggestion_count") is not None:
        row.suggestion_count = max(
            MIN_SUGGESTION_COUNT,
            min(MAX_SUGGESTION_COUNT, int(patch["suggestion_count"])),
        )
    # 尺寸只做最小值夹取，不设上限
    if patch.get("card_width") is not None:
        row.card_width = max(MIN_CARD_WIDTH, int(patch["card_width"]))
    if patch.get("card_height") is not None:
        row.card_height = max(MIN_CARD_HEIGHT, int(patch["card_height"]))

    # 以下设置一律夹取/校验后落库，非法值不抛异常，直接回落默认值
    if patch.get("connection_style") is not None:
        row.connection_style = _effective_choice(
            patch["connection_style"], CONNECTION_STYLES, DEFAULT_CONNECTION_STYLE
        )
    if patch.get("double_click_ms") is not None:
        row.double_click_ms = _effective_int(
            patch["double_click_ms"],
            DEFAULT_DOUBLE_CLICK_MS,
            MIN_DOUBLE_CLICK_MS,
            MAX_DOUBLE_CLICK_MS,
        )
    if patch.get("drag_drift_delay_ms") is not None:
        row.drag_drift_delay_ms = _effective_int(
            patch["drag_drift_delay_ms"],
            DEFAULT_DRAG_DRIFT_DELAY_MS,
            MIN_DRAG_DRIFT_DELAY_MS,
            MAX_DRAG_DRIFT_DELAY_MS,
        )
    if patch.get("drag_drift_distance") is not None:
        row.drag_drift_distance = _effective_int(
            patch["drag_drift_distance"],
            DEFAULT_DRAG_DRIFT_DISTANCE,
            MIN_DRAG_DRIFT_DISTANCE,
            MAX_DRAG_DRIFT_DISTANCE,
        )
    if patch.get("card_font_size") is not None:
        row.card_font_size = _effective_int(
            patch["card_font_size"],
            DEFAULT_CARD_FONT_SIZE,
            MIN_CARD_FONT_SIZE,
            MAX_CARD_FONT_SIZE,
        )
    if patch.get("autosave_minutes") is not None:
        row.autosave_minutes = _effective_int(
            patch["autosave_minutes"], DEFAULT_AUTOSAVE_MINUTES, MIN_AUTOSAVE_MINUTES
        )
    if patch.get("undo_steps") is not None:
        row.undo_steps = _effective_int(
            patch["undo_steps"], DEFAULT_UNDO_STEPS, MIN_UNDO_STEPS
        )
    if patch.get("theme_hue") is not None:
        row.theme_hue = _effective_float(
            patch["theme_hue"], DEFAULT_THEME_HUE, MIN_THEME_HUE, MAX_THEME_HUE
        )
    if patch.get("edge_width") is not None:
        row.edge_width = _effective_float(
            patch["edge_width"], DEFAULT_EDGE_WIDTH, MIN_EDGE_WIDTH, MAX_EDGE_WIDTH
        )
    if patch.get("edge_color") is not None:
        row.edge_color = _effective_color(patch["edge_color"], DEFAULT_EDGE_COLOR)
    if patch.get("theme_mode") is not None:
        row.theme_mode = _effective_choice(
            patch["theme_mode"], THEME_MODES, DEFAULT_THEME_MODE
        )
    if patch.get("time_format") is not None:
        row.time_format = _effective_choice(
            patch["time_format"], TIME_FORMATS, DEFAULT_TIME_FORMAT
        )

    db.commit()
    return dto(db)
