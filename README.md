# 小红书创作助手（XHS Agent）

以对话驱动的小红书笔记创作 Agent。前后端分离，后端基于 FastAPI + OpenAI 兼容协议，前端基于 React + MUI。内置同一套工具层既给对话 Agent（OpenAI function calling）用，也通过 HTTP 和 MCP stdio server 双通道暴露给外部客户端（Claude Desktop / Cursor 等）。

## 能力

- **对话创作**：说出灵感，AI 通过 function calling 真实创建/改写/打分/诊断笔记，流式回推 `token` / `tool_call` / `tool_result` 事件
- **多模态**：上传参考图 / 截图，AI 基于视觉内容给出建议
- **AI 写作工具**：整体改写、局部优化、段落润色、标题候选、大纲生成、高流量标签推荐
- **发布前诊断**：违禁词 / 钩子 / CTA / 标签缺失检查，给出「是否可发布」结论
- **五维度评分**：内容 / 视觉 / 增长 / 互动 / 综合，附改进建议，带雷达图
- **图片能力**：
  - `gpt-image-1` 生成封面（2:3 竖图）+ 正文配图（1:1 方图）
  - 画布级图片编辑器：**裁剪 / 局部重绘 / 消除 / 整体变体**（调用 `images.edit`）
  - 按笔记正文分段生成配图 prompt
- **笔记详情 AI 侧栏**：右侧对话框锁定当前笔记上下文，继续打磨
- **模板库**：内置 5 类结构模板（踩坑/清单/种草/共鸣/教程），选模板 + 主题一键成文
- **MCP 接入**：
  - HTTP 桥 `GET /api/mcp/tools` · `POST /api/mcp/call`
  - stdio server：`bash start_mcp.sh`，外部客户端按需拉起
- **设置页热更新**：浏览器里直接配 API Key / Base URL / 模型，无需重启

## 目录结构

```
xhs_agent/
├─ backend/                    FastAPI + Agent + MCP server
│  ├─ app/
│  │  ├─ api/routes.py         REST + /chat/stream (SSE)
│  │  ├─ agents/
│  │  │  ├─ tools.py           20+ function-calling 工具注册表
│  │  │  └─ runner.py          流式对话 + 多轮工具循环
│  │  ├─ services/llm.py       OpenAI 兼容客户端（chat / image / image.edit）
│  │  ├─ mcp_server/server.py  stdio MCP server
│  │  ├─ database.py           SQLite (aiosqlite + SQLAlchemy 2 async)
│  │  ├─ config.py             .env + data/settings.json overlay 热更新
│  │  └─ main.py               FastAPI 入口
│  ├─ requirements.txt
│  └─ .env.example
├─ frontend/                   React 18 + TS + Vite + MUI + Framer Motion + ECharts
│  └─ src/
│     ├─ pages/                ChatPage / ArticlesPage / ArticleDetailPage /
│     │                        TemplatesPage / SettingsPage
│     ├─ components/
│     │  ├─ ChatPanel.tsx      可复用对话组件（聊天页 & 笔记详情侧栏共用）
│     │  ├─ ImageEditor.tsx    画布级图片编辑器（裁剪 / 局部重绘 / 消除）
│     │  ├─ MessageBubble.tsx  工具调用/图片/文章预览的富渲染
│     │  └─ Markdown.tsx
│     ├─ api/client.ts         axios + SSE 客户端
│     └─ theme.ts              小红书创作中心调性
├─ start_all.sh                一键启动前后端
├─ start_backend.sh            启动后端（自动 venv / 依赖 / .env）
├─ start_frontend.sh           启动前端（自动 npm install）
└─ start_mcp.sh                启动 MCP stdio server（供外部客户端）
```

## 快速开始

需要 Python 3.10+ 和 Node.js 18+。

```bash
# 1. 配置 API Key
cp backend/.env.example backend/.env
# 编辑 backend/.env，填入你的 OPENAI_API_KEY / OPENAI_BASE_URL

# 2. 一键启动（后端 + 前端）
./start_all.sh

# 浏览器打开 http://127.0.0.1:5173
```

默认端口：后端 `8787`，前端 `5173`。

也可以不编辑 `.env`，直接进「设置」页在浏览器里填 key，保存后即刻生效，配置会持久化到数据目录的 `settings.json`。

> 服务器部署建议：不要把运行数据放在代码目录里。`start_backend.sh` 默认会把数据库、设置和图片保存到 `~/.local/share/xhs-agent`；也可以显式设置 `XHS_DATA_DIR=/srv/xhs-agent-data`。这样 `git pull`、`git clean`、容器重建或重新 clone 都不会清空业务数据。

## 配置

`backend/.env`：

```
OPENAI_API_KEY=sk-YOUR_KEY_HERE
OPENAI_BASE_URL=https://api.openai.com/v1   # 也可换成任何 OpenAI 兼容网关
CHAT_MODEL=gpt-4o
IMAGE_MODEL=gpt-image-1
XHS_DATA_DIR=/srv/xhs-agent-data            # 服务器建议：代码目录外的持久化数据目录
```

支持所有 OpenAI 兼容 API（官方 OpenAI / 第三方中转网关 / 自部署 OSS 模型）。对话模型走 `chat.completions` + function calling，图片模型走 `images.generate` / `images.edit`。

## API 总览

对话 / 文章：
- `POST /api/chat/stream`              SSE 流式对话（function calling，工具事件流推）
- `GET/POST/PATCH/DELETE /api/articles/:id?`  笔记 CRUD
- `POST /api/articles/generate`        从主题生成
- `POST /api/articles/rewrite`         整体改写
- `POST /api/articles/optimize`        局部优化
- `POST /api/articles/polish`          段落润色
- `POST /api/articles/score`           五维度打分
- `POST /api/articles/diagnose`        发布前诊断
- `POST /api/articles/outline`         大纲
- `POST /api/articles/suggest_titles`  候选标题
- `POST /api/articles/suggest_tags`    高流量标签
- `POST /api/articles/cover_prompt`    封面 prompt
- `POST /api/articles/content_image_prompt`  按正文分段的配图 prompt

图片：
- `POST /api/images/generate`     生成
- `POST /api/images/edit`         整图变体
- `POST /api/images/inpaint`      局部重绘（需 mask）
- `POST /api/images/remove_object`消除（需 mask）
- `POST /api/images/crop`         按像素盒裁剪
- `POST /api/images/upload_mask`  上传浏览器合成的 PNG mask
- `POST /api/upload`              上传参考图

模板 / 对话 / 设置 / 元信息：
- `GET  /api/templates`                 模板列表
- `POST /api/templates/apply`           按模板生成
- `GET/POST/PATCH/DELETE /api/conversations/:id?` 对话历史
- `GET/PUT /api/settings`               浏览器可编辑配置
- `POST /api/settings/test`             连通性测试
- `GET  /api/meta`                      当前模型

MCP：
- `GET  /api/mcp/tools`   工具 schema（HTTP 桥）
- `POST /api/mcp/call`    调用工具（HTTP 桥）
- `GET  /api/tools`       OpenAI function-calling 原始 schema

## MCP 接入

### 方式 1：HTTP 桥（嵌入后端）

任意客户端直接 POST `/api/mcp/call`：

```bash
curl -X POST http://127.0.0.1:8787/api/mcp/call \
  -H "Content-Type: application/json" \
  -d '{"name":"suggest_titles","arguments":{"topic":"秋冬穿搭","n":5}}'
```

### 方式 2：stdio server（Claude Desktop / Cursor）

```json
{
  "mcpServers": {
    "xhs-agent": {
      "command": "bash",
      "args": ["/path/to/xhs_agent/start_mcp.sh"]
    }
  }
}
```

### 暴露的工具（20）

| 类别 | 工具 |
| --- | --- |
| 创作 | `generate_article` / `apply_template` / `create_article` |
| 改写 | `rewrite_article` / `optimize_article` / `polish_paragraph` |
| 评估 | `score_article` / `diagnose_article` |
| 灵感 | `suggest_titles` / `suggest_tags` / `outline_article` / `cover_prompt` / `content_image_prompt` |
| CRUD | `read/update/list/delete_article` |
| 图片 | `generate_image` / `edit_image` / `inpaint_image` / `remove_object` / `crop_image` / `remove_image` |
| 模板 | `list_templates` |

## 技术要点

- Agent 采用 OpenAI 标准 function calling，保证每次 `tool_call.id` 非空，`assistant` 消息 `content=null`，`tool` 消息携带 `tool_call_id` + `name`，兼容非官方 OpenAI 网关
- 图片生成/编辑都落盘到数据目录的 `images/`，通过 `/static/images/*` 对外暴露
- 图片编辑器纯前端 Canvas 实现：用户涂抹作为可视预览，提交时合成"白底 + 透明圆"的 RGBA PNG mask 上传
- SQLite + SQLAlchemy 2.0 async；笔记与对话自动持久化
- 配置支持 `.env` 默认值 + 数据目录 `settings.json` 运行时覆盖，浏览器改完即时热更新客户端

## 服务器数据持久化

系统运行数据包括：

- SQLite 数据库：`xhs_agent.db`
- 设置页热更新配置：`settings.json`
- 用户上传图、生成图、编辑图：`images/`

历史版本默认放在 `backend/data/`。这个目录虽然被 Git 忽略，但如果服务器发布脚本执行 `git clean -fdx`、重新 clone、容器重建或整体覆盖代码目录，数据仍可能被删除。

推荐部署方式：

```bash
export XHS_DATA_DIR=/srv/xhs-agent-data
./start_backend.sh
```

如果不设置，`start_backend.sh` 会默认使用：

```bash
~/.local/share/xhs-agent
```

首次启动时，如果检测到旧的 `backend/data/` 且新的持久化目录为空，会自动复制旧数据到新目录；之后不会覆盖已有持久化数据。

如果你不用 `start_backend.sh`，而是 systemd / pm2 / supervisor / Docker 直接运行 uvicorn，也请在服务环境变量里配置：

```bash
XHS_DATA_DIR=/srv/xhs-agent-data
```

## 参考

设计上参考了：
- https://github.com/jiangmuran/noterx （诊断 / 评分 / 雷达图 UI 风格）
- https://github.com/flike/RedInk_bak （一句话生成笔记的流水线思路）

## License

MIT
