import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Button, CircularProgress, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
import { useAuth } from '../AuthContext'
import { toast } from 'sonner'

export default function LoginPage() {
  const { login, register, user } = useAuth()
  const nav = useNavigate()
  const [tab, setTab] = useState(0)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) {
    nav('/', { replace: true })
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) return
    setBusy(true)
    try {
      if (tab === 0) {
        await login(username, password)
      } else {
        await register(username, password)
      }
      nav('/', { replace: true })
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || '操作失败'
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: 380,
          bgcolor: 'background.paper',
          borderRadius: 4,
          border: '1px solid',
          borderColor: 'divider',
          p: 4,
        }}
      >
        <Stack alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'linear-gradient(135deg,#FF2741 0%,#FF7A00 100%)',
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              fontWeight: 800,
              fontSize: 20,
            }}
          >
            红
          </Box>
          <Typography sx={{ fontSize: 20, fontWeight: 700 }}>小红书创作助手</Typography>
        </Stack>

        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="fullWidth"
          sx={{ mb: 3 }}
        >
          <Tab label="登录" />
          <Tab label="注册" />
        </Tabs>

        <form onSubmit={handleSubmit}>
          <Stack spacing={2}>
            <TextField
              label="用户名"
              fullWidth
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
            />
            <TextField
              label="密码"
              type="password"
              fullWidth
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={tab === 0 ? 'current-password' : 'new-password'}
            />
            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={busy || !username || !password}
              sx={{
                py: 1.2,
                background: 'linear-gradient(135deg,#FF2741,#FF7A00)',
                fontWeight: 600,
                fontSize: 15,
              }}
            >
              {busy ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : tab === 0 ? '登录' : '注册'}
            </Button>
          </Stack>
        </form>
      </Box>
    </Box>
  )
}
