import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  TextField,
  InputAdornment,
  ToggleButton,
  ToggleButtonGroup,
  MenuItem,
  Select,
  FormControl,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import SearchIcon from '@mui/icons-material/Search'
import AddIcon from '@mui/icons-material/Add'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import EditNoteIcon from '@mui/icons-material/EditNote'
import SortIcon from '@mui/icons-material/Sort'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import { deleteArticle, listArticles, type Article } from '../api/client'
import { toast } from 'sonner'
import ConfirmDialog from '../components/ConfirmDialog'
import { appDateTimestamp, formatBeijingDate } from '../utils/time'
import { useAuth } from '../AuthContext'

type SortKey = 'updated' | 'score' | 'title'
type ArticleRow =
  | { type: 'group'; key: string; ownerName: string; count: number }
  | { type: 'article'; key: string; article: Article }

const statusColors: Record<string, { bg: string; color: string }> = {
  draft: { bg: 'rgba(140,133,120,0.10)', color: '#5C564C' },
  published: { bg: 'rgba(62,107,78,0.10)', color: '#3E6B4E' },
  scheduled: { bg: 'rgba(168,112,41,0.10)', color: '#A87029' },
}

function articleScore(a: Article) {
  const direct = Number(a.score?.overall)
  if (Number.isFinite(direct)) return Math.round(direct)
  const total = Number(a.score?.total_score ?? a.score?.overall_score ?? a.score?.model_a_score?.total_score)
  return Number.isFinite(total) ? Math.round(total) : 0
}

function articleOwnerName(a: Article) {
  return a.owner_user?.username || (a.user_id ? `用户 ${a.user_id}` : '未归属用户')
}

export default function ArticlesPage() {
  const [items, setItems] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortKey>('updated')
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const nav = useNavigate()
  const refresh = () => listArticles().then(setItems).catch(() => setItems([])).finally(() => setLoading(false))
  useEffect(() => {
    refresh()
  }, [])

  const statuses = useMemo(() => {
    const set = new Set(items.map(a => a.status))
    return Array.from(set).sort()
  }, [items])

  const filtered = useMemo(() => {
    let list = items.filter(
      a =>
        !query ||
        a.title.toLowerCase().includes(query.toLowerCase()) ||
        a.body.toLowerCase().includes(query.toLowerCase()) ||
        (a.owner_user?.username || '').toLowerCase().includes(query.toLowerCase()) ||
        (a.tags || []).some(t => t.toLowerCase().includes(query.toLowerCase()))
    )
    if (statusFilter !== 'all') {
      list = list.filter(a => a.status === statusFilter)
    }
    list = [...list].sort((a, b) => {
      if (sortBy === 'score') return articleScore(b) - articleScore(a)
      if (sortBy === 'title') return a.title.localeCompare(b.title)
      return appDateTimestamp(b.updated_at) - appDateTimestamp(a.updated_at)
    })
    return list
  }, [items, query, statusFilter, sortBy])

  const articleRows = useMemo<ArticleRow[]>(() => {
    if (!isAdmin) {
      return filtered.map(article => ({ type: 'article', key: `article-${article.id}`, article }))
    }
    const groups = new Map<string, { ownerName: string; items: Article[] }>()
    filtered.forEach(article => {
      const ownerName = articleOwnerName(article)
      const key = String(article.user_id ?? ownerName)
      const group = groups.get(key) || { ownerName, items: [] }
      group.items.push(article)
      groups.set(key, group)
    })
    return Array.from(groups.entries()).flatMap(([key, group]) => [
      { type: 'group' as const, key: `group-${key}`, ownerName: group.ownerName, count: group.items.length },
      ...group.items.map(article => ({ type: 'article' as const, key: `article-${article.id}`, article })),
    ])
  }, [filtered, isAdmin])

  return (
    <Box className="editorial-page studio-page">
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2.5, flexWrap: 'wrap', gap: 1, borderBottom: '1px solid', borderColor: 'divider', pb: 1.5 }}>
        <Typography className="editorial-mono" sx={{ fontSize: 10, fontWeight: 800, color: 'primary.main', transform: 'translateY(-8px)' }}>06</Typography>
        <Stack spacing={0.2}>
          <Typography sx={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 32, fontWeight: 800, letterSpacing: -0.8, lineHeight: 1 }}>
            {isAdmin ? '全部笔记' : '我的笔记'}
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            稿件库 · {items.length} 篇笔记{isAdmin ? ' · 管理员视图' : ''}
          </Typography>
        </Stack>
        {isAdmin && (
          <Chip
            size="small"
            icon={<PersonOutlineIcon sx={{ fontSize: '14px !important' }} />}
            label="按用户分组"
            sx={{
              height: 24,
              fontSize: 12,
              bgcolor: 'var(--accent-soft)',
              color: 'primary.main',
              '& .MuiChip-icon': { color: 'primary.main' },
            }}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={statusFilter}
          onChange={(_, v) => v && setStatusFilter(v)}
          sx={{
            '& .MuiToggleButton-root': {
              fontSize: 12,
              px: 1.4,
              py: 0.5,
              textTransform: 'none',
              borderRadius: '0 !important',
              border: '1px solid',
              borderColor: 'divider',
              '&.Mui-selected': {
                bgcolor: 'var(--accent-soft)',
                color: 'primary.main',
                borderColor: 'primary.main',
              },
            },
          }}
        >
          <ToggleButton value="all">全部</ToggleButton>
          {statuses.map(s => (
            <ToggleButton key={s} value={s}>{s === 'draft' ? '草稿' : s === 'published' ? '已发布' : s}</ToggleButton>
          ))}
        </ToggleButtonGroup>
        <FormControl size="small" sx={{ minWidth: 100 }}>
          <Select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortKey)}
            startAdornment={<SortIcon sx={{ fontSize: 14, mr: 0.5, color: 'text.secondary' }} />}
            sx={{ fontSize: 12, height: 32, borderRadius: 0 }}
          >
            <MenuItem value="updated">最近更新</MenuItem>
            <MenuItem value="score">评分最高</MenuItem>
            <MenuItem value="title">标题排序</MenuItem>
          </Select>
        </FormControl>
        <TextField
          size="small"
          placeholder={isAdmin ? '搜索标题 / 用户…' : '搜索…'}
          value={query}
          onChange={e => setQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              </InputAdornment>
            ),
          }}
          sx={{ width: { xs: '100%', sm: 220 } }}
        />
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => nav('/')}
        >
          去创作
        </Button>
      </Stack>

      {loading && (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {!loading && filtered.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 10 }}>
          <Typography className="editorial-mono" sx={{ fontSize: 11, color: 'primary.main', mb: 1.5 }}>
            {items.length === 0 ? 'EMPTY' : 'FILTER'}
          </Typography>
          <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
            {items.length === 0
              ? '还没有笔记，去创作页让助手帮你写一篇'
              : '没有匹配的笔记'}
          </Typography>
        </Box>
      )}

      <Stack spacing={1.5}>
        {articleRows.map(row => {
          if (row.type === 'group') {
            return (
              <Stack
                key={row.key}
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{
                  pt: 1.2,
                  pb: 0.2,
                  color: 'text.secondary',
                  '&:first-of-type': { pt: 0 },
                }}
              >
                <PersonOutlineIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: 'text.primary' }}>
                  {row.ownerName}
                </Typography>
                <Chip size="small" label={`${row.count} 篇`} sx={{ height: 19, fontSize: 10.5, bgcolor: 'action.hover' }} />
                <Box sx={{ flex: 1, height: 1, bgcolor: 'divider' }} />
              </Stack>
            )
          }
          const a = row.article
          return (
          <Box
            key={row.key}
            onClick={() => nav(`/articles/${a.id}`)}
            sx={{
              display: 'flex',
              gap: 2,
              p: 2,
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 0,
              cursor: 'pointer',
              transition: 'all .2s cubic-bezier(0.4,0,0.2,1)',
              '&:hover': {
                borderColor: 'primary.main',
                boxShadow: 'none',
                transform: 'translateY(-1px)',
                '& .row-actions': { opacity: 1 },
              },
            }}
          >
            {/* Thumbnail */}
            <Box
              sx={{
                width: 80,
                height: 80,
                borderRadius: 0,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: 'var(--paper-deep)',
                backgroundImage: a.cover_image ? `url(${a.cover_image})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                display: 'grid',
                placeItems: 'center',
                color: 'text.secondary',
                fontSize: 18,
                fontWeight: 800,
                fontFamily: 'var(--serif)',
                flexShrink: 0,
                overflow: 'hidden',
              }}
            >
              {!a.cover_image && (a.title.slice(0, 1) || '红')}
            </Box>

            {/* Content */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mb: 0.5 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 600 }} noWrap>
                  {a.title || '无标题'}
                </Typography>
                <Chip
                  size="small"
                  label={a.status === 'draft' ? '草稿' : a.status === 'published' ? '已发布' : a.status}
                  sx={{
                    ...(statusColors[a.status] || { bg: 'rgba(0,0,0,0.04)', color: 'text.secondary' }),
                    bgcolor: statusColors[a.status]?.bg || 'rgba(0,0,0,0.04)',
                    color: statusColors[a.status]?.color || undefined,
                    fontSize: 11,
                    height: 20,
                    fontWeight: 500,
                  }}
                />
                {articleScore(a) > 0 && (
                  <Chip
                    size="small"
                    label={`${articleScore(a)}分`}
                    sx={{ bgcolor: 'rgba(62,107,78,0.10)', color: 'success.main', fontSize: 11, height: 20, fontWeight: 600 }}
                  />
                )}
                {a.owner_user && (
                  <Chip
                    size="small"
                    icon={<PersonOutlineIcon sx={{ fontSize: '13px !important' }} />}
                    label={a.owner_user.username || `用户 ${a.user_id || ''}`}
                    sx={{
                      bgcolor: 'var(--accent-soft)',
                      color: 'primary.main',
                      fontSize: 11,
                      height: 20,
                      fontWeight: 600,
                      '& .MuiChip-icon': { color: 'primary.main' },
                    }}
                  />
                )}
              </Stack>
              <Typography
                sx={{
                  fontSize: 13,
                  color: 'text.secondary',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  lineHeight: 1.6,
                }}
              >
                {a.body}
              </Typography>
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.8, flexWrap: 'wrap', gap: 0.4 }}>
                {(a.tags || []).slice(0, 5).map(t => (
                  <Chip
                    key={t}
                    label={`#${String(t).replace(/^[#＃]+/, '')}`}
                    size="small"
                    sx={{
                      fontSize: 11,
                      minHeight: 20,
                      height: 'auto',
                      bgcolor: 'var(--paper-soft)',
                      color: 'text.primary',
                      border: '1px solid',
                      borderColor: 'divider',
                      maxWidth: 160,
                      '& .MuiChip-label': {
                        px: 0.75,
                        py: 0.2,
                        lineHeight: 1.25,
                        whiteSpace: 'normal',
                        overflowWrap: 'anywhere',
                      },
                    }}
                  />
                ))}
                {(a.tags || []).length > 5 && (
                  <Chip
                    label={`+${(a.tags || []).length - 5}`}
                    size="small"
                    sx={{ height: 20, fontSize: 10.5, bgcolor: 'background.paper', color: 'text.secondary' }}
                  />
                )}
              </Stack>
            </Box>

            {/* Actions */}
            <Stack sx={{ alignItems: 'flex-end', justifyContent: 'space-between', py: 0.3 }}>
              <Typography sx={{ fontSize: 11, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                {formatBeijingDate(a.updated_at)}
              </Typography>
              <Stack
                direction="row"
                spacing={0.3}
                className="row-actions"
                sx={{ opacity: { xs: 1, md: 0 }, transition: 'opacity .2s' }}
              >
                <Tooltip title="对话优化">
                  <IconButton
                    size="small"
                    onClick={e => {
                      e.stopPropagation()
                      nav(`/?article=${a.id}`)
                    }}
                  >
                    <ChatBubbleOutlineIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="编辑">
                  <IconButton
                    size="small"
                    onClick={e => {
                      e.stopPropagation()
                      nav(`/articles/${a.id}`)
                    }}
                  >
                    <EditNoteIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="删除">
                  <IconButton
                    size="small"
                    onClick={e => {
                      e.stopPropagation()
                      setDeleteTarget(a.id)
                    }}
                  >
                    <DeleteOutlineIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>
          </Box>
          )
        })}
      </Stack>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="确认删除"
        message="删除后无法恢复，确定要删除这篇笔记吗？"
        confirmLabel="删除"
        danger
        onConfirm={() => {
          if (deleteTarget !== null) {
            deleteArticle(deleteTarget).then(() => {
              toast.success('已删除')
              refresh()
            })
          }
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  )
}
