import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  IconButton,
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography,
  LinearProgress,
} from '@mui/material'
import { toast } from 'sonner'
import CloseIcon from '@mui/icons-material/Close'
import CropIcon from '@mui/icons-material/Crop'
import BrushIcon from '@mui/icons-material/Brush'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import ContentEraserIcon from '@mui/icons-material/CleaningServices'
import TuneIcon from '@mui/icons-material/Tune'
import UndoIcon from '@mui/icons-material/Undo'
import CheckIcon from '@mui/icons-material/Check'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import {
  cropImage,
  editImage,
  inpaintImage,
  removeObject,
  uploadMask,
  type EditBinding,
} from '../api/client'

type Mode = 'crop' | 'inpaint' | 'erase' | 'variation'

function absUrl(u: string) {
  if (!u) return u
  if (u.startsWith('http') || u.startsWith('data:')) return u
  return u
}

export default function ImageEditor({
  open,
  onClose,
  src,
  binding,
  onDone,
  defaultMode = 'inpaint',
}: {
  open: boolean
  onClose: () => void
  src: string | null
  binding?: EditBinding
  onDone: (newUrl: string) => void
  defaultMode?: Mode
}) {
  const [mode, setMode] = useState<Mode>(defaultMode)
  const [busy, setBusy] = useState<string>('')
  const [prompt, setPrompt] = useState('')
  const [brush, setBrush] = useState(32)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [original, setOriginal] = useState<HTMLImageElement | null>(null)
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [displayRect, setDisplayRect] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  const stageRef = useRef<HTMLDivElement>(null)
  const imgCanvasRef = useRef<HTMLCanvasElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const historyRef = useRef<ImageData[]>([])

  // crop selection in natural-image coords
  const [cropBox, setCropBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const cropStartRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!open) {
      setResultUrl(null)
      setCropBox(null)
      setPrompt('')
      historyRef.current = []
      return
    }
    setMode(defaultMode)
  }, [open, defaultMode])

  // Load image into canvas whenever src/open changes
  useEffect(() => {
    if (!open || !src) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      setOriginal(img)
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
      // wait a tick for canvases to mount
      requestAnimationFrame(() => renderStage(img))
    }
    img.src = absUrl(src)
  }, [open, src])

  // Recompute on window resize
  useEffect(() => {
    if (!open) return
    const onResize = () => original && renderStage(original)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open, original])

  function renderStage(img: HTMLImageElement) {
    const stage = stageRef.current
    const imgCanvas = imgCanvasRef.current
    const maskCanvas = maskCanvasRef.current
    if (!stage || !imgCanvas || !maskCanvas) return
    // fit to stage while keeping aspect ratio
    const maxW = stage.clientWidth
    const maxH = stage.clientHeight
    const r = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight)
    const w = Math.max(1, Math.floor(img.naturalWidth * r))
    const h = Math.max(1, Math.floor(img.naturalHeight * r))
    setDisplayRect({ w, h })
    for (const c of [imgCanvas, maskCanvas]) {
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      c.style.width = `${w}px`
      c.style.height = `${h}px`
    }
    const ictx = imgCanvas.getContext('2d')!
    ictx.clearRect(0, 0, imgCanvas.width, imgCanvas.height)
    ictx.drawImage(img, 0, 0)
    const mctx = maskCanvas.getContext('2d')!
    mctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height)
    historyRef.current = []
  }

  // Map a pointer event to natural-image coords
  function eventToImageCoords(e: React.PointerEvent) {
    const canvas = maskCanvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const sx = canvas.width / rect.width
    const sy = canvas.height / rect.height
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy,
    }
  }

  function pushHistory() {
    const m = maskCanvasRef.current
    if (!m) return
    const ctx = m.getContext('2d')!
    historyRef.current.push(ctx.getImageData(0, 0, m.width, m.height))
    if (historyRef.current.length > 20) historyRef.current.shift()
  }

  function undo() {
    const m = maskCanvasRef.current
    if (!m) return
    const ctx = m.getContext('2d')!
    if (mode === 'crop') {
      setCropBox(null)
      return
    }
    const prev = historyRef.current.pop()
    if (prev) ctx.putImageData(prev, 0, 0)
    else ctx.clearRect(0, 0, m.width, m.height)
  }

  function resetAll() {
    const m = maskCanvasRef.current
    if (m) m.getContext('2d')!.clearRect(0, 0, m.width, m.height)
    setCropBox(null)
    historyRef.current = []
  }

  // Drawing handlers — brush mode
  function onPointerDown(e: React.PointerEvent) {
    if (!naturalSize.w) return
    const p = eventToImageCoords(e)
    if (mode === 'crop') {
      cropStartRef.current = p
      setCropBox({ x: Math.round(p.x), y: Math.round(p.y), w: 1, h: 1 })
      return
    }
    if (mode === 'inpaint' || mode === 'erase') {
      pushHistory()
      drawingRef.current = true
      drawBrush(p.x, p.y, true)
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!naturalSize.w) return
    const p = eventToImageCoords(e)
    if (mode === 'crop' && cropStartRef.current) {
      const s = cropStartRef.current
      const x = Math.min(s.x, p.x)
      const y = Math.min(s.y, p.y)
      const w = Math.abs(p.x - s.x)
      const h = Math.abs(p.y - s.y)
      setCropBox({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) })
    } else if ((mode === 'inpaint' || mode === 'erase') && drawingRef.current) {
      drawBrush(p.x, p.y, false)
    }
  }

  function onPointerUp() {
    drawingRef.current = false
    cropStartRef.current = null
  }

  function drawBrush(x: number, y: number, first: boolean) {
    const m = maskCanvasRef.current
    if (!m) return
    const ctx = m.getContext('2d')!
    // mask uses opaque red where user painted; we'll invert to transparent when uploading
    ctx.fillStyle = 'rgba(255, 39, 65, 0.65)'
    const scale = naturalSize.w / displayRect.w
    const r = brush * scale
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    if (!first) return
  }

  async function buildMaskBlob(): Promise<Blob> {
    // Build a same-size PNG: opaque white where user did NOT paint, transparent where user painted.
    const m = maskCanvasRef.current
    if (!m) throw new Error('no mask canvas')
    const out = document.createElement('canvas')
    out.width = m.width
    out.height = m.height
    const ctx = out.getContext('2d')!
    // start fully opaque white
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, out.width, out.height)
    // punch out painted area
    const src = m.getContext('2d')!.getImageData(0, 0, m.width, m.height)
    const dst = ctx.getImageData(0, 0, out.width, out.height)
    for (let i = 0; i < src.data.length; i += 4) {
      if (src.data[i + 3] > 10) {
        // this pixel was painted → make transparent in final mask
        dst.data[i + 3] = 0
      }
    }
    ctx.putImageData(dst, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      out.toBlob(b => (b ? resolve(b) : reject(new Error('blob failed'))), 'image/png')
    })
  }

  async function doCrop() {
    if (!src || !cropBox) return
    setBusy('裁剪中…')
    try {
      const r = await cropImage({ image_url: src, ...cropBox, ...(binding || {}) })
      setResultUrl(r.image)
    } catch (e: any) {
      toast.error(e?.message || '裁剪失败')
    } finally {
      setBusy('')
    }
  }

  async function doInpaint() {
    if (!src) return
    setBusy('正在局部重绘…')
    try {
      const blob = await buildMaskBlob()
      const mask_url = await uploadMask(blob)
      const r = await inpaintImage({
        image_url: src,
        mask_url,
        prompt: prompt || 'seamlessly blend with surroundings',
        size: `${naturalSize.w}x${naturalSize.h}`,
        ...(binding || {}),
      })
      setResultUrl(r.image)
    } catch (e: any) {
      toast.error(e?.message || '重绘失败')
    } finally {
      setBusy('')
    }
  }

  async function doErase() {
    if (!src) return
    setBusy('正在消除…')
    try {
      const blob = await buildMaskBlob()
      const mask_url = await uploadMask(blob)
      const r = await removeObject({
        image_url: src,
        mask_url,
        size: `${naturalSize.w}x${naturalSize.h}`,
        ...(binding || {}),
      })
      setResultUrl(r.image)
    } catch (e: any) {
      toast.error(e?.message || '消除失败')
    } finally {
      setBusy('')
    }
  }

  async function doVariation() {
    if (!src) return
    setBusy('正在生成变体…')
    try {
      const r = await editImage({
        image_url: src,
        prompt: prompt || 'enhance clarity, keep overall composition',
        size: `${naturalSize.w}x${naturalSize.h}`,
        ...(binding || {}),
      })
      setResultUrl(r.image)
    } catch (e: any) {
      toast.error(e?.message || '编辑失败')
    } finally {
      setBusy('')
    }
  }

  function applyAndClose() {
    if (resultUrl) onDone(resultUrl)
    onClose()
  }

  const modeInfo = {
    crop: { label: '裁剪', icon: <CropIcon />, hint: '拖动选出保留区域' },
    inpaint: { label: '局部重绘', icon: <BrushIcon />, hint: '涂抹要修改的区域，再写 prompt' },
    erase: { label: '消除', icon: <ContentEraserIcon />, hint: '涂抹要擦掉的物体/路人/水印' },
    variation: { label: '整体编辑', icon: <TuneIcon />, hint: '用 prompt 重绘整张图（不涂抹）' },
  } as const

  return (
    <Dialog open={open} onClose={onClose} fullScreen PaperProps={{ sx: { bgcolor: 'background.default' } }}>
      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', height: '100vh' }}>
        {/* top bar */}
        <Stack
          direction="row"
          alignItems="center"
          spacing={2}
          sx={{
            px: 2.5,
            py: 1.5,
            borderBottom: 1, borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <Typography sx={{ fontSize: 17, fontWeight: 800 }}>图片编辑</Typography>
          <Stack direction="row" spacing={0.6}>
            {(['crop', 'inpaint', 'erase', 'variation'] as Mode[]).map(m => (
              <Chip
                key={m}
                icon={modeInfo[m].icon as any}
                label={modeInfo[m].label}
                onClick={() => {
                  setMode(m)
                  resetAll()
                }}
                sx={{
                  height: 32,
                  px: 0.5,
                  bgcolor: mode === m ? 'text.primary' : 'background.default',
                  color: mode === m ? 'background.paper' : 'text.primary',
                  '& .MuiChip-icon': { color: mode === m ? 'var(--paper) !important' : 'var(--ink) !important' },
                  fontWeight: 600,
                  borderRadius: 0,
                }}
              />
            ))}
          </Stack>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{modeInfo[mode].hint}</Typography>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="撤销">
            <span>
              <IconButton onClick={undo} disabled={!!busy}>
                <UndoIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="清空选区/涂抹">
            <span>
              <IconButton onClick={resetAll} disabled={!!busy}>
                <RestartAltIcon />
              </IconButton>
            </span>
          </Tooltip>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Stack>

        {/* main */}
        <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* stage */}
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              p: 3,
            }}
          >
            <Box
              ref={stageRef}
              className="checker-bg"
              sx={{
                position: 'relative',
                width: '100%',
                height: '100%',
                maxWidth: 1000,
                borderRadius: 0,
                overflow: 'hidden',
                border: '1px solid var(--rule)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {src && (
                <Box
                  sx={{
                    position: 'relative',
                    width: displayRect.w,
                    height: displayRect.h,
                    cursor:
                      mode === 'crop'
                        ? 'crosshair'
                        : mode === 'inpaint' || mode === 'erase'
                        ? 'crosshair'
                        : 'default',
                  }}
                >
                  <canvas
                    ref={imgCanvasRef}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none',
                    }}
                  />
                  <canvas
                    ref={maskCanvasRef}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerLeave={onPointerUp}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      touchAction: 'none',
                      pointerEvents: mode === 'variation' ? 'none' : 'auto',
                    }}
                  />
                  {mode === 'crop' && cropBox && displayRect.w > 0 && (
                    <Box
                      sx={{
                        position: 'absolute',
                        left: (cropBox.x / naturalSize.w) * displayRect.w,
                        top: (cropBox.y / naturalSize.h) * displayRect.h,
                        width: (cropBox.w / naturalSize.w) * displayRect.w,
                        height: (cropBox.h / naturalSize.h) * displayRect.h,
                        border: '2px dashed var(--accent)',
                        boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                </Box>
              )}
            </Box>
          </Box>

          {/* right sidebar */}
          <Box
            sx={{
              width: 340,
              borderLeft: '1px solid var(--rule)',
              bgcolor: 'background.paper',
              p: 2.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              overflow: 'auto',
            }}
          >
            {mode !== 'variation' && mode !== 'crop' && (
              <Box>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.8 }}>画笔大小</Typography>
                <Slider
                  value={brush}
                  min={6}
                  max={120}
                  onChange={(_, v) => setBrush(v as number)}
                  sx={{
                    color: 'primary.main',
                  }}
                />
                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                  涂抹后会作为 AI 的编辑范围，红色越厚代表越确信
                </Typography>
              </Box>
            )}

            {(mode === 'inpaint' || mode === 'variation') && (
              <Box>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.8 }}>
                  Prompt {mode === 'inpaint' ? '（描述涂抹区域要变成什么）' : '（整张图的新描述）'}
                </Typography>
                <TextField
                  fullWidth
                  multiline
                  minRows={4}
                  placeholder={
                    mode === 'inpaint'
                      ? '例如：a clean ceramic cup with soft steam'
                      : '例如：make the lighting warmer, add a cozy vibe'
                  }
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                />
              </Box>
            )}

            {mode === 'crop' && (
              <Box>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>裁剪区域</Typography>
                {cropBox ? (
                  <Typography sx={{ fontSize: 12 }}>
                    x={cropBox.x} y={cropBox.y} · {cropBox.w} × {cropBox.h}px
                  </Typography>
                ) : (
                  <Typography sx={{ fontSize: 12, color: '#B8B4AB' }}>
                    在左侧画布拖动选出保留区域
                  </Typography>
                )}
              </Box>
            )}

            {busy && (
              <Box
                sx={{
                  p: 1.5,
                  bgcolor: 'var(--accent-soft)',
                  borderRadius: 0,
                  border: '1px solid var(--rule)',
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <CircularProgress size={14} sx={{ color: 'primary.main' }} />
                  <Typography sx={{ fontSize: 13, color: 'primary.main' }}>{busy}</Typography>
                </Stack>
                <LinearProgress
                  sx={{
                    mt: 1,
                    bgcolor: 'background.paper',
                    '& .MuiLinearProgress-bar': { bgcolor: 'primary.main' },
                    borderRadius: 0,
                    height: 3,
                  }}
                />
              </Box>
            )}

            {resultUrl && (
              <Box>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.8 }}>处理结果</Typography>
                <Box
                  component="img"
                  src={absUrl(resultUrl)}
                  sx={{
                    width: '100%',
                    borderRadius: 0,
                    border: '1px solid var(--rule)',
                  }}
                />
              </Box>
            )}

            <Box sx={{ flex: 1 }} />

            <Stack direction="row" spacing={1}>
              {mode === 'crop' && (
                <Button
                  variant="contained"
                  fullWidth
                  disabled={!cropBox || !!busy}
                  onClick={doCrop}
                  sx={{
                    bgcolor: 'text.primary',
                    '&:hover': { bgcolor: '#000' },
                    borderRadius: 0,
                  }}
                >
                  应用裁剪
                </Button>
              )}
              {mode === 'inpaint' && (
                <Button
                  variant="contained"
                  fullWidth
                  disabled={!prompt || !!busy}
                  onClick={doInpaint}
                  startIcon={<AutoFixHighIcon />}
                  sx={{
                    bgcolor: 'primary.main',
                    '&:hover': { bgcolor: 'primary.dark' },
                    borderRadius: 0,
                  }}
                >
                  局部重绘
                </Button>
              )}
              {mode === 'erase' && (
                <Button
                  variant="contained"
                  fullWidth
                  disabled={!!busy}
                  onClick={doErase}
                  startIcon={<ContentEraserIcon />}
                  sx={{
                    bgcolor: 'primary.main',
                    '&:hover': { bgcolor: 'primary.dark' },
                    borderRadius: 0,
                  }}
                >
                  消除
                </Button>
              )}
              {mode === 'variation' && (
                <Button
                  variant="contained"
                  fullWidth
                  disabled={!prompt || !!busy}
                  onClick={doVariation}
                  startIcon={<TuneIcon />}
                  sx={{
                    bgcolor: 'text.primary',
                    '&:hover': { bgcolor: '#000' },
                    borderRadius: 0,
                  }}
                >
                  整体编辑
                </Button>
              )}
            </Stack>

            {resultUrl && (
              <Button
                variant="contained"
                startIcon={<CheckIcon />}
                onClick={applyAndClose}
                sx={{
                  bgcolor: 'success.main',
                  '&:hover': { bgcolor: 'success.dark' },
                  borderRadius: 0,
                }}
              >
                用这张替换原图
              </Button>
            )}
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  )
}
