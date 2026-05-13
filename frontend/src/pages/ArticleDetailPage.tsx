import { type DragEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import MenuIcon from '@mui/icons-material/Menu'
import AddIcon from '@mui/icons-material/Add'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import {
  getArticle,
  updateArticle,
  listConversations,
  deleteConversation,
  deleteConversations,
  listVersions,
  rollbackVersion,
  checkBannedWords,
  extractTemplate,
  arrangeArticleImages,
  type Article,
  type ArticleVersion,
  type BannedWordHit,
  type Conversation,
} from '../api/client'
import { toast } from 'sonner'
import ChatPanel from '../components/ChatPanel'
import ConfirmDialog from '../components/ConfirmDialog'
import ImageEditor from '../components/ImageEditor'
import PhonePreview from '../components/PhonePreview'
import TagInput from '../components/TagInput'
import { getSession, loadFromConversation, migrateSession, reconnectTask, resetSession, sessionKeyFor } from '../chatStore'

function ImageFrame({
  src,
  aspect,
  placeholder,
  onEdit,
  onRemove,
  onOpen,
  label,
  draggable,
  dragging,
  onDragStart,
  onDragOver,
  onDrop,
  onSetCover,
  onMovePrev,
  onMoveNext,
}: {
  src?: string
  aspect: string
  placeholder: string
  onEdit?: () => void
  onRemove?: () => void
  onOpen?: () => void
  label?: string
  draggable?: boolean
  dragging?: boolean
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void
  onDrop?: (e: DragEvent<HTMLDivElement>) => void
  onSetCover?: () => void
  onMovePrev?: () => void
  onMoveNext?: () => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        aspectRatio: aspect,
        borderRadius: 2,
        overflow: 'hidden',
        border: '1px solid',
        borderColor: dragging ? '#FF2741' : 'divider',
        bgcolor: 'background.default',
        opacity: dragging ? 0.55 : 1,
        cursor: draggable ? 'grab' : 'default',
        '&:hover .img-toolbar': { opacity: 1 },
      }}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {src ? (
        <Box
          component="img"
          src={src}
          onClick={onOpen}
          sx={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            cursor: onOpen ? 'zoom-in' : 'default',
          }}
        />
      ) : (
        <Box
          sx={{
            width: '100%',
            height: '100%',
            display: 'grid',
            placeItems: 'center',
            color: '#B8B4AB',
            fontSize: 12,
          }}
        >
          {placeholder}
        </Box>
      )}

      {label && (
        <Chip
          size="small"
          label={label}
          sx={{
            position: 'absolute',
            top: 6,
            left: 6,
            bgcolor: 'rgba(15,23,42,0.72)',
            color: '#fff',
            fontSize: 10,
            height: 18,
            '& .MuiChip-label': { px: 0.8 },
          }}
        />
      )}

      {src && (
        <Box
          className="img-toolbar"
          sx={{
            position: 'absolute',
            top: 6,
            right: 6,
            opacity: 0,
            transition: 'opacity .15s',
            display: 'flex',
            gap: 0.4,
          }}
        >
          {onEdit && (
            <Tooltip title="编辑图片">
              <IconButton
                size="small"
                onClick={onEdit}
                sx={{
                  bgcolor: '#FF2741',
                  color: '#fff',
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  '&:hover': { bgcolor: '#D61030' },
                }}
              >
                <AutoFixHighIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          )}
          <IconButton
            size="small"
            onClick={e => setAnchor(e.currentTarget)}
            sx={{
              bgcolor: 'rgba(31,31,31,0.85)',
              color: '#fff',
              width: 28,
              height: 28,
              borderRadius: '50%',
              '&:hover': { bgcolor: 'text.primary' },
            }}
          >
            <MoreVertIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Box>
      )}
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {onOpen && src && (
          <MenuItem onClick={() => { onOpen(); setAnchor(null) }}>
            <OpenInNewIcon fontSize="small" sx={{ mr: 1 }} />
            查看大图
          </MenuItem>
        )}
        {onEdit && src && (
          <MenuItem onClick={() => { onEdit(); setAnchor(null) }}>
            <AutoFixHighIcon fontSize="small" sx={{ mr: 1 }} />
            编辑图片
          </MenuItem>
        )}
        {onSetCover && src && (
          <MenuItem onClick={() => { onSetCover(); setAnchor(null) }}>
            设为首图/封面
          </MenuItem>
        )}
        {onMovePrev && src && (
          <MenuItem onClick={() => { onMovePrev(); setAnchor(null) }}>
            前移一位
          </MenuItem>
        )}
        {onMoveNext && src && (
          <MenuItem onClick={() => { onMoveNext(); setAnchor(null) }}>
            后移一位
          </MenuItem>
        )}
        {onRemove && src && (
          <MenuItem onClick={() => { onRemove(); setAnchor(null) }} sx={{ color: '#D61030' }}>
            <DeleteOutlineIcon fontSize="small" sx={{ mr: 1 }} />
            删除
          </MenuItem>
        )}
      </Menu>
    </Box>
  )
}

function ScoreRadar({ score }: { score: Record<string, any> }) {
  const metrics = [
    ['content', '内容'],
    ['visual', '视觉'],
    ['growth', '增长'],
    ['engagement', '互动'],
    ['overall', '综合'],
  ] as const
  const cx = 120
  const cy = 110
  const r = 78
  const n = metrics.length

  const point = (i: number, value = 1) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2
    return [cx + r * value * Math.cos(angle), cy + r * value * Math.sin(angle)]
  }
  const polygon = (pts: number[][]) => pts.map(p => p.join(',')).join(' ')
  const values = metrics.map(([key]) => Math.max(0, Math.min(100, Number(score?.[key] ?? 0))) / 100)
  const dataPoints = values.map((v, i) => point(i, v))

  return (
    <Box sx={{ height: 220, display: 'grid', placeItems: 'center' }}>
      <svg width="260" height="220" viewBox="0 0 260 220">
        {[0.25, 0.5, 0.75, 1].map(scale => (
          <polygon key={scale} points={polygon(metrics.map((_, i) => point(i, scale)))} fill="none" stroke="#EEE9E1" strokeWidth="1" />
        ))}
        {metrics.map((_, i) => {
          const p = point(i)
          return <line key={i} x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke="#EEE9E1" strokeWidth="1" />
        })}
        <polygon points={polygon(dataPoints)} fill="rgba(255,39,65,0.13)" stroke="#FF2741" strokeWidth="2.2" />
        {dataPoints.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="#FF2741" />
        ))}
        {metrics.map(([, label], i) => {
          const p = point(i, 1.18)
          return (
            <text key={label} x={p[0]} y={p[1]} textAnchor="middle" dominantBaseline="middle" fontSize="12" fill="#8C8C8C" fontWeight="600">
              {label}
            </text>
          )
        })}
      </svg>
    </Box>
  )
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

export default function ArticleDetailPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const convId = params.get('c')
  const [art, setArt] = useState<Article | null>(null)
  const [savedArt, setSavedArt] = useState<Article | null>(null)
  const [saving, setSaving] = useState(false)
  const [imageLightbox, setImageLightbox] = useState<string | null>(null)
  const [editorSrc, setEditorSrc] = useState<string | null>(null)
  const [editorBinding, setEditorBinding] = useState<{
    article_id?: number
    role?: 'cover' | 'content'
    replace_index?: number
  }>({})
  const [editorDefaultMode, setEditorDefaultMode] = useState<
    'crop' | 'inpaint' | 'erase' | 'variation'
  >('inpaint')
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sidebar, setSidebar] = useState(false)
  const [mobileChat, setMobileChat] = useState(false)
  const [convos, setConvos] = useState<Conversation[]>([])
  const [versions, setVersions] = useState<ArticleVersion[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [bannedHits, setBannedHits] = useState<BannedWordHit[]>([])
  const bannedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentSessionKey = convId ? `conv:${convId}` : sessionKeyFor(id ? Number(id) : null)
  const [deleteConvoId, setDeleteConvoId] = useState<number | null>(null)
  const [selectedConvoIds, setSelectedConvoIds] = useState<number[]>([])
  const [batchDeleteIds, setBatchDeleteIds] = useState<number[] | null>(null)
  const [rollbackTarget, setRollbackTarget] = useState<number | null>(null)
  const [dragImagePos, setDragImagePos] = useState<number | null>(null)
  const selectedCount = selectedConvoIds.length
  const allSelected = convos.length > 0 && selectedCount === convos.length

  const refreshConvos = useCallback(() => {
    listConversations().then(all => {
      const scoped = all.filter(c => c.article_id === Number(id))
      setConvos(scoped)
      setSelectedConvoIds(prev => prev.filter(cid => scoped.some(c => c.id === cid)))
    }).catch(() => {
      setConvos([])
      setSelectedConvoIds([])
    })
  }, [id])

  const newChat = () => {
    resetSession(currentSessionKey)
    setParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('c')
      return next
    }, { replace: true })
  }

  const removeConvo = async (cid: number) => {
    setDeleteConvoId(cid)
  }

  const confirmRemoveConvo = async () => {
    if (deleteConvoId === null) return
    await deleteConversation(deleteConvoId)
    if (convId === String(deleteConvoId)) newChat()
    refreshConvos()
    setDeleteConvoId(null)
    setSelectedConvoIds(prev => prev.filter(id => id !== deleteConvoId))
  }

  const toggleConvoSelection = (cid: number) => {
    setSelectedConvoIds(prev => (
      prev.includes(cid) ? prev.filter(x => x !== cid) : [...prev, cid]
    ))
  }

  const toggleSelectAllConvos = () => {
    setSelectedConvoIds(allSelected ? [] : convos.map(c => c.id))
  }

  const confirmBatchRemoveConvos = async () => {
    const ids = batchDeleteIds || []
    if (!ids.length) return
    await deleteConversations(ids)
    if (convId && ids.includes(Number(convId))) newChat()
    setSelectedConvoIds([])
    setBatchDeleteIds(null)
    refreshConvos()
  }

  const refreshVersions = useCallback(() => {
    if (!id) return
    listVersions(Number(id)).then(setVersions).catch(() => setVersions([]))
  }, [id])

  const handleRollback = async (vid: number) => {
    setRollbackTarget(vid)
  }

  const confirmRollback = async () => {
    if (rollbackTarget === null) return
    const a = await rollbackVersion(Number(id), rollbackTarget)
    setArt(a)
    setSavedArt(a)
    toast.success('已回滚')
    setRollbackTarget(null)
  }

  const load = useCallback(async () => {
    const a = await getArticle(Number(id))
    setArt(a)
    setSavedArt(a)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  // Real-time banned word detection (debounced)
  useEffect(() => {
    if (!art) return
    if (bannedTimerRef.current) clearTimeout(bannedTimerRef.current)
    bannedTimerRef.current = setTimeout(() => {
      const text = `${art.title} ${art.body}`
      if (text.trim().length > 2) {
        checkBannedWords(text).then(r => setBannedHits(r.hits)).catch(() => {})
      } else {
        setBannedHits([])
      }
    }, 800)
    return () => { if (bannedTimerRef.current) clearTimeout(bannedTimerRef.current) }
  }, [art?.title, art?.body])

  // Hydrate chat from backend when page loads with ?c= (refresh or navigation)
  useEffect(() => {
    if (convId) {
      const current = getSession(currentSessionKey)
      if (current.streaming) return
      loadFromConversation(Number(convId), currentSessionKey).then((activeTaskId) => {
        if (activeTaskId) {
          reconnectTask(currentSessionKey, activeTaskId, { onArticleMayChange: load })
        }
      }).catch(() => {})
    }
  }, [convId, currentSessionKey, load])

  const handleConversationCreated = useCallback((newConvId: number) => {
    const newKey = `conv:${newConvId}`
    migrateSession(currentSessionKey, newKey)
    setParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('c', String(newConvId))
      return next
    }, { replace: true })
  }, [currentSessionKey, setParams])

  const isDirty = art && savedArt
    ? art.title !== savedArt.title || art.body !== savedArt.body || JSON.stringify(art.tags) !== JSON.stringify(savedArt.tags)
    : false

  // Auto-save: debounce 3s after edits
  useEffect(() => {
    if (!isDirty || !art) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(async () => {
      try {
        await updateArticle(art.id, {
          title: art.title,
          body: art.body,
          tags: art.tags,
          status: art.status,
        } as any)
        setSavedArt({ ...art })
        toast.success('已自动保存', { duration: 1500 })
      } catch { /* silent */ }
    }, 3000)
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  }, [art?.title, art?.body, JSON.stringify(art?.tags)])

  // Warn before browser close/refresh with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  if (!art) return null

  const visualImages = [art.cover_image, ...(art.images || [])].filter(Boolean) as string[]
  const imageBindingForPosition = (pos: number) => (
    pos === 0
      ? { article_id: art.id, role: 'cover' as const }
      : { article_id: art.id, role: 'content' as const, replace_index: pos - 1 }
  )

  const applyImageOrder = async (queue: string[], message = '图片顺序已更新') => {
    const r = await arrangeArticleImages({ article_id: art.id, action: 'set_order', order: queue })
    if (!r.ok || !r.article) throw new Error(r.error || '图片顺序更新失败')
    setArt(r.article)
    setSavedArt(r.article)
    toast.success(message)
  }

  const moveImagePosition = async (from: number, to: number) => {
    if (from === to || from < 0 || from >= visualImages.length) return
    const next = [...visualImages]
    const [item] = next.splice(from, 1)
    const safeTo = Math.max(0, Math.min(next.length, to))
    next.splice(safeTo, 0, item)
    await applyImageOrder(next, safeTo === 0 ? '已设为首图/封面' : '图片顺序已更新')
  }

  const removeImagePosition = async (pos: number) => {
    const r = await arrangeArticleImages({ article_id: art.id, action: 'remove', position: pos })
    if (!r.ok || !r.article) throw new Error(r.error || '删除失败')
    setArt(r.article)
    setSavedArt(r.article)
    toast.success('已删除图片')
  }

  const handleImageDrop = async (targetPos: number) => {
    const from = dragImagePos
    setDragImagePos(null)
    if (from === null || from === targetPos) return
    try {
      await moveImagePosition(from, targetPos)
    } catch (e: any) {
      toast.error(e?.message || '排序失败')
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateArticle(art.id, {
        title: art.title,
        body: art.body,
        tags: art.tags,
        status: art.status,
      } as any)
      setSavedArt({ ...art })
      toast.success('保存成功')
    } catch (e: any) {
      toast.error(e?.message || '保存失败')
    }
    setSaving(false)
  }

  return (
    <Box sx={{ height: 'calc(100vh - 56px)', display: 'flex', bgcolor: 'background.paper' }}>
      {/* left: chat panel */}
      <Box
        sx={{
          width: 380,
          flexShrink: 0,
          borderRight: 1,
          borderColor: 'divider',
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ px: 1.5, py: 0.8, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
        >
          <Tooltip title="历史对话">
            <IconButton onClick={() => { refreshConvos(); setSidebar(true) }} size="small">
              <MenuIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Typography noWrap sx={{ fontSize: 12, color: 'text.secondary', flex: 1 }}>
            {convId ? `对话 #${convId}` : '新对话'}
          </Typography>
          <Tooltip title="新建对话">
            <IconButton size="small" onClick={newChat}>
              <AddIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Stack>
        <ChatPanel
          article={art}
          sessionKey={currentSessionKey}
          onArticleMayChange={load}
          onConversationCreated={handleConversationCreated}
          showHeader={false}
          quickActions={[
            { label: '整体改写', prompt: '帮我整体改写这篇笔记，风格更有网感、更口语化' },
            { label: '细节优化', prompt: '优化这篇笔记的标题吸引力、开头钩子、情绪价值和标签' },
            { label: '标题候选', prompt: '为这篇笔记生成 6 个候选标题' },
            { label: '段落润色', prompt: '帮我润色正文，让表达更自然流畅' },
            { label: '生成封面', prompt: '为这篇笔记生成一张干净、有高级感的竖版封面' },
            { label: '内容配图', prompt: '根据这篇笔记按段落生成 4 张 1:1 的内容配图' },
            { label: '打分', prompt: '帮我从内容、视觉、增长、互动四个维度给这篇笔记打分' },
            { label: '发布前诊断', prompt: '帮我诊断一下能不能发，重点检查违禁词和 CTA' },
          ]}
        />
      </Box>

      {/* middle: editor */}
      <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 900, mx: 'auto' }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2.5 }}>
            <IconButton onClick={() => nav(-1)} size="small">
              <ArrowBackIcon />
            </IconButton>
            <Typography sx={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.2 }}>
              笔记 #{art.id}
            </Typography>
            <Chip
              size="small"
              label={art.status}
              sx={{ bgcolor: 'action.hover', fontSize: 11, height: 20 }}
            />
            {typeof art.score?.overall === 'number' && (
              <Chip
                size="small"
                label={`评分 ${art.score.overall}`}
                sx={{ bgcolor: '#E6F7EC', color: '#0F8C3D', fontSize: 11, height: 20 }}
              />
            )}
            <Box sx={{ flex: 1 }} />
            <Button
              onClick={async () => {
                try {
                  await extractTemplate(art.id)
                  toast.success('模板已提取，前往模板库查看')
                } catch (e: any) {
                  toast.error(e?.message || '提取失败')
                }
              }}
              variant="outlined"
              size="small"
              sx={{ mr: 1 }}
            >
              提取模板
            </Button>
            <Button
              onClick={() => nav(`/articles/${art.id}/diagnose`)}
              variant="outlined"
              size="small"
              sx={{ mr: 1, borderColor: '#FF7A00', color: '#FF7A00', '&:hover': { borderColor: '#E06800', bgcolor: '#FFF8F0' } }}
            >
              诊断
            </Button>
            <Button
              onClick={handleSave}
              variant="contained"
              size="small"
              disabled={saving}
              sx={{ bgcolor: '#FF2741', '&:hover': { bgcolor: '#D61030' } }}
            >
              保存
            </Button>
          </Stack>

          <Stack spacing={2}>
            <Box>
              <TextField
                label="标题"
                fullWidth
                value={art.title}
                onChange={e => setArt({ ...art, title: e.target.value })}
                InputProps={{ sx: { fontSize: 18, fontWeight: 600 } }}
                error={art.title.length > 20}
              />
              <Typography
                sx={{
                  mt: 0.5,
                  fontSize: 11,
                  textAlign: 'right',
                  color: art.title.length > 20 ? '#D61030' : '#8A8A8F',
                }}
              >
                {art.title.length}/20
              </Typography>
            </Box>
            <Box>
              <TextField
                label="正文"
                fullWidth
                multiline
                minRows={14}
                value={art.body}
                onChange={e => setArt({ ...art, body: e.target.value })}
                InputProps={{ sx: { fontSize: 14.5, lineHeight: 1.75 } }}
              />
              <Typography
                sx={{
                  mt: 0.5,
                  fontSize: 11,
                  textAlign: 'right',
                  color: art.body.length < 300 ? '#D97706' : art.body.length > 1000 ? '#D97706' : 'text.secondary',
                }}
              >
                {art.body.length} 字
                {art.body.length < 300 && ' · 建议 300 字以上'}
                {art.body.length > 1000 && ' · 建议控制在 1000 字内'}
                {art.body.length >= 300 && art.body.length <= 1000 && ' · 字数合适'}
              </Typography>
            </Box>
            <TagInput
              tags={art.tags || []}
              onChange={tags => setArt({ ...art, tags })}
            />

            {/* banned words warning */}
            {bannedHits.length > 0 && (
              <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: '#FEF2F2', border: '1px solid #FECACA' }}>
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#DC2626', mb: 0.5 }}>
                  ⚠️ 检测到 {bannedHits.length} 个违禁/敏感词
                </Typography>
                <Stack spacing={0.3}>
                  {bannedHits.slice(0, 8).map((h, i) => (
                    <Typography key={i} sx={{ fontSize: 11, color: '#991B1B' }}>
                      · 「{h.word}」— {h.category}{h.replacement ? `，建议替换为：${h.replacement}` : ''}
                    </Typography>
                  ))}
                  {bannedHits.length > 8 && (
                    <Typography sx={{ fontSize: 11, color: '#991B1B' }}>
                      …还有 {bannedHits.length - 8} 个
                    </Typography>
                  )}
                </Stack>
              </Box>
            )}

            {/* images queue */}
            <Box sx={{ mt: 0.5 }}>
              <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" sx={{ gap: 0.8, mb: 1 }}>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', fontWeight: 700 }}>
                  图片队列（第 1 张 = 首图/封面）
                </Typography>
                <Chip size="small" label={`共 ${visualImages.length} 张`} sx={{ height: 20, fontSize: 11 }} />
                <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                  可拖拽调换顺序，也可在菜单中设为首图、前移、后移或删除。
                </Typography>
              </Stack>

              {visualImages.length > 0 ? (
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
                    gap: 1,
                  }}
                >
                  {visualImages.map((u, pos) => {
                    const binding = imageBindingForPosition(pos)
                    return (
                      <ImageFrame
                        key={`${pos}-${u}`}
                        src={u}
                        aspect="3 / 4"
                        placeholder=""
                        label={pos === 0 ? '首图/封面' : `第 ${pos + 1} 张`}
                        draggable
                        dragging={dragImagePos === pos}
                        onDragStart={e => {
                          setDragImagePos(pos)
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', String(pos))
                        }}
                        onDragOver={e => {
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                        }}
                        onDrop={e => {
                          e.preventDefault()
                          handleImageDrop(pos)
                        }}
                        onOpen={() => setImageLightbox(u)}
                        onEdit={() => {
                          setEditorSrc(u)
                          setEditorBinding(binding)
                          setEditorDefaultMode('inpaint')
                        }}
                        onSetCover={pos > 0 ? () => moveImagePosition(pos, 0).catch(e => toast.error(e?.message || '设置失败')) : undefined}
                        onMovePrev={pos > 0 ? () => moveImagePosition(pos, pos - 1).catch(e => toast.error(e?.message || '移动失败')) : undefined}
                        onMoveNext={pos < visualImages.length - 1 ? () => moveImagePosition(pos, pos + 1).catch(e => toast.error(e?.message || '移动失败')) : undefined}
                        onRemove={() => removeImagePosition(pos).catch(e => toast.error(e?.message || '删除失败'))}
                      />
                    )
                  })}
                </Box>
              ) : (
                <Box
                  sx={{
                    minHeight: 150,
                    border: '1px dashed',
                    borderColor: 'divider',
                    borderRadius: 2,
                    display: 'grid',
                    placeItems: 'center',
                    color: 'text.secondary',
                    fontSize: 12,
                    bgcolor: 'background.default',
                  }}
                >
                  暂无图片。可以让 Agent 生成封面或内容配图，第一张会自动作为首图/封面。
                </Box>
              )}

              {art.image_context && (
                <Box
                  sx={{
                    mt: 1.5,
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: 'rgba(255,36,66,0.035)',
                    border: '1px solid rgba(255,36,66,0.10)',
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ gap: 0.8, mb: 0.8 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary' }}>
                      图片上下文
                    </Typography>
                    <Chip size="small" label={`总图 ${art.image_context.image_count}`} sx={{ height: 20, fontSize: 11 }} />
                    <Chip size="small" label={`首图 ${art.image_context.has_cover ? '已设置' : '无'}`} sx={{ height: 20, fontSize: 11 }} />
                    <Chip size="small" label={`后续图 ${art.image_context.content_image_count}`} sx={{ height: 20, fontSize: 11 }} />
                  </Stack>
                  {art.image_context.all_images.length > 0 ? (
                    <Stack spacing={0.45}>
                      {art.image_context.all_images.slice(0, 8).map((img, i) => {
                        const meta = [
                          img.width && img.height ? `${img.width}×${img.height}` : '',
                          img.format || '',
                          formatBytes(img.bytes),
                          img.exists === false ? '文件未找到' : '',
                        ].filter(Boolean).join(' · ')
                        return (
                          <Typography key={`${img.role}-${img.index ?? i}-${img.url}`} sx={{ fontSize: 11.5, color: img.exists === false ? '#B91C1C' : 'text.secondary' }} noWrap>
                            {img.role === 'cover' ? '首图/封面' : `第 ${(img.index ?? 0) + 2} 张`}：{meta ? `${meta} · ` : ''}{img.url}
                          </Typography>
                        )
                      })}
                      {art.image_context.all_images.length > 8 && (
                        <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                          还有 {art.image_context.all_images.length - 8} 张未展开
                        </Typography>
                      )}
                    </Stack>
                  ) : (
                    <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                      当前笔记还没有图片；Agent 打分会在视觉维度扣分，并可继续生成首图/内容配图。
                    </Typography>
                  )}
                </Box>
              )}
            </Box>

            {/* score radar */}
            {typeof art.score?.overall === 'number' && (
              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2.5, p: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'text.secondary' }}>
                    五维评分
                  </Typography>
                  <Chip
                    size="small"
                    label={`综合 ${art.score.overall}`}
                    sx={{ bgcolor: '#E6F7EC', color: '#0F8C3D', fontSize: 11, height: 20 }}
                  />
                </Stack>
                <ScoreRadar score={art.score || {}} />
                {art.score?.advice && (
                  <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                    {(art.score.advice as string[]).slice(0, 3).map((x, i) => (
                      <Typography key={i} sx={{ fontSize: 12, color: 'text.secondary' }}>
                        · {x}
                      </Typography>
                    ))}
                  </Stack>
                )}
              </Box>
            )}

            {/* version history */}
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2.5, p: 2 }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ cursor: 'pointer' }} onClick={() => { setShowVersions(!showVersions); if (!showVersions) refreshVersions() }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'text.secondary' }}>
                  版本历史
                </Typography>
                {versions.length > 0 && (
                  <Chip size="small" label={`${versions.length}个版本`} sx={{ fontSize: 10, height: 18 }} />
                )}
                <Box flex={1} />
                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{showVersions ? '收起' : '展开'}</Typography>
              </Stack>
              {showVersions && (
                <Stack spacing={1} sx={{ mt: 1.5 }}>
                  {versions.length === 0 && (
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>暂无版本记录（改写/优化时自动保存）</Typography>
                  )}
                  {versions.map(v => (
                    <Stack key={v.id} direction="row" alignItems="center" spacing={1} sx={{ p: 1, borderRadius: 1, bgcolor: 'background.default' }}>
                      <Typography sx={{ fontSize: 12, fontWeight: 600 }}>v{v.version}</Typography>
                      <Typography sx={{ fontSize: 11, color: 'text.secondary', flex: 1 }} noWrap>
                        {v.title || '(无标题)'} · {v.trigger}
                      </Typography>
                      <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>
                        {new Date(v.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </Typography>
                      <Button size="small" onClick={() => handleRollback(v.id)} sx={{ fontSize: 11, minWidth: 0, px: 1 }}>
                        回滚
                      </Button>
                    </Stack>
                  ))}
                </Stack>
              )}
            </Box>
          </Stack>
        </Box>
      </Box>

      {/* right: phone preview */}
      <Box
        sx={{
          width: 370,
          flexShrink: 0,
          borderLeft: 1,
          borderColor: 'divider',
          display: { xs: 'none', lg: 'flex' },
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
          overflow: 'auto',
          py: 3,
        }}
      >
        <PhonePreview
          title={art.title}
          body={art.body}
          tags={art.tags || []}
          coverImage={art.cover_image || undefined}
          images={art.images || undefined}
        />
      </Box>

      {/* Lightbox */}
      <Dialog
        open={!!imageLightbox}
        onClose={() => setImageLightbox(null)}
        maxWidth={false}
        PaperProps={{
          sx: { bgcolor: 'rgba(0,0,0,0.92)', boxShadow: 'none', m: 0, maxWidth: '100vw', maxHeight: '100vh' },
        }}
      >
        {imageLightbox && (
          <Box
            component="img"
            src={imageLightbox}
            sx={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', display: 'block', m: 'auto' }}
            onClick={() => setImageLightbox(null)}
          />
        )}
      </Dialog>

      {/* Image editor */}
      <ImageEditor
        open={!!editorSrc}
        onClose={() => setEditorSrc(null)}
        src={editorSrc}
        binding={editorBinding}
        defaultMode={editorDefaultMode}
        onDone={async () => {
          await load()
        }}
      />

      {/* History drawer */}
      <Drawer open={sidebar} onClose={() => setSidebar(false)}>
        <Box sx={{ width: 340, bgcolor: 'background.paper' }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              笔记对话记录
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Button
              size="small"
              startIcon={<AddIcon sx={{ fontSize: 16 }} />}
              onClick={() => { newChat(); setSidebar(false) }}
            >
              新建
            </Button>
          </Stack>
          {convos.length > 0 && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2, pb: 1.5 }}>
              <Button size="small" onClick={toggleSelectAllConvos}>
                {allSelected ? '取消全选' : '全选'}
              </Button>
              <Typography sx={{ flex: 1, fontSize: 12, color: 'text.secondary' }}>
                {selectedCount > 0 ? `已选 ${selectedCount} 条` : '可勾选多条后批量删除'}
              </Typography>
              {selectedCount > 0 && (
                <Button
                  size="small"
                  color="error"
                  startIcon={<DeleteOutlineIcon sx={{ fontSize: 14 }} />}
                  onClick={() => setBatchDeleteIds(selectedConvoIds)}
                  sx={{ fontSize: 12 }}
                >
                  批量删除
                </Button>
              )}
            </Stack>
          )}
          <Divider />
          <List dense>
            {convos.map(c => (
              <ListItemButton
                key={c.id}
                selected={convId === String(c.id)}
                onClick={() => {
                  if (selectedCount > 0) {
                    toggleConvoSelection(c.id)
                    return
                  }
                  setParams(prev => {
                    const next = new URLSearchParams(prev)
                    next.set('c', String(c.id))
                    return next
                  }, { replace: true })
                  setSidebar(false)
                }}
              >
                <Checkbox
                  size="small"
                  checked={selectedConvoIds.includes(c.id)}
                  onClick={e => e.stopPropagation()}
                  onChange={() => toggleConvoSelection(c.id)}
                  sx={{ mr: 0.5, p: 0.5 }}
                />
                <ListItemText
                  primary={c.title || '新对话'}
                  secondary={new Date(c.updated_at).toLocaleString()}
                  primaryTypographyProps={{ fontSize: 14, noWrap: true }}
                  secondaryTypographyProps={{ fontSize: 11 }}
                />
                <IconButton
                  size="small"
                  onClick={e => { e.stopPropagation(); removeConvo(c.id) }}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </ListItemButton>
            ))}
            {convos.length === 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 1 }}>
                暂无对话记录
              </Typography>
            )}
          </List>
        </Box>
      </Drawer>

      {/* Mobile chat FAB */}
      <IconButton
        onClick={() => setMobileChat(true)}
        sx={{
          display: { xs: 'flex', md: 'none' },
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 52,
          height: 52,
          bgcolor: 'primary.main',
          color: '#fff',
          boxShadow: '0 4px 16px rgba(255,39,65,0.3)',
          '&:hover': { bgcolor: 'primary.dark' },
          zIndex: 1100,
        }}
      >
        <ChatBubbleOutlineIcon />
      </IconButton>

      {/* Mobile chat drawer */}
      <Drawer
        anchor="bottom"
        open={mobileChat}
        onClose={() => setMobileChat(false)}
        PaperProps={{ sx: { height: '85vh', borderTopLeftRadius: 16, borderTopRightRadius: 16 } }}
        sx={{ display: { xs: 'block', md: 'none' } }}
      >
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600, flex: 1 }}>AI 助手</Typography>
            <IconButton size="small" onClick={() => setMobileChat(false)}>
              <ArrowBackIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Stack>
          <ChatPanel
            article={art}
            sessionKey={currentSessionKey}
            onArticleMayChange={load}
            onConversationCreated={handleConversationCreated}
            showHeader={false}
            quickActions={[
              { label: '整体改写', prompt: '帮我整体改写这篇笔记，风格更有网感、更口语化' },
              { label: '打分', prompt: '帮我从内容、视觉、增长、互动四个维度给这篇笔记打分' },
              { label: '生成封面', prompt: '为这篇笔记生成一张干净、有高级感的竖版封面' },
            ]}
          />
        </Box>
      </Drawer>

      <ConfirmDialog
        open={deleteConvoId !== null}
        title="确认删除"
        message="删除后无法恢复，确定要删除这条对话吗？"
        confirmLabel="删除"
        danger
        onConfirm={confirmRemoveConvo}
        onCancel={() => setDeleteConvoId(null)}
      />

      <ConfirmDialog
        open={!!batchDeleteIds?.length}
        title="确认批量删除"
        message={`删除后无法恢复，确定要删除选中的 ${batchDeleteIds?.length || 0} 条对话吗？`}
        confirmLabel="批量删除"
        danger
        onConfirm={confirmBatchRemoveConvos}
        onCancel={() => setBatchDeleteIds(null)}
      />

      <ConfirmDialog
        open={rollbackTarget !== null}
        title="确认回滚"
        message="回滚后当前内容将被覆盖，确定要回滚到此版本吗？"
        confirmLabel="回滚"
        danger
        onConfirm={confirmRollback}
        onCancel={() => setRollbackTarget(null)}
      />
    </Box>
  )
}
