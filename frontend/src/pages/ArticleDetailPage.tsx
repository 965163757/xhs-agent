import { type DragEvent, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
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
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft'
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight'
import {
  getArticle,
  listArticles,
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
import { appDateTimestamp, formatBeijingDateTime } from '../utils/time'
import { useAuth } from '../AuthContext'

const EDITOR_LAYOUT_KEY = 'xhs_article_editor_layout_v3'
const EDITOR_AGENT_PANEL_KEY = 'xhs_article_agent_panel_open'
const DEFAULT_EDITOR_LAYOUT = { left: 300, right: 318 }

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function getInitialEditorLayout() {
  if (typeof window === 'undefined') return DEFAULT_EDITOR_LAYOUT
  try {
    const raw = localStorage.getItem(EDITOR_LAYOUT_KEY)
    if (!raw) return DEFAULT_EDITOR_LAYOUT
    const parsed = JSON.parse(raw)
    return {
      left: clamp(Number(parsed.left) || DEFAULT_EDITOR_LAYOUT.left, 270, 440),
      right: clamp(Number(parsed.right) || DEFAULT_EDITOR_LAYOUT.right, 276, 430),
    }
  } catch {
    return DEFAULT_EDITOR_LAYOUT
  }
}

function adaptiveBodyRows(
  body: string,
  viewport: { width: number; height: number },
  layout: { left: number; right: number },
  imageCount: number,
  showVersions: boolean,
  versionCount: number,
  showImageContext: boolean,
  bannedCount: number,
) {
  const leftWidth = viewport.width >= 1200 ? layout.left + 10 : 0
  const rightWidth = viewport.width >= 1280 ? layout.right + 10 : 0
  const centerWidth = clamp(viewport.width - leftWidth - rightWidth, 360, 1280)
  const charsPerLine = clamp(Math.floor((centerWidth - 56) / 14), 30, 82)
  const visualLines = body
    .split('\n')
    .reduce((total, line) => total + Math.max(1, Math.ceil((line.trim().length || 1) / charsPerLine)), 0)

  const contentWidth = Math.max(280, centerWidth - 42)
  const tileWidth = viewport.width < 720 ? 96 : 112
  const tileGap = 7
  const imageColumns = Math.max(1, Math.floor((contentWidth + tileGap) / (tileWidth + tileGap)))
  const imageRows = imageCount > 0 ? Math.ceil(imageCount / imageColumns) : 1
  const imageGridHeight = imageCount > 0
    ? imageRows * (tileWidth * 4 / 3) + Math.max(0, imageRows - 1) * tileGap
    : 126
  const imageQueueHeight = 34 + 12 + imageGridHeight + (showImageContext ? 112 : 0)
  const rootHeight = Math.max(560, viewport.height - 56)
  const outerVerticalPadding = viewport.width >= 1536 ? 60 : viewport.width >= 900 ? 54 : 46
  const toolbarHeight = viewport.width >= 1536 ? 56 : viewport.width >= 900 ? 72 : 96
  const versionsHeight = showVersions ? Math.min(188, 30 + Math.max(1, versionCount) * 36) : 0
  const bannedHeight = bannedCount > 0 ? 86 : 0
  const contentChromeHeight = 34 + 38 + 27 + 72 + 18 + versionsHeight
  const lineHeight = 14.2 * 1.72
  const availableForTextarea = rootHeight
    - outerVerticalPadding
    - toolbarHeight
    - 10
    - imageQueueHeight
    - bannedHeight
    - contentChromeHeight
  const fitRows = Math.floor(availableForTextarea / lineHeight)
  const contentAwareRows = Math.min(Math.max(visualLines + 1, fitRows), fitRows + 3)
  const minRows = viewport.height < 740 ? 4 : 6
  const maxRows = viewport.height > 1080 ? 34 : viewport.height > 900 ? 28 : 22
  return clamp(Math.max(fitRows, contentAwareRows), minRows, maxRows)
}

function fitEditorLayout(layout: { left: number; right: number }, rootWidth: number) {
  const showRight = rootWidth >= 1040
  const minCenter = rootWidth >= 1900 ? 820 : rootWidth >= 1280 ? 620 : 500
  let left = clamp(layout.left, 270, 440)
  let right = clamp(layout.right, 276, 430)

  if (showRight) {
    const overflow = left + right + minCenter + 24 - rootWidth
    if (overflow > 0) {
      const leftRoom = left - 270
      const rightRoom = right - 276
      const room = Math.max(1, leftRoom + rightRoom)
      left = clamp(left - Math.ceil(overflow * (leftRoom / room)), 270, 440)
      right = clamp(right - Math.ceil(overflow * (rightRoom / room)), 276, 430)
    }
  } else {
    left = clamp(left, 270, Math.max(270, Math.min(440, rootWidth - minCenter - 12)))
  }

  return { left, right }
}

function ResizeGrip({
  onMouseDown,
  minBreakpoint = 'lg',
  title = '拖动调整栏目宽度',
}: {
  onMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => void
  minBreakpoint?: 'lg' | 'xl'
  title?: string
}) {
  return (
    <Box
      title={title}
      onMouseDown={onMouseDown}
      sx={{
        width: 10,
        flexShrink: 0,
        cursor: 'col-resize',
        display: { xs: 'none', [minBreakpoint]: 'flex' },
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.paper',
        borderLeft: '1px solid',
        borderRight: '1px solid',
        borderColor: 'divider',
        transition: 'background .15s',
        '&:hover': {
          bgcolor: 'var(--accent-soft)',
          '& .resize-grip-line': { bgcolor: 'var(--accent)', height: 54 },
        },
      }}
    >
      <Box
        className="resize-grip-line"
        sx={{
          width: 3,
          height: 36,
          borderRadius: 1,
          bgcolor: 'var(--rule)',
          transition: 'all .15s',
        }}
      />
    </Box>
  )
}

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
        borderRadius: 0,
        overflow: 'hidden',
        border: '1px solid',
        borderColor: dragging ? 'primary.main' : 'divider',
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
            bgcolor: 'text.primary',
            color: 'background.paper',
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
                  bgcolor: 'primary.main',
                  color: 'background.paper',
                  width: 28,
                  height: 28,
                  borderRadius: 0,
                  '&:hover': { bgcolor: 'primary.dark' },
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
              bgcolor: 'text.primary',
              color: 'background.paper',
              width: 28,
              height: 28,
              borderRadius: 0,
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
          <MenuItem onClick={() => { onRemove(); setAnchor(null) }} sx={{ color: 'error.main' }}>
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
  const values = metrics.map(([key]) => getScoreValue(score, key) / 100)
  const dataPoints = values.map((v, i) => point(i, v))

  return (
    <Box sx={{ height: 220, display: 'grid', placeItems: 'center' }}>
      <svg width="260" height="220" viewBox="0 0 260 220">
        {[0.25, 0.5, 0.75, 1].map(scale => (
          <polygon key={scale} points={polygon(metrics.map((_, i) => point(i, scale)))} fill="none" stroke="var(--rule)" strokeWidth="1" />
        ))}
        {metrics.map((_, i) => {
          const p = point(i)
          return <line key={i} x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke="var(--rule)" strokeWidth="1" />
        })}
        <polygon points={polygon(dataPoints)} fill="rgba(200,48,46,0.13)" stroke="#C8302E" strokeWidth="2.2" />
        {dataPoints.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="#C8302E" />
        ))}
        {metrics.map(([, label], i) => {
          const p = point(i, 1.18)
          return (
            <text key={label} x={p[0]} y={p[1]} textAnchor="middle" dominantBaseline="middle" fontSize="12" fill="#8C8578" fontWeight="600">
              {label}
            </text>
          )
        })}
      </svg>
    </Box>
  )
}

function getScoreValue(score: Record<string, any> | undefined, key: string) {
  if (!score) return 0
  const direct = Number(score[key])
  if (Number.isFinite(direct)) return Math.max(0, Math.min(100, direct))
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
    if (Number.isFinite(mapped)) return Math.max(0, Math.min(100, mapped))
  }
  if (key === 'overall') {
    const total = Number(score.total_score ?? score.overall_score ?? score.model_a_score?.total_score)
    if (Number.isFinite(total)) return Math.max(0, Math.min(100, total))
  }
  return 0
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

type ConversationRow =
  | { type: 'group'; key: string; ownerName: string; count: number }
  | { type: 'conversation'; key: string; conversation: Conversation }

function conversationOwnerName(c: Conversation) {
  return c.owner_user?.username || (c.user_id ? `用户 ${c.user_id}` : '未归属用户')
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
  const articleRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const articleLoadSeq = useRef(0)
  const [sidebar, setSidebar] = useState(false)
  const [agentPanelOpen, setAgentPanelOpen] = useState(() => localStorage.getItem(EDITOR_AGENT_PANEL_KEY) !== 'false')
  const [mobileChat, setMobileChat] = useState(false)
  const [agentChatPulse, setAgentChatPulse] = useState(false)
  const [convos, setConvos] = useState<Conversation[]>([])
  const [articleOptions, setArticleOptions] = useState<Article[]>([])
  const [articleMenuAnchor, setArticleMenuAnchor] = useState<HTMLElement | null>(null)
  const [versions, setVersions] = useState<ArticleVersion[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [bannedHits, setBannedHits] = useState<BannedWordHit[]>([])
  const bannedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentSessionKey = convId ? `conv:${convId}` : sessionKeyFor(id ? Number(id) : null)
  const [deleteConvoId, setDeleteConvoId] = useState<number | null>(null)
  const [selectedConvoIds, setSelectedConvoIds] = useState<number[]>([])
  const [batchDeleteIds, setBatchDeleteIds] = useState<number[] | null>(null)
  const [batchMode, setBatchMode] = useState(false)
  const [extractingTemplate, setExtractingTemplate] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [rollbackTarget, setRollbackTarget] = useState<number | null>(null)
  const [dragImagePos, setDragImagePos] = useState<number | null>(null)
  const [showImageContext, setShowImageContext] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [layout, setLayout] = useState(getInitialEditorLayout)
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 1440 : window.innerWidth,
    height: typeof window === 'undefined' ? 900 : window.innerHeight,
  }))
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const selectedCount = selectedConvoIds.length
  const allSelected = convos.length > 0 && selectedCount === convos.length
  const selectedConversation = convId ? convos.find(c => c.id === Number(convId)) : undefined
  const shouldOpenChat = params.get('chat') === '1'
  const conversationRows = useMemo<ConversationRow[]>(() => {
    if (!isAdmin) {
      return convos.map(conversation => ({ type: 'conversation', key: `conversation-${conversation.id}`, conversation }))
    }
    const groups = new Map<string, { ownerName: string; items: Conversation[] }>()
    convos.forEach(conversation => {
      const ownerName = conversationOwnerName(conversation)
      const key = String(conversation.user_id ?? ownerName)
      const group = groups.get(key) || { ownerName, items: [] }
      group.items.push(conversation)
      groups.set(key, group)
    })
    return Array.from(groups.entries()).flatMap(([key, group]) => [
      { type: 'group' as const, key: `group-${key}`, ownerName: group.ownerName, count: group.items.length },
      ...group.items.map(conversation => ({ type: 'conversation' as const, key: `conversation-${conversation.id}`, conversation })),
    ])
  }, [convos, isAdmin])

  useEffect(() => {
    localStorage.setItem(EDITOR_LAYOUT_KEY, JSON.stringify(layout))
  }, [layout])

  useEffect(() => {
    localStorage.setItem(EDITOR_AGENT_PANEL_KEY, agentPanelOpen ? 'true' : 'false')
  }, [agentPanelOpen])

  useEffect(() => {
    const handleResize = () => {
      const rootWidth = rootRef.current?.getBoundingClientRect().width || window.innerWidth
      setViewport({ width: window.innerWidth, height: window.innerHeight })
      setLayout(prev => fitEditorLayout(prev, rootWidth))
    }
    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const startColumnResize = useCallback((side: 'left' | 'right') => (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rootWidth = rootRef.current?.getBoundingClientRect().width || window.innerWidth
    const startX = e.clientX
    const start = { ...layout }
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      const draft = side === 'left'
        ? { ...start, left: start.left + dx }
        : { ...start, right: start.right - dx }
      setLayout(fitEditorLayout(draft, rootWidth))
    }
    const onUp = () => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [layout])

  const refreshConvos = useCallback(() => {
    listConversations().then(all => {
      const currentId = Number(id)
      const sorted = [...all].sort((a, b) => {
        const aCurrent = a.article_id === currentId ? 0 : 1
        const bCurrent = b.article_id === currentId ? 0 : 1
        if (aCurrent !== bCurrent) return aCurrent - bCurrent
        return appDateTimestamp(b.updated_at) - appDateTimestamp(a.updated_at)
      })
      setConvos(sorted)
      setSelectedConvoIds(prev => prev.filter(cid => sorted.some(c => c.id === cid)))
    }).catch(() => {
      setConvos([])
      setSelectedConvoIds([])
    })
  }, [id])

  const openArticleSwitcher = (anchor: HTMLElement) => {
    setArticleMenuAnchor(anchor)
    listArticles().then(setArticleOptions).catch(() => setArticleOptions([]))
  }

  const switchToArticle = (targetId: number, keepConversation = true) => {
    const qs = keepConversation && convId ? `?c=${convId}` : ''
    setArticleMenuAnchor(null)
    nav(`/articles/${targetId}${qs}`)
  }

  const newChat = () => {
    resetSession(currentSessionKey)
    setBatchMode(false)
    setSelectedConvoIds([])
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
    setBatchMode(false)
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
    const articleId = Number(id)
    if (!Number.isFinite(articleId) || articleId <= 0) return
    const seq = ++articleLoadSeq.current
    const a = await getArticle(articleId)
    if (seq !== articleLoadSeq.current) return
    setArt(a)
    setSavedArt(a)
  }, [id])

  const scheduleArticleRefresh = useCallback((delay = 120) => {
    if (articleRefreshTimer.current) clearTimeout(articleRefreshTimer.current)
    articleRefreshTimer.current = setTimeout(() => {
      load().catch(() => {})
    }, delay)
  }, [load])

  const handleArticleMayChange = useCallback((next?: Article | null) => {
    if (next && Number(next.id) === Number(id)) {
      articleLoadSeq.current += 1
      setArt(next)
      setSavedArt(next)
      scheduleArticleRefresh(180)
      return
    }
    scheduleArticleRefresh()
  }, [id, scheduleArticleRefresh])

  useEffect(() => {
    load().catch(() => {})
  }, [load])

  useEffect(() => () => {
    if (articleRefreshTimer.current) clearTimeout(articleRefreshTimer.current)
  }, [])

  useEffect(() => {
    setShowImageContext(false)
  }, [id])

  useEffect(() => {
    refreshConvos()
  }, [refreshConvos, convId])

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
          reconnectTask(currentSessionKey, activeTaskId, { onArticleMayChange: handleArticleMayChange })
        }
      }).catch(() => {})
    }
  }, [convId, currentSessionKey, handleArticleMayChange])

  useEffect(() => {
    if (!shouldOpenChat) return
    if (window.matchMedia('(max-width:1199.95px)').matches) setMobileChat(true)
    setAgentChatPulse(true)
    const timer = window.setTimeout(() => setAgentChatPulse(false), 900)
    setParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('chat')
      next.delete('from')
      return next
    }, { replace: true })
    return () => window.clearTimeout(timer)
  }, [shouldOpenChat, setParams])

  const handleConversationCreated = useCallback((newConvId: number) => {
    const newKey = `conv:${newConvId}`
    migrateSession(currentSessionKey, newKey)
    setParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('c', String(newConvId))
      return next
    }, { replace: true })
    refreshConvos()
  }, [currentSessionKey, setParams, refreshConvos])

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
  const bodyRows = adaptiveBodyRows(
    art.body,
    viewport,
    layout,
    visualImages.length,
    showVersions,
    versions.length,
    showImageContext,
    bannedHits.length,
  )
  const previewScale = clamp(Math.min(
    1,
    (viewport.height - 118) / 660,
    (layout.right - 28) / 340,
  ), 0.58, 1)
  const textFieldSx = {
    '& .MuiOutlinedInput-root': {
      borderRadius: 0,
      bgcolor: 'background.paper',
      alignItems: 'flex-start',
      '& fieldset': { borderColor: 'transparent' },
      '&:hover fieldset': { borderColor: 'transparent' },
      '&.Mui-focused fieldset': { borderColor: 'transparent', borderWidth: 1 },
    },
    '& .MuiInputLabel-root.Mui-focused': { color: 'primary.main' },
  }
  const toolbarButtonSx = {
    height: 30,
    borderRadius: 0,
    px: 1.35,
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'none',
    whiteSpace: 'nowrap',
    boxShadow: 'none',
  }
  const sectionCardSx = {
    borderRadius: 0,
    bgcolor: 'background.paper',
    border: '1px solid',
    borderColor: 'divider',
    boxShadow: 'none',
    overflow: 'visible',
  }
  const sectionHeaderSx = {
    px: 1.25,
    py: 0.6,
    minHeight: 34,
    borderBottom: '1px solid',
    borderColor: 'divider',
    bgcolor: 'var(--paper-soft)',
    '& .MuiChip-root': { borderRadius: 0 },
  }
  const sectionBodySx = {
    px: 1.25,
    py: 0.75,
    bgcolor: 'background.paper',
  }
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

  const handlePublish = async () => {
    setPublishing(true)
    try {
      const next = await updateArticle(art.id, {
        title: art.title,
        body: art.body,
        tags: art.tags,
        status: 'published',
      } as any)
      setArt(next)
      setSavedArt(next)
      toast.success('已推到已发布状态')
    } catch (e: any) {
      toast.error(e?.message || '发布失败')
    } finally {
      setPublishing(false)
    }
  }

  const scorePanel = getScoreValue(art.score, 'overall') > 0 ? (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2, bgcolor: 'background.paper', width: 'min(340px, 100%)' }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'text.secondary' }}>
          五维评分
        </Typography>
        <Chip
          size="small"
          label={`综合 ${getScoreValue(art.score, 'overall')}`}
          sx={{ bgcolor: 'rgba(62,107,78,0.10)', color: 'success.main', fontSize: 11, height: 20 }}
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
  ) : null

  return (
    <Box
      ref={rootRef}
      className={agentChatPulse ? 'agent-opened-article' : undefined}
      sx={{
        height: 'calc(100dvh - 56px)',
        minHeight: 0,
        display: 'flex',
        bgcolor: 'background.default',
        overflow: 'hidden',
      }}
    >
      {/* left: chat panel */}
      <Box
        className={agentChatPulse ? 'agent-chat-open-pulse' : undefined}
        sx={{
          width: { lg: agentPanelOpen ? layout.left : 44 },
          flexShrink: 0,
          display: { xs: 'none', lg: 'flex' },
          flexDirection: 'column',
          minHeight: 0,
          bgcolor: 'background.paper',
          borderRight: agentPanelOpen ? 0 : '1px solid',
          borderColor: 'divider',
          transition: 'width .22s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        {!agentPanelOpen ? (
          <Stack alignItems="center" spacing={1} sx={{ py: 1, height: '100%' }}>
            <Tooltip title="展开 Agent 对话栏">
              <IconButton size="small" onClick={() => setAgentPanelOpen(true)}>
                <KeyboardDoubleArrowRightIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="历史对话">
              <IconButton size="small" onClick={() => { refreshConvos(); setSidebar(true) }}>
                <MenuIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
            <Box sx={{ flex: 1 }} />
            <Typography
              className="editorial-mono"
              sx={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 10, color: 'text.disabled', letterSpacing: 1 }}
            >
              AGENT
            </Typography>
            <Box sx={{ flex: 1 }} />
          </Stack>
        ) : (
          <>
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
          <Tooltip title="收起 Agent 对话栏">
            <IconButton onClick={() => setAgentPanelOpen(false)} size="small">
              <KeyboardDoubleArrowLeftIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Stack sx={{ flex: 1, minWidth: 0 }} spacing={0.2}>
            <Typography noWrap sx={{ fontSize: 12, color: 'text.secondary' }}>
              {convId ? `对话 #${convId}` : '新对话'} · 当前上下文：笔记 #{art.id}
            </Typography>
            {selectedConversation?.article_id && selectedConversation.article_id !== art.id && (
              <Typography noWrap sx={{ fontSize: 10.5, color: 'warning.main' }}>
                该对话原关联笔记 #{selectedConversation.article_id}，仍可在当前笔记继续；指定 ID 时 Agent 可跨笔记操作
              </Typography>
            )}
          </Stack>
          <Tooltip title="新建对话">
            <IconButton size="small" onClick={newChat}>
              <AddIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Stack>
        <ChatPanel
          article={art}
          sessionKey={currentSessionKey}
          onArticleMayChange={handleArticleMayChange}
          onConversationCreated={handleConversationCreated}
          showHeader={false}
          quickActions={[
            { label: '整体改写', prompt: '帮我整体改写这篇笔记，风格更有网感、更口语化' },
            { label: '参考仿写', prompt: `参考笔记 #${art.id} 的中文小红书写法，仿写一篇【新主题】的小红书笔记。主题可以变化，只参考结构、语气、节奏；如果需要配图，我会明确说“同时仿图”。` },
            { label: '细节优化', prompt: '优化这篇笔记的标题吸引力、开头钩子、情绪价值和标签' },
            { label: '标题候选', prompt: '为这篇笔记生成 6 个候选标题' },
            { label: '段落润色', prompt: '帮我润色正文，让表达更自然流畅' },
            { label: '生成封面', prompt: '为这篇笔记生成一张干净、有高级感的竖版封面' },
            { label: '内容配图', prompt: '根据这篇笔记按段落生成 4 张 3:4 竖版内容配图；如我指定 2K/4K/比例，按指定尺寸来' },
            { label: '打分', prompt: `请直接调用 score_article 工具，对 article_id=${art.id} 做内容、视觉、增长、互动、综合五维评分，并写回这篇笔记的 score。` },
            { label: '发布前诊断', prompt: '帮我诊断一下能不能发，重点检查违禁词和 CTA' },
          ]}
        />
          </>
        )}
      </Box>
      {agentPanelOpen && (
        <ResizeGrip
          minBreakpoint="lg"
          title="拖动调整 Agent 栏宽度"
          onMouseDown={startColumnResize('left')}
        />
      )}

      {/* middle: editor */}
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        <Box
          sx={{
            height: '100%',
            minHeight: 0,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            p: { xs: 1.25, sm: 1.5, lg: 1.75, xl: 2 },
            pb: { xs: 1.1, sm: 1.25, lg: 1.4, xl: 1.6 },
            maxWidth: 'none',
            mx: 'auto',
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{
              position: 'sticky',
              top: 0,
              zIndex: 5,
              mb: 1.4,
              px: 1.1,
              py: 0.85,
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 0,
              boxShadow: 'none',
              flexWrap: 'wrap',
              gap: 0.8,
              '& .MuiChip-root': { borderRadius: 1 },
            }}
          >
            <IconButton onClick={() => nav(-1)} size="small">
              <ArrowBackIcon />
            </IconButton>
            <Typography sx={{ fontFamily: 'var(--serif)', fontSize: 20, fontWeight: 700, letterSpacing: -0.2 }}>
              笔记 #{art.id}
            </Typography>
            <Chip
              size="small"
              label={art.status === 'published' ? '已发布' : art.status === 'draft' ? '草稿' : art.status}
              sx={{ bgcolor: 'action.hover', fontSize: 11, height: 20 }}
            />
            {art.owner_user && (
              <Chip
                size="small"
                icon={<PersonOutlineIcon sx={{ fontSize: '13px !important' }} />}
                label={art.owner_user.username || `用户 ${art.user_id || ''}`}
                sx={{
                bgcolor: 'var(--accent-soft)',
                color: 'primary.main',
                  fontSize: 11,
                  height: 20,
                  '& .MuiChip-icon': { color: 'primary.main' },
                }}
              />
            )}
            <Button
              size="small"
              variant="outlined"
              onClick={e => openArticleSwitcher(e.currentTarget)}
              sx={{
                ...toolbarButtonSx,
                maxWidth: { xs: 170, lg: 190 },
                borderColor: 'divider',
                color: 'text.secondary',
                bgcolor: 'background.paper',
                '&:hover': { borderColor: 'text.primary', bgcolor: 'background.default' },
              }}
            >
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                切换：{art.title || `#${art.id}`}
              </Box>
            </Button>
            {getScoreValue(art.score, 'overall') > 0 && (
              <Chip
                size="small"
                label={`评分 ${getScoreValue(art.score, 'overall')}`}
                sx={{ bgcolor: 'background.paper', color: 'success.main', borderColor: 'success.main', fontSize: 11, height: 20 }}
              />
            )}
            <Box sx={{ flex: 1 }} />
            <Button
              onClick={async () => {
                setExtractingTemplate(true)
                try {
                  await extractTemplate(art.id)
                  toast.success('模板已提取，前往模板库查看')
                } catch (e: any) {
                  toast.error(e?.message || '提取失败')
                } finally {
                  setExtractingTemplate(false)
                }
              }}
              variant="outlined"
              size="small"
              disabled={extractingTemplate}
              startIcon={extractingTemplate ? <CircularProgress size={14} /> : undefined}
              sx={{
                ...toolbarButtonSx,
                borderColor: 'divider',
                color: 'text.secondary',
                bgcolor: 'background.paper',
                '&:hover': { borderColor: 'text.primary', bgcolor: 'background.default' },
              }}
            >
              {extractingTemplate ? '提取中' : '提取模板'}
            </Button>
            <Button
              onClick={() => nav(`/articles/${art.id}/diagnose`)}
              variant="outlined"
              size="small"
              sx={{
                ...toolbarButtonSx,
                borderColor: 'primary.main',
                color: 'primary.main',
                bgcolor: 'var(--accent-soft)',
                '&:hover': { borderColor: 'primary.main', bgcolor: 'var(--accent-soft)' },
              }}
            >
              诊断
            </Button>
            <Button
              onClick={handlePublish}
              variant={art.status === 'published' ? 'outlined' : 'contained'}
              size="small"
              disabled={publishing || art.status === 'published'}
              sx={{
                ...toolbarButtonSx,
                borderColor: art.status === 'published' ? 'divider' : 'transparent',
                color: art.status === 'published' ? 'text.secondary' : 'background.paper',
                bgcolor: art.status === 'published' ? 'background.default' : 'success.main',
                '&:hover': { bgcolor: art.status === 'published' ? 'background.default' : 'success.main', boxShadow: 'none' },
              }}
            >
              {art.status === 'published' ? '已发布' : publishing ? '发布中' : '发布'}
            </Button>
            <Button
              onClick={handleSave}
              variant="contained"
              size="small"
              disabled={saving}
              sx={{
                ...toolbarButtonSx,
                color: 'background.paper',
                bgcolor: 'primary.main',
                '&:hover': { bgcolor: 'primary.dark', boxShadow: 'none' },
              }}
            >
              保存
            </Button>
          </Stack>

          <Menu anchorEl={articleMenuAnchor} open={!!articleMenuAnchor} onClose={() => setArticleMenuAnchor(null)}>
            {articleOptions.length === 0 && (
              <MenuItem disabled>正在加载笔记…</MenuItem>
            )}
            {articleOptions.map(item => (
              <MenuItem
                key={item.id}
                selected={item.id === art.id}
                onClick={() => switchToArticle(item.id, true)}
                sx={{ minWidth: 300, alignItems: 'flex-start', gap: 1 }}
              >
                <Stack sx={{ minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: 13, fontWeight: item.id === art.id ? 700 : 500 }}>
                    #{item.id} {item.title || '（无标题）'}
                  </Typography>
                  <Typography noWrap sx={{ fontSize: 11, color: 'text.secondary' }}>
                    {(item.owner_user?.username ? `${item.owner_user.username} · ` : '')}{item.status} · {item.content_stats?.image_count ?? ([item.cover_image, ...(item.images || [])].filter(Boolean).length)} 张图
                    {convId ? ' · 保留当前对话' : ''}
                  </Typography>
                </Stack>
              </MenuItem>
            ))}
          </Menu>

          <Stack
            spacing={1}
            sx={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              pr: 0.25,
              pb: 'max(2px, env(safe-area-inset-bottom))',
            }}
          >
            <Box
              sx={{
                order: 1,
                ...sectionCardSx,
              }}
            >
              <Stack direction="row" alignItems="center" spacing={1} sx={{ ...sectionHeaderSx, flexWrap: 'wrap', gap: 0.6 }}>
                <Button
                  size="small"
                  variant={showVersions ? 'contained' : 'text'}
                  onClick={() => { setShowVersions(!showVersions); if (!showVersions) refreshVersions() }}
                  sx={{
                    minHeight: 24,
                    height: 24,
                    px: 0.8,
                    borderRadius: 0,
                    fontSize: 11,
                    fontWeight: 800,
                    boxShadow: 'none',
                    color: showVersions ? 'background.paper' : 'text.secondary',
                    bgcolor: showVersions ? 'text.primary' : 'background.default',
                    '&:hover': {
                      bgcolor: showVersions ? 'text.primary' : 'background.default',
                      boxShadow: 'none',
                    },
                  }}
                >
                  版本{versions.length > 0 ? ` ${versions.length}` : ''}
                </Button>
                <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'text.primary' }}>
                  内容
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Chip
                  size="small"
                  label={`${art.title.length}/20`}
                  sx={{
                    height: 20,
                    fontSize: 10.5,
                    fontWeight: 700,
                    bgcolor: art.title.length > 20 ? 'rgba(139,37,32,0.08)' : 'background.paper',
                    color: art.title.length > 20 ? 'error.main' : 'text.secondary',
                  }}
                />
                <Chip
                  size="small"
                  label={`${art.body.length} 字`}
                  sx={{
                    height: 20,
                    fontSize: 10.5,
                    fontWeight: 700,
                    bgcolor: 'background.paper',
                    color: 'text.secondary',
                  }}
                />
                <Chip
                  size="small"
                  label={art.body.length < 300 ? '建议 300 字以上' : art.body.length > 1000 ? '建议精简' : '字数合适'}
                  sx={{
                    height: 20,
                    fontSize: 10.5,
                    fontWeight: 700,
                    bgcolor: art.body.length < 300 || art.body.length > 1000 ? 'rgba(168,112,41,0.08)' : 'rgba(62,107,78,0.08)',
                    color: art.body.length < 300 || art.body.length > 1000 ? 'warning.main' : 'success.main',
                  }}
                />
              </Stack>
              {showVersions && (
                <Stack
                  spacing={0.7}
                  sx={{
                    ...sectionBodySx,
                    py: 0.65,
                    bgcolor: 'var(--paper-soft)',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  {versions.length === 0 && (
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>暂无版本记录（改写/优化时自动保存）</Typography>
                  )}
                  {versions.map(v => (
                    <Stack key={v.id} direction="row" alignItems="center" spacing={1} sx={{ p: 0.75, borderRadius: 0, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                      <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'text.primary' }}>v{v.version}</Typography>
                      <Typography sx={{ fontSize: 11, color: 'text.secondary', flex: 1 }} noWrap>
                        {v.title || '(无标题)'} · {v.trigger}
                      </Typography>
                      <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>
                        {formatBeijingDateTime(v.created_at, { year: undefined, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: undefined })}
                      </Typography>
                      <Button size="small" onClick={() => handleRollback(v.id)} sx={{ fontSize: 11, minWidth: 0, px: 1 }}>
                        回滚
                      </Button>
                    </Stack>
                  ))}
                </Stack>
              )}
              <Box sx={{ ...sectionBodySx, py: 0.7 }}>
                <TextField
                  placeholder="输入一个抓人的小红书标题"
                  fullWidth
                  size="small"
                  value={art.title}
                  onChange={e => setArt({ ...art, title: e.target.value })}
                  InputProps={{ sx: { fontSize: 17, fontWeight: 700, bgcolor: 'background.paper', px: 0, py: 0 } }}
                  sx={textFieldSx}
                  error={art.title.length > 20}
                />
                <Divider sx={{ my: 0.8 }} />
                <TextField
                  placeholder="输入正文，建议用短句、分段和情绪钩子增强小红书感"
                  fullWidth
                  multiline
                  minRows={bodyRows}
                  maxRows={bodyRows}
                  value={art.body}
                  onChange={e => setArt({ ...art, body: e.target.value })}
                  inputProps={{
                    style: {
                      overflowY: 'auto',
                    },
                  }}
                  InputProps={{
                    sx: {
                      fontSize: 14.2,
                      lineHeight: 1.72,
                      px: 0,
                      py: 0,
                      '& textarea': {
                        resize: 'none',
                      },
                    },
                  }}
                  sx={textFieldSx}
                />
                <Divider sx={{ my: 0.8 }} />
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.65 }}>
                  <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'text.primary' }}>
                    标签
                  </Typography>
                  <Chip
                    size="small"
                    label={`${(art.tags || []).length} 个`}
                    sx={{ height: 20, fontSize: 10.5, fontWeight: 700, bgcolor: 'var(--paper-soft)', color: 'text.primary' }}
                  />
                </Stack>
                <TagInput
                  tags={art.tags || []}
                  onChange={tags => setArt({ ...art, tags })}
                  showLabel={false}
                />
              </Box>
            </Box>

            {/* banned words warning */}
            {bannedHits.length > 0 && (
              <Box sx={{ order: 5, p: 1.5, borderRadius: 0, bgcolor: 'rgba(139,37,32,0.06)', border: '1px solid', borderColor: 'error.main' }}>
                <Typography className="editorial-mono" sx={{ fontSize: 10.5, fontWeight: 700, color: 'error.main', mb: 0.5 }}>
                  BANNED WORDS · {bannedHits.length}
                </Typography>
                <Stack spacing={0.3}>
                  {bannedHits.slice(0, 8).map((h, i) => (
                    <Typography key={i} sx={{ fontSize: 11, color: 'error.main' }}>
                      · 「{h.word}」— {h.category}{h.replacement ? `，建议替换为：${h.replacement}` : ''}
                    </Typography>
                  ))}
                  {bannedHits.length > 8 && (
                    <Typography sx={{ fontSize: 11, color: 'error.main' }}>
                      …还有 {bannedHits.length - 8} 个
                    </Typography>
                  )}
                </Stack>
              </Box>
            )}

            {/* images queue */}
            <Box sx={{ order: 2, mt: 0.2, ...sectionCardSx }}>
              <Box sx={sectionHeaderSx}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.8 }}>
                  <Typography sx={{ fontSize: 12, color: 'text.primary', fontWeight: 800 }}>
                    图片队列
                  </Typography>
                  <Chip size="small" label={`共 ${visualImages.length} 张`} sx={{ height: 20, fontSize: 10.5, fontWeight: 700, bgcolor: 'background.paper', color: 'text.secondary' }} />
                  <Typography sx={{ fontSize: 11.5, color: 'text.secondary', whiteSpace: { xs: 'normal', md: 'nowrap' } }}>
                    可拖拽调换顺序，也可在菜单中设为首图、前移、后移或删除。
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  {art.image_context && (
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => setShowImageContext(v => !v)}
                      sx={{
                        minHeight: 24,
                        px: 0.9,
                        borderRadius: 0,
                        fontSize: 11.5,
                        color: 'text.secondary',
                        textTransform: 'none',
                        whiteSpace: 'nowrap',
                        '&:hover': { bgcolor: 'background.default' },
                      }}
                    >
                      {showImageContext ? '收起上下文' : '图片上下文'}
                    </Button>
                  )}
                </Stack>
              </Box>

              <Box sx={sectionBodySx}>
                {visualImages.length > 0 ? (
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))',
                      gap: 0.85,
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
                      minHeight: 126,
                      border: '1px dashed',
                      borderColor: 'divider',
                      borderRadius: 0,
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
              </Box>

              {art.image_context && showImageContext && (
                <Box
                  sx={{
                    mx: 1.25,
                    mb: 1.05,
                    p: 1.1,
                    borderRadius: 1,
                    bgcolor: 'var(--paper-soft)',
                    border: '1px solid',
                    borderColor: 'divider',
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
                          <Typography key={`${img.role}-${img.index ?? i}-${img.url}`} sx={{ fontSize: 11.5, color: img.exists === false ? 'error.main' : 'text.secondary' }} noWrap>
                            {img.role === 'cover' ? '首图/封面' : `第 ${(img.index ?? 0) + 2} 张`}：{meta ? `${meta} · ` : ''}{img.full_url && img.full_url !== img.url ? `${img.url} → ${img.full_url}` : img.url}
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
          </Stack>
        </Box>
      </Box>

      <ResizeGrip
        minBreakpoint="lg"
        title="拖动调整预览栏宽度"
        onMouseDown={startColumnResize('right')}
      />

      {/* right: phone preview */}
      <Box
        sx={{
          width: { lg: layout.right },
          flexShrink: 0,
          display: { xs: 'none', lg: 'flex' },
          alignItems: 'flex-start',
          justifyContent: 'center',
          bgcolor: 'background.paper',
          borderLeft: '1px solid',
          borderColor: 'divider',
          minHeight: 0,
          overflow: 'auto',
          px: 1,
          pt: 1.2,
          pb: 'max(16px, env(safe-area-inset-bottom))',
        }}
      >
        <Stack spacing={1.2} alignItems="center" sx={{ width: '100%', minHeight: 'max-content' }}>
          <PhonePreview
            title={art.title}
            body={art.body}
            tags={art.tags || []}
            coverImage={art.cover_image || undefined}
            images={art.images || undefined}
            scale={previewScale}
          />
          {scorePanel}
        </Stack>
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
        <Box sx={{ width: { xs: 340, sm: 380 }, maxWidth: '92vw', height: '100%', bgcolor: 'background.paper', display: 'flex', flexDirection: 'column' }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              {isAdmin ? '全部对话记录' : '对话记录'}
            </Typography>
            {isAdmin && (
              <Chip
                size="small"
                label="按用户"
                sx={{ height: 20, fontSize: 10.5, bgcolor: 'var(--accent-soft)', color: 'primary.main' }}
              />
            )}
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
              {!batchMode ? (
                <Button size="small" onClick={() => { setBatchMode(true); setSelectedConvoIds([]) }}>
                  批量管理
                </Button>
              ) : (
                <Button size="small" onClick={toggleSelectAllConvos}>
                  {allSelected ? '取消全选' : '全选'}
                </Button>
              )}
              <Typography sx={{ flex: 1, fontSize: 12, color: 'text.secondary' }}>
                {batchMode ? (selectedCount > 0 ? `已选 ${selectedCount} 条` : '选择要删除的对话') : '可选择任意对话在当前笔记继续'}
              </Typography>
              {batchMode && selectedCount > 0 && (
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
              {batchMode && (
                <Button size="small" onClick={() => { setBatchMode(false); setSelectedConvoIds([]) }}>
                  取消
                </Button>
              )}
            </Stack>
          )}
          <Divider />
          <List dense sx={{ overflow: 'auto', flex: 1, px: 0.5, py: 0.75 }}>
            {conversationRows.map(row => {
              if (row.type === 'group') {
                return (
                  <Stack
                    key={row.key}
                    direction="row"
                    alignItems="center"
                    spacing={0.75}
                    sx={{ px: 1.2, pt: 1.1, pb: 0.45 }}
                  >
                    <PersonOutlineIcon sx={{ fontSize: 15, color: 'primary.main' }} />
                    <Typography noWrap sx={{ fontSize: 12, fontWeight: 800, color: 'text.primary', flex: 1 }}>
                      {row.ownerName}
                    </Typography>
                    <Chip size="small" label={`${row.count}`} sx={{ height: 18, fontSize: 10, bgcolor: 'action.hover' }} />
                  </Stack>
                )
              }
              const c = row.conversation
              const isCurrentArticle = c.article_id === art.id
              const isOtherArticle = !!c.article_id && !isCurrentArticle
              return (
                <ListItemButton
                  key={row.key}
                  selected={convId === String(c.id)}
                  onClick={() => {
                    if (batchMode) {
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
                  sx={{ alignItems: 'flex-start', py: 1 }}
                >
                  {batchMode && (
                    <Checkbox
                      size="small"
                      checked={selectedConvoIds.includes(c.id)}
                      onClick={e => e.stopPropagation()}
                      onChange={() => toggleConvoSelection(c.id)}
                      sx={{ mr: 0.5, p: 0.5, mt: 0.2 }}
                    />
                  )}
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={0.6} alignItems="center" sx={{ minWidth: 0 }}>
                        <Typography noWrap sx={{ fontSize: 14, fontWeight: 500, minWidth: 0 }}>
                          {c.title || '新对话'}
                        </Typography>
                        <Chip
                          size="small"
                          label={isCurrentArticle ? '当前笔记' : isOtherArticle ? `笔记 #${c.article_id}` : '未绑定'}
                          sx={{
                            height: 18,
                            fontSize: 10,
                            bgcolor: isCurrentArticle ? 'rgba(62,107,78,0.10)' : isOtherArticle ? 'rgba(168,112,41,0.10)' : 'action.hover',
                            color: isCurrentArticle ? 'success.main' : isOtherArticle ? 'warning.main' : 'text.secondary',
                          }}
                        />
                        {c.owner_user && (
                          <Chip
                            size="small"
                            label={c.owner_user.username}
                            sx={{
                              height: 18,
                              fontSize: 10,
                              bgcolor: 'var(--accent-soft)',
                              color: 'primary.main',
                            }}
                          />
                        )}
                      </Stack>
                    }
                    secondary={
                      <Stack spacing={0.3}>
                        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                          {formatBeijingDateTime(c.updated_at)}
                        </Typography>
                        {isOtherArticle && (
                          <Button
                            size="small"
                            onClick={e => {
                              e.stopPropagation()
                              switchToArticle(Number(c.article_id), true)
                              setSidebar(false)
                            }}
                            sx={{ alignSelf: 'flex-start', fontSize: 11, p: 0, minWidth: 0, color: 'warning.main' }}
                          >
                            切到关联笔记并保留此对话
                          </Button>
                        )}
                      </Stack>
                    }
                    primaryTypographyProps={{ component: 'div' }}
                    secondaryTypographyProps={{ component: 'div' }}
                  />
                  <IconButton
                    size="small"
                    onClick={e => { e.stopPropagation(); removeConvo(c.id) }}
                    sx={{ mt: 0.3 }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </ListItemButton>
              )
            })}
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
          display: { xs: 'flex', lg: 'none' },
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 52,
          height: 52,
          bgcolor: 'primary.main',
          color: 'background.paper',
          borderRadius: 0,
          boxShadow: 'none',
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
        PaperProps={{ sx: { height: 'min(85dvh, calc(100dvh - 20px))', borderTopLeftRadius: 0, borderTopRightRadius: 0, overflow: 'hidden' } }}
        sx={{ display: { xs: 'block', lg: 'none' } }}
      >
        <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600, flex: 1 }}>AI 助手</Typography>
            <IconButton size="small" onClick={() => setMobileChat(false)}>
              <ArrowBackIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Stack>
          <ChatPanel
            article={art}
            sessionKey={currentSessionKey}
            onArticleMayChange={handleArticleMayChange}
            onConversationCreated={handleConversationCreated}
            showHeader={false}
            quickActions={[
              { label: '整体改写', prompt: '帮我整体改写这篇笔记，风格更有网感、更口语化' },
              { label: '参考仿写', prompt: `参考笔记 #${art.id} 的中文小红书写法，仿写一篇【新主题】的小红书笔记。主题可以变化，只参考结构、语气、节奏；如果需要配图，我会明确说“同时仿图”。` },
              { label: '打分', prompt: `请直接调用 score_article 工具，对 article_id=${art.id} 做内容、视觉、增长、互动、综合五维评分，并写回这篇笔记的 score。` },
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
