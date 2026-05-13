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
  testStaticImagePublicAccess,
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
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : ''

  const [s, setS] = useState<PublicSettings | null>(null)
  const [chatApiKey, setChatApiKey] = useState('')
  const [chatBaseUrl, setChatBaseUrl] = useState('')
  const [imageApiKey, setImageApiKey] = useState('')
  const [imageBaseUrl, setImageBaseUrl] = useState('')
  const [chatModel, setChatModel] = useState('')
  const [imageModel, setImageModel] = useState('')
  const [publicBaseUrl, setPublicBaseUrl] = useState('')
  const [showChatKey, setShowChatKey] = useState(false)
  const [showImageKey, setShowImageKey] = useState(false)

  const [my, setMy] = useState<MySettings | null>(null)
  const [myChatKey, setMyChatKey] = useState('')
  const [myChatBaseUrl, setMyChatBaseUrl] = useState('')
  const [myImageKey, setMyImageKey] = useState('')
  const [myImageBaseUrl, setMyImageBaseUrl] = useState('')
  const [myChatModel, setMyChatModel] = useState('')
  const [myImageModel, setMyImageModel] = useState('')
  const [useOwnKey, setUseOwnKey] = useState(false)
  const [showMyChatKey, setShowMyChatKey] = useState(false)
  const [showMyImageKey, setShowMyImageKey] = useState(false)

  const [users, setUsers] = useState<AdminUser[]>([])
  const [regOpen, setRegOpen] = useState(true)

  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [mcpTools, setMcpTools] = useState<Array<{ name: string; description: string }>>([])
  const [staticTest, setStaticTest] = useState<Awaited<ReturnType<typeof testStaticImagePublicAccess>> | null>(null)

  const load = async () => {
    const cur = await getSettings()
    setS(cur)
    setChatBaseUrl(cur.chat_base_url || cur.openai_base_url)
    setImageBaseUrl(cur.image_base_url || cur.chat_base_url || cur.openai_base_url)
    setChatModel(cur.chat_model)
    setImageModel(cur.image_model)
    setPublicBaseUrl(cur.public_base_url || '')
    getMcpTools().then(setMcpTools).catch(() => setMcpTools([]))

    getMySettings().then(ms => {
      setMy(ms)
      setUseOwnKey(ms.use_own_key)
      setMyChatBaseUrl(ms.chat_base_url || ms.openai_base_url)
      setMyImageBaseUrl(ms.image_base_url || ms.chat_base_url || ms.openai_base_url)
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
        chat_api_key: chatApiKey || undefined,
        chat_base_url: chatBaseUrl || undefined,
        image_api_key: imageApiKey || undefined,
        image_base_url: imageBaseUrl || undefined,
        chat_model: chatModel || undefined,
        image_model: imageModel || undefined,
        public_base_url: publicBaseUrl.trim(),
      })
      setS(next)
      setChatApiKey('')
      setImageApiKey('')
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
        chat_api_key: myChatKey || undefined,
        chat_base_url: myChatBaseUrl || undefined,
        image_api_key: myImageKey || undefined,
        image_base_url: myImageBaseUrl || undefined,
        chat_model: myChatModel || undefined,
        image_model: myImageModel || undefined,
      })
      setMy(next)
      setMyChatKey('')
      setMyImageKey('')
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
      if (r.ok) setMsg({ kind: 'success', text: `文本连接正常：${r.reply || ''}；生图配置：${r.image_model || '-'} @ ${r.image_base_url || '-'}；公网地址：${r.public_base_url || '未配置'}` })
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
      setMsg({
        kind: r.ok ? 'success' : 'error',
        text: r.ok
          ? `静态图片访问正常：HTTP ${r.status_code}，${r.bytes || 0} bytes，用时 ${r.elapsed_sec}s`
          : `静态图片访问失败：${r.message || r.error || '未知错误'}`,
      })
    } catch (e: any) {
      setMsg({ kind: 'error', text: e?.response?.data?.detail || e?.message || '静态图片测试失败' })
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
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'text.secondary' }}>
                文本 / 对话模型
              </Typography>
              <TextField
                label="文本 API Key"
                placeholder={my?.chat_api_key_set || my?.openai_api_key_set ? '留空则保持不变' : '填入 sk-...'}
                fullWidth
                value={myChatKey}
                type={showMyChatKey ? 'text' : 'password'}
                onChange={e => setMyChatKey(e.target.value)}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShowMyChatKey(v => !v)} edge="end" size="small">
                        {showMyChatKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              <TextField
                label="文本 Base URL"
                placeholder="https://api.openai.com/v1"
                fullWidth
                value={myChatBaseUrl}
                onChange={e => setMyChatBaseUrl(e.target.value)}
              />
              <TextField
                label="对话模型"
                placeholder="留空则用全局"
                fullWidth
                value={myChatModel}
                onChange={e => setMyChatModel(e.target.value)}
              />

              <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'text.secondary', pt: 1 }}>
                生图模型
              </Typography>
              <TextField
                label="生图 API Key"
                placeholder={my?.image_api_key_set ? '留空则保持不变；不填则复用文本 Key' : '可留空复用文本 Key'}
                fullWidth
                value={myImageKey}
                type={showMyImageKey ? 'text' : 'password'}
                onChange={e => setMyImageKey(e.target.value)}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShowMyImageKey(v => !v)} edge="end" size="small">
                        {showMyImageKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              <TextField
                label="生图 Base URL"
                placeholder="可留空复用文本 Base URL"
                fullWidth
                value={myImageBaseUrl}
                onChange={e => setMyImageBaseUrl(e.target.value)}
              />
              <TextField
                label="图片模型"
                placeholder="留空则用全局"
                fullWidth
                value={myImageModel}
                onChange={e => setMyImageModel(e.target.value)}
              />
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

            <Stack spacing={2}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'text.secondary' }}>
                文本 / 对话模型
              </Typography>
              <TextField
                label="文本 API Key"
                placeholder={(s.chat_api_key_set || s.openai_api_key_set) ? '留空则保持不变' : '填入 sk-...'}
                fullWidth
                value={chatApiKey}
                type={showChatKey ? 'text' : 'password'}
                onChange={e => setChatApiKey(e.target.value)}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShowChatKey(v => !v)} edge="end" size="small">
                        {showChatKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              <TextField
                label="文本 Base URL"
                placeholder="https://api.openai.com/v1"
                fullWidth
                value={chatBaseUrl}
                onChange={e => setChatBaseUrl(e.target.value)}
              />
              <TextField
                label="对话模型"
                fullWidth
                value={chatModel}
                onChange={e => setChatModel(e.target.value)}
              />

              <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'text.secondary', pt: 1 }}>
                生图模型
              </Typography>
              <TextField
                label="生图 API Key"
                placeholder={s.image_api_key_set ? '留空则保持不变；不填则复用文本 Key' : '可留空复用文本 Key'}
                fullWidth
                value={imageApiKey}
                type={showImageKey ? 'text' : 'password'}
                onChange={e => setImageApiKey(e.target.value)}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShowImageKey(v => !v)} edge="end" size="small">
                        {showImageKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              <TextField
                label="生图 Base URL"
                placeholder="可留空复用文本 Base URL"
                fullWidth
                value={imageBaseUrl}
                onChange={e => setImageBaseUrl(e.target.value)}
              />
              <TextField
                label="图片模型"
                fullWidth
                value={imageModel}
                onChange={e => setImageModel(e.target.value)}
              />

              <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'text.secondary', pt: 1 }}>
                部署访问地址
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
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
              <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: -1 }}>
                当前浏览器访问地址：{currentOrigin || '-'}。本地开发经 Vite 代理时可不填；服务器直连 IP/域名部署时建议填写。
              </Typography>
              <Paper
                variant="outlined"
                sx={{
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: staticTest ? (staticTest.ok ? 'rgba(22,163,74,0.04)' : 'rgba(220,38,38,0.04)') : 'rgba(0,0,0,0.015)',
                }}
              >
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
                  <Box flex={1}>
                    <Typography sx={{ fontSize: 13, fontWeight: 700 }}>静态图片公网可访问测试</Typography>
                    <Typography sx={{ fontSize: 11.5, color: 'text.secondary', mt: 0.3 }}>
                      自动写入一张 1×1 测试图，并从服务端请求完整 URL，确认 /static/images/... 部署后真的可访问。
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
                        label={staticTest.ok ? '可访问' : '不可访问'}
                        color={staticTest.ok ? 'success' : 'error'}
                        sx={{ height: 22, fontSize: 11 }}
                      />
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
                    {!staticTest.ok && (
                      <Typography sx={{ fontSize: 11.5, color: 'error.main', mt: 0.5 }}>
                        {staticTest.error || staticTest.message}
                      </Typography>
                    )}
                  </Box>
                )}
              </Paper>
              <Stack direction="row" spacing={1}>
                <Button
                  variant="contained"
                  onClick={saveGlobal}
                  disabled={busy}
                  sx={{ alignSelf: 'flex-start', background: 'linear-gradient(135deg,#FF2442,#FF7A00)', '&:hover': { background: 'linear-gradient(135deg,#E01E3A,#E06A00)' } }}
                >
                  保存全局配置
                </Button>
              </Stack>
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
