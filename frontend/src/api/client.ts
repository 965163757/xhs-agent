import axios from 'axios'

export const api = axios.create({
  baseURL: '/api',
  // Image generation can legitimately take several minutes on compatible
  // gateways, especially for high quality / 2K requests.
  timeout: 480000,
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
      window.dispatchEvent(new Event('auth:logout'))
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
  cover_image_full_url?: string
  images: string[]
  images_full_urls?: string[]
  visual_queue?: string[]
  visual_queue_full_urls?: string[]
  status: string
  score: Record<string, any>
  image_context?: ArticleImageContext
  content_stats?: {
    title_chars: number
    body_chars: number
    tag_count: number
    image_count: number
  }
  created_at: string
  updated_at: string
}

export interface ArticleImageAsset {
  role: 'cover' | 'content' | string
  url: string
  full_url?: string
  model_url?: string
  public_url?: string
  stored_url?: string
  public_url_configured?: boolean
  url_note?: string
  index?: number
  exists?: boolean
  bytes?: number
  width?: number
  height?: number
  format?: string
}

export interface ArticleImageContext {
  has_cover: boolean
  cover_image: string
  cover_image_full_url?: string
  content_images: Array<{ index: number; url: string; full_url?: string; model_url?: string; public_url?: string; stored_url?: string }>
  visual_images?: Array<{ position: number; role: string; url: string; full_url?: string; model_url?: string; public_url?: string; stored_url?: string; index?: number }>
  all_images: ArticleImageAsset[]
  image_count: number
  content_image_count: number
  visual_queue?: string[]
  visual_queue_full_urls?: string[]
  notes?: string
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
  // Legacy aliases map to text/chat settings.
  openai_api_key_mask: string
  openai_api_key_set: boolean
  openai_base_url: string
  chat_api_key_mask: string
  chat_api_key_set: boolean
  chat_base_url: string
  image_api_key_mask: string
  image_api_key_set: boolean
  image_base_url: string
  chat_model: string
  image_model: string
  public_base_url: string
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
  | { type: 'task_id'; task_id: string; seq?: number }
  | { type: 'progress'; step: string; message: string; data?: any }
  | { type: 'result'; data: DiagnosisReport }
  | { type: 'done'; text?: string; seq?: number }
  | { type: 'cancelled'; text?: string; seq?: number }
  | { type: 'error'; message: string }

export interface DiagnosisReport {
  id?: number
  diagnosis_id?: number
  article_id?: number
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
  applied_at?: string | null
  created_at?: string | null
}

function handleStreamAuth(res: Response, url: string) {
  if (res.status === 401 && !url.includes('/auth/')) {
    localStorage.removeItem(TOKEN_KEY)
    window.dispatchEvent(new Event('auth:logout'))
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

export async function startDiagnosisTask(
  payload: { article_id?: number; title?: string; content?: string; tags?: string[]; image_count?: number }
): Promise<{ ok: boolean; task_id: string; article_id?: number }> {
  const r = await api.post('/diagnose/start', payload)
  return r.data
}

export async function getActiveDiagnosisTask(articleId: number): Promise<TaskInfo | null> {
  const r = await api.get('/diagnose/active', { params: { article_id: articleId } })
  return r.data.task || null
}

export async function listDiagnosisReports(articleId: number): Promise<DiagnosisReport[]> {
  const r = await api.get(`/articles/${articleId}/diagnoses`)
  return r.data.items || []
}

export async function getLatestDiagnosisReport(articleId: number): Promise<DiagnosisReport | null> {
  const r = await api.get(`/articles/${articleId}/diagnoses/latest`)
  return r.data.item || null
}

export async function applyDiagnosisReport(articleId: number, diagnosisId: number, fields = ['title', 'body', 'tags']) {
  const r = await api.post(`/articles/${articleId}/diagnoses/${diagnosisId}/apply`, { fields })
  return r.data as { ok: boolean; changed: string[]; article: Article; diagnosis: DiagnosisReport }
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
  return r.data as {
    ok: boolean
    shots: Array<{ index?: number; role?: string; scene: string; prompt: string; size?: string; quality?: string; series_style?: string }>
    image_storyboard?: {
      series_style?: string
      shots: Array<{ index?: number; role?: string; scene: string; prompt: string; size?: string; quality?: string; series_style?: string }>
    }
    series_style?: string
  }
}
export async function removeArticleImage(
  article_id: number,
  role: 'cover' | 'content',
  index?: number
) {
  const r = await api.post('/articles/remove_image', { article_id, role, index })
  return r.data
}

export async function arrangeArticleImages(payload: {
  article_id: number
  action: 'set_order' | 'move' | 'set_cover' | 'insert' | 'replace' | 'remove' | 'clear'
  order?: string[]
  image_url?: string
  from_position?: number
  to_position?: number
  position?: number
}) {
  const r = await api.post('/articles/arrange_images', payload)
  return r.data as { ok: boolean; article?: Article; visual_queue?: string[]; error?: string }
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
  quality?: 'high' | 'medium' | 'low' | 'auto'
} & EditBinding) {
  const r = await api.post('/images/inpaint', payload)
  return r.data as { ok: boolean; image: string }
}

export async function removeObject(payload: {
  image_url: string
  mask_url: string
  prompt?: string
  size?: string
  quality?: 'high' | 'medium' | 'low' | 'auto'
} & EditBinding) {
  const r = await api.post('/images/remove_object', payload)
  return r.data as { ok: boolean; image: string }
}

export async function editImage(payload: {
  image_url: string
  prompt: string
  size?: string
  quality?: 'high' | 'medium' | 'low' | 'auto'
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
  quality?: 'high' | 'medium' | 'low' | 'auto'
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
export async function generateImage(
  prompt: string,
  size = '1152x1536',
  n = 1,
  quality: 'high' | 'medium' | 'low' | 'auto' = 'high',
  referenceImages: string[] = []
): Promise<string[]> {
  const r = await api.post('/images/generate', { prompt, size, n, quality, reference_images: referenceImages })
  if (r.data?.ok === false) throw new Error(r.data.error || '图片生成失败')
  return r.data.images || []
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
export async function deleteConversations(ids: number[]): Promise<{ ok: boolean; deleted: number; requested: number }> {
  const r = await api.post('/conversations/batch_delete', { ids })
  return r.data
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
export async function updateSettings(payload: Partial<PublicSettings> & {
  openai_api_key?: string
  chat_api_key?: string
  image_api_key?: string
}) {
  const r = await api.put('/settings', payload)
  return r.data as PublicSettings
}
export async function testSettings() {
  const r = await api.post('/settings/test')
  return r.data as {
    ok: boolean
    reply?: string
    error?: string
    chat_base_url?: string
    chat_model?: string
    image_base_url?: string
    image_model?: string
    public_base_url?: string
    image_key_set?: boolean
  }
}

export async function testImageSettings(payload?: {
  prompt?: string
  size?: string
  quality?: 'high' | 'medium' | 'low' | 'auto'
}) {
  const r = await api.post('/settings/image-test', payload || {})
  return r.data as {
    ok: boolean
    images: string[]
    image?: string
    error?: string
    timeout?: boolean
    elapsed_ms: number
    elapsed_sec: number
    image_base_url?: string
    image_model?: string
    size?: string
    quality?: string
    retry_options?: Array<{ label: string; reason?: string; arguments?: any }>
  }
}

export async function testStaticImagePublicAccess(publicBaseUrl?: string) {
  const r = await api.post('/settings/static-image-test', { public_base_url: publicBaseUrl ?? undefined })
  return r.data as {
    ok: boolean
    public_ok?: boolean
    provider_readable?: boolean
    mode?: 'local' | 'server' | 'invalid'
    source?: 'input' | 'settings' | 'request'
    provider_base_url?: string
    public_url: string
    static_path: string
    status_code?: number
    content_type?: string
    bytes?: number
    elapsed_ms: number
    elapsed_sec: number
    message?: string
    error?: string
  }
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

// ---------- per-user settings ----------

export interface MySettings {
  use_own_key: boolean
  // Legacy aliases map to text/chat settings.
  openai_api_key_mask: string
  openai_api_key_set: boolean
  openai_base_url: string
  chat_api_key_mask: string
  chat_api_key_set: boolean
  chat_base_url: string
  image_api_key_mask: string
  image_api_key_set: boolean
  image_base_url: string
  chat_model: string
  image_model: string
}

export async function getMySettings(): Promise<MySettings> {
  const r = await api.get('/my-settings')
  return r.data
}

export async function updateMySettings(payload: {
  use_own_key?: boolean
  openai_api_key?: string
  openai_base_url?: string
  chat_api_key?: string
  chat_base_url?: string
  image_api_key?: string
  image_base_url?: string
  chat_model?: string
  image_model?: string
}): Promise<MySettings> {
  const r = await api.put('/my-settings', payload)
  return r.data
}

export async function changePassword(payload: {
  current_password: string
  new_password: string
}): Promise<{ ok: boolean }> {
  const r = await api.post('/auth/change-password', payload)
  return r.data
}

// ---------- admin ----------

export interface AdminUser {
  id: number
  username: string
  role: 'admin' | 'user'
  created_at: string
}

export async function listUsers(): Promise<AdminUser[]> {
  const r = await api.get('/admin/users')
  return r.data.items
}

export async function setUserRole(uid: number, role: 'admin' | 'user'): Promise<AdminUser> {
  const r = await api.patch(`/admin/users/${uid}/role`, { role })
  return r.data
}

export async function getSystemConfig(): Promise<Record<string, string>> {
  const r = await api.get('/admin/config')
  return r.data
}

export async function updateSystemConfig(payload: { registration_open?: string }): Promise<Record<string, string>> {
  const r = await api.put('/admin/config', payload)
  return r.data
}

export type StreamEvent =
  | { type: 'token'; text: string; seq?: number }
  | { type: 'task_id'; task_id: string; seq?: number }
  | { type: 'progress'; step: string; message: string; data?: any; seq?: number }
  | { type: 'result'; data: any; seq?: number }
  | { type: 'tool_call'; name: string; arguments: any; id: string; seq?: number }
  | { type: 'tool_progress'; name: string; id: string; step?: string; message: string; data?: any; seq?: number }
  | { type: 'tool_result'; name: string; result: any; id: string; elapsed_ms?: number; ok?: boolean; seq?: number }
  | { type: 'done'; text?: string; seq?: number }
  | { type: 'cancelled'; text?: string; seq?: number }
  | { type: 'error'; message: string; seq?: number }

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
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'stale'
  trace_id?: string
  trace?: Record<string, any>
  events: StreamEvent[]
  result_text: string
  event_count?: number
  result_preview?: string
  created_at?: string
  updated_at?: string
}

export async function listTasks(limit = 50): Promise<TaskInfo[]> {
  const r = await api.get('/tasks', { params: { limit } })
  return r.data.items
}

export async function getTask(taskId: string): Promise<TaskInfo> {
  const r = await api.get(`/tasks/${taskId}`)
  return r.data
}

export async function cancelTask(taskId: string) {
  const r = await api.post(`/tasks/${taskId}/cancel`)
  return r.data as { ok: boolean }
}

export async function streamTask(
  taskId: string,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal,
  fromIndex = 0
) {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`/api/tasks/${taskId}/stream?from_index=${fromIndex}`, { signal, headers: token ? { Authorization: `Bearer ${token}` } : {} })
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
