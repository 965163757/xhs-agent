import { Box, Chip, Collapse, Dialog, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import Markdown from './Markdown'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { ChatMessage } from '../api/client'

const toolNameZh: Record<string, string> = {
  generate_article: '生成笔记',
  rewrite_article: '改写笔记',
  optimize_article: '优化笔记',
  polish_paragraph: '段落润色',
  score_article: '笔记打分',
  diagnose_article: '发布前诊断',
  create_article: '创建笔记',
  update_article: '更新笔记',
  read_article: '读取笔记',
  list_articles: '列出笔记',
  delete_article: '删除笔记',
  generate_image: '生成配图',
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
  type: 'tool_call' | 'tool_result'
  name: string
  arguments?: any
  result?: any
}

function toAbs(url: string) {
  if (!url) return url
  if (url.startsWith('http') || url.startsWith('data:')) return url
  return url // same-origin /static/images/... works via vite proxy
}

function ToolCard({
  call,
  result,
  onImageClick,
}: {
  call?: ToolEvent
  result?: ToolEvent
  onImageClick?: (url: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [searchParams] = useSearchParams()
  const name = (call || result)?.name || ''
  const zh = toolNameZh[name] || name
  const running = !!call && !result
  const images: string[] =
    (result?.result?.images as string[]) ||
    (result?.result?.article?.images as string[]) ||
    []
  const cover: string | undefined =
    result?.result?.article?.cover_image || undefined
  const article = result?.result?.article
  const titles: string[] | undefined = result?.result?.titles
  const tags: string[] | undefined = result?.result?.tags
  const outline = result?.result?.outline
  const diagnostic = result?.result?.diagnostic
  const score = result?.result?.score
  const coverData = result?.result?.cover

  const argJson = JSON.stringify(call?.arguments ?? {}, null, 2)

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: running ? 'warning.main' : 'divider',
        bgcolor: running ? 'action.hover' : 'action.selected',
        borderRadius: 2,
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
            borderRadius: '50%',
            bgcolor: running ? '#F59E0B' : '#16A34A',
          }}
        />
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'text.primary' }}>
          {running ? `调用 ${zh}…` : `${zh} · 完成`}
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
      <Collapse in={open}>
        <Box sx={{ px: 1.4, pb: 1.4, borderTop: '1px solid', borderColor: 'divider', pt: 1 }}>
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
      {(cover || images.length > 0) && (
        <Box sx={{ px: 1.4, pb: 1.4, pt: 0.2 }}>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            {cover && (
              <Box
                component="img"
                src={toAbs(cover)}
                onClick={() => onImageClick?.(toAbs(cover))}
                sx={{
                  width: 180,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  objectFit: 'cover',
                  cursor: 'pointer',
                  '&:hover': { opacity: 0.85 },
                }}
              />
            )}
            {images.map((u, i) => (
              <Box
                key={i}
                component="img"
                src={toAbs(u)}
                onClick={() => onImageClick?.(toAbs(u))}
                sx={{
                  width: 180,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  objectFit: 'cover',
                  cursor: 'pointer',
                  '&:hover': { opacity: 0.85 },
                }}
              />
            ))}
          </Stack>
        </Box>
      )}

      {article && (
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
              borderRadius: 2,
              p: 1.2,
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>笔记 #{article.id}</Typography>
              <Chip size="small" label={article.status} sx={{ bgcolor: 'action.hover', fontSize: 11 }} />
            </Stack>
            <Typography sx={{ fontWeight: 700, fontSize: 16, mb: 0.6 }}>
              {article.title || '（无标题）'}
            </Typography>
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
            {Array.isArray(article.tags) && article.tags.length > 0 && (
              <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
                {article.tags.map((t: string) => (
                  <Chip key={t} label={t} size="small" sx={{ bgcolor: 'action.hover', fontSize: 11 }} />
                ))}
              </Stack>
            )}
            <Stack direction="row" sx={{ mt: 1 }} spacing={1}>
              <Chip
                size="small"
                label="打开编辑"
                component="a"
                clickable
                href={`/articles/${article.id}${searchParams.get('c') ? `?c=${searchParams.get('c')}` : ''}`}
                sx={{ bgcolor: 'text.primary', color: '#fff', '&:hover': { bgcolor: 'text.primary' } }}
              />
              <IconButton
                size="small"
                onClick={() => navigator.clipboard.writeText(`${article.title}\n\n${article.body}`)}
                title="复制正文"
              >
                <ContentCopyIcon sx={{ fontSize: 16 }} />
              </IconButton>
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
              <Chip key={t} label={t} size="small" sx={{ bgcolor: 'action.hover' }} />
            ))}
          </Stack>
        </Box>
      )}

      {outline && (
        <Box sx={{ px: 1.4, pb: 1.4 }}>
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.2, bgcolor: 'background.paper' }}>
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
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.2, bgcolor: 'background.paper' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 0.5 }}>
              {diagnostic.publish_ready ? '✅ 可发布' : '⚠️ 建议修改再发'}
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
            {['content', 'visual', 'growth', 'engagement', 'overall'].map(k =>
              typeof score[k] === 'number' ? (
                <Chip
                  key={k}
                  size="small"
                  label={`${k} ${score[k]}`}
                  sx={{ bgcolor: 'action.hover', fontFamily: 'monospace' }}
                />
              ) : null
            )}
          </Stack>
        </Box>
      )}

      {coverData?.prompt && (
        <Box sx={{ px: 1.4, pb: 1.4 }}>
          <Box
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              p: 1.2,
              bgcolor: 'background.paper',
              fontSize: 13,
            }}
          >
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              size: {coverData.size || '1024x1536'}
            </Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap', mt: 0.5 }}>{coverData.prompt}</Typography>
          </Box>
        </Box>
      )}
    </Box>
  )
}

function pairToolEvents(events: ToolEvent[]): Array<{ call?: ToolEvent; result?: ToolEvent }> {
  const out: Array<{ call?: ToolEvent; result?: ToolEvent }> = []
  const openCalls: Array<{ call: ToolEvent; idx: number }> = []
  for (const ev of events) {
    if (ev.type === 'tool_call') {
      out.push({ call: ev })
      openCalls.push({ call: ev, idx: out.length - 1 })
    } else if (ev.type === 'tool_result') {
      const matchIdx = openCalls.findIndex(oc => oc.call.name === ev.name)
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
}: {
  msg: ChatMessage & { tool_events?: ToolEvent[] }
}) {
  const isUser = msg.role === 'user'
  const pairs = pairToolEvents((msg.tool_events as ToolEvent[]) || [])
  const [previewImg, setPreviewImg] = useState<string | null>(null)

  return (
    <Box sx={{ py: 1.5 }}>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            flexShrink: 0,
            bgcolor: isUser ? 'action.hover' : 'transparent',
            background: isUser ? undefined : 'linear-gradient(135deg,#ef4444,#f97316)',
            color: isUser ? 'text.primary' : '#fff',
            display: 'grid',
            placeItems: 'center',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {isUser ? '我' : '红'}
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
                    borderRadius: 2,
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
            <ToolCard key={i} call={p.call} result={p.result} onImageClick={setPreviewImg} />
          ))}

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

          {!isUser && msg.content && (
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
          sx={{ position: 'absolute', top: 8, right: 8, color: '#fff', zIndex: 1 }}
        >
          <CloseIcon />
        </IconButton>
        {previewImg && (
          <Box
            component="img"
            src={previewImg}
            sx={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', display: 'block', m: 'auto' }}
          />
        )}
      </Dialog>
    </Box>
  )
}
