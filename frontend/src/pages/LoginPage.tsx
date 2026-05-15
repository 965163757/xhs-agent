import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Box, Button, CircularProgress, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
import { useAuth } from '../AuthContext'
import { toast } from 'sonner'

export default function LoginPage() {
  const { login, register, user } = useAuth()
  const [tab, setTab] = useState(0)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) return
    setBusy(true)
    try {
      if (tab === 0) {
        await login(username, password)
        toast.success('登录成功')
      } else {
        await register(username, password)
        toast.success('注册成功')
      }
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
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          inset: { xs: 20, md: 48 },
          border: '1px solid',
          borderColor: 'divider',
          pointerEvents: 'none',
        }}
      />

      <Box
        sx={{
          width: '100%',
          maxWidth: 380,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          p: { xs: 3.5, sm: 4.5 },
          position: 'relative',
          zIndex: 1,
          boxShadow: 'none',
        }}
      >
        <Stack alignItems="center" spacing={1.5} sx={{ mb: 4 }}>
          <Box
            sx={{
              width: 52,
              height: 52,
              border: '2px solid',
              borderColor: 'text.primary',
              background: 'background.paper',
              display: 'grid',
              placeItems: 'center',
              color: 'primary.main',
              fontWeight: 800,
              fontSize: 20,
              fontFamily: 'var(--mono)',
            }}
          >
            书
          </Box>
          <Stack alignItems="center" spacing={0.3}>
            <Typography sx={{ fontFamily: 'var(--serif)', fontSize: 24, fontWeight: 800, letterSpacing: -0.5 }}>
              小红书创作助手
            </Typography>
            <Typography sx={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 13.5, color: 'text.secondary', letterSpacing: 0 }}>
              AI 驱动的内容创作平台
            </Typography>
          </Stack>
        </Stack>

        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="fullWidth"
          sx={{
            mb: 3,
            minHeight: 36,
            '& .MuiTab-root': { minHeight: 36, py: 0.8 },
            '& .MuiTabs-indicator': {
              height: 2,
              background: 'var(--ink)',
            },
          }}
        >
          <Tab label="登录" />
          <Tab label="注册" />
        </Tabs>

        <form onSubmit={handleSubmit}>
          <Stack spacing={2.5}>
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
              helperText={tab === 1 && password.length > 0 && password.length < 6 ? '密码至少 6 位' : undefined}
              error={tab === 1 && password.length > 0 && password.length < 6}
            />
            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={busy || !username || !password}
              sx={{
                py: 1.3,
                fontWeight: 700,
                fontSize: 14.5,
                '&:hover': {
                  bgcolor: 'primary.main',
                  transform: 'translateY(-1px)',
                },
                '&:active': { transform: 'translateY(0.5px)' },
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
