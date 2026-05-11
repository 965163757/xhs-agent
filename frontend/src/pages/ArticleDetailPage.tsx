import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  TextField,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  Tooltip,
  Menu,
  MenuItem,
  LinearProgress,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import ReplayIcon from '@mui/icons-material/Replay'
import ImageIcon from '@mui/icons-material/Image'
import BarChartIcon from '@mui/icons-material/BarChart'
import FactCheckIcon from '@mui/icons-material/FactCheck'
import TitleIcon from '@mui/icons-material/Title'
import SpaIcon from '@mui/icons-material/Spa'
import WallpaperIcon from '@mui/icons-material/Wallpaper'
import CollectionsIcon from '@mui/icons-material/Collections'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import ReactECharts from 'echarts-for-react'
import {
  contentImagePrompt,
  coverPrompt,
  diagnoseArticle,
  generateImageForArticle,
  getArticle,
  optimizeArticle,
  polishParagraph,
  removeArticleImage,
  rewriteArticle,
  scoreArticle,
  suggestTitles,
  updateArticle,
  type Article,
} from '../api/client'
import ChatPanel from '../components/ChatPanel'
import ImageEditor from '../components/ImageEditor'

type Dlg =
  | 'rewrite'
  | 'optimize'
  | 'image'
  | 'titles'
  | 'polish'
  | 'cover_prompt'
  | 'content_shots'
  | null

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  loading,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  loading?: boolean
}) {
  return (
    <Button
      variant="outlined"
      size="small"
      startIcon={loading ? <CircularProgress size={14} /> : icon}
      onClick={onClick}
      disabled={disabled}
      sx={{
        borderColor: '#E6E0D4',
        color: '#1F1F1F',
        bgcolor: '#fff',
        fontSize: 13,
        fontWeight: 600,
        borderRadius: 999,
        px: 1.6,
        '&:hover': { borderColor: '#1F1F1F', bgcolor: '#F5EFE5' },
      }}
    >
      {label}
    </Button>
  )
}

function ImageFrame({
  src,
  aspect,
  placeholder,
  onRegenerate,
  onReplace,
  onEdit,
  onRemove,
  onOpen,
  label,
  disabled,
}: {
  src?: string
  aspect: string
  placeholder: string
  onRegenerate?: () => void
  onReplace?: () => void
  onEdit?: () => void
  onRemove?: () => void
  onOpen?: () => void
  label?: string
  disabled?: boolean
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
        border: '1px solid #EEE9E1',
        bgcolor: '#FAF7F2',
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
        {onRegenerate && (
          <Tooltip title="重新生成">
            <IconButton
              size="small"
              onClick={onRegenerate}
              disabled={disabled}
              sx={{
                bgcolor: 'rgba(31,31,31,0.85)',
                color: '#fff',
                width: 28,
                height: 28,
                borderRadius: '50%',
                '&:hover': { bgcolor: '#1F1F1F' },
              }}
            >
              <ReplayIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
        {onEdit && src && (
          <Tooltip title="编辑（裁剪/重绘/消除）">
            <IconButton
              size="small"
              onClick={onEdit}
              disabled={disabled}
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
            '&:hover': { bgcolor: '#1F1F1F' },
          }}
        >
          <MoreVertIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Box>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {onOpen && src && (
          <MenuItem
            onClick={() => {
              onOpen()
              setAnchor(null)
            }}
          >
            <OpenInNewIcon fontSize="small" sx={{ mr: 1 }} />
            查看大图
          </MenuItem>
        )}
        {onEdit && src && (
          <MenuItem
            onClick={() => {
              onEdit()
              setAnchor(null)
            }}
          >
            <AutoFixHighIcon fontSize="small" sx={{ mr: 1 }} />
            编辑图片（裁剪/重绘/消除）
          </MenuItem>
        )}
        {onReplace && (
          <MenuItem
            onClick={() => {
              onReplace()
              setAnchor(null)
            }}
          >
            <SwapHorizIcon fontSize="small" sx={{ mr: 1 }} />
            用新 prompt 替换
          </MenuItem>
        )}
        {onRegenerate && (
          <MenuItem
            onClick={() => {
              onRegenerate()
              setAnchor(null)
            }}
          >
            <ReplayIcon fontSize="small" sx={{ mr: 1 }} />
            用相同 prompt 重抽
          </MenuItem>
        )}
        {onRemove && src && (
          <MenuItem
            onClick={() => {
              onRemove()
              setAnchor(null)
            }}
            sx={{ color: '#D61030' }}
          >
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
  const [art, setArt] = useState<Article | null>(null)
  const [busy, setBusy] = useState<string>('')
  const [dialog, setDialog] = useState<Dlg>(null)
  const [style, setStyle] = useState('更有网感、更口语化')
  const [instruction, setInstruction] = useState('')
  const [focus, setFocus] = useState('标题吸引力、开头钩子、情绪价值、标签')
  const [imagePrompt, setImagePrompt] = useState('')
  const [imageRole, setImageRole] = useState<'cover' | 'content'>('cover')
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null)
  const [titleCandidates, setTitleCandidates] = useState<string[]>([])
  const [polishSrc, setPolishSrc] = useState('')
  const [polishStyle, setPolishStyle] = useState('更有网感、更口语化')
  const [polishOut, setPolishOut] = useState('')
  const [coverStyle, setCoverStyle] = useState('小红书风、干净、高级感、柔和光')
  const [coverData, setCoverData] = useState<{ prompt: string; size: string } | null>(null)
  const [contentShots, setContentShots] = useState<
    Array<{ scene: string; prompt: string; size?: string }>
  >([])
  const [diag, setDiag] = useState<any>(null)
  const [imageLightbox, setImageLightbox] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(true)
  const [imageProgress, setImageProgress] = useState<string>('')
  const [editorSrc, setEditorSrc] = useState<string | null>(null)
  const [editorBinding, setEditorBinding] = useState<{
    article_id?: number
    role?: 'cover' | 'content'
    replace_index?: number
  }>({})
  const [editorDefaultMode, setEditorDefaultMode] = useState<
    'crop' | 'inpaint' | 'erase' | 'variation'
  >('inpaint')

  const load = useCallback(async () => {
    const a = await getArticle(Number(id))
    setArt(a)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

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
        axisName: { color: '#8A8A8F', fontSize: 12 },
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
    setBusy('save')
    await updateArticle(art.id, {
      title: art.title,
      body: art.body,
      tags: art.tags,
      status: art.status,
    } as any)
    setBusy('')
  }
  const handleRewrite = async () => {
    setBusy('rewrite')
    setDialog(null)
    await rewriteArticle(art.id, style, instruction)
    await load()
    setBusy('')
  }
  const handleOptimize = async () => {
    setBusy('optimize')
    setDialog(null)
    await optimizeArticle(art.id, focus)
    await load()
    setBusy('')
  }
  const handleScore = async () => {
    setBusy('score')
    await scoreArticle(art.id)
    await load()
    setBusy('')
  }
  const handleDiagnose = async () => {
    setBusy('diagnose')
    const r = await diagnoseArticle(art.id)
    setDiag(r.diagnostic)
    setBusy('')
  }
  const handleTitles = async () => {
    setBusy('titles')
    const r = await suggestTitles(art.title || art.body.slice(0, 30), art.body, 6)
    setTitleCandidates(r.titles || [])
    setDialog('titles')
    setBusy('')
  }
  const handlePolish = async () => {
    setBusy('polish')
    const r = await polishParagraph(polishSrc, polishStyle)
    setPolishOut(r.paragraph || '')
    setBusy('')
  }
  const handleCoverPrompt = async () => {
    setBusy('cover_prompt')
    const r = await coverPrompt(art.title || art.body.slice(0, 30), art.title, coverStyle)
    setCoverData(r.cover || null)
    setBusy('')
  }
  const handleContentShots = async () => {
    setBusy('content_shots')
    const r = await contentImagePrompt({ article_id: art.id, n: 4 })
    setContentShots(r.shots || [])
    setDialog('content_shots')
    setBusy('')
  }

  const runGenerate = async (
    prompt: string,
    role: 'cover' | 'content',
    replace_index?: number
  ) => {
    setImageProgress(
      role === 'cover'
        ? '正在生成封面（竖图 2:3，约 15-30 秒）…'
        : replace_index !== undefined
        ? `正在替换第 ${replace_index + 1} 张配图…`
        : '正在生成内容配图…'
    )
    try {
      await generateImageForArticle({
        prompt,
        size: role === 'cover' ? '1024x1536' : '1024x1024',
        n: 1,
        article_id: art.id,
        role,
        replace_index,
      })
      await load()
    } catch (e: any) {
      alert(`生成失败：${e?.message || e}`)
    } finally {
      setImageProgress('')
    }
  }

  const handleGenImage = async () => {
    setDialog(null)
    await runGenerate(imagePrompt, imageRole, replaceIndex ?? undefined)
    setReplaceIndex(null)
  }

  const removeCover = async () => {
    await removeArticleImage(art.id, 'cover')
    await load()
  }
  const removeContent = async (i: number) => {
    await removeArticleImage(art.id, 'content', i)
    await load()
  }

  const regenCover = async () => {
    const basePrompt =
      coverData?.prompt ||
      `minimalist, clean, premium feel, soft natural light, vertical 2:3, theme: ${art.title}`
    await runGenerate(basePrompt, 'cover')
  }

  const regenContent = async (i: number) => {
    const base = `content illustration for xiaohongshu note: ${art.title}, clean composition, soft palette, square 1:1`
    await runGenerate(base, 'content', i)
  }

  return (
    <Box sx={{ height: 'calc(100vh - 56px)', display: 'flex', bgcolor: '#fff' }}>
      {/* left: editor */}
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
              sx={{ bgcolor: '#F4EFE5', fontSize: 11, height: 20 }}
            />
            {typeof art.score?.overall === 'number' && (
              <Chip
                size="small"
                label={`评分 ${art.score.overall}`}
                sx={{ bgcolor: '#E6F7EC', color: '#0F8C3D', fontSize: 11, height: 20 }}
              />
            )}
            <Box sx={{ flex: 1 }} />
            <Tooltip title={chatOpen ? '隐藏 AI 对话侧栏' : '显示 AI 对话侧栏'}>
              <IconButton size="small" onClick={() => setChatOpen(o => !o)}>
                <ChatBubbleOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Button
              onClick={handleSave}
              variant="contained"
              size="small"
              disabled={busy === 'save'}
              sx={{ bgcolor: '#FF2741', '&:hover': { bgcolor: '#D61030' } }}
            >
              保存
            </Button>
          </Stack>

          <Stack spacing={2}>
            <TextField
              label="标题"
              value={art.title}
              onChange={e => setArt({ ...art, title: e.target.value })}
              InputProps={{ sx: { fontSize: 18, fontWeight: 600 } }}
            />
            <TextField
              label="正文"
              multiline
              minRows={14}
              value={art.body}
              onChange={e => setArt({ ...art, body: e.target.value })}
              InputProps={{ sx: { fontSize: 14.5, lineHeight: 1.75 } }}
            />
            <TextField
              label="标签（逗号分隔）"
              value={(art.tags || []).join(',')}
              onChange={e =>
                setArt({
                  ...art,
                  tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
                })
              }
            />

            <Box sx={{ pt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              <ActionButton
                icon={<ReplayIcon sx={{ fontSize: 16 }} />}
                label="整体改写"
                onClick={() => setDialog('rewrite')}
                disabled={!!busy}
              />
              <ActionButton
                icon={<AutoAwesomeIcon sx={{ fontSize: 16 }} />}
                label="细节优化"
                onClick={() => setDialog('optimize')}
                disabled={!!busy}
              />
              <ActionButton
                icon={<TitleIcon sx={{ fontSize: 16 }} />}
                label="标题候选"
                onClick={handleTitles}
                disabled={!!busy}
                loading={busy === 'titles'}
              />
              <ActionButton
                icon={<SpaIcon sx={{ fontSize: 16 }} />}
                label="段落润色"
                onClick={() => {
                  setPolishSrc('')
                  setPolishOut('')
                  setDialog('polish')
                }}
                disabled={!!busy}
              />
              <ActionButton
                icon={<WallpaperIcon sx={{ fontSize: 16 }} />}
                label="封面 Prompt"
                onClick={() => {
                  setCoverData(null)
                  setDialog('cover_prompt')
                }}
                disabled={!!busy}
              />
              <ActionButton
                icon={<CollectionsIcon sx={{ fontSize: 16 }} />}
                label="内容配图 Prompt"
                onClick={handleContentShots}
                disabled={!!busy}
                loading={busy === 'content_shots'}
              />
              <ActionButton
                icon={<ImageIcon sx={{ fontSize: 16 }} />}
                label="自定义生成"
                onClick={() => {
                  setImagePrompt('')
                  setImageRole('cover')
                  setReplaceIndex(null)
                  setDialog('image')
                }}
                disabled={!!busy}
              />
              <ActionButton
                icon={<BarChartIcon sx={{ fontSize: 16 }} />}
                label="打分"
                onClick={handleScore}
                disabled={!!busy}
                loading={busy === 'score'}
              />
              <ActionButton
                icon={<FactCheckIcon sx={{ fontSize: 16 }} />}
                label="发布前诊断"
                onClick={handleDiagnose}
                disabled={!!busy}
                loading={busy === 'diagnose'}
              />
            </Box>

            {/* inline progress bar for image generation */}
            {imageProgress && (
              <Box
                sx={{
                  border: '1px solid #EEE9E1',
                  borderRadius: 2,
                  p: 1.5,
                  bgcolor: '#FFF7E8',
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.6 }}>
                  <CircularProgress size={14} sx={{ color: '#B45309' }} />
                  <Typography sx={{ fontSize: 13, color: '#92400e' }}>{imageProgress}</Typography>
                </Stack>
                <LinearProgress
                  sx={{
                    bgcolor: '#FFD9A1',
                    '& .MuiLinearProgress-bar': { bgcolor: '#B45309' },
                    borderRadius: 2,
                    height: 4,
                  }}
                />
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
                  <Typography sx={{ fontSize: 12, color: '#8A8A8F', mb: 0.8, fontWeight: 600 }}>
                    封面（2:3）
                  </Typography>
                  <ImageFrame
                    src={art.cover_image || undefined}
                    aspect="2 / 3"
                    placeholder="暂无封面"
                    label={art.cover_image ? '封面' : undefined}
                    onOpen={art.cover_image ? () => setImageLightbox(art.cover_image) : undefined}
                    onRegenerate={regenCover}
                    onReplace={() => {
                      setImageRole('cover')
                      setReplaceIndex(null)
                      setImagePrompt(coverData?.prompt || '')
                      setDialog('image')
                    }}
                    onEdit={
                      art.cover_image
                        ? () => {
                            setEditorSrc(art.cover_image)
                            setEditorBinding({ article_id: art.id, role: 'cover' })
                            setEditorDefaultMode('inpaint')
                          }
                        : undefined
                    }
                    onRemove={art.cover_image ? removeCover : undefined}
                    disabled={!!imageProgress}
                  />
                </Box>

                {/* content images grid */}
                <Box sx={{ flex: 1, width: '100%' }}>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.8 }}>
                    <Typography sx={{ fontSize: 12, color: '#8A8A8F', fontWeight: 600 }}>
                      内容配图（1:1）
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Button
                      size="small"
                      startIcon={<CollectionsIcon sx={{ fontSize: 16 }} />}
                      onClick={handleContentShots}
                      disabled={!!busy || !!imageProgress}
                      sx={{ fontSize: 12, color: '#1F1F1F' }}
                    >
                      {busy === 'content_shots' ? '生成中…' : '按段落配 4 张'}
                    </Button>
                  </Stack>
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
                        onRegenerate={() => regenContent(i)}
                        onReplace={() => {
                          setImageRole('content')
                          setReplaceIndex(i)
                          setImagePrompt('')
                          setDialog('image')
                        }}
                        onEdit={() => {
                          setEditorSrc(u)
                          setEditorBinding({
                            article_id: art.id,
                            role: 'content',
                            replace_index: i,
                          })
                          setEditorDefaultMode('inpaint')
                        }}
                        onRemove={() => removeContent(i)}
                        disabled={!!imageProgress}
                      />
                    ))}
                    <Box
                      onClick={() => {
                        if (imageProgress) return
                        setImageRole('content')
                        setReplaceIndex(null)
                        setImagePrompt('')
                        setDialog('image')
                      }}
                      sx={{
                        aspectRatio: '1 / 1',
                        border: '1px dashed #d1d5db',
                        borderRadius: 2,
                        display: 'grid',
                        placeItems: 'center',
                        color: '#B8B4AB',
                        cursor: 'pointer',
                        fontSize: 12,
                        '&:hover': {
                          borderColor: '#B8B4AB',
                          bgcolor: '#FAF7F2',
                          color: '#1F1F1F',
                        },
                      }}
                    >
                      + 添加
                    </Box>
                  </Box>
                </Box>
              </Stack>
            </Box>

            {/* score + diagnostic */}
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <Box sx={{ flex: 1, border: '1px solid #EEE9E1', borderRadius: 2.5, p: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#8A8A8F' }}>
                    五维评分
                  </Typography>
                  {typeof art.score?.overall === 'number' && (
                    <Chip
                      size="small"
                      label={`综合 ${art.score.overall}`}
                      sx={{ bgcolor: '#E6F7EC', color: '#0F8C3D', fontSize: 11, height: 20 }}
                    />
                  )}
                </Stack>
                <ReactECharts option={scoreOption} style={{ height: 220 }} />
                {art.score?.advice && (
                  <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                    {(art.score.advice as string[]).slice(0, 3).map((x, i) => (
                      <Typography key={i} sx={{ fontSize: 12, color: '#8A8A8F' }}>
                        · {x}
                      </Typography>
                    ))}
                  </Stack>
                )}
              </Box>

              {diag && (
                <Box
                  sx={{
                    flex: 1,
                    border: '1px solid #EEE9E1',
                    borderRadius: 2.5,
                    p: 2,
                    bgcolor: '#FAF7F2',
                  }}
                >
                  <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1 }}>
                    {diag.publish_ready ? '✅ 可发布' : '⚠️ 建议修改再发'}
                  </Typography>
                  <Stack spacing={1.2}>
                    {(['risks', 'missing', 'suggestions'] as const).map(k =>
                      Array.isArray(diag[k]) && diag[k].length > 0 ? (
                        <Box key={k}>
                          <Typography
                            sx={{
                              fontSize: 11,
                              fontWeight: 600,
                              color:
                                k === 'risks'
                                  ? '#D61030'
                                  : k === 'missing'
                                  ? '#B45309'
                                  : '#0F6FC9',
                              textTransform: 'uppercase',
                              letterSpacing: 0.5,
                            }}
                          >
                            {k === 'risks' ? '风险' : k === 'missing' ? '缺失' : '建议'}
                          </Typography>
                          {(diag[k] as string[]).map((r, i) => (
                            <Typography key={i} sx={{ fontSize: 13, color: '#1F1F1F' }}>
                              · {r}
                            </Typography>
                          ))}
                        </Box>
                      ) : null
                    )}
                  </Stack>
                </Box>
              )}
            </Stack>
          </Stack>
        </Box>
      </Box>

      {/* right: chat panel */}
      {chatOpen && (
        <Box
          sx={{
            width: { xs: '100%', md: 420 },
            minWidth: { md: 360 },
            borderLeft: '1px solid #e5e7eb',
            display: { xs: 'none', md: 'flex' },
            flexDirection: 'column',
            flexShrink: 0,
          }}
        >
          <ChatPanel
            article={art}
            onArticleMayChange={load}
            quickActions={[
              { label: '加强钩子', prompt: '开头的钩子不够戳人，帮我改得更直戳痛点一些' },
              { label: '优化标签', prompt: '检查标签，替换成搜索流量更高、更垂直的版本' },
              { label: '生成封面', prompt: '为这篇笔记生成一张干净、有高级感的竖版封面' },
              { label: '配 4 张图', prompt: '根据这篇笔记按段落生成 4 张 1:1 的内容配图' },
              { label: '发布前诊断', prompt: '帮我诊断一下能不能发，重点检查违禁词和 CTA' },
            ]}
          />
        </Box>
      )}

      {/* ------------ dialogs ------------ */}
      <Dialog open={dialog === 'rewrite'} onClose={() => setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 600 }}>整体改写</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="风格" value={style} onChange={e => setStyle(e.target.value)} />
            <TextField
              label="附加要求"
              multiline
              minRows={3}
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>取消</Button>
          <Button
            variant="contained"
            onClick={handleRewrite}
            sx={{ bgcolor: '#FF2741', '&:hover': { bgcolor: '#D61030' } }}
          >
            开始改写
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog === 'optimize'} onClose={() => setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 600 }}>细节优化</DialogTitle>
        <DialogContent>
          <TextField
            sx={{ mt: 1 }}
            fullWidth
            label="优化重点"
            multiline
            minRows={3}
            value={focus}
            onChange={e => setFocus(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>取消</Button>
          <Button
            variant="contained"
            onClick={handleOptimize}
            sx={{ bgcolor: '#FF2741', '&:hover': { bgcolor: '#D61030' } }}
          >
            开始优化
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog === 'image'} onClose={() => setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 600 }}>
          {replaceIndex !== null
            ? `替换第 ${replaceIndex + 1} 张配图`
            : imageRole === 'cover'
            ? '生成封面'
            : '生成内容配图'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {replaceIndex === null && (
              <Stack direction="row" spacing={1}>
                <Chip
                  label="封面（竖图 2:3）"
                  color={imageRole === 'cover' ? 'primary' : 'default'}
                  onClick={() => setImageRole('cover')}
                  variant={imageRole === 'cover' ? 'filled' : 'outlined'}
                />
                <Chip
                  label="正文配图（方图）"
                  color={imageRole === 'content' ? 'primary' : 'default'}
                  onClick={() => setImageRole('content')}
                  variant={imageRole === 'content' ? 'filled' : 'outlined'}
                />
              </Stack>
            )}
            <TextField
              label="图片描述 prompt（英文效果最佳）"
              multiline
              minRows={4}
              value={imagePrompt}
              onChange={e => setImagePrompt(e.target.value)}
            />
            <Typography sx={{ fontSize: 12, color: '#B8B4AB' }}>
              也可以先点 <b>封面 Prompt</b> 或 <b>内容配图 Prompt</b> 让 AI 写一版更专业的提示词。
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>取消</Button>
          <Button
            variant="contained"
            onClick={handleGenImage}
            disabled={!imagePrompt}
            sx={{ bgcolor: '#FF2741', '&:hover': { bgcolor: '#D61030' } }}
          >
            生成
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog === 'titles'} onClose={() => setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 600 }}>候选标题</DialogTitle>
        <DialogContent>
          <Stack spacing={1} sx={{ mt: 1 }}>
            {titleCandidates.map((t, i) => (
              <Box
                key={i}
                sx={{
                  p: 1.4,
                  border: '1px solid #EEE9E1',
                  borderRadius: 1.5,
                  cursor: 'pointer',
                  '&:hover': { borderColor: '#B8B4AB', bgcolor: '#FAF7F2' },
                }}
                onClick={() => {
                  setArt({ ...art, title: t })
                  setDialog(null)
                }}
              >
                <Typography sx={{ fontSize: 14 }}>{t}</Typography>
              </Box>
            ))}
            {titleCandidates.length === 0 && (
              <Alert severity="info">尚未生成候选。</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>关闭</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog === 'polish'} onClose={() => setDialog(null)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 600 }}>段落润色</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="需要润色的段落"
              multiline
              minRows={4}
              value={polishSrc}
              onChange={e => setPolishSrc(e.target.value)}
            />
            <TextField
              label="风格"
              value={polishStyle}
              onChange={e => setPolishStyle(e.target.value)}
            />
            <Button
              variant="contained"
              onClick={handlePolish}
              disabled={!polishSrc || busy === 'polish'}
              startIcon={busy === 'polish' ? <CircularProgress size={14} /> : <SpaIcon />}
              sx={{
                alignSelf: 'flex-start',
                bgcolor: '#FF2741',
                '&:hover': { bgcolor: '#D61030' },
              }}
            >
              {busy === 'polish' ? '润色中…' : '润色'}
            </Button>
            {polishOut && (
              <Box
                sx={{
                  p: 2,
                  bgcolor: '#FAF7F2',
                  borderRadius: 2,
                  border: '1px solid #EEE9E1',
                }}
              >
                <Typography sx={{ fontSize: 11, color: '#B8B4AB', mb: 0.5 }}>
                  润色结果
                </Typography>
                <Typography sx={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7 }}>
                  {polishOut}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => navigator.clipboard.writeText(polishOut)}
                  >
                    复制
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => {
                      setArt({ ...art, body: polishOut })
                      setDialog(null)
                    }}
                  >
                    替换正文
                  </Button>
                </Stack>
              </Box>
            )}
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'cover_prompt'} onClose={() => setDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 600 }}>封面 Prompt 建议</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="风格描述"
              value={coverStyle}
              onChange={e => setCoverStyle(e.target.value)}
            />
            <Button
              variant="contained"
              onClick={handleCoverPrompt}
              disabled={busy === 'cover_prompt'}
              sx={{
                alignSelf: 'flex-start',
                bgcolor: '#FF2741',
                '&:hover': { bgcolor: '#D61030' },
              }}
            >
              {busy === 'cover_prompt' ? '生成中…' : '生成 prompt'}
            </Button>
            {coverData && (
              <Box
                sx={{
                  p: 2,
                  bgcolor: '#FAF7F2',
                  borderRadius: 2,
                  border: '1px solid #EEE9E1',
                }}
              >
                <Typography sx={{ fontSize: 11, color: '#B8B4AB' }}>
                  size: {coverData.size || '1024x1536'}
                </Typography>
                <Typography sx={{ mt: 1, whiteSpace: 'pre-wrap', fontSize: 14 }}>
                  {coverData.prompt}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => {
                      setImagePrompt(coverData.prompt)
                      setImageRole('cover')
                      setReplaceIndex(null)
                      setDialog('image')
                    }}
                  >
                    用这段生成
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={async () => {
                      setDialog(null)
                      await runGenerate(coverData.prompt, 'cover')
                    }}
                    sx={{ bgcolor: '#FF2741', '&:hover': { bgcolor: '#D61030' } }}
                  >
                    直接生成封面
                  </Button>
                </Stack>
              </Box>
            )}
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'content_shots'} onClose={() => setDialog(null)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 600 }}>内容配图 Prompt · 按段落</DialogTitle>
        <DialogContent>
          <Stack spacing={1.2} sx={{ mt: 1 }}>
            {contentShots.length === 0 && (
              <Alert severity="info">尚未生成。先点"按段落配 4 张"。</Alert>
            )}
            {contentShots.map((s, i) => (
              <Box
                key={i}
                sx={{
                  p: 1.4,
                  border: '1px solid #EEE9E1',
                  borderRadius: 2,
                  bgcolor: '#fff',
                }}
              >
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#1F1F1F', mb: 0.6 }}>
                  {i + 1}. {s.scene}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 12.5,
                    color: '#8A8A8F',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'ui-monospace, Menlo, monospace',
                  }}
                >
                  {s.prompt}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      setImageRole('content')
                      setReplaceIndex(null)
                      setImagePrompt(s.prompt)
                      setDialog('image')
                    }}
                  >
                    编辑后生成
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={async () => {
                      await runGenerate(s.prompt, 'content')
                    }}
                    sx={{ bgcolor: '#FF2741', '&:hover': { bgcolor: '#D61030' } }}
                  >
                    直接生成 1 张
                  </Button>
                </Stack>
              </Box>
            ))}
            {contentShots.length > 0 && (
              <Button
                variant="contained"
                onClick={async () => {
                  setDialog(null)
                  for (const s of contentShots) {
                    await runGenerate(s.prompt, 'content')
                  }
                }}
                sx={{
                  bgcolor: '#FF2741',
                  '&:hover': { bgcolor: '#D61030' },
                  alignSelf: 'flex-start',
                }}
              >
                顺序生成全部 {contentShots.length} 张
              </Button>
            )}
          </Stack>
        </DialogContent>
      </Dialog>

      {/* Lightbox */}
      <Dialog
        open={!!imageLightbox}
        onClose={() => setImageLightbox(null)}
        maxWidth="md"
        PaperProps={{ sx: { bgcolor: '#1F1F1F', border: 'none' } }}
      >
        {imageLightbox && (
          <Box
            component="img"
            src={imageLightbox}
            sx={{ maxWidth: '90vw', maxHeight: '85vh', display: 'block' }}
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
    </Box>
  )
}
