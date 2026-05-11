from typing import Any, List, Optional
from pydantic import BaseModel, Field


class ArticleIn(BaseModel):
    title: str = ""
    body: str = ""
    tags: List[str] = Field(default_factory=list)
    cover_image: str = ""
    images: List[str] = Field(default_factory=list)
    status: str = "draft"


class ArticleUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    tags: Optional[List[str]] = None
    cover_image: Optional[str] = None
    images: Optional[List[str]] = None
    status: Optional[str] = None
    score: Optional[dict] = None


class ChatMessage(BaseModel):
    role: str
    content: str = ""
    images: List[str] = Field(default_factory=list)


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    article_id: Optional[int] = None
    conversation_id: Optional[int] = None


class ImageGenRequest(BaseModel):
    prompt: str
    size: str = "1024x1536"
    n: int = 1
    reference_images: List[str] = Field(default_factory=list)


class RewriteRequest(BaseModel):
    article_id: int
    style: str = "更有网感、更口语化"
    instruction: str = ""


class OptimizeRequest(BaseModel):
    article_id: int
    focus: str = "标题吸引力、开头钩子、情绪价值、标签"


class ScoreRequest(BaseModel):
    article_id: int


class DiagnoseRequest(BaseModel):
    article_id: int


class GenerateArticleRequest(BaseModel):
    topic: str
    tone: str = "真诚、有温度"
    length: str = "中等"
    audience: str = "20-30岁女性"
    extra: str = ""


class SuggestTagsRequest(BaseModel):
    topic: str = ""
    body: str = ""


class SuggestTitlesRequest(BaseModel):
    topic: str = ""
    body: str = ""
    n: int = 6


class OutlineRequest(BaseModel):
    topic: str
    audience: str = "小红书主力用户"


class PolishRequest(BaseModel):
    paragraph: str
    style: str = "更有网感、更口语化"


class CoverPromptRequest(BaseModel):
    topic: str = ""
    title: str = ""
    style: str = "小红书风、干净、高级感、柔和光"


class ContentImagePromptRequest(BaseModel):
    article_id: Optional[int] = None
    topic: str = ""
    title: str = ""
    body: str = ""
    n: int = 4


class RemoveImageRequest(BaseModel):
    article_id: int
    role: str = "content"
    index: Optional[int] = None


class CropImageRequest(BaseModel):
    image_url: str
    x: int
    y: int
    w: int
    h: int
    article_id: Optional[int] = None
    role: str = "content"
    replace_index: Optional[int] = None


class InpaintRequest(BaseModel):
    image_url: str
    mask_url: str
    prompt: str = "match surrounding style"
    size: str = "1024x1024"
    article_id: Optional[int] = None
    role: str = "content"
    replace_index: Optional[int] = None


class RemoveObjectRequest(BaseModel):
    image_url: str
    mask_url: str
    prompt: Optional[str] = None
    size: str = "1024x1024"
    article_id: Optional[int] = None
    role: str = "content"
    replace_index: Optional[int] = None


class EditImageRequest(BaseModel):
    image_url: str
    prompt: str
    size: str = "1024x1024"
    article_id: Optional[int] = None
    role: str = "content"
    replace_index: Optional[int] = None


class ApplyTemplateRequest(BaseModel):
    template_id: int
    topic: str


class SettingsUpdate(BaseModel):
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    chat_model: Optional[str] = None
    image_model: Optional[str] = None


class MCPCallRequest(BaseModel):
    name: str
    arguments: dict = Field(default_factory=dict)
