import {
  chatStream,
  cancelTask,
  createConversation,
  getConversation,
  getTask,
  streamTask,
  updateConversation,
  type ChatMessage,
  type StreamEvent,
  type Article,
} from './api/client'
import type { ToolEvent } from './components/MessageBubble'

export type UiMessage = ChatMessage & { tool_events?: ToolEvent[] }

export type SessionState = {
  messages: UiMessage[]
  streaming: boolean
  status: string
  pendingImages: string[]
  input: string
  conversationId: number | null
  taskId: string | null
  abort?: AbortController
  version: number
}

type Listener = () => void

function emptyState(): SessionState {
  return {
    messages: [],
    streaming: false,
    status: '',
    pendingImages: [],
    input: '',
    conversationId: null,
    taskId: null,
    version: 0,
  }
}

// --- snapshots: immutable objects returned by getSnapshot ---
const snapshots: Record<string, SessionState> = {}
const sessions: Record<string, SessionState> = {}
const listeners: Record<string, Set<Listener>> = {}

function ensure(key: string): SessionState {
  if (!sessions[key]) sessions[key] = emptyState()
  return sessions[key]
}

function makeSnapshot(key: string): SessionState {
  const s = ensure(key)
  // Create a new object reference so useSyncExternalStore detects the change
  snapshots[key] = { ...s }
  return snapshots[key]
}

function bump(key: string) {
  const s = ensure(key)
  s.version += 1
  makeSnapshot(key)
  listeners[key]?.forEach(l => l())
  // If other keys share the same session object, update their snapshots too
  for (const k of Object.keys(sessions)) {
    if (k !== key && sessions[k] === s) {
      snapshots[k] = { ...s }
      listeners[k]?.forEach(l => l())
    }
  }
}

export function sessionKeyFor(articleId: number | null | undefined): string {
  return articleId ? `article:${articleId}` : 'new'
}

export function getSession(key: string): SessionState {
  if (!snapshots[key]) makeSnapshot(key)
  return snapshots[key]
}

export function subscribe(key: string, fn: Listener): () => void {
  if (!listeners[key]) listeners[key] = new Set()
  listeners[key].add(fn)
  return () => { listeners[key].delete(fn) }
}

export function setInput(key: string, input: string) {
  ensure(key).input = input
  bump(key)
}

export function setPendingImages(key: string, images: string[]) {
  ensure(key).pendingImages = images
  bump(key)
}

export function resetSession(key: string) {
  const s = ensure(key)
  if (s.abort) { try { s.abort.abort() } catch { /* */ } }
  sessions[key] = emptyState()
  bump(key)
}

export function abortSession(key: string) {
  const s = ensure(key)
  if (s.taskId) cancelTask(s.taskId).catch(() => {})
  if (s.abort) { try { s.abort.abort() } catch { /* */ } s.abort = undefined }
  s.streaming = false
  s.status = ''
  bump(key)
}

export function migrateSession(oldKey: string, newKey: string) {
  if (oldKey === newKey) return
  const s = sessions[oldKey]
  if (!s) return
  // Both keys now share the same session object
  sessions[newKey] = s
  // Merge listeners so bump(oldKey) also notifies newKey subscribers
  if (!listeners[newKey]) listeners[newKey] = new Set()
  if (listeners[oldKey]) {
    for (const l of listeners[oldKey]) listeners[newKey].add(l)
  }
  listeners[oldKey] = listeners[newKey]
  makeSnapshot(newKey)
  makeSnapshot(oldKey)
  listeners[newKey].forEach(l => l())
}

export function getConversationId(key: string): number | null {
  return ensure(key).conversationId
}

export async function loadFromConversation(convId: number, key: string): Promise<string | null> {
  const conv = await getConversation(convId)
  const s = ensure(key)
  s.messages = compactMessagesForHistory((conv.messages || []) as UiMessage[])
  s.conversationId = convId
  bump(key)
  return conv.active_task_id || null
}

function shouldAttachArticleImages(text: string): boolean {
  return /(图片|图像|封面|配图|视觉|图文|画面|构图|排版|设计|海报|诊断|打分|匹配|裁剪|重绘|消除|编辑图|参考图|仿图|模仿|仿写|参考)/i.test(text)
}

function buildContextPreface(article?: Article | null, latestText = ''): UiMessage[] {
  if (!article) return []
  const body = article.body || ''
  const preview = body.length > 1200 ? body.slice(0, 1200) + '…' : body
  const visualItems: Array<{ position: number; role?: string; url: string; model_url?: string; full_url?: string }> = article.image_context?.visual_images?.length
    ? article.image_context.visual_images
    : [article.cover_image, ...(article.images || [])]
      .filter(Boolean)
      .map((url, position) => ({ position, role: position === 0 ? 'cover' : 'content', url }))
  const articleImages = visualItems.map(x => x.model_url || x.full_url || x.url).filter(Boolean)
  const attachVisuals = shouldAttachArticleImages(latestText)
  const attachedImages = attachVisuals ? articleImages.slice(0, 5) : []
  const imageLines = visualItems.length > 0
    ? visualItems.slice(0, 12).map(item => {
      const full = item.model_url || item.full_url || item.url
      const role = item.position === 0 ? '首图/封面' : `第 ${item.position + 1} 张`
      return `${role}：${item.url}${full && full !== item.url ? `（完整URL：${full}）` : ''}`
    }).join('\n')
    : '无'
  return [{
    role: 'user',
    content:
      `【当前笔记上下文 · id=${article.id}】\n` +
      `标题：${article.title}\n` +
      `状态：${article.status}\n` +
      `标签：${(article.tags || []).join(' ')}\n\n` +
      `图片：共 ${articleImages.length} 张（小红书展示队列：第 1 张就是首图/封面；上方含完整 URL/model_url）\n${imageLines}\n` +
      (attachedImages.length > 0
        ? `本轮涉及视觉/图片，已随上下文附带前 ${attachedImages.length} 张图片供视觉理解。\n\n`
        : `本轮先提供图片 URL；如需视觉像素级分析，用户问题包含图片/视觉/封面/配图等意图时会自动附带图片。\n\n`) +
      `正文：\n${preview}\n\n` +
      `---\n当前编辑页默认操作「笔记 ${article.id}」，但对话不与笔记强绑定；如果用户明确指定其它笔记 ID 或多个笔记，请按用户指定 ID 操作。` +
      `任何写入都通过工具完成（read/update/rewrite/imitate_article_style/optimize/score/diagnose/generate_image/arrange_article_images/remove_image）。` +
      `图片默认 3:4 竖版 1152x1536；用户指定 2K/4K/16:9/1:1/横版/竖版时，必须把规格传给工具，不能固定默认尺寸。` +
      `每次改写/优化/仿写前先 read_article 拿最新版；read_article 会返回有效首图 cover_image、后续 images、完整图片 URL 和 image_context。`,
    images: attachedImages,
  }]
}

const toolLabel: Record<string, string> = {
  generate_article: '生成笔记',
  create_complete_note_workflow: '一键成稿',
  rewrite_article: '改写',
  imitate_article_style: '仿写',
  optimize_article: '优化',
  polish_paragraph: '润色',
  score_article: '打分',
  diagnose_article: '诊断',
  create_article: '创建',
  update_article: '更新',
  read_article: '读取',
  list_articles: '列出',
  delete_article: '删除',
  generate_image: '生成图片',
  generate_article_images: '批量生成配图',
  remove_image: '删图',
  suggest_tags: '标签',
  suggest_titles: '标题',
  outline_article: '大纲',
  cover_prompt: '封面 Prompt',
  content_image_prompt: '配图 Prompt',
  list_templates: '模板',
  apply_template: '应用模板',
  search_articles: '搜索',
  batch_score: '批量打分',
  batch_optimize: '批量优化',
  export_articles: '导出',
  article_stats: '统计',
  schedule_publish: '定时发布',
  crop_image: '裁剪',
  inpaint_image: '局部重绘',
  remove_object: '消除',
  edit_image: '编辑图片',
}

const articleOpeningTools = new Set([
  'generate_article',
  'create_complete_note_workflow',
  'create_article',
  'imitate_article_style',
  'rewrite_article',
  'optimize_article',
  'update_article',
  'apply_template',
  'generate_article_images',
  'arrange_article_images',
  'edit_image',
  'crop_image',
  'inpaint_image',
  'remove_object',
  'remove_image',
])

function articleIdFromToolResult(result: any): number {
  const candidates = [
    result?.article?.id,
    result?.article_id,
    result?.workflow?.article_id,
    result?.workflow?.article?.id,
  ]
  for (const value of candidates) {
    const id = Number(value || 0)
    if (Number.isFinite(id) && id > 0) return id
  }
  return 0
}

function articleIdFromText(text: any): number {
  const value = String(text || '')
  const patterns = [
    /(?:笔记|文章|草稿)\s*[#＃]\s*(\d+)/i,
    /(?:article_id|articleId|文章ID|笔记ID)\D{0,8}(\d+)/i,
  ]
  for (const pattern of patterns) {
    const match = value.match(pattern)
    const id = Number(match?.[1] || 0)
    if (Number.isFinite(id) && id > 0) return id
  }
  return 0
}

function articleIdFromToolProgress(ev: Extract<StreamEvent, { type: 'tool_progress' }>): number {
  const data: any = ev.data || {}
  const candidates = [data.article_id, data.articleId, data.article?.id]
  for (const value of candidates) {
    const id = Number(value || 0)
    if (Number.isFinite(id) && id > 0) return id
  }
  return articleIdFromText(ev.message)
}

function toolEventsFromStreamEvents(events: StreamEvent[] | undefined): ToolEvent[] {
  const toolEvents: ToolEvent[] = []
  for (const ev of events || []) {
    if (ev.type === 'tool_call' || ev.type === 'tool_progress' || ev.type === 'tool_result') {
      toolEvents.push(ev as ToolEvent)
    }
  }
  return toolEvents
}

function latestArticleResultFromEvents(events: StreamEvent[] | undefined): { id: number; article?: Article; name?: string } {
  for (const ev of [...(events || [])].reverse()) {
    if (ev.type !== 'tool_result') continue
    const id = articleIdFromToolResult(ev.result)
    if (id > 0) return { id, article: ev.result?.article, name: ev.name }
  }
  return { id: 0 }
}

function openArticleSoftly(
  id: number,
  conversationId?: number | null,
  opts?: { onArticleCreated?: (id: number, conversationId?: number | null) => void },
) {
  if (!Number.isFinite(id) || id <= 0) return
  const qs = new URLSearchParams()
  if (conversationId) qs.set('c', String(conversationId))
  qs.set('chat', '1')
  qs.set('from', 'agent')
  const target = `/articles/${id}?${qs.toString()}`
  try {
    localStorage.setItem('xhs_pending_open_article', JSON.stringify({ id, conversationId: conversationId || null, target, at: Date.now() }))
  } catch {
    /* ignore */
  }
  opts?.onArticleCreated?.(id, conversationId)
  const emitOpenEvent = () => {
    window.dispatchEvent(new CustomEvent('xhs:open-article', { detail: { id, conversationId, target } }))
  }
  emitOpenEvent()
  window.setTimeout(emitOpenEvent, 120)
  window.setTimeout(() => {
    const expected = `/articles/${id}`
    if (window.location.pathname === expected) return
    window.history.pushState(null, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, 360)
  window.setTimeout(() => {
    const expected = `/articles/${id}`
    if (window.location.pathname === expected) return
    // Last-resort navigation: only used when React Router/event soft navigation
    // did not take effect, so the user still lands on the generated note instead
    // of being stranded in the chat.
    window.location.assign(target)
  }, 1400)
}

function isOnArticleRoute(id: number) {
  return window.location.pathname === `/articles/${id}`
}

const MAX_CLIENT_MESSAGES = 80
const MAX_CLIENT_MESSAGE_CHARS = 12000
const MAX_CLIENT_IMAGES_PER_MESSAGE = 8
const MAX_CLIENT_TOOL_EVENTS = 24
const MAX_CLIENT_TOOL_RESULT_CHARS = 6000

function truncateText(value: any, limit = MAX_CLIENT_MESSAGE_CHARS): string {
  const text = String(value || '').trim()
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

function compactToolResultForHistory(result: any): any {
  if (!result || typeof result !== 'object') return result
  const compact: any = {}
  for (const key of [
    'ok',
    'error',
    'timeout',
    'elapsed_ms',
    'elapsed_sec',
    'image',
    'images',
    'generated_cover',
    'generated_content_images',
    'visual_queue',
    'used_image_model',
    'used_image_base_url',
    'retry_options',
    'score',
    'titles',
    'tags',
    'outline',
    'diagnostic',
    'message',
  ]) {
    if (key in result) compact[key] = result[key]
  }
  if (Array.isArray(result.image_attempts)) compact.image_attempts = result.image_attempts.slice(0, 8)
  if (result.workflow && typeof result.workflow === 'object') {
    compact.workflow = {}
    for (const key of [
      'generated_cover',
      'generated_content_images',
      'generated_visual_queue',
      'visual_queue',
      'title_candidates',
      'image_attempts',
      'elapsed_sec',
    ]) {
      if (key in result.workflow) compact.workflow[key] = result.workflow[key]
    }
    if (Array.isArray(compact.workflow.image_attempts)) compact.workflow.image_attempts = compact.workflow.image_attempts.slice(0, 8)
  }
  if (result.article && typeof result.article === 'object') {
    compact.article = {
      id: result.article.id,
      title: result.article.title,
      body: truncateText(result.article.body, 3000),
      tags: result.article.tags,
      status: result.article.status,
      cover_image: result.article.cover_image,
      images: Array.isArray(result.article.images) ? result.article.images.slice(0, 12) : result.article.images,
      score: result.article.score,
      content_stats: result.article.content_stats,
    }
  }
  const payload = Object.keys(compact).length ? compact : result
  const json = JSON.stringify(payload)
  if (json.length <= MAX_CLIENT_TOOL_RESULT_CHARS) return payload
  return {
    ok: result.ok ?? true,
    error: result.error ? truncateText(result.error, 1500) : undefined,
    summary: truncateText(json, MAX_CLIENT_TOOL_RESULT_CHARS),
    note: 'tool result compacted for stored chat history',
  }
}

function compactToolEventsForHistory(events: ToolEvent[] | undefined): ToolEvent[] | undefined {
  if (!Array.isArray(events) || events.length === 0) return undefined
  return events.slice(-MAX_CLIENT_TOOL_EVENTS).map(ev => {
    const out: ToolEvent = {
      type: ev.type,
      name: truncateText(ev.name, 120),
      id: ev.id ? truncateText(ev.id, 120) : ev.id,
      step: ev.step ? truncateText(ev.step, 120) : ev.step,
      message: ev.message ? truncateText(ev.message, 500) : ev.message,
      data: ev.data,
      elapsed_ms: ev.elapsed_ms,
      ok: ev.ok,
    }
    if (ev.arguments !== undefined) {
      const argJson = JSON.stringify(ev.arguments)
      out.arguments = argJson.length <= 3000 ? ev.arguments : { summary: truncateText(argJson, 3000) }
    }
    if (ev.result !== undefined) out.result = compactToolResultForHistory(ev.result)
    return out
  })
}

function compactMessagesForHistory(messages: UiMessage[]): UiMessage[] {
  return messages.slice(-MAX_CLIENT_MESSAGES).map(m => {
    const item: UiMessage = {
      ...m,
      content: truncateText(m.content),
      images: Array.isArray(m.images) ? m.images.filter(Boolean).slice(0, MAX_CLIENT_IMAGES_PER_MESSAGE) : [],
    }
    const toolEvents = compactToolEventsForHistory(m.tool_events)
    if (toolEvents) item.tool_events = toolEvents
    else delete item.tool_events
    return item
  })
}

async function persistToBackend(key: string, articleId?: number | null) {
  const s = ensure(key)
  s.messages = compactMessagesForHistory(s.messages)
  const title = s.messages.find(m => m.role === 'user')?.content?.slice(0, 30) || '新对话'
  try {
    if (s.conversationId) {
      const payload: any = {
        messages: s.messages as any,
        title,
      }
      if (articleId !== undefined) payload.article_id = articleId
      await updateConversation(s.conversationId, payload)
    } else {
      const conv = await createConversation({
        title,
        article_id: articleId ?? undefined,
        messages: s.messages as any,
      } as any)
      s.conversationId = conv.id
      bump(key)
    }
  } catch {
    /* network failure — non-critical */
  }
}

async function reconcileTaskResult(
  key: string,
  taskId: string | null | undefined,
  opts: {
    onArticleMayChange?: (article?: Article | null) => void
    onArticleCreated?: (id: number, conversationId?: number | null) => void
  },
  alreadyOpened: boolean,
): Promise<{ articleId: number; opened: boolean }> {
  if (!taskId) return { articleId: 0, opened: alreadyOpened }
  let task: Awaited<ReturnType<typeof getTask>> | null = null
  for (let i = 0; i < 4; i += 1) {
    try {
      task = await getTask(taskId)
      if (task?.events?.some(ev => ev.type === 'tool_result') || task?.status !== 'running') break
    } catch {
      return { articleId: 0, opened: alreadyOpened }
    }
    await new Promise(resolve => window.setTimeout(resolve, 180))
  }
  if (!task) return { articleId: 0, opened: alreadyOpened }

  const events = task.events || []
  const toolEvents = toolEventsFromStreamEvents(events)
  const cur = ensure(key)
  const copy = cur.messages.slice()
  if (copy.length > 0 && copy[copy.length - 1].role === 'assistant') {
    const last = { ...copy[copy.length - 1] } as UiMessage
    if (task.result_text && (!last.content || task.result_text.length >= last.content.length)) {
      last.content = task.result_text
    }
    if (toolEvents.length) last.tool_events = toolEvents
    copy[copy.length - 1] = last
    cur.messages = compactMessagesForHistory(copy)
    bump(key)
  }

  const latest = latestArticleResultFromEvents(events)
  if (latest.id > 0) {
    const cid = ensure(key).conversationId
    if (cid) updateConversation(cid, { article_id: latest.id } as any).catch(() => {})
    opts.onArticleMayChange?.(latest.article || null)
    if ((!alreadyOpened || !isOnArticleRoute(latest.id)) && (!latest.name || articleOpeningTools.has(latest.name))) {
      openArticleSoftly(latest.id, cid, opts)
      return { articleId: latest.id, opened: true }
    }
    return { articleId: latest.id, opened: alreadyOpened }
  }
  return { articleId: 0, opened: alreadyOpened }
}

export async function sendMessage(
  key: string,
  text: string,
  opts: {
    article?: Article | null
    images?: string[]
    onArticleMayChange?: (article?: Article | null) => void
    onConversationCreated?: (id: number) => void
    onArticleCreated?: (id: number, conversationId?: number | null) => void
  } = {}
) {
  const s = ensure(key)
  if (s.streaming) return
  const content = text.trim()
  const images = opts.images ?? s.pendingImages.slice()
  if (!content && images.length === 0) return

  const userMsg: UiMessage = { role: 'user', content, images }
  const assistant: UiMessage = { role: 'assistant', content: '', tool_events: [] }

  s.messages = compactMessagesForHistory([...s.messages, userMsg, assistant])
  s.pendingImages = []
  s.input = ''
  s.streaming = true
  s.status = '连接中…'
  const controller = new AbortController()
  s.abort = controller
  bump(key)

  // Persist immediately so the conversation exists in backend before stream starts.
  // This way a mid-stream refresh won't lose messages.
  await persistToBackend(key, opts.article?.id)
  const newConvId = ensure(key).conversationId
  if (newConvId) {
    const url = new URL(window.location.href)
    if (url.searchParams.get('c') !== String(newConvId)) {
      url.searchParams.set('c', String(newConvId))
      if (opts.article?.id) url.searchParams.set('article', String(opts.article.id))
      window.history.replaceState(null, '', url.toString())
      opts.onConversationCreated?.(newConvId)
    }
  }

  const outgoing: UiMessage[] = [
    ...buildContextPreface(opts.article, content),
    ...s.messages.slice(0, -1),
  ]
  let activeArticleId: number | null | undefined = opts.article?.id
  let articleCreatedNotified = false

  // Throttled save: persist at most once every 3s during streaming
  let lastPersist = Date.now()
  const maybePersist = () => {
    const now = Date.now()
    if (now - lastPersist > 3000) {
      lastPersist = now
      persistToBackend(key, activeArticleId)
    }
  }

  let gotFirstToken = false
  try {
    await chatStream(
      outgoing,
      (ev: StreamEvent) => {
        const cur = ensure(key)
        if (ev.type === 'task_id') {
          cur.taskId = ev.task_id
          bump(key)
          return
        } else if (ev.type === 'token') {
          if (!gotFirstToken) { gotFirstToken = true; cur.status = '' }
        } else if (ev.type === 'tool_call') {
          cur.status = `${toolLabel[ev.name] || ev.name}…`
        } else if (ev.type === 'tool_progress') {
          cur.status = ev.message || `${toolLabel[ev.name] || ev.name}…`
          const progressArticleId = articleOpeningTools.has(ev.name) ? articleIdFromToolProgress(ev) : 0
          if (progressArticleId > 0) {
            activeArticleId = progressArticleId
            const cid = ensure(key).conversationId
            if (cid) updateConversation(cid, { article_id: progressArticleId } as any).catch(() => {})
            if (!articleCreatedNotified) {
              articleCreatedNotified = true
              openArticleSoftly(progressArticleId, cid, opts)
            }
          }
        } else if (ev.type === 'tool_result') {
          cur.status = ev.elapsed_ms ? `${toolLabel[ev.name] || ev.name}完成，用时 ${(ev.elapsed_ms / 1000).toFixed(1)}s，整合结果…` : '整合结果…'
          opts.onArticleMayChange?.(ev.result?.article || null)
          const createdByTool = articleOpeningTools.has(ev.name)
          const createdArticleId = articleIdFromToolResult(ev.result)
          if (createdByTool && ev.result?.ok !== false && createdArticleId > 0) {
            activeArticleId = createdArticleId
            const cid = ensure(key).conversationId
            if (cid) updateConversation(cid, { article_id: createdArticleId } as any).catch(() => {})
            if (!articleCreatedNotified) {
              articleCreatedNotified = true
              openArticleSoftly(createdArticleId, cid, opts)
            }
          }
          maybePersist()
        } else if (ev.type === 'done') {
          cur.status = ''
        } else if (ev.type === 'cancelled') {
          cur.status = ''
        }

        const copy = cur.messages.slice()
        const last = { ...copy[copy.length - 1] } as UiMessage
        last.tool_events = last.tool_events ? [...last.tool_events] : []
        if (ev.type === 'token') {
          last.content += ev.text
        } else if (ev.type === 'tool_call') {
          last.tool_events.push({ type: 'tool_call', name: ev.name, arguments: ev.arguments, id: ev.id })
        } else if (ev.type === 'tool_progress') {
          last.tool_events.push({
            type: 'tool_progress',
            name: ev.name,
            id: ev.id,
            step: ev.step,
            message: ev.message,
            data: ev.data,
          } as ToolEvent)
        } else if (ev.type === 'tool_result') {
          last.tool_events.push({
            type: 'tool_result',
            name: ev.name,
            result: ev.result,
            id: ev.id,
            elapsed_ms: ev.elapsed_ms,
          } as ToolEvent)
        } else if (ev.type === 'error') {
          last.content += `\n\n⚠️ ${ev.message}`
        } else if (ev.type === 'cancelled') {
          if (!last.content.trim()) last.content = '已停止生成。'
        }
        copy[copy.length - 1] = last
        cur.messages = compactMessagesForHistory(copy)
        bump(key)
      },
      controller.signal,
      s.conversationId
    )
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      // User cancelled — no error message needed
    } else {
      const cur = ensure(key)
      const copy = cur.messages.slice()
      if (copy.length > 0 && copy[copy.length - 1].role === 'assistant') {
        const last = { ...copy[copy.length - 1] } as UiMessage
        const detail = err?.message || '网络异常，请检查连接后重试'
        last.content += `\n\n⚠️ ${detail}`
        copy[copy.length - 1] = last
      }
      cur.messages = compactMessagesForHistory(copy)
      bump(key)
    }
  } finally {
    const taskIdToReconcile = ensure(key).taskId
    const reconciled = await reconcileTaskResult(key, taskIdToReconcile, opts, articleCreatedNotified)
    if (reconciled.articleId > 0) activeArticleId = reconciled.articleId
    articleCreatedNotified = reconciled.opened
    if (activeArticleId && articleCreatedNotified && !isOnArticleRoute(activeArticleId)) {
      openArticleSoftly(activeArticleId, ensure(key).conversationId, opts)
    }
    const cur = ensure(key)
    cur.streaming = false
    cur.status = ''
    cur.abort = undefined
    bump(key)
    opts.onArticleMayChange?.()
  }

  // Final persist with complete messages
  await persistToBackend(key, activeArticleId)
}

export async function reconnectTask(
  key: string,
  taskId: string,
  opts: { onArticleMayChange?: (article?: Article | null) => void } = {}
) {
  const s = ensure(key)
  if (s.streaming) return

  s.streaming = true
  s.status = '重新连接…'
  s.taskId = taskId
  const controller = new AbortController()
  s.abort = controller
  bump(key)

  try {
    const task = await getTask(taskId)

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      // Task already finished — apply stored result
      const cur = ensure(key)
      const copy = cur.messages.slice()
      if (copy.length > 0 && copy[copy.length - 1].role === 'assistant') {
        const last = { ...copy[copy.length - 1] } as UiMessage
        const storedText = task.result_text || (task.events || [])
          .filter((ev): ev is Extract<StreamEvent, { type: 'token' }> => ev.type === 'token')
          .map(ev => ev.text)
          .join('')
        if (storedText) last.content = storedText
        const toolEvents = toolEventsFromStreamEvents(task.events)
        if (toolEvents.length) last.tool_events = toolEvents
        copy[copy.length - 1] = last
      }
      cur.messages = compactMessagesForHistory(copy)
      cur.streaming = false
      cur.status = ''
      cur.taskId = null
      cur.abort = undefined
      bump(key)
      const latest = latestArticleResultFromEvents(task.events)
      opts.onArticleMayChange?.(latest.article || null)
      return
    }

    // Task still running — connect to live stream
    const cur = ensure(key)
    const replayEvents = task.events || []
    if (replayEvents.length) {
      const copy = cur.messages.slice()
      if (copy.length > 0 && copy[copy.length - 1].role === 'assistant') {
        const last = { ...copy[copy.length - 1] } as UiMessage
        last.content = replayEvents
          .filter((ev): ev is Extract<StreamEvent, { type: 'token' }> => ev.type === 'token')
          .map(ev => ev.text)
          .join('')
        const toolEvents = toolEventsFromStreamEvents(replayEvents)
        last.tool_events = toolEvents
        copy[copy.length - 1] = last
      }
      cur.messages = compactMessagesForHistory(copy)
    }
    cur.status = '继续生成中…'
    bump(key)

    await streamTask(
      taskId,
      (ev: StreamEvent) => {
        const cur = ensure(key)
        if (ev.type === 'task_id') return
        if (ev.type === 'token') {
          cur.status = ''
        } else if (ev.type === 'tool_call') {
          cur.status = `${toolLabel[ev.name] || ev.name}…`
        } else if (ev.type === 'tool_progress') {
          cur.status = ev.message || `${toolLabel[ev.name] || ev.name}…`
        } else if (ev.type === 'tool_result') {
          cur.status = ev.elapsed_ms ? `${toolLabel[ev.name] || ev.name}完成，用时 ${(ev.elapsed_ms / 1000).toFixed(1)}s，整合结果…` : '整合结果…'
          opts.onArticleMayChange?.(ev.result?.article || null)
        } else if (ev.type === 'done') {
          cur.status = ''
        } else if (ev.type === 'cancelled') {
          cur.status = ''
        }

        const copy = cur.messages.slice()
        if (copy.length > 0 && copy[copy.length - 1].role === 'assistant') {
          const last = { ...copy[copy.length - 1] } as UiMessage
          last.tool_events = last.tool_events ? [...last.tool_events] : []
          if (ev.type === 'token') {
            last.content += ev.text
          } else if (ev.type === 'tool_call') {
            last.tool_events.push({ type: 'tool_call', name: ev.name, arguments: ev.arguments, id: ev.id })
        } else if (ev.type === 'tool_progress') {
            last.tool_events.push({
              type: 'tool_progress',
              name: ev.name,
              id: ev.id,
              step: ev.step,
              message: ev.message,
              data: ev.data,
            } as ToolEvent)
          } else if (ev.type === 'tool_result') {
            last.tool_events.push({
              type: 'tool_result',
              name: ev.name,
              result: ev.result,
              id: ev.id,
              elapsed_ms: ev.elapsed_ms,
            } as ToolEvent)
          } else if (ev.type === 'error') {
            last.content += `\n\n⚠️ ${ev.message}`
          } else if (ev.type === 'cancelled') {
            if (!last.content.trim()) last.content = '已停止生成。'
          }
          copy[copy.length - 1] = last
        }
        cur.messages = compactMessagesForHistory(copy)
        bump(key)
      },
      controller.signal,
      replayEvents.length
    )
  } catch (err: any) {
    const cur = ensure(key)
    cur.status = ''
    const copy = cur.messages.slice()
    if (copy.length > 0 && copy[copy.length - 1].role === 'assistant') {
      const last = { ...copy[copy.length - 1] } as UiMessage
      if (!last.content.includes('重连失败')) {
        last.content += `\n\n⚠️ 重连失败：${err?.message || '请刷新后重试'}`
        copy[copy.length - 1] = last
        cur.messages = compactMessagesForHistory(copy)
      }
    }
  } finally {
    const cur = ensure(key)
    cur.streaming = false
    cur.status = ''
    cur.taskId = null
    cur.abort = undefined
    bump(key)
    opts.onArticleMayChange?.()
  }
}
