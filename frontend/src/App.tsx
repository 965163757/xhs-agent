import { lazy, Suspense } from 'react'
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
import LoginPage from './pages/LoginPage'
import CommandPalette from './components/CommandPalette'
import OnboardingDialog from './components/OnboardingDialog'

const ArticleDetailPage = lazy(() => import('./pages/ArticleDetailPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const TemplatesPage = lazy(() => import('./pages/TemplatesPage'))
const DiagnosePage = lazy(() => import('./pages/DiagnosePage'))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'))

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <Box sx={{ display: 'grid', placeItems: 'center', height: '100vh' }}><CircularProgress /></Box>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function TopTab({ to, label }: { to: string; label: string }) {
  return (
    <NavLink to={to} end={to === '/'} style={{ textDecoration: 'none' }}>
      {({ isActive }) => (
        <Box
          sx={{
            position: 'relative',
            px: 1.8,
            py: 1.8,
            fontSize: 13.5,
            fontWeight: isActive ? 700 : 500,
            color: isActive ? 'text.primary' : 'text.secondary',
            cursor: 'pointer',
            transition: 'all .2s cubic-bezier(0.4,0,0.2,1)',
            borderRadius: 2,
            '&:hover': { color: 'text.primary', bgcolor: 'rgba(255,36,66,0.04)' },
            '&::after': {
              content: '""',
              position: 'absolute',
              left: '50%',
              bottom: 8,
              width: isActive ? 18 : 0,
              height: 2.5,
              borderRadius: 2,
              background: 'linear-gradient(90deg,#FF2442,#FF7A00)',
              transform: 'translateX(-50%)',
              transition: 'width .3s cubic-bezier(0.4,0,0.2,1)',
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
                <Toolbar sx={{ minHeight: 56, gap: 1.5, px: { xs: 2, md: 3 } }}>
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{ cursor: 'pointer', mr: 1, '&:hover': { opacity: 0.85 }, transition: 'opacity 0.2s' }}
                    onClick={() => nav('/')}
                  >
                    <Box
                      sx={{
                        width: 30,
                        height: 30,
                        borderRadius: '10px',
                        background: 'linear-gradient(135deg,#FF2442 0%,#FF7A00 100%)',
                        display: 'grid',
                        placeItems: 'center',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: 13,
                        boxShadow: '0 2px 8px rgba(255,36,66,0.25)',
                      }}
                    >
                      红
                    </Box>
                    <Typography sx={{ fontSize: 15, fontWeight: 800, letterSpacing: -0.3, display: { xs: 'none', sm: 'block' } }}>
                      小红书创作助手
                    </Typography>
                  </Stack>

                  <Stack direction="row" spacing={0.3} sx={{ ml: 2 }}>
                    <TopTab to="/" label="创作" />
                    <TopTab to="/articles" label="笔记" />
                    <TopTab to="/templates" label="模板" />
                    <TopTab to="/analytics" label="数据" />
                    <TopTab to="/settings" label="设置" />
                  </Stack>

                  <Box sx={{ flex: 1 }} />

                  <Tooltip title={mode === 'light' ? '切换暗色模式' : '切换亮色模式'}>
                    <IconButton size="small" onClick={toggle} sx={{ mr: 0.5 }}>
                      {mode === 'light' ? <DarkModeOutlinedIcon sx={{ fontSize: 18 }} /> : <LightModeOutlinedIcon sx={{ fontSize: 18 }} />}
                    </IconButton>
                  </Tooltip>

                  {user && (
                    <Stack direction="row" alignItems="center" spacing={0.5}>
                      <Box
                        sx={{
                          display: { xs: 'none', sm: 'flex' },
                          alignItems: 'center',
                          gap: 0.8,
                          px: 1.2,
                          py: 0.5,
                          borderRadius: 2,
                          bgcolor: 'rgba(0,0,0,0.03)',
                          border: '1px solid',
                          borderColor: 'divider',
                          fontSize: 12,
                          color: 'text.primary',
                          fontWeight: 500,
                        }}
                      >
                        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#22C55E', boxShadow: '0 0 6px rgba(34,197,94,0.5)' }} />
                        {user.username}
                        {user.role === 'admin' && (
                          <Box
                            component="span"
                            sx={{
                              fontSize: 10,
                              fontWeight: 600,
                              color: '#FF2442',
                              bgcolor: 'rgba(255,36,66,0.08)',
                              px: 0.6,
                              py: 0.1,
                              borderRadius: 1,
                            }}
                          >
                            管理员
                          </Box>
                        )}
                      </Box>
                      <Tooltip title="退出登录">
                        <IconButton size="small" onClick={logout}>
                          <LogoutIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  )}
                </Toolbar>
              </AppBar>

              <Box sx={{ flex: 1, minHeight: 0 }}>
                <Suspense fallback={<Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}><CircularProgress size={24} /></Box>}>
                  <Routes>
                    <Route path="/" element={<ChatPage />} />
                    <Route path="/articles" element={<ArticlesPage />} />
                    <Route path="/articles/:id" element={<ArticleDetailPage />} />
                    <Route path="/articles/:id/diagnose" element={<DiagnosePage />} />
                    <Route path="/templates" element={<TemplatesPage />} />
                    <Route path="/analytics" element={<AnalyticsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Suspense>
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
