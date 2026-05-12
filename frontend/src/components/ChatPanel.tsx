import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
  CircularProgress,
  Chip,
} from '@mui/material'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import StopCircleIcon from '@mui/icons-material/StopCircle'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import CloseIcon from '@mui/icons-material/Close'
import ReplayIcon from '@mui/icons-material/Replay'
import { uploadImage, type Article } from '../api/client'
import MessageBubble from './MessageBubble'
import {
  abortSession,
  getSession,
  sendMessage,
  sessionKeyFor,
  setInput as storeSetInput,
  setPendingImages as storeSetPendingImages,
  subscribe,
} from '../chatStore'

export type HeroAction = { icon: string; title: string; prompt: string }

export default function ChatPanel({
  article,
  onArticleMayChange,
  onConversationCreated,
  onArticleCreated,
  quickActions,
  heroActions,
  heroTitle,
  heroSubtitle,
  placeholder,
  height,
  showHeader = true,
  sessionKey: sessionKeyProp,
}: {
  article?: Article | null
  onArticleMayChange?: () => void
  onConversationCreated?: (id: number) => void
  onArticleCreated?: (id: number) => void
  quickActions?: Array<{ label: string; prompt: string }>
  heroActions?: HeroAction[]
  heroTitle?: string
  heroSubtitle?: string
  placeholder?: string
  height?: string | number
  showHeader?: boolean
  sessionKey?: string
}) {
  const sessionKey = sessionKeyProp || sessionKeyFor(article?.id)

  // subscribe to the module-level store so messages/status survive unmount
  const session = useSyncExternalStore(
    cb => subscribe(sessionKey, cb),
    () => getSession(sessionKey),
    () => getSession(sessionKey),
  )
  const { messages, input, pendingImages, streaming, status } = session

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' })
  }, [messages, streaming, status])

  async function handleSend(text?: string) {
    await sendMessage(sessionKey, text ?? input, {
      article,
      onArticleMayChange,
      onConversationCreated,
      onArticleCreated,
    })
  }

  async function handleUpload(file: File) {
    const url = await uploadImage(file)
    storeSetPendingImages(sessionKey, [...pendingImages, url])
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: height || '100%',
        bgcolor: 'background.paper',
      }}
    >
      {showHeader && (
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ px: 2, py: 1.2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Box
            sx={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: 'linear-gradient(135deg,#ef4444,#f97316)',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            红
          </Box>
          <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
            {article ? `为笔记 #${article.id} 继续打磨` : 'AI 创作助手'}
          </Typography>
          <Box sx={{ flex: 1 }} />
          {article && (
            <Chip
              size="small"
              label={article.title?.slice(0, 14) || '（无标题）'}
              sx={{ bgcolor: 'action.hover', fontSize: 11, height: 20, maxWidth: 160 }}
            />
          )}
          {streaming && (
            <Chip
              size="small"
              label="AI 工作中"
              sx={{
                bgcolor: '#FFF1B8',
                color: '#92400e',
                fontSize: 11,
                height: 20,
                fontWeight: 600,
              }}
            />
          )}
        </Stack>
      )}

      <Box
        ref={scrollRef}
        sx={{
          flex: 1,
          overflow: 'auto',
          px: { xs: 2, md: 3 },
          py: messages.length === 0 ? 0 : 3,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: messages.length === 0 ? 'center' : 'flex-start',
        }}
      >
        {messages.length === 0 && (
          <Box sx={{ maxWidth: 720, width: '100%', mx: 'auto', py: 4 }}>
            {article ? (
              <>
                <Typography
                  sx={{
                    fontSize: { xs: 26, md: 30 },
                    fontWeight: 600,
                    letterSpacing: -0.5,
                    color: 'text.primary',
                    textAlign: 'center',
                  }}
                >
                  {heroTitle || `为笔记 #${article.id} 继续打磨`}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 14,
                    color: 'text.secondary',
                    mt: 1,
                    textAlign: 'center',
                  }}
                >
                  {heroSubtitle || '试试说：换个钩子、润色第 3 段、重新生成封面'}
                </Typography>
              </>
            ) : (
              <>
                <Typography
                  sx={{
                    fontSize: { xs: 28, md: 32 },
                    fontWeight: 600,
                    letterSpacing: -0.5,
                    color: 'text.primary',
                    textAlign: 'center',
                  }}
                >
                  {heroTitle || '今天想写什么笔记？'}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 14,
                    color: 'text.secondary',
                    mt: 1,
                    textAlign: 'center',
                  }}
                >
                  {heroSubtitle || '说出你的灵感,我会帮你创作、改写、打分、诊断和配图。'}
                </Typography>
              </>
            )}

            {heroActions && heroActions.length > 0 && (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                  gap: 1.2,
                  mt: 3,
                }}
              >
                {heroActions.map(a => (
                  <Box
                    key={a.title}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSend(a.prompt)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleSend(a.prompt)
                      }
                    }}
                    sx={{
                      textAlign: 'left',
                      p: 1.6,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 2.5,
                      bgcolor: 'background.paper',
                      cursor: 'pointer',
                      transition: 'all .15s',
                      '&:hover': {
                        borderColor: 'text.primary',
                        bgcolor: 'background.default',
                        transform: 'translateY(-1px)',
                      },
                      '&:focus-visible': {
                        outline: 'none',
                        borderColor: 'text.primary',
                        boxShadow: '0 0 0 3px rgba(31,31,31,0.08)',
                      },
                    }}
                  >
                    <Typography sx={{ fontSize: 18, lineHeight: 1 }}>{a.icon}</Typography>
                    <Typography
                      sx={{ fontSize: 13.5, fontWeight: 600, mt: 0.6, color: 'text.primary' }}
                    >
                      {a.title}
                    </Typography>
                    <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.3 }}>
                      {a.prompt}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}

            {quickActions && quickActions.length > 0 && (
              <Stack
                direction="row"
                sx={{
                  flexWrap: 'wrap',
                  gap: 0.8,
                  mt: heroActions && heroActions.length > 0 ? 2 : 3,
                  justifyContent: 'center',
                }}
              >
                {quickActions.map(q => (
                  <Chip
                    key={q.label}
                    label={q.label}
                    size="small"
                    clickable
                    onClick={() => handleSend(q.prompt)}
                    sx={{
                      bgcolor: 'background.paper',
                      border: '1px solid',
                      borderColor: 'divider',
                      fontSize: 12,
                      height: 28,
                      '&:hover': { bgcolor: 'background.default', borderColor: 'text.secondary' },
                    }}
                  />
                ))}
              </Stack>
            )}
          </Box>
        )}

        {messages.length > 0 && (
          <Box sx={{ maxWidth: 760, width: '100%', mx: 'auto' }}>
            {messages.map((m, i) => (
              <MessageBubble key={i} msg={m} />
            ))}

            {streaming && status && (
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ color: 'text.secondary', mt: 0.5 }}
              >
                <CircularProgress size={12} sx={{ color: 'text.primary' }} />
                <Typography sx={{ fontSize: 12 }}>{status}</Typography>
              </Stack>
            )}

            {!streaming && messages.length >= 2 && messages[messages.length - 1].role === 'assistant' && messages[messages.length - 1].content?.includes('⚠️') && (
              <Button
                size="small"
                startIcon={<ReplayIcon sx={{ fontSize: 14 }} />}
                onClick={() => {
                  const lastUser = [...messages].reverse().find(m => m.role === 'user')
                  if (lastUser) handleSend(lastUser.content || '')
                }}
                sx={{ mt: 1, fontSize: 12, color: 'text.secondary', textTransform: 'none' }}
              >
                重试
              </Button>
            )}
          </Box>
        )}
      </Box>

      <Box sx={{ px: { xs: 2, md: 3 }, pb: 2.5, pt: 1.2 }}>
        <Box sx={{ maxWidth: 760, mx: 'auto' }}>
          {pendingImages.length > 0 && (
            <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', gap: 1 }}>
              {pendingImages.map((u, i) => (
                <Box key={i} sx={{ position: 'relative' }}>
                  <Box
                    component="img"
                    src={u}
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: 1.2,
                      objectFit: 'cover',
                      border: '1px solid',
                      borderColor: 'divider',
                    }}
                  />
                  <IconButton
                    size="small"
                    onClick={() => storeSetPendingImages(sessionKey, pendingImages.filter((_, idx) => idx !== i))}
                    sx={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      width: 18,
                      height: 18,
                      bgcolor: 'text.primary',
                      color: 'background.paper',
                      '&:hover': { bgcolor: 'error.main' },
                    }}
                  >
                    <CloseIcon sx={{ fontSize: 12 }} />
                  </IconButton>
                </Box>
              ))}
            </Stack>
          )}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 0.4,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 28,
              px: 1.2,
              py: 0.8,
              bgcolor: 'background.paper',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
              transition: 'border-color .15s, box-shadow .15s',
              '&:focus-within': {
                borderColor: 'text.primary',
                boxShadow: '0 2px 8px rgba(31,31,31,0.06)',
              },
            }}
          >
            <Tooltip title="上传参考图">
              <IconButton
                component="label"
                size="small"
                sx={{ color: 'text.secondary', alignSelf: 'center' }}
              >
                <ImageOutlinedIcon sx={{ fontSize: 20 }} />
                <input
                  type="file"
                  hidden
                  accept="image/*"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) handleUpload(f)
                    e.target.value = ''
                  }}
                />
              </IconButton>
            </Tooltip>
            <TextField
              multiline
              minRows={1}
              maxRows={8}
              fullWidth
              placeholder={placeholder || (article ? '继续对这篇笔记说…' : '发消息给小红书助手…')}
              value={input}
              onChange={e => storeSetInput(sessionKey, e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              variant="standard"
              InputProps={{
                disableUnderline: true,
                sx: { fontSize: 15, py: 0.6, lineHeight: 1.5 },
              }}
            />
            {streaming ? (
              <IconButton
                size="small"
                onClick={() => abortSession(sessionKey)}
                sx={{
                  bgcolor: 'text.primary',
                  color: '#fff',
                  width: 34,
                  height: 34,
                  alignSelf: 'center',
                  '&:hover': { bgcolor: '#000' },
                }}
              >
                <StopCircleIcon sx={{ fontSize: 18 }} />
              </IconButton>
            ) : (
              <IconButton
                size="small"
                onClick={() => handleSend()}
                disabled={!input.trim() && pendingImages.length === 0}
                sx={{
                  bgcolor: 'text.primary',
                  color: 'background.paper',
                  width: 34,
                  height: 34,
                  alignSelf: 'center',
                  '&:hover': { bgcolor: '#000' },
                  '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'text.disabled' },
                }}
              >
                <SendRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            )}
          </Box>
          <Typography
            sx={{
              mt: 1,
              fontSize: 11,
              color: 'text.disabled',
              textAlign: 'center',
            }}
          >
            AI 可能会出错,重要内容请自行核实。Enter 发送 · Shift+Enter 换行
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}
