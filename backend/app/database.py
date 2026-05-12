from contextlib import asynccontextmanager
from datetime import datetime
from typing import AsyncIterator

from sqlalchemy import JSON, DateTime, Integer, String, Text, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .config import get_settings

settings = get_settings()

engine = create_async_engine(settings.database_url, future=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


class Article(Base):
    __tablename__ = "articles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[str] = mapped_column(String(512), default="")
    cover_image: Mapped[str] = mapped_column(String(1024), default="")
    images: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(32), default="draft")
    score: Mapped[dict] = mapped_column(JSON, default=dict)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "body": self.body,
            "tags": [t for t in self.tags.split(",") if t] if self.tags else [],
            "cover_image": self.cover_image,
            "images": self.images or [],
            "status": self.status,
            "score": self.score or {},
            "scheduled_at": self.scheduled_at.isoformat() if self.scheduled_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), default="新对话")
    article_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    messages: Mapped[list] = mapped_column(JSON, default=list)
    active_task_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "article_id": self.article_id,
            "messages": self.messages or [],
            "active_task_id": self.active_task_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    conversation_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="running")
    events: Mapped[list] = mapped_column(JSON, default=list)
    result_text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "conversation_id": self.conversation_id,
            "status": self.status,
            "events": self.events or [],
            "result_text": self.result_text or "",
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class ArticleVersion(Base):
    __tablename__ = "article_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    article_id: Mapped[int] = mapped_column(Integer, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    title: Mapped[str] = mapped_column(String(255), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[str] = mapped_column(String(512), default="")
    cover_image: Mapped[str] = mapped_column(String(1024), default="")
    images: Mapped[list] = mapped_column(JSON, default=list)
    trigger: Mapped[str] = mapped_column(String(64), default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "article_id": self.article_id,
            "version": self.version,
            "title": self.title,
            "body": self.body,
            "tags": [t for t in self.tags.split(",") if t] if self.tags else [],
            "cover_image": self.cover_image,
            "images": self.images or [],
            "trigger": self.trigger,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Template(Base):
    __tablename__ = "templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), default="")
    category: Mapped[str] = mapped_column(String(64), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    body: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "description": self.description,
            "body": self.body,
            "tags": self.tags or [],
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(256), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "username": self.username,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


_SEED_TEMPLATES = [
    {
        "name": "亲测踩坑式",
        "category": "测评",
        "description": "以「我踩过的坑 → 正确做法」结构，适合好物/避雷类笔记",
        "body": (
            "[钩子]\n- 一句戳痛点的话 or 对比反差\n\n"
            "[我踩过的坑]\n- 误区1：...\n- 误区2：...\n- 误区3：...\n\n"
            "[正确做法]\n- 要点1：...\n- 要点2：...\n- 要点3：...\n\n"
            "[总结+CTA]\n- 收藏，不要再踩坑\n- 你还想看什么主题？评论区告诉我"
        ),
        "tags": ["#踩坑", "#避雷指南", "#亲测"],
    },
    {
        "name": "清单干货式",
        "category": "干货",
        "description": "「N 个必学/必看/必备」清单体，信息密度高",
        "body": (
            "[钩子]\n- 一句话承诺：看完你会得到什么\n\n"
            "[清单]\n1. ...\n2. ...\n3. ...\n4. ...\n5. ...\n\n"
            "[结语]\n- 建议先收藏\n- CTA 引互动"
        ),
        "tags": ["#干货分享", "#必备清单"],
    },
    {
        "name": "反转种草式",
        "category": "种草",
        "description": "先抑后扬，第一印象差→用完真香",
        "body": (
            "[第一印象]\n- 吐槽/怀疑/担心...\n\n"
            "[使用体验]\n- 细节1：...\n- 细节2：...\n- 细节3：...\n\n"
            "[反转总结]\n- 用完是真香，给这些人推荐：...\n- CTA"
        ),
        "tags": ["#真香", "#好物分享"],
    },
    {
        "name": "情绪共鸣式",
        "category": "生活",
        "description": "以情绪/场景切入，引发共鸣",
        "body": (
            "[场景]\n- 用一个具体画面/细节开场\n\n"
            "[共鸣]\n- 这种感觉你也有吧？\n- 我是怎么走出来的 / 我学到了什么\n\n"
            "[收尾+CTA]\n- 温暖一句\n- 评论区互动"
        ),
        "tags": ["#情绪碎碎念", "#治愈"],
    },
    {
        "name": "教程步骤式",
        "category": "教程",
        "description": "Step by step，结构清晰",
        "body": (
            "[开场]\n- 适用人群/产出结果\n\n"
            "[步骤]\n- Step 1 ...\n- Step 2 ...\n- Step 3 ...\n\n"
            "[常见问题]\n- Q: ... A: ...\n\n[结语]"
        ),
        "tags": ["#教程", "#保姆级"],
    },
]


async def _seed_templates() -> None:
    async with SessionLocal() as s:
        cur = await s.execute(select(Template))
        existing = cur.scalars().first()
        if existing:
            return
        for seed in _SEED_TEMPLATES:
            s.add(Template(**seed))
        await s.commit()


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _seed_templates()


@asynccontextmanager
async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
