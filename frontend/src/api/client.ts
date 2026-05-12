import axios from 'axios'

export const api = axios.create({
  baseURL: '/api',
  timeout: 180000,
})

const TOKEN_KEY = 'xhs_token'

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !err.config?.url?.includes('/auth/')) {
      localStorage.removeItem(TOKEN_KEY)
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export interface Article {
  id: number
  title: string
  body: string
  tags: string[]
  cover_image: string
  images: string[]
  status: string
  score: Record<string, any>
  created_at: string
  updated_at: string
}

export interface Template {
  id: number
  name: string
  category: string
  description: string
  body: string
  tags: string[]
}

export interface Conversation {
  id: number
  title: string
  article_id: number | null
  messages: ChatMessage[]
  active_task_id: string | null
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  images?: string[]
  tool_calls?: any[]
  tool_results?: any[]
  name?: string
}

export interface PublicSettings {
  openai_api_key_mask: string
  openai_api_key_set: boolean
  openai_base_url: string
  chat_model: string
  image_model: string
}

export async function listArticles(): Promise<Article[]> {
  const r = await api.get('/articles')
  return r.data.items
}
export async function getArticle(id: number): Promise<Article> {
  const r = await api.get(`/articles/${id}`)
  return r.data
}
export async function createArticle(payload: Partial<Article>): Promise<Article> {
  const r = await api.post('/articles', payload)
  return r.data
}
export async function updateArticle(id: number, payload: Partial<Article>): Promise<Article> {
  const r = await api.patch(`/articles/${id}`, payload)
  return r.data
}
export async function deleteArticle(id: number) {
  await api.delete(`/articles/${id}`)
}
export async function rewriteArticle(id: number, style: string, instruction: string) {
  const r = await api.post('/articles/rewrite', { article_id: id, style, instruction })
  return r.data
}
export async function optimizeArticle(id: number, focus: string) {
  const r = await api.post('/articles/optimize', { article_id: id, focus })
  return r.data
}
export async function scoreArticle(id: number) {
  const r = await api.post('/articles/score', { article_id: id })
  return r.data
}
export async function diagnoseArticle(id: number) {
  const r = await api.post('/articles/diagnose', { article_id: id })
  return r.data
}

export type DiagnoseEvent =
  | { type: 'progress'; step: string; message: string; data?: any }
  | { type: 'result'; data: DiagnosisReport }
  | { type: 'error'; message: string }

export interface DiagnosisReport {
  overall_score: number
  grade: string
  radar_data: Record<string, number>
  issues: Array<{ severity: string; description: string; from_agent: string }>
  suggestions: Array<{ priority: number; description: string; expected_impact: string }>
  debate_summary: string
  optimized_title: string
  optimized_content: string
  optimized_tags: string[]
  cover_direction: { layout: string; color_scheme: string; text_style: string; tips: string[] }
  simulated_comments: Array<{ username: string; avatar_emoji: string; comment: string; sentiment: string; likes: number; persona?: string }>
  agent_opinions: Array<{ agent_name: string; dimension: string; score: number; issues: string[]; suggestions: string[]; reasoning: string }>
  debate_results: Array<{ agent: string; agreements: string[]; disagreements: string[]; additions: string[]; revised_score?: number }>
  model_a_score: Record<string, any>
  text_analysis: Record<string, any>
  category: string
  category_cn: string
  elapsed_ms: number
}

function handleStreamAuth(res: Response, url: string) {
  if (res.status === 401 && !url.includes('/auth/')) {
    localStorage.removeItem(TOKEN_KEY)
    window.location.href = '/login'
    throw new Error('未登录')
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
}

export async function diagnoseStream(
  payload: { article_id?: number; title?: string; content?: string; tags?: string[]; image_count?: number },
  onEvent: (ev: DiagnoseEvent) => void,
  signal?: AbortSignal
) {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch('/api/diagnose/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
    signal,
  })
  handleStreamAuth(res, '/api/diagnose/stream')
  if (!res.body) throw new Error('no stream body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data:')) continue
      const payload2 = line.slice(5).trim()
      if (payload2 === '[DONE]') return
      try {
        onEvent(JSON.parse(payload2))
      } catch (e) {
        console.warn('bad sse payload', payload2)
      }
    }
  }
}
export async function outlineArticle(topic: string, audience?: string) {
  const r = await api.post('/articles/outline', { topic, audience })
  return r.data
}
export async function suggestTitles(topic: string, body?: string, n = 6) {
  const r = await api.post('/articles/suggest_titles', { topic, body, n })
  return r.data
}
export async function suggestTags(topic: string, body?: string) {
  const r = await api.post('/articles/suggest_tags', { topic, body })
  return r.data
}
export async function polishParagraph(paragraph: string, style?: string) {
  const r = await api.post('/articles/polish', { paragraph, style })
  return r.data
}
export async function coverPrompt(topic: string, title?: string, style?: string) {
  const r = await api.post('/articles/cover_prompt', { topic, title, style })
  return r.data
}
export async function contentImagePrompt(
  payload: { article_id?: number; topic?: string; title?: string; body?: string; n?: number }
) {
  const r = await api.post('/articles/content_image_prompt', payload)
  return r.data as { ok: boolean; shots: Array<{ scene: string; prompt: string; size?: string }> }
}
export async function removeArticleImage(
  article_id: number,
  role: 'cover' | 'content',
  index?: number
) {
  const r = await api.post('/articles/remove_image', { article_id, role, index })
  return r.data
}

export interface EditBinding {
  article_id?: number
  role?: 'cover' | 'content'
  replace_index?: number
}

export async function cropImage(payload: {
  image_url: string
  x: number
  y: number
  w: number
  h: number
} & EditBinding) {
  const r = await api.post('/images/crop', payload)
  return r.data as { ok: boolean; image: string }
}

export async function inpaintImage(payload: {
  image_url: string
  mask_url: string
  prompt: string
  size?: string
} & EditBinding) {
  const r = await api.post('/images/inpaint', payload)
  return r.data as { ok: boolean; image: string }
}

export async function removeObject(payload: {
  image_url: string
  mask_url: string
  prompt?: string
  size?: string
} & EditBinding) {
  const r = await api.post('/images/remove_object', payload)
  return r.data as { ok: boolean; image: string }
}

export async function editImage(payload: {
  image_url: string
  prompt: string
  size?: string
} & EditBinding) {
  const r = await api.post('/images/edit', payload)
  return r.data as { ok: boolean; image: string }
}

export async function uploadMask(blob: Blob): Promise<string> {
  const fd = new FormData()
  fd.append('file', blob, 'mask.png')
  const r = await api.post('/images/upload_mask', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return r.data.url
}
export async function generateImageForArticle(payload: {
  prompt: string
  size?: string
  n?: number
  article_id: number
  role: 'cover' | 'content'
  replace_index?: number
}) {
  const r = await api.post('/mcp/call', {
    name: 'generate_image',
    arguments: payload,
  })
  return r.data.result as { ok: boolean; images: string[] }
}
export async function generateImage(prompt: string, size = '1024x1536', n = 1): Promise<string[]> {
  const r = await api.post('/images/generate', { prompt, size, n })
  return r.data.images
}
export async function uploadImage(file: File): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  const r = await api.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  return r.data.url
}
export async function getMeta() {
  const r = await api.get('/meta')
  return r.data
}

export interface BannedWordHit {
  word: string
  category: string
  position: number
  replacement: string
  severity: string
}
export interface BanCheckResult {
  safe: boolean
  hit_count: number
  summary: string
  hits: BannedWordHit[]
}
export async function checkBannedWords(text: string): Promise<BanCheckResult> {
  const r = await api.post('/check_banned_words', { text })
  return r.data
}
export async function getBannedWords(): Promise<Record<string, any>> {
  const r = await api.get('/banned_words')
  return r.data
}
export interface HotTag {
  tag: string
  heat: string
  heat_label: string
  category: string
}
export async function suggestHotTags(query = '', category = '', limit = 20): Promise<HotTag[]> {
  const r = await api.get('/tags/suggest', { params: { query, category, limit } })
  return r.data.items
}

export async function listTemplates(): Promise<Template[]> {
  const r = await api.get('/templates')
  return r.data.items
}
export async function applyTemplate(template_id: number, topic: string): Promise<Article> {
  const r = await api.post('/templates/apply', { template_id, topic })
  return r.data.article
}
export async function createTemplate(payload: Omit<Template, 'id'>): Promise<Template> {
  const r = await api.post('/templates', payload)
  return r.data
}
export async function deleteTemplate(id: number) {
  await api.delete(`/templates/${id}`)
}
export async function extractTemplate(article_id: number): Promise<Template> {
  const r = await api.post('/templates/extract', { article_id })
  return r.data
}
export async function listConversations(): Promise<Conversation[]> {
  const r = await api.get('/conversations')
  return r.data.items
}
export async function getConversation(id: number): Promise<Conversation> {
  const r = await api.get(`/conversations/${id}`)
  return r.data
}
export async function createConversation(payload: Partial<Conversation>): Promise<Conversation> {
  const r = await api.post('/conversations', payload)
  return r.data
}
export async function updateConversation(id: number, payload: Partial<Conversation>): Promise<Conversation> {
  const r = await api.patch(`/conversations/${id}`, payload)
  return r.data
}
export async function deleteConversation(id: number) {
  await api.delete(`/conversations/${id}`)
}

export interface ArticleVersion {
  id: number
  article_id: number
  version: number
  title: string
  body: string
  tags: string[]
  cover_image: string
  images: string[]
  trigger: string
  created_at: string
}

export async function listVersions(articleId: number): Promise<ArticleVersion[]> {
  const r = await api.get(`/articles/${articleId}/versions`)
  return r.data.items
}
export async function createVersion(articleId: number, trigger = 'manual'): Promise<ArticleVersion> {
  const r = await api.post(`/articles/${articleId}/versions`, { trigger })
  return r.data
}
export async function rollbackVersion(articleId: number, versionId: number): Promise<Article> {
  const r = await api.post(`/articles/${articleId}/versions/${versionId}/rollback`)
  return r.data
}

export async function getSettings(): Promise<PublicSettings> {
  const r = await api.get('/settings')
  return r.data
}
export async function updateSettings(payload: Partial<PublicSettings> & { openai_api_key?: string }) {
  const r = await api.put('/settings', payload)
  return r.data as PublicSettings
}
export async function testSettings() {
  const r = await api.post('/settings/test')
  return r.data as { ok: boolean; reply?: string; error?: string }
}

export async function getStats(): Promise<{
  total: number
  by_status: Record<string, number>
  scored_count: number
  avg_score: number | null
  top_tags: Array<{ tag: string; count: number }>
}> {
  const r = await api.get('/stats')
  return r.data
}

export async function getCalendar(): Promise<Record<string, Array<{ id: number; title: string; status: string }>>> {
  const r = await api.get('/stats/calendar')
  return r.data.calendar
}

export async function getMcpTools() {
  const r = await api.get('/mcp/tools')
  return r.data.tools as Array<{ name: string; description: string; inputSchema: any }>
}

export type StreamEvent =
  | { type: 'token'; text: string }
  | { type: 'task_id'; task_id: string }
  | { type: 'tool_call'; name: string; arguments: any; id: string }
  | { type: 'tool_result'; name: string; result: any; id: string }
  | { type: 'done'; text?: string }
  | { type: 'error'; message: string }

export async function chatStream(
  messages: ChatMessage[],
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal,
  conversationId?: number | null
) {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ messages, conversation_id: conversationId || undefined }),
    signal,
  })
  handleStreamAuth(res, '/api/chat/stream')
  if (!res.body) throw new Error('no stream body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        onEvent(JSON.parse(payload))
      } catch (e) {
        console.warn('bad sse payload', payload)
      }
    }
  }
}

export interface TaskInfo {
  id: string
  conversation_id: number | null
  status: 'running' | 'completed' | 'failed'
  events: StreamEvent[]
  result_text: string
}

export async function getTask(taskId: string): Promise<TaskInfo> {
  const r = await api.get(`/tasks/${taskId}`)
  return r.data
}

export async function streamTask(
  taskId: string,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal
) {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`/api/tasks/${taskId}/stream`, { signal, headers: token ? { Authorization: `Bearer ${token}` } : {} })
  handleStreamAuth(res, `/api/tasks/${taskId}/stream`)
  if (!res.body) throw new Error('no stream body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        onEvent(JSON.parse(payload))
      } catch (e) {
        console.warn('bad sse payload', payload)
      }
    }
  }
}
