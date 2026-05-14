import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import CleaningServicesIcon from '@mui/icons-material/CleaningServices'
import ImageSearchIcon from '@mui/icons-material/ImageSearch'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import UploadIcon from '@mui/icons-material/Upload'
import { toast } from 'sonner'
import {
  editImage,
  generateImage,
  inpaintImage,
  removeObject,
  uploadImage,
  uploadMask,
} from '../api/client'

type Quality = 'high' | 'medium' | 'low' | 'auto'
type BoxRect = { x: number; y: number; w: number; h: number }
type LogItem = { title: string; detail: string; image?: string; elapsedSec?: number; ok?: boolean }
type SemanticRegion = BoxRect & { id: string; label: string; prompt?: string }

const DEFAULT_PROMPT = '小红书爆款封面海报，主题是威海海景民宿，奶油蓝+米白色调，落地窗看海上日出，房间干净温馨，有评价卡片、价格标签和旅行贴纸，整体高级清爽，图文排版精致，适合女性收藏种草，中文标题区域清晰。'
const DEFAULT_EDIT_PROMPT = '把选区改成更精致的小红书风格装饰卡片，保持整体奶油蓝色调和海景民宿氛围。'

function absUrl(u: string) {
  if (!u) return u
  if (u.startsWith('http') || u.startsWith('data:')) return u
  return u
}

function clampRect(rect: BoxRect, width: number, height: number): BoxRect {
  const x = Math.max(0, Math.min(width - 1, Math.round(rect.x)))
  const y = Math.max(0, Math.min(height - 1, Math.round(rect.y)))
  const w = Math.max(1, Math.min(width - x, Math.round(rect.w)))
  const h = Math.max(1, Math.min(height - y, Math.round(rect.h)))
  return { x, y, w, h }
}

async function buildRectMask(rect: BoxRect, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  // OpenAI-style edit mask: opaque means keep, transparent means editable.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.clearRect(rect.x, rect.y, rect.w, rect.h)
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('mask blob failed'))), 'image/png')
  })
}

export default function AiImageLabPage() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)

  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [editPrompt, setEditPrompt] = useState(DEFAULT_EDIT_PROMPT)
  const [size, setSize] = useState('1152x1536')
  const [quality, setQuality] = useState<Quality>('high')
  const [imageUrl, setImageUrl] = useState('')
  const [resultUrl, setResultUrl] = useState('')
  const [busy, setBusy] = useState('')
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [display, setDisplay] = useState({ w: 0, h: 0 })
  const [selection, setSelection] = useState<BoxRect | null>(null)
  const [regions, setRegions] = useState<SemanticRegion[]>([])
  const [logs, setLogs] = useState<LogItem[]>([])

  useEffect(() => {
    const onResize = () => syncDisplayRect()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function addLog(item: LogItem) {
    setLogs(prev => [{ ...item }, ...prev].slice(0, 12))
  }

  function syncDisplayRect() {
    const img = imgRef.current
    if (!img) return
    const rect = img.getBoundingClientRect()
    setDisplay({ w: rect.width, h: rect.height })
  }

  function eventToImagePoint(e: React.PointerEvent) {
    const img = imgRef.current
    if (!img || !natural.w || !display.w) return { x: 0, y: 0 }
    const rect = img.getBoundingClientRect()
    const sx = natural.w / rect.width
    const sy = natural.h / rect.height
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy,
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!imageUrl || !natural.w) return
    const p = eventToImagePoint(e)
    dragStartRef.current = p
    setSelection({ x: Math.round(p.x), y: Math.round(p.y), w: 1, h: 1 })
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragStartRef.current || !natural.w) return
    const p = eventToImagePoint(e)
    const s = dragStartRef.current
    const x = Math.min(s.x, p.x)
    const y = Math.min(s.y, p.y)
    const w = Math.abs(p.x - s.x)
    const h = Math.abs(p.y - s.y)
    setSelection(clampRect({ x, y, w, h }, natural.w, natural.h))
  }

  function onPointerUp() {
    dragStartRef.current = null
  }

  async function handleGenerate() {
    setBusy('正在调用当前图片模型生成整图…')
    setResultUrl('')
    const start = performance.now()
    try {
      const urls = await generateImage(prompt, size, 1, quality)
      const url = urls[0] || ''
      setImageUrl(url)
      setSelection(null)
      setRegions([])
      addLog({ ok: true, title: '整图生成成功', detail: `${size} · quality=${quality}`, image: url, elapsedSec: (performance.now() - start) / 1000 })
    } catch (e: any) {
      addLog({ ok: false, title: '整图生成失败', detail: e?.message || '未知错误', elapsedSec: (performance.now() - start) / 1000 })
      toast.error(e?.message || '生成失败')
    } finally {
      setBusy('')
    }
  }

  async function handleUpload(file?: File | null) {
    if (!file) return
    setBusy('正在上传图片…')
    try {
      const url = await uploadImage(file)
      setImageUrl(url)
      setResultUrl('')
      setSelection(null)
      setRegions([])
      addLog({ ok: true, title: '上传图片成功', detail: file.name, image: url })
    } catch (e: any) {
      toast.error(e?.message || '上传失败')
    } finally {
      setBusy('')
    }
  }

  async function selectedMaskUrl() {
    if (!selection || !natural.w || !natural.h) throw new Error('请先在图片上拖拽框选一个区域')
    const rect = clampRect(selection, natural.w, natural.h)
    const blob = await buildRectMask(rect, natural.w, natural.h)
    return { mask_url: await uploadMask(blob), rect }
  }

  async function handleInpaint() {
    if (!imageUrl) return toast.error('请先生成或上传图片')
    setBusy('正在对选区进行 AI 局部重绘…')
    const start = performance.now()
    try {
      const { mask_url, rect } = await selectedMaskUrl()
      const r = await inpaintImage({ image_url: imageUrl, mask_url, prompt: editPrompt, size: `${natural.w}x${natural.h}`, quality })
      if (!r.ok) throw new Error((r as any).error || '局部重绘失败')
      setResultUrl(r.image)
      setRegions(prev => [{ ...rect, id: `region_${Date.now()}`, label: '局部重绘选区', prompt: editPrompt }, ...prev])
      addLog({ ok: true, title: '局部重绘成功', detail: `${rect.w}×${rect.h}px · ${editPrompt}`, image: r.image, elapsedSec: (performance.now() - start) / 1000 })
    } catch (e: any) {
      addLog({ ok: false, title: '局部重绘失败', detail: e?.message || '未知错误', elapsedSec: (performance.now() - start) / 1000 })
      toast.error(e?.message || '局部重绘失败')
    } finally {
      setBusy('')
    }
  }

  async function handleErase() {
    if (!imageUrl) return toast.error('请先生成或上传图片')
    setBusy('正在 AI 消除选区并补背景…')
    const start = performance.now()
    try {
      const { mask_url, rect } = await selectedMaskUrl()
      const r = await removeObject({ image_url: imageUrl, mask_url, size: `${natural.w}x${natural.h}`, quality })
      if (!r.ok) throw new Error((r as any).error || '消除失败')
      setResultUrl(r.image)
      setRegions(prev => [{ ...rect, id: `region_${Date.now()}`, label: '消除选区' }, ...prev])
      addLog({ ok: true, title: '选区消除成功', detail: `${rect.w}×${rect.h}px`, image: r.image, elapsedSec: (performance.now() - start) / 1000 })
    } catch (e: any) {
      addLog({ ok: false, title: '选区消除失败', detail: e?.message || '未知错误', elapsedSec: (performance.now() - start) / 1000 })
      toast.error(e?.message || '消除失败')
    } finally {
      setBusy('')
    }
  }

  async function handleWholeEdit() {
    if (!imageUrl) return toast.error('请先生成或上传图片')
    setBusy('正在 AI 整体编辑当前图片…')
    const start = performance.now()
    try {
      const r = await editImage({ image_url: imageUrl, prompt: editPrompt, size: natural.w && natural.h ? `${natural.w}x${natural.h}` : size, quality })
      if (!r.ok) throw new Error((r as any).error || '整体编辑失败')
      setResultUrl(r.image)
      addLog({ ok: true, title: '整体编辑成功', detail: editPrompt, image: r.image, elapsedSec: (performance.now() - start) / 1000 })
    } catch (e: any) {
      addLog({ ok: false, title: '整体编辑失败', detail: e?.message || '未知错误', elapsedSec: (performance.now() - start) / 1000 })
      toast.error(e?.message || '整体编辑失败')
    } finally {
      setBusy('')
    }
  }

  function useResultAsCurrent() {
    if (!resultUrl) return
    setImageUrl(resultUrl)
    setResultUrl('')
    setSelection(null)
    toast.success('已将结果设为当前图，可继续选区编辑')
  }

  const selectionStyle = selection && display.w && display.h && natural.w && natural.h ? {
    left: `${(selection.x / natural.w) * display.w}px`,
    top: `${(selection.y / natural.h) * display.h}px`,
    width: `${(selection.w / natural.w) * display.w}px`,
    height: `${(selection.h / natural.h) * display.h}px`,
  } : undefined

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1480, mx: 'auto' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }} sx={{ mb: 2 }}>
        <Box flex={1}>
          <Typography sx={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.8 }}>AI Native 图片编辑 Demo</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5 }}>
            用当前配置真实调用：整图生成 → 框选区域 → 局部重绘/消除/整体编辑。这个 demo 用来验证“先发挥 AI 生图能力，再做语义选区编辑”的路线。
          </Typography>
        </Box>
        <Chip icon={<ImageSearchIcon />} label="独立实验页，不影响笔记数据" sx={{ alignSelf: { xs: 'flex-start', md: 'center' } }} />
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '360px minmax(0,1fr) 320px' }, gap: 2 }}>
        <Paper sx={{ p: 2, borderRadius: 3 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 800, mb: 1 }}>1. 整图生成 / 上传</Typography>
          <TextField
            label="整图生成 Prompt"
            multiline
            minRows={6}
            fullWidth
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
          />
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <TextField label="size" value={size} onChange={e => setSize(e.target.value)} size="small" fullWidth />
            <Select size="small" value={quality} onChange={e => setQuality(e.target.value as Quality)} sx={{ minWidth: 110 }}>
              {(['high', 'medium', 'low', 'auto'] as Quality[]).map(q => <MenuItem key={q} value={q}>{q}</MenuItem>)}
            </Select>
          </Stack>
          <Stack spacing={1} sx={{ mt: 1 }}>
            <Button variant="contained" startIcon={<AutoFixHighIcon />} disabled={!!busy || !prompt.trim()} onClick={handleGenerate}>
              用当前图片 API 生成整图
            </Button>
            <Button variant="outlined" component="label" startIcon={<UploadIcon />} disabled={!!busy}>
              上传已有图测试
              <input hidden type="file" accept="image/*" onChange={e => handleUpload(e.target.files?.[0])} />
            </Button>
          </Stack>

          <Typography sx={{ fontSize: 15, fontWeight: 800, mt: 3, mb: 1 }}>2. 选区编辑 Prompt</Typography>
          <TextField
            label="局部/整体编辑 Prompt"
            multiline
            minRows={5}
            fullWidth
            value={editPrompt}
            onChange={e => setEditPrompt(e.target.value)}
          />
          <Stack spacing={1} sx={{ mt: 1 }}>
            <Button variant="contained" color="warning" disabled={!!busy || !imageUrl || !selection} onClick={handleInpaint}>
              AI 局部重绘选区
            </Button>
            <Button variant="outlined" color="error" startIcon={<CleaningServicesIcon />} disabled={!!busy || !imageUrl || !selection} onClick={handleErase}>
              AI 消除选区
            </Button>
            <Button variant="outlined" disabled={!!busy || !imageUrl} onClick={handleWholeEdit}>
              AI 整体编辑当前图
            </Button>
          </Stack>
          {selection && (
            <Typography sx={{ mt: 1, fontSize: 12, color: 'text.secondary' }}>
              当前选区：x={selection.x}, y={selection.y}, {selection.w}×{selection.h}px
            </Typography>
          )}
          <Button size="small" startIcon={<RestartAltIcon />} onClick={() => { setSelection(null); setResultUrl('') }} sx={{ mt: 1 }}>
            清空选区/结果
          </Button>
        </Paper>

        <Paper sx={{ p: 2, borderRadius: 3, minHeight: 680, display: 'flex', flexDirection: 'column' }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 800 }}>画布</Typography>
            {natural.w > 0 && <Chip size="small" label={`${natural.w}×${natural.h}`} />}
            <Box flex={1} />
            {busy && <Chip color="warning" size="small" label={busy} />}
          </Stack>
          <Box
            ref={wrapRef}
            sx={{
              flex: 1,
              minHeight: 560,
              borderRadius: 3,
              border: '1px dashed',
              borderColor: 'divider',
              bgcolor: 'rgba(0,0,0,0.025)',
              display: 'grid',
              placeItems: 'center',
              overflow: 'hidden',
              p: 2,
            }}
          >
            {!imageUrl ? (
              <Stack alignItems="center" spacing={1} sx={{ color: 'text.secondary' }}>
                <ImageSearchIcon sx={{ fontSize: 48, opacity: 0.5 }} />
                <Typography>先生成或上传一张图片</Typography>
              </Stack>
            ) : (
              <Box sx={{ position: 'relative', maxWidth: '100%', maxHeight: '100%' }}>
                <Box
                  component="img"
                  ref={imgRef}
                  src={absUrl(imageUrl)}
                  onLoad={e => {
                    const img = e.currentTarget
                    setNatural({ w: img.naturalWidth, h: img.naturalHeight })
                    requestAnimationFrame(syncDisplayRect)
                  }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerLeave={onPointerUp}
                  draggable={false}
                  sx={{
                    maxWidth: '100%',
                    maxHeight: '620px',
                    display: 'block',
                    userSelect: 'none',
                    cursor: 'crosshair',
                    borderRadius: 2,
                    boxShadow: '0 22px 60px rgba(0,0,0,0.14)',
                  }}
                />
                {selectionStyle && (
                  <Box
                    sx={{
                      position: 'absolute',
                      border: '2px solid #FF2442',
                      boxShadow: '0 0 0 9999px rgba(0,0,0,0.28)',
                      pointerEvents: 'none',
                      borderRadius: 0.8,
                      ...selectionStyle,
                    }}
                  />
                )}
              </Box>
            )}
          </Box>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>
            在图片上拖拽即可生成矩形选区。真实产品里这一步可以升级为 OCR 文本框、SAM 元素分割和语义图层。
          </Typography>
        </Paper>

        <Stack spacing={2}>
          <Paper sx={{ p: 2, borderRadius: 3 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 800, mb: 1 }}>结果图</Typography>
            {busy && <CircularProgress size={18} sx={{ mb: 1 }} />}
            {resultUrl ? (
              <>
                <Box component="img" src={absUrl(resultUrl)} sx={{ width: '100%', borderRadius: 2, border: '1px solid', borderColor: 'divider' }} />
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <Button size="small" variant="contained" onClick={useResultAsCurrent}>设为当前图</Button>
                  <Button size="small" variant="outlined" href={absUrl(resultUrl)} target="_blank">打开</Button>
                </Stack>
              </>
            ) : (
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>局部/整体编辑成功后会显示在这里。</Typography>
            )}
          </Paper>

          <Paper sx={{ p: 2, borderRadius: 3 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 800, mb: 1 }}>语义选区记录（demo）</Typography>
            {regions.length === 0 ? (
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>暂无。每次局部编辑会记录一个“语义区域”。</Typography>
            ) : regions.map(r => (
              <Box key={r.id} sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 2, mb: 1 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{r.label}</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>x={r.x}, y={r.y}, {r.w}×{r.h}</Typography>
                {r.prompt && <Typography sx={{ fontSize: 12, color: 'text.secondary' }} noWrap>{r.prompt}</Typography>}
              </Box>
            ))}
          </Paper>

          <Paper sx={{ p: 2, borderRadius: 3 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 800, mb: 1 }}>调用日志</Typography>
            {logs.length === 0 ? <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>暂无调用。</Typography> : logs.map((l, i) => (
              <Box key={i} sx={{ p: 1, borderBottom: i === logs.length - 1 ? 0 : '1px solid', borderColor: 'divider' }}>
                <Stack direction="row" spacing={0.6} alignItems="center">
                  <Chip size="small" color={l.ok === false ? 'error' : 'success'} label={l.ok === false ? '失败' : '成功'} sx={{ height: 20, fontSize: 10 }} />
                  <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{l.title}</Typography>
                  {l.elapsedSec !== undefined && <Typography sx={{ fontSize: 11, color: 'text.secondary', ml: 'auto' }}>{l.elapsedSec.toFixed(1)}s</Typography>}
                </Stack>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.3 }} noWrap>{l.detail}</Typography>
              </Box>
            ))}
          </Paper>
        </Stack>
      </Box>
    </Box>
  )
}
