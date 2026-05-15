# 小红书创作 Agent · Prototype v3 · Brand Spec

> 方向：编辑工作室·克制黑白
> 灵感：Pentagram 信息建筑 + Kinfolk 编辑感
> 采集日期：2026-05-15
> 资产完整度：基于现有前端 theme.ts + 10 页 .tsx 真实业务文本

## 哲学

这不是「又一个 SaaS Dashboard」，是一间**编辑工作室**。
- 每篇笔记是一份**稿件**，不是一条 record
- 每次诊断是一次**审稿会**，不是一个 score 弹窗
- 每个工具调用是一次**编辑动作**，不是一个 spinner
- AI 是 staff writer + senior editor，不是 chatbot

## 🎨 色板

| 角色 | 色值 | 用途 |
|---|---|---|
| `--paper` | `#F4F1EA` | 主背景，米色纸张感（不是 #FFFFFF，避开 SaaS 标配） |
| `--paper-soft` | `#EDE8DD` | 卡片次级面，比 paper 略深 |
| `--ink` | `#1A1814` | 主文字，墨色（不是纯黑） |
| `--ink-soft` | `#5C564C` | 次级文字 |
| `--ink-mute` | `#8C8578` | meta / timestamp / hint |
| `--rule` | `#D4CCBC` | 分隔线、表格线 |
| `--rule-soft` | `#E5DECF` | 次级分隔 |
| `--accent` | `#C8302E` | 唯一 accent，小红书红的克制版（撇开 #FF2442 的塑料感）|
| `--accent-soft` | `#F5DEDC` | accent 浅底，用于 hover/选中 |
| `--ok` | `#3E6B4E` | 通过 / 已发布 |
| `--warn` | `#A87029` | 警告 / 草稿 |
| `--hazard` | `#8B2520` | 违禁词 / 严重错误 |

**禁用**：
- 紫色渐变（AI slop 重灾区）
- emoji 装饰
- 圆角 + 左 border accent 卡片（Material 烂大街组合）
- 任何超过两种 accent

## ✒️ 字型

| 角色 | 字体栈 | 用途 |
|---|---|---|
| **Display** | `"Source Serif 4", "Noto Serif SC", "Songti SC", Georgia, serif` | 大标题、引语、栏目名——给编辑感的来源 |
| **Body** | `"Inter", "PingFang SC", system-ui, sans-serif` | 正文、表单、按钮 |
| **Mono** | `"JetBrains Mono", "SF Mono", "Menlo", monospace` | 数据 HUD、tool 调用、ID、trace、版本号 |

**Editorial 比例**：
- Display H1: 56px / line-height 1.05 / letter-spacing -0.02em
- Display H2: 36px / 1.1 / -0.015em
- Section label: 11px Mono / 0.18em letter-spacing / uppercase
- Body: 14px / 1.6
- Caption: 12px / 1.5 / mute

## 📐 布局语法

- 8px 基准网格，关键 padding 24/32/48
- 卡片：1px solid --rule，**不用阴影**（这是平面印刷美学，不是 Material）
- Border radius：0–4–8 三档为主，hero 容器到 16，禁用任何 ≥20 的圆角
- Section 之间用「细横线 + 小标号 + 章节名」分割（Pentagram 式）
- 信息密度：编辑工作台必须密——稿件状态、版本、工具运行轨迹、违禁词警告同屏可见，**不靠折叠**

## 🖼️ 设备/容器规范

- 每屏 mock 用一个**编辑器外壳**（薄 chrome：左上三圆点 + 中央页面 ID + 右上 meta），不用 Mac 红绿黄玻璃质感（太消费品）
- 屏宽：1440 × 900（桌面应用比例）
- 屏与屏之间 64px gap，背景 paper

## 🏷️ 角标 & 章节编号

每屏左上有 italic label `01 — Login` 风格，编号用罗马数字也可（`I. Login`）。

## 🔥 签名细节（一处做到 120%）

- **诊断页的「专家辩论」**：给它一个真实「会议纪要」的样式——多列对话，每个 expert 头像是字母 monogram（A B C），中间用 mono `vs.` 分隔。这是全 deck 最值得截图的一屏。

## 📋 反 AI slop 自检清单

- [ ] 没有紫色 / cyber 渐变
- [ ] 没有 emoji 当 icon（emoji 只在用户的真实业务文案如「✍️一键完整成稿」原文里保留）
- [ ] 没有装饰性 stats / fake numbers（数字必须是合理 demo 值，不是 random）
- [ ] 没有 SVG 画人脸 / 场景
- [ ] 没有圆角卡片 + 左色 border 的撞 slop 组合
- [ ] 业务文案 100% 来自真实代码（subagent 已抓取）
- [ ] 雷达图 / 进度条 / 图表是 SVG，不是 emoji 拼

## 📐 信息密度规则

按「品位锚点」: 高密度型——产品卖点是 **AI 智能 / Agent 工具调用 / 多模型 / 诊断**，每屏需 ≥ 3 处可见的产品差异化信息：

- 工具调用 trace（function calling 的工程美学）
- 评分雷达 + 维度数字
- 任务后台运行 + 耗时
- 违禁词热点 highlight
- 版本对比 / diff
