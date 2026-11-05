"""FastAPI 应用入口：健康检查 + 画布/节点 API。"""

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import attachments, nodes, projects, settings
from app.db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """启动时建表，保证数据库与表结构就绪。"""
    init_db()
    yield


app = FastAPI(title="树状对话后端", lifespan=lifespan)

# 允许本地开发的前端（Vite 默认端口 5173）跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(nodes.router)
app.include_router(settings.router)
app.include_router(attachments.router)


@app.get("/health")
def health() -> dict[str, str]:
    """健康检查，用于确认服务已启动。"""
    return {"status": "ok"}
