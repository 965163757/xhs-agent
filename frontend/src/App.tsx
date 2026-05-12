import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { AppBar, Box, CircularProgress, IconButton, Stack, Toolbar, Tooltip, Typography } from '@mui/material'
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined'
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined'
import LogoutIcon from '@mui/icons-material/Logout'
import { Toaster } from 'sonner'
import { useThemeMode } from './ThemeContext'
import { useAuth } from './AuthContext'
import ChatPage from './pages/ChatPage'
import ArticlesPage from './pages/ArticlesPage'
import ArticleDetailPage from './pages/ArticleDetailPage'
import SettingsPage from './pages/SettingsPage'
import TemplatesPage from './pages/TemplatesPage'
import DiagnosePage from './pages/DiagnosePage'
import AnalyticsPage from './pages/AnalyticsPage'
import LoginPage from './pages/LoginPage'
import CommandPalette from './components/CommandPalette'
import OnboardingDialog from './components/OnboardingDialog'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <Box sx={{ display: 'grid', placeItems: 'center', height: '100vh' }}><CircularProgress /></Box>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function TopTab({ to, label }: { to: string; label: string }) {
  return (
    <NavLink to={to} end style={{ textDecoration: 'none' }}>
      {({ isActive }) => (
        <Box
          sx={{
            position: 'relative',
            px: 1.6,
            py: 1.8,
            fontSize: 15,
            fontWeight: 600,
            color: isActive ? 'text.primary' : 'text.secondary',
            cursor: 'pointer',
            transition: 'color .15s',
            '&:hover': { color: 'text.primary' },
            '&::after': {
              content: '""',
              position: 'absolute',
              left: '50%',
              bottom: 10,
              width: isActive ? 24 : 0,
              height: 3,
              borderRadius: 2,
              background: '#FF2741',
              transform: 'translateX(-50%)',
              transition: 'width .2s',
            },
          }}
        >
          {label}
        </Box>
      )}
    </NavLink>
  )
}

export default function App() {
  const nav = useNavigate()
  const { mode, toggle } = useThemeMode()
  const { user, logout } = useAuth()
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <Toaster position="top-center" richColors closeButton theme={mode} />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={
          <ProtectedRoute>
            <>
              <AppBar position="sticky" elevation={0}>
                <Toolbar sx={{ minHeight: 60, gap: 2, px: { xs: 2, md: 3 } }}>
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1.2}
                    sx={{ cursor: 'pointer', mr: 1 }}
                    onClick={() => nav('/')}
                  >
                    <Box
                      sx={{
                        width: 30,
                        height: 30,
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg,#FF2741 0%,#FF7A00 100%)',
                        display: 'grid',
                        placeItems: 'center',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: 14,
                        boxShadow: '0 2px 8px rgba(255,39,65,0.25)',
                      }}
                    >
                      红
                    </Box>
                    <Stack spacing={-0.2}>
                      <Typography sx={{ fontSize: 15, fontWeight: 800, letterSpacing: -0.2, lineHeight: 1.1 }}>
                        小红书创作助手
                      </Typography>
                      <Typography sx={{ fontSize: 10.5, color: 'text.secondary', letterSpacing: 0.4 }}>
                        CREATOR · AGENT · MCP
                      </Typography>
                    </Stack>
                  </Stack>

                  <Stack direction="row" spacing={0.5} sx={{ ml: 2 }}>
                    <TopTab to="/" label="创作" />
                    <TopTab to="/articles" label="笔记" />
                    <TopTab to="/templates" label="模板" />
                    <TopTab to="/analytics" label="数据" />
                    <TopTab to="/settings" label="设置" />
                  </Stack>

                  <Box sx={{ flex: 1 }} />

                  <Tooltip title={mode === 'light' ? '切换暗色模式' : '切换亮色模式'}>
                    <IconButton size="small" onClick={toggle} sx={{ mr: 1 }}>
                      {mode === 'light' ? <DarkModeOutlinedIcon sx={{ fontSize: 20 }} /> : <LightModeOutlinedIcon sx={{ fontSize: 20 }} />}
                    </IconButton>
                  </Tooltip>

                  {user && (
                    <Stack direction="row" alignItems="center" spacing={0.8}>
                      <Box
                        sx={{
                          display: { xs: 'none', sm: 'flex' },
                          alignItems: 'center',
                          gap: 1,
                          px: 1.2,
                          py: 0.6,
                          borderRadius: 999,
                          bgcolor: mode === 'light' ? '#F5EFE5' : '#2A2A2A',
                          fontSize: 12,
                          color: 'text.primary',
                          fontWeight: 600,
                        }}
                      >
                        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#16A34A' }} />
                        {user.username}
                      </Box>
                      <Tooltip title="退出登录">
                        <IconButton size="small" onClick={logout}>
                          <LogoutIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  )}
                </Toolbar>
              </AppBar>

              <Box sx={{ flex: 1, minHeight: 0 }}>
                <Routes>
                  <Route path="/" element={<ChatPage />} />
                  <Route path="/articles" element={<ArticlesPage />} />
                  <Route path="/articles/:id" element={<ArticleDetailPage />} />
                  <Route path="/articles/:id/diagnose" element={<DiagnosePage />} />
                  <Route path="/templates" element={<TemplatesPage />} />
                  <Route path="/analytics" element={<AnalyticsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Routes>
              </Box>
              <CommandPalette />
              <OnboardingDialog />
            </>
          </ProtectedRoute>
        } />
      </Routes>
    </Box>
  )
}
