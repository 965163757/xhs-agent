import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Box,
  Button,
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
import ReactECharts from 'echarts-for-react'
import {
  getArticle,
  updateArticle,
  listConversations,
  deleteConversation,
  listVersions,
  rollbackVersion,
  checkBannedWords,
  extractTemplate,
  type Article,
  type ArticleVersion,
  type BannedWordHit,
  type Conversation,
} from '../api/client'
import { toast } from 'sonner'
import ChatPanel from '../components/ChatPanel'
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
}: {
  src?: string
  aspect: string
  placeholder: string
  onEdit?: () => void
  onRemove?: () => void
  onOpen?: () => void
  label?: string
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
        border: '1px solid', borderColor: 'divider',
        bgcolor: 'background.default',
        '&:hover .img-toolbar': { opacity: 1 },
      }}
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

  const refreshConvos = useCallback(() => {
    listConversations().then(all => {
      setConvos(all.filter(c => c.article_id === Number(id)))
    }).catch(() => setConvos([]))
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
    if (!confirm('删除这条对话？')) return
    await deleteConversation(cid)
    if (convId === String(cid)) newChat()
    refreshConvos()
  }

  const refreshVersions = useCallback(() => {
    if (!id) return
    listVersions(Number(id)).then(setVersions).catch(() => setVersions([]))
  }, [id])

  const handleRollback = async (vid: number) => {
    if (!confirm('确定回滚到此版本？当前内容将被覆盖。')) return
    const a = await rollbackVersion(Number(id), vid)
    setArt(a)
    setSavedArt(a)
    toast.success('已回滚')
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

  const scoreOption = useMemo(() => {
    const s = art?.score || {}
    return {
      radar: {
        indicator: [
          { name: '内容', max: 100 },
          { name: '视觉', max: 100 },
          { name: '增长', max: 100 },
          { name: '互动', max: 100 },
          { name: '综合', max: 100 },
        ],
        radius: '62%',
        axisName: { color: 'text.secondary', fontSize: 12 },
        splitLine: { lineStyle: { color: '#EEE9E1' } },
        splitArea: { areaStyle: { color: ['#fafafa', '#ffffff'] } },
      },
      series: [
        {
          type: 'radar',
          areaStyle: { color: 'rgba(255,39,65,0.12)' },
          lineStyle: { color: '#FF2741', width: 2 },
          symbol: 'circle',
          data: [
            {
              value: [
                s.content ?? 0,
                s.visual ?? 0,
                s.growth ?? 0,
                s.engagement ?? 0,
                s.overall ?? 0,
              ],
              name: '评分',
            },
          ],
        },
      ],
    }
  }, [art?.score])

  if (!art) return null

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
              <Typography sx={{ mt: 0.5, fontSize: 11, textAlign: 'right', color: 'text.secondary' }}>
                {art.body.length} 字
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

            {/* images area */}
            <Box sx={{ mt: 0.5 }}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={2}
                alignItems="flex-start"
              >
                {/* cover */}
                <Box sx={{ width: { xs: '100%', sm: 200 } }}>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.8, fontWeight: 600 }}>
                    封面（2:3）
                  </Typography>
                  <ImageFrame
                    src={art.cover_image || undefined}
                    aspect="2 / 3"
                    placeholder="暂无封面"
                    label={art.cover_image ? '封面' : undefined}
                    onOpen={art.cover_image ? () => setImageLightbox(art.cover_image) : undefined}
                    onEdit={
                      art.cover_image
                        ? () => {
                            setEditorSrc(art.cover_image)
                            setEditorBinding({ article_id: art.id, role: 'cover' })
                            setEditorDefaultMode('inpaint')
                          }
                        : undefined
                    }
                  />
                </Box>

                {/* content images grid */}
                <Box sx={{ flex: 1, width: '100%' }}>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.8, fontWeight: 600 }}>
                    内容配图（1:1）
                  </Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                      gap: 1,
                    }}
                  >
                    {(art.images || []).map((u, i) => (
                      <ImageFrame
                        key={i}
                        src={u}
                        aspect="1 / 1"
                        placeholder=""
                        label={`#${i + 1}`}
                        onOpen={() => setImageLightbox(u)}
                        onEdit={() => {
                          setEditorSrc(u)
                          setEditorBinding({
                            article_id: art.id,
                            role: 'content',
                            replace_index: i,
                          })
                          setEditorDefaultMode('inpaint')
                        }}
                      />
                    ))}
                  </Box>
                </Box>
              </Stack>
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
                <ReactECharts option={scoreOption} style={{ height: 220 }} />
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
          width: 400,
          flexShrink: 0,
          borderLeft: '1px solid #e5e7eb',
          display: { xs: 'none', lg: 'flex' },
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: '#FAFAFA',
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
        <Box sx={{ width: 300, bgcolor: 'background.paper' }}>
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
          <Divider />
          <List dense>
            {convos.map(c => (
              <ListItemButton
                key={c.id}
                selected={convId === String(c.id)}
                onClick={() => {
                  setParams(prev => {
                    const next = new URLSearchParams(prev)
                    next.set('c', String(c.id))
                    return next
                  }, { replace: true })
                  setSidebar(false)
                }}
              >
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
    </Box>
  )
}
