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
  Divider,
} from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { getSettings, updateSettings, testSettings, getMcpTools, type PublicSettings } from '../api/client'

function Section({ title, desc, children }: { title: string; desc?: string; children: any }) {
  return (
    <Box sx={{ py: 3, borderBottom: 1, borderColor: 'divider' }}>
      <Typography sx={{ fontSize: 16, fontWeight: 600, color: 'text.primary' }}>{title}</Typography>
      {desc && (
        <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5, mb: 1.5 }}>{desc}</Typography>
      )}
      {children}
    </Box>
  )
}

export default function SettingsPage() {
  const [s, setS] = useState<PublicSettings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [chatModel, setChatModel] = useState('')
  const [imageModel, setImageModel] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [mcpTools, setMcpTools] = useState<Array<{ name: string; description: string }>>([])

  const load = async () => {
    const cur = await getSettings()
    setS(cur)
    setBaseUrl(cur.openai_base_url)
    setChatModel(cur.chat_model)
    setImageModel(cur.image_model)
    getMcpTools().then(setMcpTools).catch(() => setMcpTools([]))
  }

  useEffect(() => {
    load()
  }, [])

  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const next = await updateSettings({
        openai_api_key: apiKey || undefined,
        openai_base_url: baseUrl || undefined,
        chat_model: chatModel || undefined,
        image_model: imageModel || undefined,
      })
      setS(next)
      setApiKey('')
      setMsg({ kind: 'success', text: '已保存，配置已热更新。' })
    } catch (e: any) {
      setMsg({ kind: 'error', text: e?.message || '保存失败' })
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    setMsg({ kind: 'info', text: '正在测试连接...' })
    try {
      const r = await testSettings()
      if (r.ok) setMsg({ kind: 'success', text: `连接正常，模型回复：${r.reply || ''}` })
      else setMsg({ kind: 'error', text: `连接失败：${r.error || ''}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 760, mx: 'auto' }}>
      <Typography sx={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.3, mb: 0.5 }}>
        设置
      </Typography>
      <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mb: 1 }}>
        管理 API 密钥、模型和 MCP 接入。修改保存后立即生效。
      </Typography>

      {!s && (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {s && (
        <Section
          title="API 与模型"
          desc="OpenAI 兼容网关配置。API Key 存储在本地 data/settings.json。"
        >
          <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ gap: 0.5, mb: 2 }}>
            <Chip
              size="small"
              label={`Key: ${s.openai_api_key_mask || '未设置'}`}
              sx={{
                bgcolor: s.openai_api_key_set ? '#ecfdf5' : '#f3f4f6',
                color: s.openai_api_key_set ? '#0F8C3D' : '#8A8A8F',
              }}
            />
            <Chip size="small" label={`对话 ${s.chat_model}`} sx={{ bgcolor: 'action.hover' }} />
            <Chip size="small" label={`图片 ${s.image_model}`} sx={{ bgcolor: 'action.hover' }} />
          </Stack>

          <Stack spacing={2}>
            <TextField
              label="OpenAI API Key"
              placeholder={s.openai_api_key_set ? '留空则保持不变' : '填入 sk-...'}
              fullWidth
              value={apiKey}
              type={showKey ? 'text' : 'password'}
              onChange={e => setApiKey(e.target.value)}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowKey(v => !v)} edge="end" size="small">
                      {showKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              label="Base URL"
              placeholder="https://yituoshiai.com/v1"
              fullWidth
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="对话模型"
                fullWidth
                value={chatModel}
                onChange={e => setChatModel(e.target.value)}
              />
              <TextField
                label="图片模型"
                fullWidth
                value={imageModel}
                onChange={e => setImageModel(e.target.value)}
              />
            </Stack>

            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                onClick={save}
                disabled={busy}
                sx={{ bgcolor: '#FF2741', '&:hover': { bgcolor: '#D61030' } }}
              >
                保存
              </Button>
              <Button variant="outlined" onClick={test} disabled={busy}>
                测试连接
              </Button>
            </Stack>
            {msg && <Alert severity={msg.kind}>{msg.text}</Alert>}
          </Stack>
        </Section>
      )}

      <Section
        title="MCP 接入"
        desc="本项目同时提供 HTTP 桥 (/api/mcp/*) 和 stdio server 两种 MCP 接入方式。"
      >
        <Stack spacing={0.6} sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 13, color: 'text.primary' }}>
            · HTTP 桥：<code>GET /api/mcp/tools</code> · <code>POST /api/mcp/call</code>
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'text.primary' }}>
            · stdio server：<code>bash start_mcp.sh</code>，适配 Claude Desktop / Cursor
          </Typography>
        </Stack>
        <Box
          sx={{
            p: 1.8,
            bgcolor: '#FF2741',
            color: '#EEE9E1',
            borderRadius: 2,
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: 12.5,
            whiteSpace: 'pre-wrap',
            overflow: 'auto',
          }}
        >{`{
  "mcpServers": {
    "xhs-agent": {
      "command": "bash",
      "args": ["<项目路径>/start_mcp.sh"]
    }
  }
}`}</Box>

        <Typography sx={{ fontSize: 13, fontWeight: 600, mt: 2.2, mb: 1 }}>
          已注册工具（{mcpTools.length}）
        </Typography>
        <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ gap: 0.5 }}>
          {mcpTools.map(t => (
            <Chip
              key={t.name}
              size="small"
              label={t.name}
              title={t.description}
              sx={{ bgcolor: 'action.hover', fontFamily: 'monospace', fontSize: 11 }}
            />
          ))}
        </Stack>
      </Section>

      <Box sx={{ py: 3 }}>
        <Typography sx={{ fontSize: 11, color: '#B8B4AB' }}>
          XHS Agent · v0.2.0
        </Typography>
      </Box>
    </Box>
  )
}
