import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  CircularProgress,
  Stack,
  TextField,
  Typography,
  Chip,
  Alert,
  InputAdornment,
  IconButton,
  Switch,
  FormControlLabel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Select,
  MenuItem,
  Paper,
} from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import {
  getSettings,
  updateSettings,
  testSettings,
  getMcpTools,
  getMySettings,
  updateMySettings,
  changePassword,
  listUsers,
  setUserRole,
  getSystemConfig,
  updateSystemConfig,
  testImageSettings,
  testStaticImagePublicAccess,
  fetchModelList,
  type PublicSettings,
  type MySettings,
  type AdminUser,
} from '../api/client'
import { useAuth } from '../AuthContext'
import { formatBeijingDate } from '../utils/time'

function Section({ title, desc, children }: { title: string; desc?: string; children: any }) {
  return (
    <Paper sx={{ p: { xs: 1.5, md: 2 }, mb: 1.5, borderRadius: 2.2 }}>
      <Typography sx={{ fontSize: 15, fontWeight: 800, color: 'text.primary', mb: 0.2 }}>{title}</Typography>
      {desc && (
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1.4 }}>{desc}</Typography>
      )}
      {children}
    </Paper>
  )
}

type ModelPoolRow = {
  model: string
  base_url: string
  api_key: string
  supports_image_url?: boolean
  supports_quality?: boolean
}

const defaultModelRow = (): ModelPoolRow => ({
  model: '',
  base_url: '',
  api_key: '',
  supports_image_url: true,
  supports_quality: true,
})

function parseBool(value: any, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const text = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on', '支持', '是'].includes(text)) return true
  if (['0', 'false', 'no', 'off', '不支持', '否'].includes(text)) return false
  return fallback
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

function parseModelPool(value: string): ModelPoolRow[] {
  const raw = (value || '').trim()
  if (!raw) return []
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.map(x => ({
          model: String(x?.model || x?.name || ''),
          base_url: String(x?.base_url || x?.url || ''),
          api_key: String(x?.api_key || x?.key || ''),
          supports_image_url: parseBool(x?.supports_image_url, true),
          supports_quality: parseBool(x?.supports_quality, true),
        }))
      }
    } catch {
      // fall through to legacy parser
    }
  }
  return raw
    .split('\n')
    .flatMap(line => {
      const value = line.trim()
      if (!value || value.startsWith('#')) return []
      const parts = value.split('|').map(x => x.trim())
      if (parts.length === 1 && /[,，;；]/.test(value)) {
        return value.split(/[,，;；]+/).map(model => ({
          model: model.trim(),
          base_url: '',
          api_key: '',
          supports_image_url: true,
          supports_quality: true,
        })).filter(x => x.model)
      }
      return [{
        model: parts[0] || '',
        base_url: parts[1] || '',
        api_key: parts[2] || '',
        supports_image_url: true,
        supports_quality: true,
      }]
    })
}

function serializeModelPool(rows: ModelPoolRow[], includeImageOptions = false) {
  const normalized = rows.map(r => ({
    model: r.model.trim(),
    base_url: r.base_url.trim(),
    api_key: r.api_key.trim(),
    ...(includeImageOptions ? {
      supports_image_url: r.supports_image_url !== false,
      supports_quality: r.supports_quality !== false,
    } : {}),
  }))
  // Keep intentionally added blank rows so “添加模型” gives immediate visual
  // feedback and the user can fill the row next. Empty fallback rows can still
  // be removed with the row delete button.
  if (normalized.length === 0) return ''
  return JSON.stringify(normalized, null, 2)
}

function ModelQueueEditor({
  title,
  model,
  baseUrl,
  apiKey,
  supportsImageUrl,
  supportsQuality,
  onModelChange,
  onBaseUrlChange,
  onApiKeyChange,
  onSupportsImageUrlChange,
  onSupportsQualityChange,
  value,
  onChange,
  modelPlaceholder,
  kind = 'chat',
  sx,
}: {
  title: string
  model: string
  baseUrl: string
  apiKey: string
  supportsImageUrl?: boolean
  supportsQuality?: boolean
  onModelChange: (value: string) => void
  onBaseUrlChange: (value: string) => void
  onApiKeyChange: (value: string) => void
  onSupportsImageUrlChange?: (value: boolean) => void
  onSupportsQualityChange?: (value: boolean) => void
  value: string
  onChange: (value: string) => void
  modelPlaceholder: string
  kind?: 'chat' | 'image'
  sx?: any
}) {
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)
  const [modelOptions, setModelOptions] = useState<Record<number, string[]>>({})
  const [loadingOptions, setLoadingOptions] = useState<Record<number, boolean>>({})
  const fallbackRows = parseModelPool(value)
  const displayRows = [
    {
      model,
      base_url: baseUrl,
      api_key: apiKey,
      supports_image_url: supportsImageUrl !== false,
      supports_quality: supportsQuality !== false,
    },
    ...fallbackRows,
  ]
  const rows = displayRows.length ? displayRows : [defaultModelRow()]
  const filledCount = rows.filter(r => r.model.trim()).length
  const isImage = kind === 'image'

  const commitRows = (nextRows: ModelPoolRow[]) => {
    const normalized = nextRows.map(r => ({
      model: r.model.trim(),
      base_url: r.base_url.trim(),
      api_key: r.api_key.trim(),
      supports_image_url: r.supports_image_url !== false,
      supports_quality: r.supports_quality !== false,
    }))
    const first = normalized[0] || defaultModelRow()
    onModelChange(first.model)
    onBaseUrlChange(first.base_url)
    onApiKeyChange(first.api_key)
    onSupportsImageUrlChange?.(first.supports_image_url !== false)
    onSupportsQualityChange?.(first.supports_quality !== false)
    onChange(serializeModelPool(normalized.slice(1), isImage))
  }
  const updateRow = (idx: number, patch: Partial<ModelPoolRow>) => {
    const next = [...rows]
    next[idx] = { ...next[idx], ...patch }
    commitRows(next)
  }
  const addRow = () => commitRows([...rows, defaultModelRow()])
  const removeRow = (idx: number) => {
    const next = rows.filter((_, i) => i !== idx)
    commitRows(next.length ? next : [defaultModelRow()])
  }
  const moveRow = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return
    const next = [...rows]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    commitRows(next)
  }
  const loadModelOptions = async (idx: number) => {
    const row = rows[idx] || defaultModelRow()
    const primary = rows[0] || defaultModelRow()
    const base_url = row.base_url || primary.base_url
    const api_key = row.api_key || primary.api_key
    setLoadingOptions(prev => ({ ...prev, [idx]: true }))
    try {
      const r = await fetchModelList({ base_url, api_key, kind })
      if (!r.ok) throw new Error(r.error || '获取模型列表失败')
      setModelOptions(prev => ({ ...prev, [idx]: r.models || [] }))
    } catch (e: any) {
      setModelOptions(prev => ({ ...prev, [idx]: [] }))
      alert(e?.message || '获取模型列表失败')
    } finally {
      setLoadingOptions(prev => ({ ...prev, [idx]: false }))
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.1, borderRadius: 2, bgcolor: 'rgba(15,23,42,0.015)', ...sx }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.8 }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: '#334155' }}>{title}</Typography>
        <Chip size="small" label={`${filledCount} 个模型`} sx={{ height: 20, fontSize: 10.5 }} />
        <Chip size="small" label="第 1 个为主模型" color="primary" variant="outlined" sx={{ height: 20, fontSize: 10.5 }} />
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" onClick={addRow} sx={{ minHeight: 26, fontSize: 11.5 }}>
          添加模型
        </Button>
      </Stack>
      <Table size="small" sx={{ '& td, & th': { px: 0.5, py: 0.4, borderBottomColor: 'rgba(15,23,42,0.06)' } }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: 64, fontSize: 11.5, color: 'text.secondary' }}>顺序</TableCell>
            <TableCell sx={{ width: isImage ? '21%' : '23%', fontSize: 11.5, color: 'text.secondary' }}>模型</TableCell>
            <TableCell sx={{ width: isImage ? '28%' : '34%', fontSize: 11.5, color: 'text.secondary' }}>Base URL</TableCell>
            {isImage && <TableCell sx={{ width: 150, fontSize: 11.5, color: 'text.secondary' }}>能力</TableCell>}
            <TableCell sx={{ width: isImage ? '25%' : '31%', fontSize: 11.5, color: 'text.secondary' }}>API Key</TableCell>
            <TableCell sx={{ width: 56 }} />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, idx) => (
            <TableRow
              key={idx}
              draggable
              onDragStart={e => {
                setDraggingIdx(idx)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(idx))
              }}
              onDragOver={e => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
              }}
              onDrop={e => {
                e.preventDefault()
                const from = draggingIdx ?? Number(e.dataTransfer.getData('text/plain'))
                setDraggingIdx(null)
                moveRow(from, idx)
              }}
              onDragEnd={() => setDraggingIdx(null)}
              sx={{
                opacity: draggingIdx === idx ? 0.55 : 1,
                bgcolor: idx === 0 ? 'rgba(255,36,66,0.035)' : 'transparent',
              }}
            >
              <TableCell>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Box sx={{ cursor: 'grab', color: 'text.secondary', fontSize: 14, lineHeight: 1 }}>☰</Box>
                  <Chip
                    size="small"
                    label={idx === 0 ? '主' : `备${idx}`}
                    color={idx === 0 ? 'primary' : 'default'}
                    variant={idx === 0 ? 'filled' : 'outlined'}
                    sx={{ height: 20, fontSize: 10.5, minWidth: 34 }}
                  />
                </Stack>
              </TableCell>
              <TableCell>
                <Stack spacing={0.4}>
                  <Stack direction="row" spacing={0.5}>
                    <TextField
                      size="small"
                      fullWidth
                      placeholder={modelPlaceholder}
                      value={row.model}
                      onChange={e => updateRow(idx, { model: e.target.value })}
                      inputProps={{ style: { fontSize: 12.5 } }}
                    />
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => loadModelOptions(idx)}
                      disabled={!!loadingOptions[idx]}
                      sx={{ minWidth: 46, fontSize: 10.5, px: 0.7 }}
                    >
                      {loadingOptions[idx] ? '...' : '获取'}
                    </Button>
                  </Stack>
                  {(modelOptions[idx] || []).length > 0 && (
                    <Select
                      size="small"
                      value=""
                      displayEmpty
                      onChange={e => updateRow(idx, { model: String(e.target.value) })}
                      sx={{ height: 28, fontSize: 11.5 }}
                    >
                      <MenuItem value="" disabled>选择模型（{modelOptions[idx].length}）</MenuItem>
                      {modelOptions[idx].map(m => (
                        <MenuItem key={m} value={m}>{m}</MenuItem>
                      ))}
                    </Select>
                  )}
                </Stack>
              </TableCell>
              <TableCell>
                <TextField
                  size="small"
                  fullWidth
                  placeholder={idx === 0 ? 'https://api.example.com/v1' : '留空复用主 URL'}
                  value={row.base_url}
                  onChange={e => updateRow(idx, { base_url: e.target.value })}
                  inputProps={{ style: { fontSize: 12.5 } }}
                />
              </TableCell>
              {isImage && (
                <TableCell>
                  <Stack spacing={0.2}>
                    <FormControlLabel
                      control={<Switch size="small" checked={row.supports_image_url !== false} onChange={e => updateRow(idx, { supports_image_url: e.target.checked })} />}
                      label="支持URL"
                      sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: 11.5 } }}
                    />
                    <FormControlLabel
                      control={<Switch size="small" checked={row.supports_quality !== false} onChange={e => updateRow(idx, { supports_quality: e.target.checked })} />}
                      label="支持quality"
                      sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: 11.5 } }}
                    />
                  </Stack>
                </TableCell>
              )}
              <TableCell>
                <TextField
                  size="small"
                  fullWidth
                  placeholder={idx === 0 ? 'sk-...' : '留空复用主 Key'}
                  value={row.api_key}
                  onChange={e => updateRow(idx, { api_key: e.target.value })}
                  inputProps={{ style: { fontSize: 12.5 } }}
                />
              </TableCell>
              <TableCell align="right">
                <Button size="small" color="warning" onClick={() => removeRow(idx)} sx={{ minWidth: 44, fontSize: 11 }}>
                  删除
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Typography sx={{ fontSize: 11.2, color: 'text.secondary', mt: 0.75 }}>
        可拖拽调整顺序。调用失败时自动降到下一行；失败模型进入冷却，稍后会按原队列顺序重新尝试并恢复主位。
        {isImage ? ' 关闭“支持URL”后会由后端下载/读取原图并 multipart 上传；关闭“支持quality”后请求不会传 quality 参数。' : ''}
      </Typography>
    </Paper>
  )
}

export default function SettingsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : ''

  const [s, setS] = useState<PublicSettings | null>(null)
  const [chatApiKey, setChatApiKey] = useState('')
  const [chatBaseUrl, setChatBaseUrl] = useState('')
  const [imageApiKey, setImageApiKey] = useState('')
  const [imageBaseUrl, setImageBaseUrl] = useState('')
  const [chatModel, setChatModel] = useState('')
  const [imageModel, setImageModel] = useState('')
  const [chatModels, setChatModels] = useState('')
  const [imageModels, setImageModels] = useState('')
  const [imageSupportsImageUrl, setImageSupportsImageUrl] = useState(true)
  const [imageSupportsQuality, setImageSupportsQuality] = useState(true)
  const [publicBaseUrl, setPublicBaseUrl] = useState('')

  const [my, setMy] = useState<MySettings | null>(null)
  const [myChatKey, setMyChatKey] = useState('')
  const [myChatBaseUrl, setMyChatBaseUrl] = useState('')
  const [myImageKey, setMyImageKey] = useState('')
  const [myImageBaseUrl, setMyImageBaseUrl] = useState('')
  const [myChatModel, setMyChatModel] = useState('')
  const [myImageModel, setMyImageModel] = useState('')
  const [myChatModels, setMyChatModels] = useState('')
  const [myImageModels, setMyImageModels] = useState('')
  const [myImageSupportsImageUrl, setMyImageSupportsImageUrl] = useState(true)
  const [myImageSupportsQuality, setMyImageSupportsQuality] = useState(true)
  const [useOwnKey, setUseOwnKey] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)

  const [users, setUsers] = useState<AdminUser[]>([])
  const [regOpen, setRegOpen] = useState(true)

  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [mcpTools, setMcpTools] = useState<Array<{ name: string; description: string }>>([])
  const [staticTest, setStaticTest] = useState<Awaited<ReturnType<typeof testStaticImagePublicAccess>> | null>(null)
  const [imageTest, setImageTest] = useState<Awaited<ReturnType<typeof testImageSettings>> | null>(null)

  const load = async () => {
    const cur = await getSettings()
    setS(cur)
    setChatApiKey(cur.chat_api_key || cur.openai_api_key || '')
    setChatBaseUrl(cur.chat_base_url || cur.openai_base_url)
    setImageApiKey(cur.image_api_key || '')
    setImageBaseUrl(cur.image_base_url || cur.chat_base_url || cur.openai_base_url)
    setChatModel(cur.chat_model)
    setImageModel(cur.image_model)
    setChatModels(cur.chat_models || '')
    setImageModels(cur.image_models || '')
    setImageSupportsImageUrl(cur.image_supports_image_url !== false)
    setImageSupportsQuality(cur.image_supports_quality !== false)
    setPublicBaseUrl(cur.public_base_url || '')
    getMcpTools().then(setMcpTools).catch(() => setMcpTools([]))

    getMySettings().then(ms => {
      setMy(ms)
      setUseOwnKey(ms.use_own_key)
      setMyChatKey(ms.chat_api_key || ms.openai_api_key || '')
      setMyChatBaseUrl(ms.chat_base_url || ms.openai_base_url)
      setMyImageKey(ms.image_api_key || '')
      setMyImageBaseUrl(ms.image_base_url || ms.chat_base_url || ms.openai_base_url)
      setMyChatModel(ms.chat_model)
      setMyImageModel(ms.image_model)
      setMyChatModels(ms.chat_models || '')
      setMyImageModels(ms.image_models || '')
      setMyImageSupportsImageUrl(ms.image_supports_image_url !== false)
      setMyImageSupportsQuality(ms.image_supports_quality !== false)
    }).catch(() => {})

    if (isAdmin) {
      listUsers().then(setUsers).catch(() => {})
      getSystemConfig().then(cfg => {
        setRegOpen(cfg.registration_open !== 'false')
      }).catch(() => {})
    }
  }

  useEffect(() => {
    load()
  }, [])

  const saveGlobal = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const next = await updateSettings({
        chat_api_key: chatApiKey || undefined,
        chat_base_url: chatBaseUrl || undefined,
        image_api_key: imageApiKey || undefined,
        image_base_url: imageBaseUrl || undefined,
        chat_model: chatModel || undefined,
        image_model: imageModel || undefined,
        chat_models: chatModels,
        image_models: imageModels,
        image_supports_image_url: imageSupportsImageUrl,
        image_supports_quality: imageSupportsQuality,
        public_base_url: publicBaseUrl.trim(),
      })
      setS(next)
      setChatApiKey(next.chat_api_key || next.openai_api_key || chatApiKey)
      setImageApiKey(next.image_api_key || imageApiKey)
      setMsg({ kind: 'success', text: '全局配置已保存。' })
    } catch (e: any) {
      setMsg({ kind: 'error', text: e?.response?.data?.detail || e?.message || '保存失败' })
    } finally {
      setBusy(false)
    }
  }

  const clearGlobalKey = async (kind: 'chat' | 'image') => {
    if (!isAdmin) return
    setBusy(true)
    setMsg(null)
    try {
      const next = await updateSettings(kind === 'chat' ? { chat_api_key: '', openai_api_key: '' } : { image_api_key: '' })
      setS(next)
      if (kind === 'chat') setChatApiKey('')
      else setImageApiKey('')
      setMsg({ kind: 'success', text: kind === 'chat' ? '全局文本 Key 已清空。' : '全局生图 Key 已清空。' })
    } catch (e: any) {
      setMsg({ kind: 'error', text: e?.response?.data?.detail || e?.message || '清空失败' })
    } finally {
      setBusy(false)
    }
  }

  const saveMy = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const next = await updateMySettings({
        use_own_key: useOwnKey,
        chat_api_key: myChatKey || undefined,
        chat_base_url: myChatBaseUrl || undefined,
        image_api_key: myImageKey || undefined,
        image_base_url: myImageBaseUrl || undefined,
        chat_model: myChatModel || undefined,
        image_model: myImageModel || undefined,
        chat_models: myChatModels,
        image_models: myImageModels,
        image_supports_image_url: myImageSupportsImageUrl,
        image_supports_quality: myImageSupportsQuality,
      })
      setMy(next)
      setMyChatKey(next.chat_api_key || next.openai_api_key || myChatKey)
      setMyImageKey(next.image_api_key || myImageKey)
      setMsg({ kind: 'success', text: '个人设置已保存。' })
    } catch (e: any) {
      setMsg({ kind: 'error', text: e?.message || '保存失败' })
    } finally {
      setBusy(false)
    }
  }

  const clearMyKey = async (kind: 'chat' | 'image') => {
    setBusy(true)
    setMsg(null)
    try {
      const next = await updateMySettings(kind === 'chat' ? { chat_api_key: '', openai_api_key: '' } : { image_api_key: '' })
      setMy(next)
      if (kind === 'chat') setMyChatKey('')
      else setMyImageKey('')
      setMsg({ kind: 'success', text: kind === 'chat' ? '个人文本 Key 已清空。' : '个人生图 Key 已清空。' })
    } catch (e: any) {
      setMsg({ kind: 'error', text: e?.message || '清空失败' })
    } finally {
      setBusy(false)
    }
  }

  const savePassword = async () => {
    if (!currentPassword || !newPassword) {
      setMsg({ kind: 'error', text: '请输入当前密码和新密码。' })
      return
    }
    if (newPassword.length < 4) {
      setMsg({ kind: 'error', text: '新密码至少 4 位。' })
      return
    }
    if (newPassword !== confirmPassword) {
      setMsg({ kind: 'error', text: '两次输入的新密码不一致。' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await changePassword({ current_password: currentPassword, new_password: newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setMsg({ kind: 'success', text: '密码已修改，下次登录请使用新密码。' })
    } catch (e: any) {
      setMsg({ kind: 'error', text: e?.response?.data?.detail || e?.message || '修改密码失败' })
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    setMsg({ kind: 'info', text: '正在测试连接...' })
    try {
      const r = await testSettings()
      if (r.ok) setMsg({ kind: 'success', text: `文本连接正常：${r.reply || ''}；实际模型 ${r.used_chat_model || r.chat_model || '-'}；对话候选 ${r.chat_model_candidates?.length || 1} 个；生图候选 ${r.image_model_candidates?.length || 1} 个；生图配置：${r.image_model || '-'} @ ${r.image_base_url || '-'}；公网地址：${r.public_base_url || '未配置'}` })
      else setMsg({ kind: 'error', text: `连接失败：${r.error || ''}` })
    } finally {
      setBusy(false)
    }
  }

  const testStaticImages = async () => {
    setBusy(true)
    setStaticTest(null)
    setMsg({ kind: 'info', text: '正在生成测试图片并检测 /static/images/... 可访问性...' })
    try {
      const r = await testStaticImagePublicAccess(publicBaseUrl.trim() || undefined)
      setStaticTest(r)
      const reachableButLocal = r.ok && !r.provider_readable
      setMsg({
        kind: r.ok ? (reachableButLocal ? 'info' : 'success') : 'error',
        text: r.ok
          ? (reachableButLocal
            ? `本地静态图片访问正常：HTTP ${r.status_code}，但当前地址不是公网，模型会走本地上传/原图内联。`
            : `静态图片公网访问正常：HTTP ${r.status_code}，${r.bytes || 0} bytes，用时 ${r.elapsed_sec}s`)
          : `静态图片访问失败：${r.message || r.error || '未知错误'}`,
      })
    } catch (e: any) {
      setMsg({ kind: 'error', text: e?.response?.data?.detail || e?.message || '静态图片测试失败' })
    } finally {
      setBusy(false)
    }
  }

  const testImageModel = async () => {
    setBusy(true)
    setImageTest(null)
    setMsg({ kind: 'info', text: '正在真实调用生图模型测试，可能需要数十秒到数分钟...' })
    try {
      const r = await testImageSettings({
        prompt: '小红书风格测试图，奶油红背景，一只可爱的便签贴纸，清晰干净，无文字',
        size: '1152x1536',
        quality: 'high',
      })
      setImageTest(r)
      setMsg({
        kind: r.ok ? 'success' : 'error',
        text: r.ok
          ? `生图模型可用：${r.image_model || '-'}，候选 ${r.image_model_candidates?.length || 1} 个，用时 ${r.elapsed_sec}s`
          : `生图测试失败：${r.error || '未知错误'}${r.timeout ? '（疑似超时）' : ''}`,
      })
    } catch (e: any) {
      setMsg({ kind: 'error', text: e?.response?.data?.detail || e?.message || '生图测试失败' })
    } finally {
      setBusy(false)
    }
  }

  const toggleReg = async () => {
    const next = !regOpen
    setRegOpen(next)
    await updateSystemConfig({ registration_open: next ? 'true' : 'false' })
  }

  const handleRoleChange = async (uid: number, role: 'admin' | 'user') => {
    try {
      await setUserRole(uid, role)
      setUsers(prev => prev.map(u => u.id === uid ? { ...u, role } : u))
    } catch (e: any) {
      setMsg({ kind: 'error', text: e?.response?.data?.detail || '修改失败' })
    }
  }

  const fieldGridSx = {
    display: 'grid',
    gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
    gap: 1.15,
    alignItems: 'start',
  }
  const wideSx = { gridColumn: '1 / -1' }

  return (
    <Box sx={{ p: { xs: 1.25, md: 2.2 }, maxWidth: 1180, mx: 'auto' }}>
      <Stack spacing={0.25} sx={{ mb: 1.8 }}>
        <Typography sx={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5 }}>
          设置
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
          管理个人模型配置{isAdmin ? '和系统管理' : ''}
        </Typography>
      </Stack>

      {!s && (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {msg && <Alert severity={msg.kind} sx={{ mb: 2, borderRadius: 2 }}>{msg.text}</Alert>}

      {/* Personal settings */}
      {s && (
        <Section
          title="我的模型配置"
          desc="开启后使用自己的 API Key 调用模型，关闭则使用管理员提供的全局配置。"
        >
          <FormControlLabel
            control={<Switch checked={useOwnKey} onChange={e => setUseOwnKey(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 13.5 }}>使用自己的 API Key</Typography>}
            sx={{ mb: 2 }}
          />

          {useOwnKey && (
            <Box sx={fieldGridSx}>
              <Typography sx={{ ...wideSx, fontSize: 13, fontWeight: 700, color: 'text.secondary' }}>
                文本 / 对话模型
              </Typography>
              <ModelQueueEditor
                title="对话模型队列"
                model={myChatModel}
                baseUrl={myChatBaseUrl}
                apiKey={myChatKey}
                onModelChange={setMyChatModel}
                onBaseUrlChange={setMyChatBaseUrl}
                onApiKeyChange={setMyChatKey}
                value={myChatModels}
                onChange={setMyChatModels}
                modelPlaceholder="gpt-5.4"
                kind="chat"
                sx={wideSx}
              />

              <Typography sx={{ ...wideSx, fontSize: 13, fontWeight: 700, color: 'text.secondary', pt: 0.3 }}>
                生图模型
              </Typography>
              <ModelQueueEditor
                title="生图模型队列"
                model={myImageModel}
                baseUrl={myImageBaseUrl}
                apiKey={myImageKey}
                supportsImageUrl={myImageSupportsImageUrl}
                supportsQuality={myImageSupportsQuality}
                onModelChange={setMyImageModel}
                onBaseUrlChange={setMyImageBaseUrl}
                onApiKeyChange={setMyImageKey}
                onSupportsImageUrlChange={setMyImageSupportsImageUrl}
                onSupportsQualityChange={setMyImageSupportsQuality}
                value={myImageModels}
                onChange={setMyImageModels}
                modelPlaceholder="gpt-image-2"
                kind="image"
                sx={wideSx}
              />
            </Box>
          )}

          <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ gap: 1, mt: 2.5 }}>
            <Button
              variant="contained"
              onClick={saveMy}
              disabled={busy}
              sx={{ background: 'linear-gradient(135deg,#FF2442,#FF7A00)', '&:hover': { background: 'linear-gradient(135deg,#E01E3A,#E06A00)' } }}
            >
              保存个人设置
            </Button>
            <Button variant="outlined" onClick={test} disabled={busy}>
              测试连接
            </Button>
            <Button variant="outlined" color="warning" onClick={() => clearMyKey('chat')} disabled={busy || !useOwnKey}>
              清空个人文本 Key
            </Button>
            <Button variant="outlined" color="warning" onClick={() => clearMyKey('image')} disabled={busy || !useOwnKey}>
              清空个人生图 Key
            </Button>
          </Stack>
        </Section>
      )}

      {s && (
        <Section title="账号安全" desc="修改当前登录账号的密码。">
          <Stack spacing={2}>
            <TextField
              label="当前密码"
              fullWidth
              type={showPasswords ? 'text' : 'password'}
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowPasswords(v => !v)} edge="end" size="small">
                      {showPasswords ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              label="新密码"
              fullWidth
              type={showPasswords ? 'text' : 'password'}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              helperText="至少 4 位，修改后当前登录不会被强制退出。"
            />
            <TextField
              label="确认新密码"
              fullWidth
              type={showPasswords ? 'text' : 'password'}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
            />
            <Button variant="outlined" onClick={savePassword} disabled={busy} sx={{ alignSelf: 'flex-start' }}>
              修改密码
            </Button>
          </Stack>
        </Section>
      )}

      {/* Admin panel */}
      {isAdmin && s && (
        <>
          <Section
            title="全局 API 配置"
            desc="所有未配置个人 Key 的用户将使用此配置。"
          >
            <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ gap: 0.5, mb: 2.5 }}>
              <Chip
                size="small"
                label={`文本 Key: ${s.chat_api_key_mask || s.openai_api_key_mask || '未设置'}`}
                sx={{
                  bgcolor: (s.chat_api_key_set || s.openai_api_key_set) ? 'rgba(22,163,74,0.08)' : 'rgba(0,0,0,0.04)',
                  color: (s.chat_api_key_set || s.openai_api_key_set) ? '#16A34A' : 'text.secondary',
                  fontWeight: 500,
                }}
              />
              <Chip
                size="small"
                label={`生图 Key: ${s.image_api_key_mask || '未设置'}`}
                sx={{
                  bgcolor: s.image_api_key_set ? 'rgba(22,163,74,0.08)' : 'rgba(0,0,0,0.04)',
                  color: s.image_api_key_set ? '#16A34A' : 'text.secondary',
                  fontWeight: 500,
                }}
              />
              <Chip size="small" label={`对话 ${s.chat_model}`} />
              <Chip size="small" label={`图片 ${s.image_model}`} />
              <Chip size="small" label={`对话候选 ${s.chat_model_candidates?.length || 1}`} />
              <Chip size="small" label={`生图候选 ${s.image_model_candidates?.length || 1}`} />
              <Chip
                size="small"
                label={`公网地址 ${s.public_base_url || '未配置'}`}
                sx={{
                  bgcolor: s.public_base_url ? 'rgba(22,163,74,0.08)' : 'rgba(0,0,0,0.04)',
                  color: s.public_base_url ? '#16A34A' : 'text.secondary',
                  fontWeight: 500,
                }}
              />
            </Stack>

            <Box sx={fieldGridSx}>
              <Typography sx={{ ...wideSx, fontSize: 13, fontWeight: 700, color: 'text.secondary' }}>
                文本 / 对话模型
              </Typography>
              <ModelQueueEditor
                title="对话模型队列"
                model={chatModel}
                baseUrl={chatBaseUrl}
                apiKey={chatApiKey}
                onModelChange={setChatModel}
                onBaseUrlChange={setChatBaseUrl}
                onApiKeyChange={setChatApiKey}
                value={chatModels}
                onChange={setChatModels}
                modelPlaceholder="gpt-5.4"
                kind="chat"
                sx={wideSx}
              />

              <Typography sx={{ ...wideSx, fontSize: 13, fontWeight: 700, color: 'text.secondary', pt: 0.3 }}>
                生图模型
              </Typography>
              <ModelQueueEditor
                title="生图模型队列"
                model={imageModel}
                baseUrl={imageBaseUrl}
                apiKey={imageApiKey}
                supportsImageUrl={imageSupportsImageUrl}
                supportsQuality={imageSupportsQuality}
                onModelChange={setImageModel}
                onBaseUrlChange={setImageBaseUrl}
                onApiKeyChange={setImageApiKey}
                onSupportsImageUrlChange={setImageSupportsImageUrl}
                onSupportsQualityChange={setImageSupportsQuality}
                value={imageModels}
                onChange={setImageModels}
                modelPlaceholder="gpt-image-2"
                kind="image"
                sx={wideSx}
              />

              <Typography sx={{ ...wideSx, fontSize: 13, fontWeight: 700, color: 'text.secondary', pt: 0.3 }}>
                部署访问地址
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={wideSx}>
                <TextField
                  size="small"
                  label="服务公网地址 / 当前部署 Origin"
                  placeholder="例如 http://服务器IP:8787 或 https://xhs.example.com"
                  fullWidth
                  value={publicBaseUrl}
                  onChange={e => setPublicBaseUrl(e.target.value)}
                  helperText="直接用 IP/域名访问后端时填这里。模型读取 /static/images/... 会优先转成这个公网地址；失败再回退本地上传/内联。"
                />
                <Button
                  variant="outlined"
                  onClick={() => setPublicBaseUrl(currentOrigin)}
                  sx={{ minWidth: 138, alignSelf: { xs: 'stretch', sm: 'flex-start' }, mt: { sm: 0.5 } }}
                >
                  使用当前地址
                </Button>
              </Stack>
              <Typography sx={{ ...wideSx, fontSize: 11.5, color: 'text.secondary', mt: -0.5 }}>
                当前浏览器访问地址：{currentOrigin || '-'}。本地开发经 Vite 代理时可不填；服务器直连 IP/域名部署时建议填写。
              </Typography>
              <Paper
                variant="outlined"
                sx={{
                  ...wideSx,
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: staticTest
                    ? (staticTest.ok
                      ? (staticTest.provider_readable ? 'rgba(22,163,74,0.04)' : 'rgba(37,99,235,0.04)')
                      : 'rgba(220,38,38,0.04)')
                    : 'rgba(0,0,0,0.015)',
                }}
              >
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                  <Box flex={1}>
                    <Typography sx={{ fontSize: 13, fontWeight: 700 }}>静态图片公网可访问测试</Typography>
                    <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.3 }}>
                      自动写入一张 1×1 测试图，并从服务端请求完整 URL；本地模式确认代理/静态挂载，服务器模式确认外部模型可直接读取。
                    </Typography>
                  </Box>
                  <Button variant="outlined" onClick={testStaticImages} disabled={busy} sx={{ minWidth: 152 }}>
                    测试静态图片
                  </Button>
                </Stack>
                {staticTest && (
                  <Box sx={{ mt: 1.2 }}>
                    <Stack direction="row" spacing={0.6} flexWrap="wrap" sx={{ gap: 0.6, mb: 0.8 }}>
                      <Chip
                        size="small"
                        label={staticTest.ok ? (staticTest.provider_readable ? '公网可访问' : '本地可访问') : '不可访问'}
                        color={staticTest.ok ? (staticTest.provider_readable ? 'success' : 'info') : 'error'}
                        sx={{ height: 22, fontSize: 11 }}
                      />
                      <Chip
                        size="small"
                        label={staticTest.mode === 'server' ? '服务器模式' : staticTest.mode === 'invalid' ? '地址无效' : '本地模式'}
                        sx={{ height: 22, fontSize: 11 }}
                      />
                      {staticTest.provider_readable === false && staticTest.ok && (
                        <Chip size="small" label="模型不可直接抓取" color="warning" sx={{ height: 22, fontSize: 11 }} />
                      )}
                      {typeof staticTest.status_code === 'number' && (
                        <Chip size="small" label={`HTTP ${staticTest.status_code}`} sx={{ height: 22, fontSize: 11 }} />
                      )}
                      {staticTest.content_type && (
                        <Chip size="small" label={staticTest.content_type} sx={{ height: 22, fontSize: 11 }} />
                      )}
                      <Chip size="small" label={`${staticTest.elapsed_sec}s`} sx={{ height: 22, fontSize: 11 }} />
                    </Stack>
                    <Typography sx={{ fontSize: 11.5, color: 'text.secondary', wordBreak: 'break-all' }}>
                      URL：<a href={staticTest.public_url} target="_blank" rel="noreferrer">{staticTest.public_url}</a>
                    </Typography>
                    {staticTest.provider_base_url && (
                      <Typography sx={{ fontSize: 11.5, color: 'text.secondary', wordBreak: 'break-all', mt: 0.4 }}>
                        模型可读 Origin：{staticTest.provider_base_url}
                      </Typography>
                    )}
                    {staticTest.message && (
                      <Typography sx={{ fontSize: 11.5, color: staticTest.ok ? 'text.secondary' : 'error.main', mt: 0.5 }}>
                        {staticTest.error || staticTest.message}
                      </Typography>
                    )}
                  </Box>
                )}
              </Paper>
              <Paper
                variant="outlined"
                sx={{
                  ...wideSx,
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: imageTest ? (imageTest.ok ? 'rgba(22,163,74,0.04)' : 'rgba(220,38,38,0.04)') : 'rgba(0,0,0,0.015)',
                }}
              >
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                  <Box flex={1}>
                    <Typography sx={{ fontSize: 13, fontWeight: 700 }}>生图模型真实调用测试</Typography>
                    <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.3 }}>
                      使用当前有效配置请求 1 张 1152×1536 high 质量测试图，显示模型、耗时、错误和返回图片。
                    </Typography>
                  </Box>
                  <Button variant="outlined" onClick={testImageModel} disabled={busy} sx={{ minWidth: 152 }}>
                    测试生图模型
                  </Button>
                </Stack>
                {imageTest && (
                  <Box sx={{ mt: 1.2 }}>
                    <Stack direction="row" spacing={0.6} flexWrap="wrap" sx={{ gap: 0.6, mb: 0.8 }}>
                      <Chip
                        size="small"
                        label={imageTest.ok ? '可用' : '失败'}
                        color={imageTest.ok ? 'success' : 'error'}
                        sx={{ height: 22, fontSize: 11 }}
                      />
                      <Chip size="small" label={`${imageTest.elapsed_sec || 0}s`} sx={{ height: 22, fontSize: 11 }} />
                      {imageTest.timeout && <Chip size="small" color="warning" label="超时" sx={{ height: 22, fontSize: 11 }} />}
                      {imageTest.image_model && <Chip size="small" label={imageTest.image_model} sx={{ height: 22, fontSize: 11 }} />}
                      <Chip size="small" label={`候选 ${imageTest.image_model_candidates?.length || 1}`} sx={{ height: 22, fontSize: 11 }} />
                      {imageTest.size && <Chip size="small" label={imageTest.size} sx={{ height: 22, fontSize: 11 }} />}
                      {imageTest.quality && <Chip size="small" label={`quality=${imageTest.quality}`} sx={{ height: 22, fontSize: 11 }} />}
                    </Stack>
                    {Array.isArray(imageTest.image_attempts) && imageTest.image_attempts.length > 0 && (
                      <Box sx={{ mb: 1, p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: 'background.paper' }}>
                        <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mb: 0.6 }}>
                          重试链路：失败即切换到下一候选，成功后停止
                        </Typography>
                        <Stack spacing={0.5}>
                          {imageTest.image_attempts.map((a, idx) => (
                            <Stack key={`${a.model || 'model'}-${idx}`} direction="row" spacing={0.6} alignItems="center" sx={{ minWidth: 0 }}>
                              <Chip
                                size="small"
                                label={a.ok || a.status === 'success' ? '成功' : '失败'}
                                color={a.ok || a.status === 'success' ? 'success' : 'error'}
                                sx={{ height: 20, fontSize: 10.5 }}
                              />
                              <Typography sx={{ fontSize: 12, fontWeight: 700, minWidth: 0 }} noWrap>
                                {idx + 1}. {a.model || '-'}
                              </Typography>
                              {a.method && <Chip size="small" label={a.method} sx={{ height: 20, fontSize: 10.5 }} />}
                              {deliveryLabel(a) && <Chip size="small" label={deliveryLabel(a)} variant="outlined" sx={{ height: 20, fontSize: 10.5 }} />}
                              {a.supports_image_url === false && <Chip size="small" label="URL关闭" variant="outlined" sx={{ height: 20, fontSize: 10.5 }} />}
                              {a.supports_quality === false && <Chip size="small" label="无quality" variant="outlined" sx={{ height: 20, fontSize: 10.5 }} />}
                              <Typography sx={{ fontSize: 11.5, color: 'text.secondary', ml: 'auto', whiteSpace: 'nowrap' }}>
                                {a.elapsed_sec ?? 0}s
                              </Typography>
                            </Stack>
                          ))}
                        </Stack>
                      </Box>
                    )}
                    {imageTest.image && (
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mt: 1 }}>
                        <Box
                          component="img"
                          src={imageTest.image}
                          alt="生图测试结果"
                          sx={{ width: 92, height: 122, objectFit: 'cover', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}
                        />
                        <Typography sx={{ fontSize: 11.5, color: 'text.secondary', wordBreak: 'break-all' }}>
                          URL：<a href={imageTest.image} target="_blank" rel="noreferrer">{imageTest.image}</a>
                        </Typography>
                      </Box>
                    )}
                    {!imageTest.ok && (
                      <Typography sx={{ fontSize: 11.5, color: 'error.main', mt: 0.5, wordBreak: 'break-word' }}>
                        {imageTest.error || '未知错误'}
                      </Typography>
                    )}
                  </Box>
                )}
              </Paper>
              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ ...wideSx, gap: 1 }}>
                <Button
                  variant="contained"
                  onClick={saveGlobal}
                  disabled={busy}
                  sx={{ alignSelf: 'flex-start', background: 'linear-gradient(135deg,#FF2442,#FF7A00)', '&:hover': { background: 'linear-gradient(135deg,#E01E3A,#E06A00)' } }}
                >
                  保存全局配置
                </Button>
                <Button variant="outlined" onClick={test} disabled={busy}>
                  测试文本连接
                </Button>
                <Button variant="outlined" color="warning" onClick={() => clearGlobalKey('chat')} disabled={busy}>
                  清空全局文本 Key
                </Button>
                <Button variant="outlined" color="warning" onClick={() => clearGlobalKey('image')} disabled={busy}>
                  清空全局生图 Key
                </Button>
              </Stack>
            </Box>
          </Section>

          <Section title="系统管理" desc="注册控制和用户角色管理。">
            <FormControlLabel
              control={<Switch checked={regOpen} onChange={toggleReg} />}
              label={<Typography sx={{ fontSize: 13.5 }}>开放注册</Typography>}
              sx={{ mb: 2.5 }}
            />

            <Typography sx={{ fontSize: 13.5, fontWeight: 600, mb: 1.5 }}>用户列表</Typography>
            <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.02)' }}>
                    <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>ID</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>用户名</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>角色</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>注册时间</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {users.map(u => (
                    <TableRow key={u.id} sx={{ '&:last-child td': { borderBottom: 0 } }}>
                      <TableCell sx={{ fontSize: 12.5 }}>{u.id}</TableCell>
                      <TableCell sx={{ fontSize: 12.5, fontWeight: 500 }}>{u.username}</TableCell>
                      <TableCell>
                        {u.id === user?.id ? (
                          <Chip
                            size="small"
                            label="admin"
                            sx={{ bgcolor: 'rgba(255,36,66,0.08)', color: '#FF2442', fontSize: 11, fontWeight: 600, height: 22 }}
                          />
                        ) : (
                          <Select
                            size="small"
                            value={u.role}
                            onChange={e => handleRoleChange(u.id, e.target.value as 'admin' | 'user')}
                            sx={{ fontSize: 12, height: 28, borderRadius: 1.5 }}
                          >
                            <MenuItem value="user">user</MenuItem>
                            <MenuItem value="admin">admin</MenuItem>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>
                        {formatBeijingDate(u.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Section>
        </>
      )}

      <Section
        title="MCP 接入"
        desc="本项目同时提供 HTTP 桥和 stdio server 两种 MCP 接入方式。"
      >
        <Stack spacing={0.6} sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 12.5, color: 'text.primary' }}>
            · HTTP 桥：<code style={{ fontSize: 11.5, padding: '1px 5px', borderRadius: 4, background: 'rgba(0,0,0,0.04)' }}>GET /api/mcp/tools</code> · <code style={{ fontSize: 11.5, padding: '1px 5px', borderRadius: 4, background: 'rgba(0,0,0,0.04)' }}>POST /api/mcp/call</code>
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: 'text.primary' }}>
            · stdio server：<code style={{ fontSize: 11.5, padding: '1px 5px', borderRadius: 4, background: 'rgba(0,0,0,0.04)' }}>bash start_mcp.sh</code>，适配 Claude Desktop / Cursor
          </Typography>
        </Stack>
        <Box
          sx={{
            p: 2,
            bgcolor: '#1A1A1A',
            color: '#E5E5E5',
            borderRadius: 2.5,
            fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            overflow: 'auto',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >{`{
  "mcpServers": {
    "xhs-agent": {
      "command": "bash",
      "args": ["<项目路径>/start_mcp.sh"]
    }
  }
}`}</Box>

        <Typography sx={{ fontSize: 13, fontWeight: 600, mt: 2.5, mb: 1 }}>
          已注册工具（{mcpTools.length}）
        </Typography>
        <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ gap: 0.5 }}>
          {mcpTools.map(t => (
            <Chip
              key={t.name}
              size="small"
              label={t.name}
              title={t.description}
              sx={{ fontFamily: 'monospace', fontSize: 11 }}
            />
          ))}
        </Stack>
      </Section>

      <Box sx={{ py: 3, textAlign: 'center' }}>
        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
          XHS Agent · v0.2.0
        </Typography>
      </Box>
    </Box>
  )
}
