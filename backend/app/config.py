"""运行时配置：从环境变量或 backend/.env 读取，均带默认值。"""

from pathlib import Path

from dotenv import load_dotenv
import os

# backend 目录（本文件位于 backend/app/config.py）
BACKEND_DIR = Path(__file__).resolve().parent.parent
# 仓库根目录
REPO_DIR = BACKEND_DIR.parent

# 加载 backend/.env；文件不存在时静默跳过，不报错
load_dotenv(BACKEND_DIR / ".env")


def _read_bool(name: str, default: bool) -> bool:
    """把环境变量里的 true/false 文本解析为布尔值。"""
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _read_int(name: str, default: int) -> int:
    """把环境变量里的整数文本解析为 int，非法值回退默认值。"""
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw.strip())
    except ValueError:
        return default


# DeepSeek 相关配置（Key 只保存在后端，禁止出现在前端）
DEEPSEEK_API_KEY: str = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL: str = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MODEL: str = os.getenv("DEEPSEEK_MODEL", "deepseek-flash")

# OpenAI 相关配置：作为数据库设置的兜底，未配置时回落空 Key
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL: str = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# 是否开启思考模式；关闭时不向模型发送 thinking 参数
THINKING_ENABLED: bool = _read_bool("THINKING_ENABLED", True)
# 每个节点生成的候选方向数量
SUGGESTION_COUNT: int = _read_int("SUGGESTION_COUNT", 3)
# 是否默认开启联网搜索；页面「设置」里的开关优先
WEB_SEARCH_ENABLED: bool = _read_bool("WEB_SEARCH_ENABLED", False)

# 运行模式：local（单用户本地）/ server（多用户服务器）
APP_MODE: str = (os.getenv("APP_MODE", "local") or "local").strip().lower()
# 会话签名与加密密钥；server 模式必填
AUTH_SECRET: str = os.getenv("AUTH_SECRET", "")
# 会话 Cookie 是否只走 HTTPS（本地 http 调试时可设为 false）
AUTH_COOKIE_SECURE: bool = _read_bool("AUTH_COOKIE_SECURE", True)
# 允许跨域访问的前端地址，逗号分隔
ALLOWED_ORIGINS: list[str] = [
    item.strip()
    for item in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if item.strip()
]


def _resolve_db_path(raw: str) -> Path:
    """把 DB_PATH 解析为绝对路径：相对路径按仓库根目录解析，兼容 Windows 路径。"""
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = REPO_DIR / path
    return path


# SQLite 数据库文件路径；默认 backend/data/app.db
DB_PATH: Path = _resolve_db_path(os.getenv("DB_PATH", "") or "backend/data/app.db")
# 数据目录必须存在，否则 SQLite 无法创建数据库
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# 附件存放目录；默认 backend/data/uploads，同样支持相对路径
UPLOAD_DIR: Path = _resolve_db_path(
    os.getenv("UPLOAD_DIR", "") or "backend/data/uploads"
)
# 上传目录必须存在，否则保存附件时会失败
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
