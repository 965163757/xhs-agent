import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
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
import ContentCutIcon from '@mui/icons-material/ContentCut'
import DownloadDoneIcon from '@mui/icons-material/DownloadDone'
import ImageSearchIcon from '@mui/icons-material/ImageSearch'
import LayersIcon from '@mui/icons-material/Layers'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import TextFieldsIcon from '@mui/icons-material/TextFields'
import UploadIcon from '@mui/icons-material/Upload'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { toast } from 'sonner'
import {
  analyzeImageLayers,
  editImage,
  extractPixelLayers,
  generateImage,
  inpaintImage,
  removeObject,
  uploadImage,
  uploadMask,
  type AnalyzedImageLayer,
  type PixelExtractedLayer,
} from '../api/client'

type Quality = 'high' | 'medium' | 'low' | 'auto'
type BoxRect = { x: number; y: number; w: number; h: number }
type LogItem = { title: string; detail: string; image?: string; elapsedSec?: number; ok?: boolean }
type DemoLayerType = 'text' | 'object' | 'background' | 'decoration' | 'image_overlay'
type DemoLayer = BoxRect & {
  id: string
  type: DemoLayerType
  label: string
  text?: string
  hidden?: boolean
  confidence?: number
  fontFamily?: string
  fontSize?: number
  color?: string
  fontWeight?: number
  imageUrl?: string
  edit_prompt?: string
  opacity?: number
  zIndex: number
}

type DragState = {
  id: string
  mode: 'move' | 'resize'
  start: { x: number; y: number }
  original: BoxRect
}

const DEFAULT_PROMPT = '小红书爆款封面海报，主题是威海海景民宿，奶油蓝+米白色调，落地窗看海上日出，房间干净温馨，有评价卡片、价格标签和旅行贴纸，整体高级清爽，图文排版精致，适合女性收藏种草，中文标题区域清晰。'
const DEFAULT_EDIT_PROMPT = '把选区改成更精致的小红书风格装饰卡片，保持整体奶油蓝色调和海景民宿氛围。'
const FONT_OPTIONS = [
  'PingFang SC',
  'Microsoft YaHei',
  'Noto Sans SC',
  'Source Han Sans SC',
  'Arial',
  'serif',
  'cursive',
]

function absUrl(u: string) {
  if (!u) return u
  if (u.startsWith('http') || u.startsWith('data:')) return u
  return u
}

function clampRect(rect: BoxRect, width: number, height: number): BoxRect {
  const x = Math.max(0, Math.min(Math.max(0, width - 1), Math.round(rect.x)))
  const y = Math.max(0, Math.min(Math.max(0, height - 1), Math.round(rect.y)))
  const w = Math.max(1, Math.min(Math.max(1, width - x), Math.round(rect.w)))
  const h = Math.max(1, Math.min(Math.max(1, height - y), Math.round(rect.h)))
  return { x, y, w, h }
}

function normToRect(bbox: [number, number, number, number], width: number, height: number): BoxRect {
  const [x, y, w, h] = bbox
  return clampRect(
    {
      x: (x / 1000) * width,
      y: (y / 1000) * height,
      w: (w / 1000) * width,
      h: (h / 1000) * height,
    },
    width,
    height,
  )
}

function rectLabel(r: BoxRect) {
  return `x=${Math.round(r.x)}, y=${Math.round(r.y)}, ${Math.round(r.w)}×${Math.round(r.h)}`
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

async function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('export blob failed'))), 'image/png')
  })
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = absUrl(src)
  })
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const raw = String(text || '').split('\n')
  const lines: string[] = []
  for (const paragraph of raw) {
    let line = ''
    for (const ch of paragraph) {
      const next = line + ch
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line)
        line = ch
      } else {
        line = next
      }
    }
    lines.push(line)
  }
  return lines
}

export default function AiImageLabPage() {
  const imgRef = useRef<HTMLImageElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)

  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [editPrompt, setEditPrompt] = useState(DEFAULT_EDIT_PROMPT)
  const [size, setSize] = useState('1152x1536')
  const [quality, setQuality] = useState<Quality>('high')
  const [imageUrl, setImageUrl] = useState('')
  const [resultUrl, setResultUrl] = useState('')
  const [busy, setBusy] = useState('')
  const [pixelSensitivity, setPixelSensitivity] = useState(0.58)
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [display, setDisplay] = useState({ w: 0, h: 0 })
  const [selection, setSelection] = useState<BoxRect | null>(null)
  const [layers, setLayers] = useState<DemoLayer[]>([])
  const [selectedLayerId, setSelectedLayerId] = useState('')
  const [logs, setLogs] = useState<LogItem[]>([])
  const [drag, setDrag] = useState<DragState | null>(null)

  const selectedLayer = layers.find(l => l.id === selectedLayerId)

  useEffect(() => {
    const onResize = () => syncDisplayRect()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function addLog(item: LogItem) {
    setLogs(prev => [{ ...item }, ...prev].slice(0, 14))
  }

  function syncDisplayRect() {
    const img = imgRef.current
    if (!img) return
    const rect = img.getBoundingClientRect()
    setDisplay({ w: rect.width, h: rect.height })
  }

  function updateLayer(id: string, patch: Partial<DemoLayer>) {
    setLayers(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l)))
  }

  function normalizeZIndex(items: DemoLayer[]) {
    return [...items]
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((l, idx) => ({ ...l, zIndex: idx + 1 }))
  }

  function moveLayerOrder(id: string, direction: -1 | 1) {
    setLayers(prev => {
      const sorted = normalizeZIndex(prev)
      const idx = sorted.findIndex(l => l.id === id)
      const target = idx + direction
      if (idx < 0 || target < 0 || target >= sorted.length) return prev
      const next = [...sorted]
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return normalizeZIndex(next)
    })
  }

  function duplicateLayer(id: string) {
    setLayers(prev => {
      const src = prev.find(l => l.id === id)
      if (!src) return prev
      const next: DemoLayer = {
        ...src,
        id: `${src.type}_${Date.now()}`,
        label: `${src.label} 副本`,
        x: Math.min(natural.w - 1, src.x + Math.max(8, src.w * 0.04)),
        y: Math.min(natural.h - 1, src.y + Math.max(8, src.h * 0.04)),
        zIndex: Math.max(...prev.map(l => l.zIndex), 0) + 1,
      }
      setSelectedLayerId(next.id)
      return [...prev, next]
    })
  }

  function eventToImagePoint(e: ReactPointerEvent) {
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

  function onCanvasPointerDown(e: ReactPointerEvent) {
    if (!imageUrl || !natural.w) return
    const p = eventToImagePoint(e)
    dragStartRef.current = p
    setSelectedLayerId('')
    setSelection({ x: Math.round(p.x), y: Math.round(p.y), w: 1, h: 1 })
  }

  function onCanvasPointerMove(e: ReactPointerEvent) {
    if (drag) {
      const p = eventToImagePoint(e)
      const dx = p.x - drag.start.x
      const dy = p.y - drag.start.y
      if (drag.mode === 'move') {
        updateLayer(drag.id, clampRect({ ...drag.original, x: drag.original.x + dx, y: drag.original.y + dy }, natural.w, natural.h))
      } else {
        updateLayer(drag.id, clampRect({ ...drag.original, w: drag.original.w + dx, h: drag.original.h + dy }, natural.w, natural.h))
      }
      return
    }
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
    setDrag(null)
  }

  function layerStyle(layer: DemoLayer) {
    return {
      left: `${(layer.x / natural.w) * display.w}px`,
      top: `${(layer.y / natural.h) * display.h}px`,
      width: `${(layer.w / natural.w) * display.w}px`,
      height: `${(layer.h / natural.h) * display.h}px`,
    }
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
      setLayers([])
      setSelectedLayerId('')
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
      setLayers([])
      setSelectedLayerId('')
      addLog({ ok: true, title: '上传图片成功', detail: file.name, image: url })
    } catch (e: any) {
      toast.error(e?.message || '上传失败')
    } finally {
      setBusy('')
    }
  }

  async function handlePixelExtract() {
    if (!imageUrl) return toast.error('请先生成或上传图片')
    setBusy('正在本地 PS 式拆层：生成清理背景和透明 PNG 图层…')
    setResultUrl('')
    const start = performance.now()
    try {
      const r = await extractPixelLayers({ image_url: imageUrl, sensitivity: pixelSensitivity, max_layers: 32 })
      if (!r.ok) throw new Error(r.error || '像素拆层失败')
      const width = natural.w || r.canvas?.width || 1000
      const height = natural.h || r.canvas?.height || 1000
      const next = (r.layers || []).map((item: PixelExtractedLayer, idx: number): DemoLayer => ({
        id: item.id || `pixel_${idx + 1}`,
        type: 'image_overlay',
        label: item.label || `像素图层 ${idx + 1}`,
        imageUrl: item.pixel_url,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        opacity: 1,
        zIndex: item.zIndex ?? idx + 1,
        edit_prompt: item.type === 'text_pixel'
          ? '保持字体风格和排版位置，优化/替换这个文字或标识像素层'
          : '保持整体风格一致，优化/替换这个元素像素层',
      }))
      setImageUrl(r.background_image || imageUrl)
      setNatural({ w: width, h: height })
      setSelection(null)
      setLayers(normalizeZIndex(next))
      setSelectedLayerId(next[0]?.id || '')
      addLog({
        ok: true,
        title: 'PS式像素拆层完成',
        detail: `生成清理背景 + ${next.length} 个真实透明 PNG 图层；可拖拽/缩放/删除/调层级`,
        image: r.background_image,
        elapsedSec: r.elapsed_sec ?? (performance.now() - start) / 1000,
      })
      toast.success(`已拆出 ${next.length} 个真实像素图层`)
    } catch (e: any) {
      addLog({ ok: false, title: 'PS式像素拆层失败', detail: e?.message || '未知错误', elapsedSec: (performance.now() - start) / 1000 })
      toast.error(e?.message || '拆层失败')
    } finally {
      setBusy('')
    }
  }

  async function handleAnalyze() {
    if (!imageUrl) return toast.error('请先生成或上传图片')
    setBusy('正在用当前视觉模型拆解文本和元素…')
    const start = performance.now()
    try {
      const r = await analyzeImageLayers({ image_url: imageUrl, width: natural.w, height: natural.h, hint: prompt })
      if (!r.ok) throw new Error(r.error || '拆解失败')
      const next = (r.layers || []).map((item: AnalyzedImageLayer, idx: number): DemoLayer => {
        const rect = normToRect(item.bbox_norm, natural.w || r.canvas?.width || 1000, natural.h || r.canvas?.height || 1000)
        const isText = item.type === 'text'
        return {
          ...rect,
          id: item.id || `layer_${idx + 1}`,
          type: item.type,
          label: item.label || (isText ? '文本' : '元素'),
          text: item.text || '',
          confidence: item.confidence || 0,
          fontFamily: isText ? 'PingFang SC' : undefined,
          fontSize: isText ? Math.max(18, Math.round(rect.h * 0.46)) : undefined,
          color: isText ? '#111827' : undefined,
          fontWeight: isText ? 800 : undefined,
          edit_prompt: item.edit_prompt || '',
          zIndex: item.zIndex ?? idx,
        }
      })
      setLayers(next)
      setSelectedLayerId(next.find(l => l.type === 'text')?.id || next[0]?.id || '')
      addLog({ ok: true, title: '智能拆解完成', detail: `识别 ${next.length} 个语义层`, elapsedSec: (performance.now() - start) / 1000 })
    } catch (e: any) {
      addLog({ ok: false, title: '智能拆解失败', detail: e?.message || '未知错误', elapsedSec: (performance.now() - start) / 1000 })
      toast.error(e?.message || '拆解失败')
    } finally {
      setBusy('')
    }
  }

  async function selectedMaskUrl(rect?: BoxRect) {
    const target = rect || selectedLayer || selection
    if (!target || !natural.w || !natural.h) throw new Error('请先选择图层或在图片上拖拽框选一个区域')
    const clean = clampRect(target, natural.w, natural.h)
    const blob = await buildRectMask(clean, natural.w, natural.h)
    return { mask_url: await uploadMask(blob), rect: clean }
  }

  async function handleInpaint(rect?: BoxRect, promptOverride?: string) {
    if (!imageUrl) return toast.error('请先生成或上传图片')
    setBusy('正在对选区/图层进行 AI 局部重绘…')
    const start = performance.now()
    try {
      const { mask_url, rect: usedRect } = await selectedMaskUrl(rect)
      const finalPrompt = promptOverride || selectedLayer?.edit_prompt || editPrompt
      const r = await inpaintImage({ image_url: imageUrl, mask_url, prompt: finalPrompt, size: `${natural.w}x${natural.h}`, quality })
      if (!r.ok) throw new Error((r as any).error || '局部重绘失败')
      setResultUrl(r.image)
      addLog({ ok: true, title: '局部重绘成功', detail: `${rectLabel(usedRect)} · ${finalPrompt}`, image: r.image, elapsedSec: (performance.now() - start) / 1000 })
    } catch (e: any) {
      addLog({ ok: false, title: '局部重绘失败', detail: e?.message || '未知错误', elapsedSec: (performance.now() - start) / 1000 })
      toast.error(e?.message || '局部重绘失败')
    } finally {
      setBusy('')
    }
  }

  async function handleErase(rect?: BoxRect, quiet = false) {
    if (!imageUrl) {
      toast.error('请先生成或上传图片')
      return ''
    }
    setBusy('正在 AI 消除选区/图层并补背景…')
    const start = performance.now()
    try {
      const { mask_url, rect: usedRect } = await selectedMaskUrl(rect)
      const r = await removeObject({ image_url: imageUrl, mask_url, size: `${natural.w}x${natural.h}`, quality })
      if (!r.ok) throw new Error((r as any).error || '消除失败')
      if (!quiet) setResultUrl(r.image)
      addLog({ ok: true, title: '选区消除成功', detail: rectLabel(usedRect), image: r.image, elapsedSec: (performance.now() - start) / 1000 })
      return r.image
    } catch (e: any) {
      addLog({ ok: false, title: '选区消除失败', detail: e?.message || '未知错误', elapsedSec: (performance.now() - start) / 1000 })
      toast.error(e?.message || '消除失败')
      return ''
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

  async function handleEditSelectedLayer() {
    if (!selectedLayer) return toast.error('请先选择一个图层')
    if (selectedLayer.type !== 'image_overlay') {
      return handleInpaint(selectedLayer, selectedLayer.edit_prompt || editPrompt)
    }
    if (!selectedLayer.imageUrl) return toast.error('当前像素层缺少透明 PNG')
    setBusy('正在单独编辑这个透明 PNG 图层…')
    const start = performance.now()
    try {
      const layerSize = `${Math.max(64, Math.round(selectedLayer.w))}x${Math.max(64, Math.round(selectedLayer.h))}`
      const finalPrompt = `${selectedLayer.edit_prompt || editPrompt}\n\n要求：保持透明背景和原图层边界，只修改该图层自身，不要生成整张海报背景。`
      const r = await editImage({ image_url: selectedLayer.imageUrl, prompt: finalPrompt, size: layerSize, quality })
      if (!r.ok) throw new Error((r as any).error || '图层编辑失败')
      updateLayer(selectedLayer.id, { imageUrl: r.image })
      setResultUrl(r.image)
      addLog({ ok: true, title: '透明 PNG 图层编辑成功', detail: `${selectedLayer.label} · ${layerSize}`, image: r.image, elapsedSec: (performance.now() - start) / 1000 })
      toast.success('已替换当前图层图片')
    } catch (e: any) {
      addLog({ ok: false, title: '透明 PNG 图层编辑失败', detail: e?.message || '未知错误', elapsedSec: (performance.now() - start) / 1000 })
      toast.error(e?.message || '图层编辑失败')
    } finally {
      setBusy('')
    }
  }

  function removeSelectedLayer() {
    if (!selectedLayer) return
    setLayers(prev => prev.filter(l => l.id !== selectedLayer.id))
    setSelectedLayerId('')
    toast.success('已删除图层；合成导出后生效')
  }

  function addTextLayer() {
    const rect = selection || { x: natural.w * 0.12, y: natural.h * 0.12, w: natural.w * 0.68, h: natural.h * 0.1 }
    const id = `text_${Date.now()}`
    setLayers(prev => [{ ...clampRect(rect, natural.w, natural.h), id, type: 'text', label: '新增文本', text: '双击右侧编辑文字', fontFamily: 'PingFang SC', fontSize: 56, fontWeight: 800, color: '#111827', zIndex: 100 + prev.length }, ...prev])
    setSelectedLayerId(id)
  }

  function addObjectRegion() {
    if (!selection) return toast.error('请先框选一个区域')
    const id = `object_${Date.now()}`
    setLayers(prev => [{ ...selection, id, type: 'object', label: '手动元素选区', zIndex: 50 + prev.length, edit_prompt: editPrompt }, ...prev])
    setSelectedLayerId(id)
  }

  async function cropLayerAsDataUrl(layer: DemoLayer): Promise<string> {
    const img = await loadImage(imageUrl)
    const rect = clampRect(layer, natural.w, natural.h)
    const canvas = document.createElement('canvas')
    canvas.width = rect.w
    canvas.height = rect.h
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h)
    return canvas.toDataURL('image/png')
  }

  async function extractSelectedToMovableLayer() {
    if (!selectedLayer || selectedLayer.type === 'text' || selectedLayer.type === 'image_overlay') return toast.error('请选择尚未像素化的语义元素层')
    setBusy('正在提取元素并清除原位置…')
    try {
      const dataUrl = await cropLayerAsDataUrl(selectedLayer)
      const cleaned = await handleErase(selectedLayer, true)
      if (cleaned) {
        setImageUrl(cleaned)
        setResultUrl(cleaned)
      }
      const id = `movable_${Date.now()}`
      setLayers(prev => [
        ...prev.filter(l => l.id !== selectedLayer.id),
        { ...selectedLayer, id, type: 'image_overlay', label: `${selectedLayer.label}（可移动）`, imageUrl: dataUrl, zIndex: 200 + prev.length },
      ])
      setSelectedLayerId(id)
      toast.success('已转成可拖拽图片层，可移动后合成导出')
    } catch (e: any) {
      toast.error(e?.message || '提取失败')
    } finally {
      setBusy('')
    }
  }

  async function exportComposite() {
    if (!imageUrl || !natural.w || !natural.h) return toast.error('没有可导出的图片')
    setBusy('正在合成图层并上传导出图…')
    const start = performance.now()
    try {
      const base = await loadImage(imageUrl)
      const canvas = document.createElement('canvas')
      canvas.width = natural.w
      canvas.height = natural.h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(base, 0, 0, natural.w, natural.h)
      const visible = [...layers].filter(l => !l.hidden).sort((a, b) => a.zIndex - b.zIndex)
      for (const layer of visible) {
        ctx.save()
        ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity ?? 1))
        if (layer.type === 'image_overlay' && layer.imageUrl) {
          const img = await loadImage(layer.imageUrl)
          ctx.drawImage(img, layer.x, layer.y, layer.w, layer.h)
        } else if (layer.type === 'text' && layer.text) {
          const weight = layer.fontWeight || 700
          const fontSize = layer.fontSize || Math.max(18, layer.h * 0.45)
          const font = layer.fontFamily || 'PingFang SC'
          ctx.font = `${weight} ${fontSize}px ${font}`
          ctx.fillStyle = layer.color || '#111827'
          ctx.textBaseline = 'top'
          const lines = wrapText(ctx, layer.text, Math.max(20, layer.w))
          const lineHeight = fontSize * 1.18
          lines.slice(0, Math.max(1, Math.floor(layer.h / lineHeight) + 1)).forEach((line, idx) => {
            ctx.fillText(line, layer.x, layer.y + idx * lineHeight)
          })
        }
        ctx.restore()
      }
      const blob = await canvasBlob(canvas)
      const file = new File([blob], `ai-layer-export-${Date.now()}.png`, { type: 'image/png' })
      const url = await uploadImage(file)
      setResultUrl(url)
      addLog({ ok: true, title: '图层合成导出成功', detail: `合成 ${visible.length} 个可见层`, image: url, elapsedSec: (performance.now() - start) / 1000 })
      toast.success('已导出合成图')
    } catch (e: any) {
      addLog({ ok: false, title: '图层合成失败', detail: e?.message || '未知错误', elapsedSec: (performance.now() - start) / 1000 })
      toast.error(e?.message || '导出失败；可能是图片跨域导致画布不可读')
    } finally {
      setBusy('')
    }
  }

  function useResultAsCurrent() {
    if (!resultUrl) return
    setImageUrl(resultUrl)
    setResultUrl('')
    setSelection(null)
    setLayers([])
    setSelectedLayerId('')
    toast.success('已将结果设为当前底图，可重新拆解或继续编辑')
  }

  const selectionStyle = selection && display.w && display.h && natural.w && natural.h ? {
    left: `${(selection.x / natural.w) * display.w}px`,
    top: `${(selection.y / natural.h) * display.h}px`,
    width: `${(selection.w / natural.w) * display.w}px`,
    height: `${(selection.h / natural.h) * display.h}px`,
  } : undefined

  return (
    <Box className="editorial-page studio-page studio-page--wide">
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }} sx={{ mb: 2, borderBottom: '1px solid', borderColor: 'divider', pb: 1.5 }}>
        <Typography className="editorial-mono" sx={{ fontSize: 10, fontWeight: 800, color: 'primary.main', transform: { md: 'translateY(-13px)' } }}>10</Typography>
        <Box flex={1}>
          <Typography sx={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 32, fontWeight: 800, letterSpacing: -0.8, lineHeight: 1 }}>PS式图片拆层编辑 Demo</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5 }}>
            核心走本地像素拆层：扁平图 → 清理背景 + 透明 PNG 图层 → 拖拽/缩放/删除/调层级 → 合成导出；AI 只作为整体生成和局部重绘的增强能力。
          </Typography>
        </Box>
        <Chip icon={<LayersIcon />} label="真实透明 PNG 像素图层，不再只是画框" sx={{ alignSelf: { xs: 'flex-start', md: 'center' } }} />
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '280px minmax(0,1fr) 280px', xl: '360px minmax(0,1fr) 360px' }, gap: 2 }}>
        <Paper sx={{ p: 2, borderRadius: 0 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 800, mb: 1 }}>1. 整图生成 / 上传</Typography>
          <TextField label="整图生成 Prompt" multiline minRows={5} fullWidth value={prompt} onChange={e => setPrompt(e.target.value)} />
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <TextField label="size" value={size} onChange={e => setSize(e.target.value)} size="small" fullWidth />
            <Select size="small" value={quality} onChange={e => setQuality(e.target.value as Quality)} sx={{ minWidth: 110 }}>
              {(['high', 'medium', 'low', 'auto'] as Quality[]).map(q => <MenuItem key={q} value={q}>{q}</MenuItem>)}
            </Select>
          </Stack>
          <Stack spacing={1} sx={{ mt: 1 }}>
            <Button variant="contained" startIcon={<AutoFixHighIcon />} disabled={!!busy || !prompt.trim()} onClick={handleGenerate}>用当前图片 API 生成整图</Button>
            <Button variant="outlined" component="label" startIcon={<UploadIcon />} disabled={!!busy}>上传已有图测试<input hidden type="file" accept="image/*" onChange={e => handleUpload(e.target.files?.[0])} /></Button>
            <Stack direction="row" spacing={1}>
              <Button variant="contained" color="secondary" startIcon={<LayersIcon />} disabled={!!busy || !imageUrl} onClick={handlePixelExtract} sx={{ flex: 1 }}>PS式像素拆层</Button>
              <TextField
                size="small"
                label="灵敏度"
                type="number"
                value={pixelSensitivity}
                onChange={e => setPixelSensitivity(Math.max(0.1, Math.min(1, Number(e.target.value) || 0.58)))}
                inputProps={{ min: 0.1, max: 1, step: 0.05 }}
                sx={{ width: 96 }}
              />
            </Stack>
            <Button variant="outlined" color="secondary" startIcon={<LayersIcon />} disabled={!!busy || !imageUrl} onClick={handleAnalyze}>AI 语义识别（可选）</Button>
          </Stack>

          <Typography sx={{ fontSize: 15, fontWeight: 800, mt: 3, mb: 1 }}>2. 选区/图层编辑 Prompt</Typography>
          <TextField label="局部/整体编辑 Prompt" multiline minRows={4} fullWidth value={editPrompt} onChange={e => setEditPrompt(e.target.value)} />
          <Stack spacing={1} sx={{ mt: 1 }}>
            <Button variant="contained" color="warning" disabled={!!busy || !imageUrl || (!selection && !selectedLayer)} onClick={() => handleInpaint()}>AI 修改选区/图层</Button>
            <Button variant="outlined" color="error" startIcon={<CleaningServicesIcon />} disabled={!!busy || !imageUrl || (!selection && !selectedLayer)} onClick={() => handleErase()}>AI 删除选区/图层并补背景</Button>
            <Button variant="outlined" disabled={!!busy || !imageUrl} onClick={handleWholeEdit}>AI 整体编辑当前图</Button>
          </Stack>
          <Divider sx={{ my: 2 }} />
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Button size="small" variant="outlined" startIcon={<TextFieldsIcon />} disabled={!imageUrl || !natural.w} onClick={addTextLayer}>加文本层</Button>
            <Button size="small" variant="outlined" disabled={!selection} onClick={addObjectRegion}>选区成元素层</Button>
            <Button size="small" variant="contained" startIcon={<DownloadDoneIcon />} disabled={!imageUrl || !!busy} onClick={exportComposite}>合成导出</Button>
          </Stack>
          {selection && <Typography sx={{ mt: 1, fontSize: 12, color: 'text.secondary' }}>当前手动选区：{rectLabel(selection)}</Typography>}
          <Button size="small" startIcon={<RestartAltIcon />} onClick={() => { setSelection(null); setResultUrl('') }} sx={{ mt: 1 }}>清空选区/结果</Button>
        </Paper>

        <Paper sx={{ p: 2, borderRadius: 0, minHeight: 720, display: 'flex', flexDirection: 'column' }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 800 }}>智能画布</Typography>
            {natural.w > 0 && <Chip size="small" label={`${natural.w}×${natural.h}`} />}
            <Chip size="small" label={`${layers.length} 层`} />
            <Box flex={1} />
            {busy && <Chip color="warning" size="small" label={busy} />}
          </Stack>
          <Box sx={{ flex: 1, minHeight: 620, borderRadius: 0, border: '1px dashed', borderColor: 'divider', bgcolor: 'background.default', display: 'grid', placeItems: 'center', overflow: 'hidden', p: 2 }}>
            {!imageUrl ? (
              <Stack alignItems="center" spacing={1} sx={{ color: 'text.secondary' }}><ImageSearchIcon sx={{ fontSize: 48, opacity: 0.5 }} /><Typography>先生成或上传一张图片</Typography></Stack>
            ) : (
              <Box sx={{ position: 'relative', maxWidth: '100%', maxHeight: '100%' }} onPointerMove={onCanvasPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
                <Box component="img" ref={imgRef} src={absUrl(imageUrl)} onLoad={e => { const img = e.currentTarget; setNatural({ w: img.naturalWidth, h: img.naturalHeight }); requestAnimationFrame(syncDisplayRect) }} onPointerDown={onCanvasPointerDown} draggable={false} sx={{ maxWidth: '100%', maxHeight: '680px', display: 'block', userSelect: 'none', cursor: 'crosshair', borderRadius: 0, boxShadow: 'none', border: '1px solid', borderColor: 'divider' }} />
                {layers.filter(l => !l.hidden).sort((a, b) => a.zIndex - b.zIndex).map(layer => {
                  const selected = layer.id === selectedLayerId
                  const isText = layer.type === 'text'
                  const isImage = layer.type === 'image_overlay'
                  return (
                    <Box key={layer.id} onPointerDown={e => { e.stopPropagation(); setSelection(null); setSelectedLayerId(layer.id); setDrag({ id: layer.id, mode: 'move', start: eventToImagePoint(e), original: { x: layer.x, y: layer.y, w: layer.w, h: layer.h } }) }} sx={{ position: 'absolute', ...layerStyle(layer), border: selected ? '2px solid var(--accent)' : (isImage ? '1px solid transparent' : '1px dashed rgba(200,48,46,0.65)'), bgcolor: isText ? 'rgba(255,255,255,0.08)' : (isImage ? 'transparent' : 'rgba(200,48,46,0.06)'), cursor: 'move', overflow: 'hidden', zIndex: 20 + layer.zIndex, borderRadius: 0, opacity: layer.opacity ?? 1 }}>
                      {isImage && layer.imageUrl && <Box component="img" src={layer.imageUrl} sx={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }} />}
                      {isText && <Typography sx={{ p: 0.3, fontFamily: layer.fontFamily, fontWeight: layer.fontWeight, fontSize: `${Math.max(8, (layer.fontSize || 36) * (display.w / natural.w))}px`, lineHeight: 1.12, color: layer.color, whiteSpace: 'pre-wrap', overflow: 'hidden', textShadow: '0 1px 8px rgba(255,255,255,0.65)' }}>{layer.text || layer.label}</Typography>}
                      {!isText && !isImage && <Chip size="small" label={layer.label} sx={{ m: 0.4, height: 20, fontSize: 10, bgcolor: selected ? 'primary.main' : 'rgba(26,24,20,0.72)', color: 'background.paper' }} />}
                      <Box onPointerDown={e => { e.stopPropagation(); setSelectedLayerId(layer.id); setDrag({ id: layer.id, mode: 'resize', start: eventToImagePoint(e), original: { x: layer.x, y: layer.y, w: layer.w, h: layer.h } }) }} sx={{ position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, bgcolor: selected ? 'primary.main' : 'rgba(0,0,0,0.45)', cursor: 'nwse-resize' }} />
                    </Box>
                  )
                })}
                {selectionStyle && <Box sx={{ position: 'absolute', border: '2px solid var(--accent)', boxShadow: '0 0 0 9999px rgba(0,0,0,0.28)', pointerEvents: 'none', borderRadius: 0, ...selectionStyle }} />}
              </Box>
            )}
          </Box>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1 }}>拖拽图片生成手动选区；PS式拆出的透明 PNG 层可直接拖拽、缩放、删除、调层级；AI 语义层主要用于辅助定位和局部重绘。</Typography>
        </Paper>

        <Stack spacing={2}>
          <Paper sx={{ p: 2, borderRadius: 0 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 800, mb: 1 }}>图层面板</Typography>
            {layers.length === 0 ? <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>点击「PS式像素拆层」后会出现可移动的真实透明 PNG 图层；AI 语义识别只作为辅助。</Typography> : [...layers].sort((a, b) => b.zIndex - a.zIndex).map(layer => (
              <Box key={layer.id} onClick={() => setSelectedLayerId(layer.id)} sx={{ p: 1, border: '1px solid', borderColor: layer.id === selectedLayerId ? 'primary.main' : 'divider', borderRadius: 0, mb: 1, cursor: 'pointer', bgcolor: layer.hidden ? 'action.hover' : 'background.paper' }}>
                <Stack direction="row" spacing={0.6} alignItems="center">
                  {layer.type === 'image_overlay' && layer.imageUrl && <Box component="img" src={layer.imageUrl} sx={{ width: 30, height: 30, objectFit: 'contain', bgcolor: 'rgba(0,0,0,0.04)', borderRadius: 1, border: '1px solid', borderColor: 'divider' }} />}
                  <Chip size="small" label={layer.type} sx={{ height: 20, fontSize: 10 }} />
                  <Typography sx={{ fontSize: 13, fontWeight: 800 }} noWrap>{layer.label}</Typography>
                  <Box flex={1} />
                  <Button size="small" onClick={e => { e.stopPropagation(); moveLayerOrder(layer.id, 1) }} sx={{ minWidth: 28, px: 0.5 }}>↑</Button>
                  <Button size="small" onClick={e => { e.stopPropagation(); moveLayerOrder(layer.id, -1) }} sx={{ minWidth: 28, px: 0.5 }}>↓</Button>
                  <IconButton size="small" onClick={e => { e.stopPropagation(); updateLayer(layer.id, { hidden: !layer.hidden }) }}><VisibilityOffIcon sx={{ fontSize: 15 }} /></IconButton>
                </Stack>
                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{rectLabel(layer)}</Typography>
                {layer.text && <Typography sx={{ fontSize: 11, color: 'text.secondary' }} noWrap>{layer.text}</Typography>}
              </Box>
            ))}
          </Paper>

          <Paper sx={{ p: 2, borderRadius: 0 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 800, mb: 1 }}>选中层编辑</Typography>
            {!selectedLayer ? <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>请选择一个图层。</Typography> : (
              <Stack spacing={1}>
                <TextField size="small" label="名称" value={selectedLayer.label} onChange={e => updateLayer(selectedLayer.id, { label: e.target.value })} />
                <Stack direction="row" spacing={1}>
                  <TextField size="small" label="X" type="number" value={Math.round(selectedLayer.x)} onChange={e => updateLayer(selectedLayer.id, clampRect({ ...selectedLayer, x: Number(e.target.value) || 0 }, natural.w, natural.h))} />
                  <TextField size="small" label="Y" type="number" value={Math.round(selectedLayer.y)} onChange={e => updateLayer(selectedLayer.id, clampRect({ ...selectedLayer, y: Number(e.target.value) || 0 }, natural.w, natural.h))} />
                </Stack>
                <Stack direction="row" spacing={1}>
                  <TextField size="small" label="W" type="number" value={Math.round(selectedLayer.w)} onChange={e => updateLayer(selectedLayer.id, clampRect({ ...selectedLayer, w: Number(e.target.value) || 1 }, natural.w, natural.h))} />
                  <TextField size="small" label="H" type="number" value={Math.round(selectedLayer.h)} onChange={e => updateLayer(selectedLayer.id, clampRect({ ...selectedLayer, h: Number(e.target.value) || 1 }, natural.w, natural.h))} />
                </Stack>
                <TextField
                  size="small"
                  label="透明度 0-1"
                  type="number"
                  value={selectedLayer.opacity ?? 1}
                  onChange={e => updateLayer(selectedLayer.id, { opacity: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })}
                  inputProps={{ min: 0, max: 1, step: 0.05 }}
                />
                {selectedLayer.type === 'text' && (
                  <>
                    <TextField label="文本内容" multiline minRows={3} value={selectedLayer.text || ''} onChange={e => updateLayer(selectedLayer.id, { text: e.target.value })} />
                    <Stack direction="row" spacing={1}>
                      <Select size="small" value={selectedLayer.fontFamily || 'PingFang SC'} onChange={e => updateLayer(selectedLayer.id, { fontFamily: e.target.value })} fullWidth>{FONT_OPTIONS.map(f => <MenuItem key={f} value={f}>{f}</MenuItem>)}</Select>
                      <TextField size="small" label="字号" type="number" value={selectedLayer.fontSize || 42} onChange={e => updateLayer(selectedLayer.id, { fontSize: Number(e.target.value) || 42 })} sx={{ width: 96 }} />
                    </Stack>
                    <Stack direction="row" spacing={1}>
                      <TextField size="small" label="颜色" value={selectedLayer.color || '#111827'} onChange={e => updateLayer(selectedLayer.id, { color: e.target.value })} fullWidth />
                      <Select size="small" value={selectedLayer.fontWeight || 800} onChange={e => updateLayer(selectedLayer.id, { fontWeight: Number(e.target.value) })} sx={{ width: 110 }}><MenuItem value={400}>常规</MenuItem><MenuItem value={700}>粗体</MenuItem><MenuItem value={900}>重黑</MenuItem></Select>
                    </Stack>
                  </>
                )}
                <TextField label="AI 修改提示" multiline minRows={2} value={selectedLayer.edit_prompt || editPrompt} onChange={e => updateLayer(selectedLayer.id, { edit_prompt: e.target.value })} />
                {selectedLayer.type === 'image_overlay' && (
                  <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                    这是从原图真实抠出的透明 PNG 图层：移动、缩放、隐藏、删除会直接改变最终合成图；「AI 修改层」会单独编辑这个透明 PNG，而不是只在底图上画框。
                  </Typography>
                )}
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                  <Button size="small" variant="contained" color="warning" onClick={handleEditSelectedLayer} disabled={!!busy}>AI 修改层</Button>
                  {selectedLayer.type !== 'image_overlay' && <Button size="small" variant="outlined" color="error" onClick={() => handleErase(selectedLayer)} disabled={!!busy}>AI 删除层并补背景</Button>}
                  {selectedLayer.type !== 'text' && selectedLayer.type !== 'image_overlay' && <Button size="small" variant="outlined" startIcon={<ContentCutIcon />} onClick={extractSelectedToMovableLayer} disabled={!!busy}>提取可移动</Button>}
                  <Button size="small" variant="outlined" onClick={() => duplicateLayer(selectedLayer.id)}>复制图层</Button>
                  <Button size="small" variant="outlined" color="error" onClick={removeSelectedLayer}>删除图层</Button>
                </Stack>
                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>提示：修改文字或图层位置后点「合成导出」会生成新的 PNG；PS式拆层能改真实像素图层，但扁平 PNG 无法 100% 还原原始 PSD 的矢量/字体参数。</Typography>
              </Stack>
            )}
          </Paper>

          <Paper sx={{ p: 2, borderRadius: 0 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 800, mb: 1 }}>结果图</Typography>
            {busy && <CircularProgress size={18} sx={{ mb: 1 }} />}
            {resultUrl ? <><Box component="img" src={absUrl(resultUrl)} sx={{ width: '100%', borderRadius: 0, border: '1px solid', borderColor: 'divider' }} /><Stack direction="row" spacing={1} sx={{ mt: 1 }}><Button size="small" variant="contained" onClick={useResultAsCurrent}>设为当前底图</Button><Button size="small" variant="outlined" href={absUrl(resultUrl)} target="_blank">打开</Button></Stack></> : <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>编辑/导出成功后会显示在这里。</Typography>}
          </Paper>

          <Paper sx={{ p: 2, borderRadius: 0 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 800, mb: 1 }}>调用日志</Typography>
            {logs.length === 0 ? <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>暂无调用。</Typography> : logs.map((l, i) => <Box key={i} sx={{ p: 1, borderBottom: i === logs.length - 1 ? 0 : '1px solid', borderColor: 'divider' }}><Stack direction="row" spacing={0.6} alignItems="center"><Chip size="small" color={l.ok === false ? 'error' : 'success'} label={l.ok === false ? '失败' : '成功'} sx={{ height: 20, fontSize: 10 }} /><Typography sx={{ fontSize: 13, fontWeight: 700 }}>{l.title}</Typography>{l.elapsedSec !== undefined && <Typography sx={{ fontSize: 11, color: 'text.secondary', ml: 'auto' }}>{l.elapsedSec.toFixed(1)}s</Typography>}</Stack><Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.3 }} noWrap>{l.detail}</Typography></Box>)}
          </Paper>
        </Stack>
      </Box>
    </Box>
  )
}
