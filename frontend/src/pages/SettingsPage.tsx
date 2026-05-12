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
  listUsers,
  setUserRole,
  getSystemConfig,
  updateSystemConfig,
  type PublicSettings,
  type MySettings,
  type AdminUser,
} from '../api/client'
import { useAuth } from '../AuthContext'

function Section({ title, desc, children }: { title: string; desc?: string; children: any }) {
  return (
    <Paper sx={{ p: 3, mb: 2.5 }}>
      <Typography sx={{ fontSize: 15, fontWeight: 700, color: 'text.primary', mb: 0.3 }}>{title}</Typography>
      {desc && (
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mb: 2 }}>{desc}</Typography>
      )}
      {children}
    </Paper>
  )
}

export default function SettingsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [s, setS] = useState<PublicSettings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [chatModel, setChatModel] = useState('')
  const [imageModel, setImageModel] = useState('')
  const [showKey, setShowKey] = useState(false)

  const [my, setMy] = useState<MySettings | null>(null)
  const [myKey, setMyKey] = useState('')
  const [myBaseUrl, setMyBaseUrl] = useState('')
  const [myChatModel, setMyChatModel] = useState('')
  const [myImageModel, setMyImageModel] = useState('')
  const [useOwnKey, setUseOwnKey] = useState(false)
  const [showMyKey, setShowMyKey] = useState(false)

  const [users, setUsers] = useState<AdminUser[]>([])
  const [regOpen, setRegOpen] = useState(true)

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

    getMySettings().then(ms => {
      setMy(ms)
      setUseOwnKey(ms.use_own_key)
      setMyBaseUrl(ms.openai_base_url)
      setMyChatModel(ms.chat_model)
      setMyImageModel(ms.image_model)
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
        openai_api_key: apiKey || undefined,
        openai_base_url: baseUrl || undefined,
        chat_model: chatModel || undefined,
        image_model: imageModel || undefined,
      })
      setS(next)
      setApiKey('')
      setMsg({ kind: 'success', text: '全局配置已保存。' })
    } catch (e: any) {
      setMsg({ kind: 'error', text: e?.response?.data?.detail || e?.message || '保存失败' })
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
        openai_api_key: myKey || undefined,
        openai_base_url: myBaseUrl || undefined,
        chat_model: myChatModel || undefined,
        image_model: myImageModel || undefined,
      })
      setMy(next)
      setMyKey('')
      setMsg({ kind: 'success', text: '个人设置已保存。' })
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

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 760, mx: 'auto' }}>
      <Stack spacing={0.3} sx={{ mb: 3 }}>
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
            <Stack spacing={2}>
              <TextField
                label="我的 API Key"
                placeholder={my?.openai_api_key_set ? '留空则保持不变' : '填入 sk-...'}
                fullWidth
                value={myKey}
                type={showMyKey ? 'text' : 'password'}
                onChange={e => setMyKey(e.target.value)}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShowMyKey(v => !v)} edge="end" size="small">
                        {showMyKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              <TextField
                label="Base URL"
                placeholder="https://api.openai.com/v1"
                fullWidth
                value={myBaseUrl}
                onChange={e => setMyBaseUrl(e.target.value)}
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="对话模型"
                  placeholder="留空则用全局"
                  fullWidth
                  value={myChatModel}
                  onChange={e => setMyChatModel(e.target.value)}
                />
                <TextField
                  label="图片模型"
                  placeholder="留空则用全局"
                  fullWidth
                  value={myImageModel}
                  onChange={e => setMyImageModel(e.target.value)}
                />
              </Stack>
            </Stack>
          )}

          <Stack direction="row" spacing={1} sx={{ mt: 2.5 }}>
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
                label={`Key: ${s.openai_api_key_mask || '未设置'}`}
                sx={{
                  bgcolor: s.openai_api_key_set ? 'rgba(22,163,74,0.08)' : 'rgba(0,0,0,0.04)',
                  color: s.openai_api_key_set ? '#16A34A' : 'text.secondary',
                  fontWeight: 500,
                }}
              />
              <Chip size="small" label={`对话 ${s.chat_model}`} />
              <Chip size="small" label={`图片 ${s.image_model}`} />
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
                placeholder="https://api.openai.com/v1"
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
              <Button
                variant="contained"
                onClick={saveGlobal}
                disabled={busy}
                sx={{ alignSelf: 'flex-start', background: 'linear-gradient(135deg,#FF2442,#FF7A00)', '&:hover': { background: 'linear-gradient(135deg,#E01E3A,#E06A00)' } }}
              >
                保存全局配置
              </Button>
            </Stack>
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
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}
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
