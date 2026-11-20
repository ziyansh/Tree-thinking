"""FastAPI 应用入口：健康检查 + 认证/画布/节点 API。"""

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.api import attachments, auth, links, models, nodes, projects, settings
from app.db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """启动时校验 server 模式密钥，并建表保证数据库结构就绪。"""
    if config.APP_MODE == "server" and not config.AUTH_SECRET:
        raise RuntimeError("server 模式必须配置 AUTH_SECRET（用于会话签名与 Key 加密）")
    init_db()
    yield


app = FastAPI(title="树状对话后端", lifespan=lifespan)

# 跨域：允许前端地址携带 Cookie 访问（地址由 ALLOWED_ORIGINS 配置）
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(links.router)
app.include_router(nodes.router)
app.include_router(settings.router)
app.include_router(attachments.router)
app.include_router(models.router)


@app.get("/health")
def health() -> dict[str, str]:
    """健康检查，用于确认服务已启动。"""
    return {"status": "ok"}
