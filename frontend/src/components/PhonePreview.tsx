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
}: {
  title: string
  body: string
  tags: string[]
  coverImage?: string
  images?: string[]
}) {
  const allImages = [coverImage, ...(images || [])].filter(Boolean) as string[]
  const [slideIdx, setSlideIdx] = useState(0)
  const safeIdx = allImages.length > 0 ? slideIdx % allImages.length : 0

  return (
    <Box
      sx={{
        width: 340,
        height: 660,
        border: '2px solid #E5E5E5',
        borderRadius: '38px',
        overflow: 'hidden',
        bgcolor: '#fff',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
        mx: 'auto',
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
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#1F1F1F' }}>9:41</Typography>
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          <Box sx={{ width: 16, height: 10, border: '1px solid #1F1F1F', borderRadius: 0.5, position: 'relative' }}>
            <Box sx={{ position: 'absolute', inset: '1.5px', bgcolor: '#1F1F1F', borderRadius: 0.3 }} />
          </Box>
        </Box>
      </Box>

      {/* Scrollable content */}
      <Box sx={{ flex: 1, overflow: 'auto', '&::-webkit-scrollbar': { display: 'none' } }}>
        {/* Image carousel */}
        <Box sx={{ position: 'relative', width: '100%', aspectRatio: '3 / 4', bgcolor: '#F5F5F5' }}>
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
                      bgcolor: 'rgba(0,0,0,0.35)', color: '#fff', width: 28, height: 28,
                      '&:hover': { bgcolor: 'rgba(0,0,0,0.55)' },
                    }}
                  >
                    <ChevronLeftIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => setSlideIdx(i => (i + 1) % allImages.length)}
                    sx={{
                      position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                      bgcolor: 'rgba(0,0,0,0.35)', color: '#fff', width: 28, height: 28,
                      '&:hover': { bgcolor: 'rgba(0,0,0,0.55)' },
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
                          borderRadius: 3,
                          bgcolor: i === safeIdx ? '#fff' : 'rgba(255,255,255,0.5)',
                          transition: 'all .2s',
                        }}
                      />
                    ))}
                  </Stack>
                  {/* Counter */}
                  <Box
                    sx={{
                      position: 'absolute', top: 10, right: 10,
                      bgcolor: 'rgba(0,0,0,0.45)', color: '#fff',
                      fontSize: 11, px: 0.8, py: 0.2, borderRadius: 1,
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
                color: '#BFBFBF',
                fontSize: 13,
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
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #FF6B6B, #FF2741)',
                display: 'grid',
                placeItems: 'center',
                color: '#fff',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              我
            </Box>
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: '#333', lineHeight: 1.2 }}>
                小红书创作者
              </Typography>
              <Typography sx={{ fontSize: 10, color: '#999' }}>刚刚</Typography>
            </Box>
          </Stack>

          {/* Title */}
          <Typography
            sx={{
              fontSize: 16,
              fontWeight: 700,
              color: '#333',
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
              color: '#333',
              lineHeight: 1.8,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              mb: 1.5,
            }}
          >
            {body || '（正文为空）'}
          </Typography>

          {/* Tags */}
          {tags.length > 0 && (
            <Typography sx={{ fontSize: 13, color: '#FF2741', lineHeight: 1.8, mb: 1 }}>
              {tags.map(t => (t.startsWith('#') ? t : `#${t}`)).join(' ')}
            </Typography>
          )}
        </Box>
      </Box>

      {/* Bottom interaction bar */}
      <Box
        sx={{
          height: 50,
          borderTop: '1px solid #F0F0F0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
          px: 2,
          flexShrink: 0,
        }}
      >
        <Stack direction="row" spacing={0.3} alignItems="center">
          <FavoriteBorderIcon sx={{ fontSize: 20, color: '#666' }} />
          <Typography sx={{ fontSize: 11, color: '#666' }}>128</Typography>
        </Stack>
        <Stack direction="row" spacing={0.3} alignItems="center">
          <StarBorderIcon sx={{ fontSize: 20, color: '#666' }} />
          <Typography sx={{ fontSize: 11, color: '#666' }}>56</Typography>
        </Stack>
        <Stack direction="row" spacing={0.3} alignItems="center">
          <ChatBubbleOutlineIcon sx={{ fontSize: 18, color: '#666' }} />
          <Typography sx={{ fontSize: 11, color: '#666' }}>23</Typography>
        </Stack>
        <ShareOutlinedIcon sx={{ fontSize: 20, color: '#666' }} />
      </Box>
    </Box>
  )
}
