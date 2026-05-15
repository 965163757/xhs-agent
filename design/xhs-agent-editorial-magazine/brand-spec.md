# XHS Agent · Editorial Magazine Studio

> 方向：高级杂志编辑工作室
> 原型日期：2026-05-15
> 范围：完整系统全页面平铺
> 基础：当前代码业务结构 + 历史原型字体偏好

## 核心叙事

这不是一个普通 AI 聊天工具，而是一间为小红书创作者服务的高级编辑工作室。

- 每篇笔记是一份稿件
- 每次诊断是一场审稿会
- 每次工具调用是一条编辑轨迹
- 每张封面是一版杂志视觉
- 用户不是表单填写者，而是 editor-in-chief

## 字体系统

```css
--font-display: "Newsreader", "Noto Serif SC", "Songti SC", Georgia, serif;
--font-body: "IBM Plex Sans", "PingFang SC", "HarmonyOS Sans SC", system-ui, sans-serif;
--font-mono: "JetBrains Mono", "SF Mono", Menlo, monospace;
```

### 用法

- Display：页面标题、稿件标题、引语、关键数字
- Body：导航、按钮、正文、表单、操作说明
- Mono：编号、任务 ID、模型名、工具 trace、时间戳、状态码

## 色板

| Token | Value | 用途 |
|---|---:|---|
| `--paper` | `#F2EEE5` | 主背景，偏暖纸张 |
| `--paper-soft` | `#E9E1D2` | 次级底色 |
| `--paper-quiet` | `#FAF7F0` | 内容面 |
| `--ink` | `#17130F` | 主文字 |
| `--ink-soft` | `#5E564B` | 次级文字 |
| `--ink-mute` | `#948A7A` | meta / caption |
| `--rule` | `#CEC2AE` | 主分隔线 |
| `--rule-soft` | `#E1D7C7` | 次级分隔线 |
| `--accent` | `#B82B29` | 克制小红书红 |
| `--accent-soft` | `#F0D7D4` | 红色浅底 |
| `--green` | `#3B6A4D` | 通过 / 发布 |
| `--gold` | `#A36C24` | 草稿 / 注意 |
| `--blueblack` | `#232B33` | 工具轨迹深色 |

## 排版尺度

- Cover title：124px / 0.9 / display
- Screen heading：34px / 1.05 / display
- Panel heading：18px / 1.2 / display italic
- Body：13px / 1.55 / body
- Label：10px / mono / 0.18em tracking / uppercase
- Data number：34-56px / display

## 界面语法

- 桌面画框：1440 × 900
- 主导航：左侧固定编辑室索引
- 主内容：细线网格、低圆角、无大面积阴影
- 按钮：方角或 4px 圆角，避免 SaaS 药丸感
- 图表：黑红绿金四色以内，像杂志图表，不像 BI Dashboard
- Agent trace：用 mono 与细线串联，像印刷校样批注

## 禁区

- 不用亮橙渐变按钮
- 不用紫色 AI 科技渐变
- 不用 emoji 做装饰图标
- 不用大圆角卡片套卡片
- 不把所有内容都做成玻璃态

