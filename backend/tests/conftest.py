"""pytest 公共夹具：隔离数据库，避免读写真实 backend/data/app.db。"""

import os
import sys
import tempfile
from pathlib import Path

# 必须在导入 app 模块之前设置环境变量：config 在导入时读取 DB_PATH 与 Key
_TMP_DIR = Path(tempfile.mkdtemp(prefix="tree_thinking_test_"))
os.environ["DB_PATH"] = str(_TMP_DIR / "app.db")
# 附件写入临时目录，避免测试污染真实 backend/data/uploads
os.environ["UPLOAD_DIR"] = str(_TMP_DIR / "uploads")
# 测试默认不配置 Key，避免意外发起真实请求
os.environ["DEEPSEEK_API_KEY"] = ""
os.environ["OPENAI_API_KEY"] = ""

# 把 backend 目录加入 sys.path，保证能直接 import app
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.api.nodes as nodes_api
from app.db import Base, get_db
from app.main import app


@pytest.fixture()
def session_factory(monkeypatch):
    """内存 SQLite 会话工厂，并同时替换生成器内部使用的 SessionLocal。"""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        # 内存库必须在所有会话间共享同一连接，否则表会随连接关闭而丢失
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(nodes_api, "SessionLocal", factory)

    yield factory

    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture()
def client(session_factory):
    """覆盖 get_db 为内存库的 TestClient。"""

    def override_get_db():
        db: Session = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
