import re
from typing import Any, List, Optional
from pydantic import BaseModel, Field, field_validator


IMAGE_SIZE_RE = re.compile(r"^\s*(\d{2,5})\s*x\s*(\d{2,5})\s*$", re.IGNORECASE)
IMAGE_MIN_SIDE = 64
IMAGE_MAX_SIDE = 4096
IMAGE_MAX_PIXELS = IMAGE_MAX_SIDE * IMAGE_MAX_SIDE
IMAGE_QUALITIES = {"high", "medium", "low", "auto", "hd", "standard"}


def _validate_image_size(v: str) -> str:
    value = str(v or "").strip().lower()
    m = IMAGE_SIZE_RE.match(value)
    if not m:
        raise ValueError("图片尺寸格式应为 宽x高，例如 1024x1536")
    w, h = int(m.group(1)), int(m.group(2))
    if w < IMAGE_MIN_SIDE or h < IMAGE_MIN_SIDE:
        raise ValueError(f"图片尺寸过小，单边不能小于 {IMAGE_MIN_SIDE}")
    if w > IMAGE_MAX_SIDE or h > IMAGE_MAX_SIDE or w * h > IMAGE_MAX_PIXELS:
        raise ValueError(f"图片尺寸过大，单边不超过 {IMAGE_MAX_SIDE}，总像素不超过 {IMAGE_MAX_PIXELS}")
    return f"{w}x{h}"


def _validate_image_quality(v: str) -> str:
    value = str(v or "high").strip().lower()
    aliases = {"最高": "high", "高清": "high", "高": "high", "中": "medium", "低": "low"}
    value = aliases.get(value, value)
    if value not in IMAGE_QUALITIES:
        raise ValueError(f"不支持的图片质量参数: {v}")
    return value


def _normalize_tag_list(tags: List[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for raw in tags or []:
        tag = str(raw or "").strip().lstrip("#＃").strip()
        if not tag:
            continue
        key = tag.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(tag)
    return out


class ArticleIn(BaseModel):
    title: str = ""
    body: str = ""
    tags: List[str] = Field(default_factory=list)
    cover_image: str = ""
    images: List[str] = Field(default_factory=list)
    status: str = "draft"

    @field_validator("title")
    @classmethod
    def title_max_length(cls, v: str) -> str:
        if len(v) > 20:
            raise ValueError("标题不能超过 20 个字符")
        return v

    @field_validator("tags")
    @classmethod
    def tags_normalized(cls, v: List[str]) -> List[str]:
        return _normalize_tag_list(v)


class ArticleUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    tags: Optional[List[str]] = None
    cover_image: Optional[str] = None
    images: Optional[List[str]] = None
    status: Optional[str] = None
    score: Optional[dict] = None

    @field_validator("title")
    @classmethod
    def title_max_length(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) > 20:
            raise ValueError("标题不能超过 20 个字符")
        return v

    @field_validator("tags")
    @classmethod
    def update_tags_normalized(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        return _normalize_tag_list(v or []) if v is not None else v


class ChatMessage(BaseModel):
    role: str
    content: str = ""
    images: List[str] = Field(default_factory=list)


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    article_id: Optional[int] = None
    conversation_id: Optional[int] = None


class ImageGenRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    size: str = "1152x1536"
    quality: str = "high"
    n: int = Field(default=1, ge=1, le=4)
    reference_images: List[str] = Field(default_factory=list)

    @field_validator("size")
    @classmethod
    def image_size_valid(cls, v: str) -> str:
        return _validate_image_size(v)

    @field_validator("quality")
    @classmethod
    def image_quality_valid(cls, v: str) -> str:
        return _validate_image_quality(v)

    @field_validator("reference_images")
    @classmethod
    def reference_images_valid(cls, v: List[str]) -> List[str]:
        refs = [str(x).strip() for x in (v or []) if str(x or "").strip()]
        if len(refs) > 8:
            raise ValueError("参考图最多 8 张")
        return refs


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


class ApplyDiagnosisRequest(BaseModel):
    fields: List[str] = Field(default_factory=lambda: ["title", "body", "tags"])


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


class ArticleImageArrangeRequest(BaseModel):
    article_id: int
    action: str = Field(default="set_order", description="set_order/move/set_cover/insert/replace/remove/clear")
    order: List[str] = Field(default_factory=list, description="完整展示队列：第 1 张即封面")
    image_url: str = ""
    from_position: Optional[int] = None
    to_position: Optional[int] = None
    position: Optional[int] = None


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
    quality: str = "high"
    article_id: Optional[int] = None
    role: str = "content"
    replace_index: Optional[int] = None

    @field_validator("size")
    @classmethod
    def image_size_valid(cls, v: str) -> str:
        return _validate_image_size(v)

    @field_validator("quality")
    @classmethod
    def image_quality_valid(cls, v: str) -> str:
        return _validate_image_quality(v)


class RemoveObjectRequest(BaseModel):
    image_url: str
    mask_url: str
    prompt: Optional[str] = None
    size: str = "1024x1024"
    quality: str = "high"
    article_id: Optional[int] = None
    role: str = "content"
    replace_index: Optional[int] = None

    @field_validator("size")
    @classmethod
    def image_size_valid(cls, v: str) -> str:
        return _validate_image_size(v)

    @field_validator("quality")
    @classmethod
    def image_quality_valid(cls, v: str) -> str:
        return _validate_image_quality(v)


class EditImageRequest(BaseModel):
    image_url: str
    prompt: str = Field(min_length=1, max_length=8000)
    size: str = "1024x1024"
    quality: str = "high"
    article_id: Optional[int] = None
    role: str = "content"
    replace_index: Optional[int] = None

    @field_validator("size")
    @classmethod
    def image_size_valid(cls, v: str) -> str:
        return _validate_image_size(v)

    @field_validator("quality")
    @classmethod
    def image_quality_valid(cls, v: str) -> str:
        return _validate_image_quality(v)


class AnalyzeImageLayersRequest(BaseModel):
    image_url: str
    width: Optional[int] = None
    height: Optional[int] = None
    hint: str = ""


class ExtractPixelLayersRequest(BaseModel):
    image_url: str
    sensitivity: float = Field(default=0.58, ge=0.1, le=1.0)
    max_layers: int = Field(default=24, ge=1, le=48)


class ApplyTemplateRequest(BaseModel):
    template_id: int
    topic: str


class TemplateCreate(BaseModel):
    name: str
    category: str = ""
    description: str = ""
    body: str = ""
    tags: List[str] = Field(default_factory=list)


class ExtractTemplateRequest(BaseModel):
    article_id: int


class SettingsUpdate(BaseModel):
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    chat_api_key: Optional[str] = None
    chat_base_url: Optional[str] = None
    image_api_key: Optional[str] = None
    image_base_url: Optional[str] = None
    chat_model: Optional[str] = None
    image_model: Optional[str] = None
    chat_models: Optional[str] = None
    image_models: Optional[str] = None
    public_base_url: Optional[str] = None

    @field_validator("public_base_url")
    @classmethod
    def public_base_url_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        value = v.strip().rstrip("/")
        if not value:
            return ""
        if not (value.startswith("http://") or value.startswith("https://")):
            raise ValueError("服务公网地址必须以 http:// 或 https:// 开头")
        return value


class StaticImagePublicTestRequest(BaseModel):
    public_base_url: Optional[str] = None

    @field_validator("public_base_url")
    @classmethod
    def public_base_url_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        value = v.strip().rstrip("/")
        if not value:
            return ""
        if not (value.startswith("http://") or value.startswith("https://")):
            raise ValueError("测试地址必须以 http:// 或 https:// 开头")
        return value


class ImageSettingsTestRequest(BaseModel):
    prompt: str = "小红书风格测试图，奶油红背景，一只可爱的便签贴纸，清晰干净，无文字"
    size: str = "1152x1536"
    quality: str = "high"

    @field_validator("size")
    @classmethod
    def image_size_valid(cls, v: str) -> str:
        return _validate_image_size(v)

    @field_validator("quality")
    @classmethod
    def image_quality_valid(cls, v: str) -> str:
        return _validate_image_quality(v)


class MCPCallRequest(BaseModel):
    name: str
    arguments: dict = Field(default_factory=dict)
