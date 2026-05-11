import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Box, Stack } from '@mui/material'

const IMAGE_PATH_RE = /(?:^|\s)(\/static\/images\/[^\s)]+\.(?:png|jpg|jpeg|webp|gif))/g

function extractInlineImages(text: string): { cleaned: string; images: string[] } {
  const images: string[] = []
  const cleaned = text.replace(IMAGE_PATH_RE, (match, path) => {
    images.push(path)
    return ''
  })
  return { cleaned: cleaned.trim(), images }
}

export default function Markdown({
  text,
  onImageClick,
}: {
  text: string
  onImageClick?: (url: string) => void
}) {
  const { cleaned, images } = extractInlineImages(text)

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ src, alt }) => (
            <Box
              component="img"
              src={src}
              alt={alt || ''}
              onClick={() => src && onImageClick?.(src)}
              sx={{
                maxWidth: 320,
                maxHeight: 400,
                borderRadius: 2,
                border: '1px solid #EEE9E1',
                objectFit: 'contain',
                cursor: onImageClick ? 'pointer' : 'default',
                display: 'block',
                my: 1,
                '&:hover': { opacity: 0.88 },
              }}
            />
          ),
        }}
      >
        {cleaned}
      </ReactMarkdown>
      {images.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', gap: 1 }}>
          {images.map((src, i) => (
            <Box
              key={i}
              component="img"
              src={src}
              onClick={() => onImageClick?.(src)}
              sx={{
                maxWidth: 280,
                maxHeight: 360,
                borderRadius: 2,
                border: '1px solid #EEE9E1',
                objectFit: 'contain',
                cursor: 'pointer',
                '&:hover': { opacity: 0.88 },
              }}
            />
          ))}
        </Stack>
      )}
    </div>
  )
}
