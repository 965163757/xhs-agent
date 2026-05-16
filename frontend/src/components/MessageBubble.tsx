import { Box, Chip, CircularProgress, Collapse, Dialog, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import Markdown from './Markdown'
import ImageEditor from './ImageEditor'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { ChatMessage, EditBinding } from '../api/client'

const toolNameZh: Record<string, string> = {
  generate_article: '生成笔记',
  create_complete_note_workflow: '一键成稿工作流',
  rewrite_article: '改写笔记',
  imitate_article_style: '参考仿写',
  optimize_article: '优化笔记',
  polish_paragraph: '段落润色',
  score_article: '笔记打分',
  diagnose_article: '发布前诊断',
  create_article: '创建笔记',
  update_article: '更新笔记',
  read_article: '读取笔记',
  list_articles: '列出笔记',
  delete_article: '删除笔记',
  generate_image: '生成图片',
  generate_article_images: '批量生成配图',
  suggest_tags: '推荐标签',
  suggest_titles: '候选标题',
  outline_article: '生成大纲',
  cover_prompt: '封面 Prompt',
  content_image_prompt: '配图 Prompt',
  list_templates: '列出模板',
  apply_template: '按模板生成',
  search_articles: '搜索笔记',
  batch_score: '批量打分',
  batch_optimize: '批量优化',
  export_articles: '导出笔记',
  article_stats: '笔记统计',
  schedule_publish: '定时发布',
  crop_image: '裁剪图片',
  inpaint_image: '局部重绘',
  remove_object: '消除物体',
  edit_image: '编辑图片',
  remove_image: '删除图片',
}

export type ToolEvent = {
  type: 'tool_call' | 'tool_progress' | 'tool_result'
  name: string
  id?: string
  arguments?: any
  step?: string
  message?: string
  data?: any
  result?: any
  elapsed_ms?: number
  ok?: boolean
}

function formatElapsed(ms?: number) {
  if (!ms && ms !== 0) return ''
  const sec = ms / 1000
  if (sec < 60) return `${sec.toFixed(1)}s`
  return `${Math.floor(sec / 60)}m${Math.round(sec % 60)}s`
}

function deliveryLabel(attempt: any) {
  const delivery = String(attempt?.input_delivery || '')
  if (delivery === 'image_url') return '传URL'
  if (delivery === 'file_upload') return '传原图'
  if (delivery === 'image_url_then_file_upload') return 'URL失败→传原图'
  if (attempt?.provider_readable === false) return '传原图'
  if (attempt?.provider_readable === true) return '传URL'
  return ''
}

function toAbs(url: string) {
  if (!url) return url
  if (url.startsWith('http') || url.startsWith('data:')) return url
  return url // same-origin /static/images/... works via vite proxy
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

function articleIdFromProgress(progress: ToolEvent[] | undefined): number {
  for (const ev of [...(progress || [])].reverse()) {
    const data: any = ev.data || {}
    const candidates = [data.article_id, data.articleId, data.article?.id]
    for (const value of candidates) {
      const id = Number(value || 0)
      if (Number.isFinite(id) && id > 0) return id
    }
    const id = articleIdFromText(ev.message)
    if (id > 0) return id
  }
  return 0
}

function uniqImages(values: Array<string | undefined | null>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const u = String(raw || '').trim()
    if (!u || seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}

function collectToolImages(payload: any): string[] {
  if (!payload || payload.ok === false) return []
  const urls: Array<string | undefined | null> = []
  const push = (value: any) => {
    if (Array.isArray(value)) value.forEach(push)
    else if (typeof value === 'string') urls.push(value)
  }
  push(payload.image)
  push(payload.images)
  push(payload.generated_cover)
  push(payload.generated_content_images)
  push(payload.generated_visual_queue)
  push(payload.visual_queue)
  push(payload.workflow?.generated_cover)
  push(payload.workflow?.generated_content_images)
  push(payload.workflow?.generated_visual_queue)
  push(payload.workflow?.visual_queue)
  push(payload.article?.cover_image)
  push(payload.article?.images)
  return uniqImages(urls)
}

function bindingFromToolArgs(args: any): EditBinding | undefined {
  if (!args || typeof args !== 'object') return undefined
  const articleId = Number(args.article_id)
  const binding: EditBinding = {}
  if (Number.isFinite(articleId) && articleId > 0) binding.article_id = articleId
  if (args.role === 'cover' || args.role === 'content') binding.role = args.role
  if (args.replace_index !== undefined && args.replace_index !== null && args.replace_index !== '') {
    const idx = Number(args.replace_index)
    if (Number.isFinite(idx) && idx >= 0) binding.replace_index = idx
  }
  return Object.keys(binding).length ? binding : undefined
}

function scoreValue(score: Record<string, any> | undefined, key: string) {
  if (!score) return undefined
  const direct = Number(score[key])
  if (Number.isFinite(direct)) return Math.max(0, Math.min(100, Math.round(direct)))
  const dims = score.dimensions || score.model_a_score?.dimensions
  if (dims) {
    if (key === 'content') {
      const title = Number(dims.title_quality)
      const body = Number(dims.content_quality)
      if (Number.isFinite(title) && Number.isFinite(body)) return Math.round(title * 0.45 + body * 0.55)
    }
    const map: Record<string, string> = {
      visual: 'visual_quality',
      growth: 'tag_strategy',
      engagement: 'engagement_potential',
    }
    const mapped = Number(dims[map[key]])
    if (Number.isFinite(mapped)) return Math.max(0, Math.min(100, Math.round(mapped)))
  }
  if (key === 'overall') {
    const total = Number(score.total_score ?? score.overall_score ?? score.model_a_score?.total_score)
    if (Number.isFinite(total)) return Math.max(0, Math.min(100, Math.round(total)))
  }
  return undefined
}

function ToolCard({
  call,
  progress = [],
  result,
  onImageClick,
  onImageEdit,
}: {
  call?: ToolEvent
  progress?: ToolEvent[]
  result?: ToolEvent
  onImageClick?: (url: string) => void
  onImageEdit?: (url: string, binding?: EditBinding) => void
}) {
  const [open, setOpen] = useState(false)
  const [searchParams] = useSearchParams()
  const name = (call || result)?.name || ''
  const zh = toolNameZh[name] || name
  const running = !!call && !result
  const elapsedMs = result?.elapsed_ms ?? result?.result?.elapsed_ms
  const elapsedText = formatElapsed(elapsedMs)
  const ok = !result || result.result?.ok !== false
  const errorText: string | undefined = result?.result?.error
  const retryOptions: Array<{ label: string; reason?: string; arguments?: any }> = result?.result?.retry_options || []
  const imageAttempts: any[] = Array.isArray(result?.result?.image_attempts)
    ? result.result.image_attempts
    : Array.isArray(result?.result?.workflow?.image_attempts)
      ? result.result.workflow.image_attempts
      : []
  const images: string[] = collectToolImages(result?.result)
  const editBinding = bindingFromToolArgs(call?.arguments)
  const article = result?.result?.article
  const articleId = Number(
    article?.id ||
    result?.result?.article_id ||
    result?.result?.workflow?.article_id ||
    result?.result?.workflow?.article?.id ||
    call?.arguments?.article_id ||
    articleIdFromProgress(progress) ||
    0,
  )
  const titles: string[] | undefined = result?.result?.titles || result?.result?.workflow?.title_candidates
  const tags: string[] | undefined = result?.result?.tags
  const outline = result?.result?.outline
  const diagnostic = result?.result?.diagnostic
  const score = result?.result?.score
  const coverData = result?.result?.cover || result?.result?.workflow?.cover_prompt
  const storyboard =
    result?.result?.image_storyboard?.shots ||
    result?.result?.workflow?.image_storyboard?.shots ||
    result?.result?.workflow?.content_image_prompts ||
    result?.result?.shots

  const argJson = JSON.stringify(call?.arguments ?? {}, null, 2)
  const latestProgress = progress[progress.length - 1]

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: running ? 'warning.main' : ok ? 'divider' : 'error.main',
        bgcolor: running ? 'action.hover' : 'action.selected',
        borderRadius: 0,
        my: 1,
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 1.4, py: 0.8, cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}
      >
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: 0,
            bgcolor: running ? 'warning.main' : ok ? 'success.main' : 'error.main',
          }}
        />
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'text.primary' }}>
          {running ? `调用 ${zh}…` : `${zh} · ${ok ? '完成' : '失败'}${elapsedText ? ` · ${elapsedText}` : ''}`}
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', fontFamily: 'monospace' }}>
          {name}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <KeyboardArrowDownIcon
          sx={{
            fontSize: 18,
            color: 'text.disabled',
            transition: 'transform .2s',
            transform: open ? 'rotate(180deg)' : 'none',
          }}
        />
      </Stack>
      {latestProgress?.message && (
        <Box sx={{ px: 1.4, pb: 0.9, mt: -0.2 }}>
          <Stack direction="row" spacing={0.8} alignItems="center">
            {running && <CircularProgress size={10} sx={{ color: 'text.secondary' }} />}
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }} noWrap>
              {latestProgress.message}
            </Typography>
          </Stack>
        </Box>
      )}
      <Collapse in={open}>
        <Box sx={{ px: 1.4, pb: 1.4, borderTop: '1px solid', borderColor: 'divider', pt: 1 }}>
          {progress.length > 0 && (
            <Box
              sx={{
                mb: 1,
                p: 1,
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.paper',
              }}
            >
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.75 }}>
                执行过程
              </Typography>
              <Stack spacing={0.55}>
                {progress.slice(-12).map((p, idx) => (
                  <Stack key={`${p.id || p.name}-${p.step || 'step'}-${idx}`} direction="row" spacing={0.75} alignItems="flex-start">
                    <Box
                      sx={{
                        width: 6,
                        height: 6,
                        mt: 0.65,
                        flexShrink: 0,
                        bgcolor: idx === progress.slice(-12).length - 1 ? 'primary.main' : 'divider',
                      }}
                    />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography sx={{ fontSize: 12.2, color: 'text.primary', lineHeight: 1.45 }}>
                        {p.message || p.step || '处理中'}
                      </Typography>
                      {p.step && (
                        <Typography className="editorial-mono" sx={{ fontSize: 10.5, color: 'text.disabled' }}>
                          {p.step}
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                ))}
              </Stack>
            </Box>
          )}
          {errorText && (
            <Box
              sx={{
                fontSize: 13,
                color: 'error.main',
                bgcolor: 'rgba(220,38,38,0.08)',
                border: '1px solid rgba(220,38,38,0.2)',
                borderRadius: 1,
                p: 1,
                whiteSpace: 'pre-wrap',
                mb: 1,
              }}
            >
              {errorText}
            </Box>
          )}
          {retryOptions.length > 0 && (
            <Box sx={{ mb: 1 }}>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.6 }}>
                可选重试方案（不会自动降低画质）
              </Typography>
              <Stack direction="row" spacing={0.6} flexWrap="wrap" sx={{ gap: 0.6 }}>
                {retryOptions.map((opt, idx) => (
                  <Chip
                    key={idx}
                    size="small"
                    label={opt.label || `方案 ${idx + 1}`}
                    title={opt.reason || ''}
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(opt.arguments || {}, null, 2))
                      toast.success('已复制重试参数', { duration: 1200 })
                    }}
                    sx={{ cursor: 'pointer' }}
                  />
                ))}
              </Stack>
            </Box>
          )}
          {imageAttempts.length > 0 && (
            <Box
              sx={{
                mb: 1,
                p: 1,
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.paper',
              }}
            >
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.8 }}>
                图片模型重试链路
              </Typography>
              <Stack spacing={0.6}>
                {imageAttempts.map((a, idx) => (
                  <Stack key={`${a?.model || 'model'}-${idx}`} direction="row" spacing={0.6} alignItems="center" sx={{ minWidth: 0 }}>
                    <Chip
                      size="small"
                      label={a?.ok || a?.status === 'success' ? '成功' : '失败'}
                      color={a?.ok || a?.status === 'success' ? 'success' : 'error'}
                      sx={{ height: 20, fontSize: 10.5 }}
                    />
                    <Typography sx={{ fontSize: 12, fontWeight: 700, minWidth: 0 }} noWrap>
                      {idx + 1}. {a?.model || '-'}
                    </Typography>
                    {a?.method && <Chip size="small" label={a.method} sx={{ height: 20, fontSize: 10.5 }} />}
                    {deliveryLabel(a) && <Chip size="small" label={deliveryLabel(a)} variant="outlined" sx={{ height: 20, fontSize: 10.5 }} />}
                    {a?.supports_image_url === false && <Chip size="small" label="URL关闭" variant="outlined" sx={{ height: 20, fontSize: 10.5 }} />}
                    {a?.supports_quality === false && <Chip size="small" label="无quality" variant="outlined" sx={{ height: 20, fontSize: 10.5 }} />}
                    {a?.timeout_budget_sec && <Chip size="small" label={`预算${Math.round(Number(a.timeout_budget_sec) / 60)}min`} variant="outlined" sx={{ height: 20, fontSize: 10.5 }} />}
                    <Typography sx={{ fontSize: 11.5, color: 'text.secondary', ml: 'auto', whiteSpace: 'nowrap' }}>
                      {formatElapsed(a?.elapsed_ms)}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Box>
          )}
          {argJson !== '{}' && (
            <Box
              sx={{
                fontFamily: 'ui-monospace, Menlo, monospace',
                fontSize: 12,
                color: 'text.primary',
                bgcolor: 'background.paper',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 1,
                whiteSpace: 'pre-wrap',
                mb: result ? 1 : 0,
              }}
            >
              {argJson}
            </Box>
          )}
          {result?.result && (
            <Box
              sx={{
                fontFamily: 'ui-monospace, Menlo, monospace',
                fontSize: 12,
                color: 'text.secondary',
                bgcolor: 'background.paper',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 1,
                maxHeight: 240,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {JSON.stringify(result.result, null, 2)}
            </Box>
          )}
        </Box>
      </Collapse>

      {/* Rich previews below the card */}
      {images.length > 0 && (
        <Box sx={{ px: 1.4, pb: 1.4, pt: 0.2 }}>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            {images.map((u, i) => (
              <Box
                key={`${u}-${i}`}
                sx={{
                  width: 180,
                  position: 'relative',
                  borderRadius: 0,
                  overflow: 'hidden',
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                }}
              >
                <Box
                  component="img"
                  src={toAbs(u)}
                  onClick={() => onImageClick?.(toAbs(u))}
                  sx={{
                    width: '100%',
                    maxHeight: 220,
                    display: 'block',
                    objectFit: 'cover',
                    cursor: 'zoom-in',
                    '&:hover': { opacity: 0.9 },
                  }}
                />
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{
                    position: 'absolute',
                    left: 6,
                    right: 6,
                    bottom: 6,
                    justifyContent: 'space-between',
                  }}
                >
                  <Chip
                    size="small"
                    label={i === 0 && name !== 'generate_image' ? '结果图' : `图片 ${i + 1}`}
                    sx={{
                      height: 22,
                      fontSize: 11,
                      bgcolor: 'text.primary',
                      color: 'background.paper',
                      pointerEvents: 'none',
                    }}
                  />
                  <Chip
                    size="small"
                    icon={<AutoFixHighIcon sx={{ fontSize: '14px !important', color: 'var(--paper) !important' }} />}
                    label="继续编辑"
                    onClick={(e) => {
                      e.stopPropagation()
                      onImageEdit?.(u, editBinding)
                    }}
                    sx={{
                      height: 22,
                      fontSize: 11,
                      bgcolor: 'primary.main',
                      color: 'background.paper',
                      cursor: 'pointer',
                      pointerEvents: 'auto',
                      '&:hover': { bgcolor: 'primary.dark' },
                    }}
                  />
                </Stack>
              </Box>
            ))}
          </Stack>
        </Box>
      )}

      {(article || articleId > 0) && (
        <Box
          sx={{
            px: 1.4,
            pb: 1.4,
            pt: 0.2,
          }}
        >
          <Box
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              borderRadius: 0,
              p: 1.2,
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>笔记 #{article?.id || articleId}</Typography>
              {article?.status && <Chip size="small" label={article.status} sx={{ bgcolor: 'action.hover', fontSize: 11 }} />}
            </Stack>
            <Typography sx={{ fontWeight: 700, fontSize: 16, mb: 0.6 }}>
              {article?.title || '笔记已生成/更新'}
            </Typography>
            {article?.body && (
              <Typography
                sx={{
                  fontSize: 13.5,
                  color: 'text.primary',
                  whiteSpace: 'pre-wrap',
                  maxHeight: 220,
                  overflow: 'auto',
                  lineHeight: 1.7,
                }}
              >
                {article.body}
              </Typography>
            )}
            {Array.isArray(article?.tags) && article.tags.length > 0 && (
              <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
                {article.tags.map((t: string) => (
                  <Chip key={t} label={`#${String(t).replace(/^[#＃]+/, '')}`} size="small" sx={{ bgcolor: 'action.hover', fontSize: 11 }} />
                ))}
              </Stack>
            )}
            <Stack direction="row" sx={{ mt: 1 }} spacing={1}>
              <Chip
                size="small"
                label="打开编辑"
                component="a"
                clickable
                href={`/articles/${article?.id || articleId}${searchParams.get('c') ? `?c=${searchParams.get('c')}&chat=1&from=agent` : '?chat=1&from=agent'}`}
                sx={{ bgcolor: 'text.primary', color: 'background.paper', '&:hover': { bgcolor: 'text.primary' } }}
              />
              {article && (
                <IconButton
                  size="small"
                  onClick={() => navigator.clipboard.writeText(`${article.title}\n\n${article.body}`)}
                  title="复制正文"
                >
                  <ContentCopyIcon sx={{ fontSize: 16 }} />
                </IconButton>
              )}
            </Stack>
          </Box>
        </Box>
      )}

      {titles && titles.length > 0 && (
        <Box sx={{ px: 1.4, pb: 1.4 }}>
          <Stack spacing={0.6}>
            {titles.map((t, i) => (
              <Box
                key={i}
                sx={{
                  px: 1.2,
                  py: 0.8,
                  bgcolor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1.5,
                  fontSize: 14,
                  cursor: 'pointer',
                  '&:hover': { borderColor: 'text.secondary' },
                }}
                onClick={() => navigator.clipboard.writeText(t)}
              >
                {t}
              </Box>
            ))}
          </Stack>
        </Box>
      )}

      {tags && tags.length > 0 && !article && (
        <Box sx={{ px: 1.4, pb: 1.4 }}>
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
            {tags.map(t => (
              <Chip key={t} label={`#${String(t).replace(/^[#＃]+/, '')}`} size="small" sx={{ bgcolor: 'action.hover' }} />
            ))}
          </Stack>
        </Box>
      )}

      {outline && (
        <Box sx={{ px: 1.4, pb: 1.4 }}>
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 0, p: 1.2, bgcolor: 'background.paper' }}>
            {outline.hook && (
              <>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>钩子</Typography>
                <Typography sx={{ fontSize: 14, mb: 0.8 }}>{outline.hook}</Typography>
              </>
            )}
            {Array.isArray(outline.sections) && outline.sections.map((s: any, i: number) => (
              <Box key={i} sx={{ mb: 0.8 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
                  {i + 1}. {s.title}
                </Typography>
                {Array.isArray(s.points) &&
                  s.points.map((p: string, j: number) => (
                    <Typography key={j} sx={{ fontSize: 13, color: 'text.secondary', ml: 1.5 }}>
                      · {p}
                    </Typography>
                  ))}
              </Box>
            ))}
            {outline.cta && (
              <>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.6 }}>CTA</Typography>
                <Typography sx={{ fontSize: 14 }}>{outline.cta}</Typography>
              </>
            )}
          </Box>
        </Box>
      )}

      {diagnostic && (
        <Box sx={{ px: 1.4, pb: 1.4 }}>
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 0, p: 1.2, bgcolor: 'background.paper' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 0.5 }}>
              {diagnostic.publish_ready ? 'READY · 可发布' : 'CHECK · 建议修改再发'}
            </Typography>
            {['risks', 'missing', 'suggestions'].map(k =>
              Array.isArray(diagnostic[k]) && diagnostic[k].length > 0 ? (
                <Box key={k} sx={{ mt: 0.6 }}>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {k === 'risks' ? '风险' : k === 'missing' ? '缺失' : '建议'}
                  </Typography>
                  {diagnostic[k].map((x: string, i: number) => (
                    <Typography key={i} sx={{ fontSize: 13, color: 'text.primary' }}>
                      · {x}
                    </Typography>
                  ))}
                </Box>
              ) : null
            )}
          </Box>
        </Box>
      )}

      {score && (
        <Box sx={{ px: 1.4, pb: 1.4 }}>
          <Stack direction="row" spacing={0.8} sx={{ flexWrap: 'wrap', gap: 0.8 }}>
            {['content', 'visual', 'growth', 'engagement', 'overall'].map(k => {
              const v = scoreValue(score, k)
              return typeof v === 'number' ? (
                <Chip
                  key={k}
                  size="small"
                  label={`${k} ${v}`}
                  sx={{ bgcolor: 'action.hover', fontFamily: 'monospace' }}
                />
              ) : null
            })}
          </Stack>
        </Box>
      )}

      {coverData?.prompt && (
        <Box sx={{ px: 1.4, pb: 1.4 }}>
          <Box
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 0,
              p: 1.2,
              bgcolor: 'background.paper',
              fontSize: 13,
            }}
          >
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              size: {coverData.size || '1152x1536'}
            </Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap', mt: 0.5 }}>{coverData.prompt}</Typography>
          </Box>
        </Box>
      )}

      {Array.isArray(storyboard) && storyboard.length > 0 && (
        <Box sx={{ px: 1.4, pb: 1.4 }}>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.7 }}>
            图文分镜 / 图片大纲
          </Typography>
          <Stack spacing={0.7}>
            {storyboard.slice(0, 6).map((shot: any, i: number) => (
              <Box
                key={`${shot.scene || 'shot'}-${i}`}
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1.5,
                  bgcolor: 'background.paper',
                  p: 1,
                }}
              >
                <Stack direction="row" spacing={0.6} alignItems="center" sx={{ mb: 0.4 }}>
                  <Chip size="small" label={shot.role || `第 ${i + 1} 张`} sx={{ height: 18, fontSize: 10 }} />
                  <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 700, minWidth: 0 }}>
                    {shot.scene || `配图 ${i + 1}`}
                  </Typography>
                  {shot.size && <Typography sx={{ fontSize: 11, color: 'text.secondary', ml: 'auto' }}>{shot.size}</Typography>}
                </Stack>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.55 }} noWrap>
                  {shot.prompt}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      )}
    </Box>
  )
}

function pairToolEvents(events: ToolEvent[]): Array<{ call?: ToolEvent; progress?: ToolEvent[]; result?: ToolEvent }> {
  const out: Array<{ call?: ToolEvent; progress?: ToolEvent[]; result?: ToolEvent }> = []
  const openCalls: Array<{ call: ToolEvent; idx: number }> = []
  for (const ev of events) {
    if (ev.type === 'tool_call') {
      out.push({ call: ev, progress: [] })
      openCalls.push({ call: ev, idx: out.length - 1 })
    } else if (ev.type === 'tool_progress') {
      const matchIdx = openCalls.findIndex(oc => (
        ev.id && oc.call.id ? oc.call.id === ev.id : oc.call.name === ev.name
      ))
      if (matchIdx !== -1) {
        const { idx } = openCalls[matchIdx]
        out[idx] = { ...out[idx], progress: [...(out[idx].progress || []), ev] }
      } else {
        out.push({ progress: [ev] })
      }
    } else if (ev.type === 'tool_result') {
      const matchIdx = openCalls.findIndex(oc => (
        ev.id && oc.call.id ? oc.call.id === ev.id : oc.call.name === ev.name
      ))
      if (matchIdx !== -1) {
        const { idx } = openCalls[matchIdx]
        out[idx] = { ...out[idx], result: ev }
        openCalls.splice(matchIdx, 1)
      } else {
        out.push({ result: ev })
      }
    }
  }
  return out
}

export default function MessageBubble({
  msg,
  streaming = false,
}: {
  msg: ChatMessage & { tool_events?: ToolEvent[] }
  streaming?: boolean
}) {
  const isUser = msg.role === 'user'
  const pairs = pairToolEvents((msg.tool_events as ToolEvent[]) || [])
  const [previewImg, setPreviewImg] = useState<string | null>(null)
  const [editorImg, setEditorImg] = useState<string | null>(null)
  const [editorBinding, setEditorBinding] = useState<EditBinding | undefined>(undefined)
  const [localEditedImages, setLocalEditedImages] = useState<Array<{ url: string; binding?: EditBinding }>>([])

  function openEditor(url: string, binding?: EditBinding) {
    setPreviewImg(null)
    setEditorImg(url)
    setEditorBinding(binding)
  }

  return (
    <Box sx={{ py: 1.5 }}>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: isUser ? '50%' : 0,
            flexShrink: 0,
            bgcolor: isUser ? 'text.primary' : 'background.paper',
            border: isUser ? 0 : '1px solid',
            borderColor: 'text.primary',
            color: isUser ? 'background.paper' : 'primary.main',
            display: 'grid',
            placeItems: 'center',
            fontSize: 12,
            fontWeight: 700,
            fontFamily: isUser ? 'var(--serif)' : 'var(--mono)',
          }}
        >
          {isUser ? '我' : 'A'}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'text.secondary', mb: 0.6 }}>
            {isUser ? '你' : '小红书助手'}
          </Typography>

          {msg.images && msg.images.length > 0 && (
            <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', gap: 1 }}>
              {msg.images.map((u, i) => (
                <Box
                  key={i}
                  component="img"
                  src={toAbs(u)}
                  onClick={() => setPreviewImg(toAbs(u))}
                  sx={{
                    maxWidth: 220,
                    maxHeight: 180,
                    borderRadius: 0,
                    border: '1px solid',
                    borderColor: 'divider',
                    objectFit: 'cover',
                    cursor: 'pointer',
                    '&:hover': { opacity: 0.85 },
                  }}
                />
              ))}
            </Stack>
          )}

          {pairs.map((p, i) => (
          <ToolCard
              key={i}
              call={p.call}
              progress={p.progress}
              result={p.result}
              onImageClick={setPreviewImg}
              onImageEdit={openEditor}
            />
          ))}

          {localEditedImages.length > 0 && (
            <Box sx={{ my: 1 }}>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.7 }}>
                继续编辑产生的新图
              </Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                {localEditedImages.map((item, i) => (
                  <Box
                    key={`${item.url}-${i}`}
                    sx={{
                      width: 180,
                      position: 'relative',
                      borderRadius: 0,
                      overflow: 'hidden',
                      border: '1px solid',
                      borderColor: 'divider',
                      bgcolor: 'background.paper',
                    }}
                  >
                    <Box
                      component="img"
                      src={toAbs(item.url)}
                      onClick={() => setPreviewImg(toAbs(item.url))}
                      sx={{ width: '100%', maxHeight: 220, display: 'block', objectFit: 'cover', cursor: 'zoom-in' }}
                    />
                    <Chip
                      size="small"
                      icon={<AutoFixHighIcon sx={{ fontSize: '14px !important', color: 'var(--paper) !important' }} />}
                      label="继续编辑"
                      onClick={(e) => {
                        e.stopPropagation()
                        openEditor(item.url, item.binding)
                      }}
                      sx={{
                        position: 'absolute',
                        right: 6,
                        bottom: 6,
                        height: 22,
                        fontSize: 11,
                        bgcolor: 'primary.main',
                        color: 'background.paper',
                        cursor: 'pointer',
                        '&:hover': { bgcolor: 'primary.dark' },
                      }}
                    />
                  </Box>
                ))}
              </Stack>
            </Box>
          )}

          {msg.content ? (
            isUser ? (
              <Typography
                sx={{
                  whiteSpace: 'pre-wrap',
                  fontSize: 15,
                  lineHeight: 1.75,
                  color: 'text.primary',
                }}
              >
                {msg.content}
              </Typography>
            ) : (
              <Markdown text={msg.content} onImageClick={setPreviewImg} />
            )
          ) : null}

          {!isUser && msg.content && !streaming && (
            <Tooltip title="复制内容">
              <IconButton
                size="small"
                onClick={() => {
                  navigator.clipboard.writeText(msg.content || '')
                  toast.success('已复制', { duration: 1200 })
                }}
                sx={{ mt: 0.5, color: '#B8B4AB', '&:hover': { color: 'text.primary' } }}
              >
                <ContentCopyIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      <Dialog
        open={!!previewImg}
        onClose={() => setPreviewImg(null)}
        maxWidth={false}
        PaperProps={{
          sx: { bgcolor: 'rgba(0,0,0,0.92)', boxShadow: 'none', m: 0, maxWidth: '100vw', maxHeight: '100vh' },
        }}
      >
        <IconButton
          onClick={() => setPreviewImg(null)}
          sx={{ position: 'absolute', top: 8, right: 8, color: 'background.paper', zIndex: 1 }}
        >
          <CloseIcon />
        </IconButton>
        {previewImg && (
          <Chip
            icon={<AutoFixHighIcon sx={{ color: 'var(--paper) !important' }} />}
            label="编辑这张图"
            onClick={() => openEditor(previewImg)}
            sx={{
              position: 'absolute',
              top: 12,
              left: 12,
              zIndex: 1,
              bgcolor: 'primary.main',
              color: 'background.paper',
              fontWeight: 700,
              '&:hover': { bgcolor: 'primary.dark' },
            }}
          />
        )}
        {previewImg && (
          <Box
            component="img"
            src={previewImg}
            sx={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', display: 'block', m: 'auto' }}
          />
        )}
      </Dialog>
      <ImageEditor
        open={!!editorImg}
        src={editorImg}
        binding={editorBinding}
        defaultMode="variation"
        onClose={() => setEditorImg(null)}
        onDone={(newUrl) => {
          setLocalEditedImages(prev => [
            { url: newUrl, binding: editorBinding },
            ...prev.filter(item => item.url !== newUrl),
          ])
          setPreviewImg(toAbs(newUrl))
          toast.success('图片编辑完成，已展示在当前聊天里')
        }}
      />
    </Box>
  )
}
