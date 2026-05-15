import { useState } from 'react'
import { Box, IconButton, Stack, Typography } from '@mui/material'
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'

export default function PhonePreview({
  title,
  body,
  tags,
  coverImage,
  images,
  scale = 1,
}: {
  title: string
  body: string
  tags: string[]
  coverImage?: string
  images?: string[]
  scale?: number
}) {
  const allImages = [coverImage, ...(images || [])].filter(Boolean) as string[]
  const [slideIdx, setSlideIdx] = useState(0)
  const safeIdx = allImages.length > 0 ? slideIdx % allImages.length : 0
  const normalizedTags = tags.map(t => String(t || '').replace(/^[#＃]+/, '').trim()).filter(Boolean)
  const safeScale = Math.max(0.58, Math.min(1, scale))

  return (
    <Box
      sx={{
        width: 340 * safeScale,
        height: 660 * safeScale,
        flexShrink: 0,
        position: 'relative',
        overflow: 'visible',
        mx: 'auto',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 340,
          height: 660,
          transform: `scale(${safeScale})`,
          transformOrigin: 'top left',
          border: '2px solid var(--ink)',
          borderRadius: '38px',
          overflow: 'hidden',
          bgcolor: '#FDFBF6',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'none',
        }}
      >
        {/* Status bar */}
        <Box
          sx={{
            height: 40,
            px: 3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'var(--ink)', fontFamily: 'var(--mono)' }}>9:41</Typography>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
            <Box sx={{ width: 16, height: 10, border: '1px solid var(--ink)', borderRadius: 0, position: 'relative' }}>
              <Box sx={{ position: 'absolute', inset: '1.5px', bgcolor: 'var(--ink)', borderRadius: 0 }} />
            </Box>
          </Box>
        </Box>

        {/* Scrollable content */}
        <Box sx={{ flex: 1, overflow: 'auto', '&::-webkit-scrollbar': { display: 'none' } }}>
          {/* Image carousel */}
          <Box sx={{ position: 'relative', width: '100%', aspectRatio: '3 / 4', bgcolor: 'var(--paper-soft)', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)' }}>
          {allImages.length > 0 ? (
            <>
              <Box
                component="img"
                src={allImages[safeIdx]}
                sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              {allImages.length > 1 && (
                <>
                  <IconButton
                    size="small"
                    onClick={() => setSlideIdx(i => (i - 1 + allImages.length) % allImages.length)}
                    sx={{
                      position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)',
                      bgcolor: 'rgba(26,24,20,0.72)', color: '#fff', width: 28, height: 28, borderRadius: 0,
                      '&:hover': { bgcolor: 'rgba(26,24,20,0.9)' },
                    }}
                  >
                    <ChevronLeftIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => setSlideIdx(i => (i + 1) % allImages.length)}
                    sx={{
                      position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                      bgcolor: 'rgba(26,24,20,0.72)', color: '#fff', width: 28, height: 28, borderRadius: 0,
                      '&:hover': { bgcolor: 'rgba(26,24,20,0.9)' },
                    }}
                  >
                    <ChevronRightIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                  {/* Dots indicator */}
                  <Stack
                    direction="row"
                    spacing={0.5}
                    sx={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)' }}
                  >
                    {allImages.map((_, i) => (
                      <Box
                        key={i}
                        sx={{
                          width: i === safeIdx ? 16 : 6,
                          height: 6,
                          borderRadius: 0,
                          bgcolor: i === safeIdx ? 'var(--accent)' : 'rgba(244,241,234,0.72)',
                          transition: 'all .2s',
                        }}
                      />
                    ))}
                  </Stack>
                  {/* Counter */}
                  <Box
                    sx={{
                      position: 'absolute', top: 10, right: 10,
                      bgcolor: 'rgba(26,24,20,0.78)', color: '#fff',
                      fontSize: 11, px: 0.8, py: 0.2, borderRadius: 0, fontFamily: 'var(--mono)', fontWeight: 800,
                    }}
                  >
                    {safeIdx + 1}/{allImages.length}
                  </Box>
                </>
              )}
            </>
          ) : (
            <Box
              sx={{
                width: '100%',
                height: '100%',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--ink-mute)',
                fontSize: 13,
                fontFamily: 'var(--serif)',
              }}
            >
              暂无封面
            </Box>
          )}
          </Box>

          {/* Content area */}
          <Box sx={{ px: 2, py: 1.5 }}>
          {/* Author row */}
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: 0,
                background: 'var(--ink)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--paper)',
                fontSize: 12,
                fontWeight: 800,
                fontFamily: 'var(--serif)',
              }}
            >
              我
            </Box>
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2, fontFamily: 'var(--serif)' }}>
                小红书创作者
              </Typography>
              <Typography sx={{ fontSize: 10, color: 'var(--ink-mute)', fontFamily: 'var(--mono)' }}>刚刚</Typography>
            </Box>
          </Stack>

          {/* Title */}
          <Typography
            sx={{
              fontSize: 17,
              fontWeight: 700,
              color: 'var(--ink)',
              fontFamily: 'var(--serif)',
              lineHeight: 1.4,
              mb: 1,
              wordBreak: 'break-word',
            }}
          >
            {title || '（无标题）'}
          </Typography>

          {/* Body */}
          <Typography
            sx={{
              fontSize: 14,
              color: 'var(--ink)',
              lineHeight: 1.8,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              mb: 1.5,
            }}
          >
            {body || '（正文为空）'}
          </Typography>

          {/* Tags */}
          {normalizedTags.length > 0 && (
            <Typography sx={{ fontSize: 13, color: 'var(--accent)', lineHeight: 1.8, mb: 1, fontFamily: 'var(--serif)', fontWeight: 700 }}>
              {normalizedTags.map(t => `#${t}`).join(' ')}
            </Typography>
          )}
          </Box>
        </Box>

        {/* Bottom interaction bar */}
        <Box
          sx={{
            height: 50,
            borderTop: '1px solid var(--rule)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            px: 2,
            flexShrink: 0,
          }}
        >
          <Stack direction="row" spacing={0.3} alignItems="center">
            <FavoriteBorderIcon sx={{ fontSize: 20, color: 'var(--ink-soft)' }} />
            <Typography sx={{ fontSize: 11, color: 'var(--ink-soft)', fontFamily: 'var(--mono)' }}>128</Typography>
          </Stack>
          <Stack direction="row" spacing={0.3} alignItems="center">
            <StarBorderIcon sx={{ fontSize: 20, color: 'var(--ink-soft)' }} />
            <Typography sx={{ fontSize: 11, color: 'var(--ink-soft)', fontFamily: 'var(--mono)' }}>56</Typography>
          </Stack>
          <Stack direction="row" spacing={0.3} alignItems="center">
            <ChatBubbleOutlineIcon sx={{ fontSize: 18, color: 'var(--ink-soft)' }} />
            <Typography sx={{ fontSize: 11, color: 'var(--ink-soft)', fontFamily: 'var(--mono)' }}>23</Typography>
          </Stack>
          <ShareOutlinedIcon sx={{ fontSize: 20, color: 'var(--ink-soft)' }} />
        </Box>
      </Box>
    </Box>
  )
}
