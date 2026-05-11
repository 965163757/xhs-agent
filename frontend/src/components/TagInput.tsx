import { useState } from 'react'
import { Box, Chip, Stack, TextField, Typography } from '@mui/material'

export default function TagInput({
  tags,
  onChange,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
}) {
  const [input, setInput] = useState('')

  function addTag(raw: string) {
    const tag = raw.trim().replace(/^#/, '')
    if (tag && !tags.includes(tag)) {
      onChange([...tags, tag])
    }
    setInput('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
      e.preventDefault()
      addTag(input)
    }
    if (e.key === 'Backspace' && !input && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: '#8A8A8F', mb: 0.5, fontWeight: 600 }}>
        标签
      </Typography>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0.6,
          alignItems: 'center',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 3,
          px: 1.2,
          py: 0.8,
          minHeight: 42,
          bgcolor: 'background.paper',
          '&:focus-within': { borderColor: 'text.primary' },
          transition: 'border-color .15s',
        }}
      >
        {tags.map((t, i) => (
          <Chip
            key={t}
            label={`#${t}`}
            size="small"
            onDelete={() => onChange(tags.filter((_, idx) => idx !== i))}
            sx={{ fontSize: 12, height: 26 }}
          />
        ))}
        <TextField
          variant="standard"
          placeholder={tags.length === 0 ? '输入标签，回车添加' : ''}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (input.trim()) addTag(input) }}
          InputProps={{ disableUnderline: true, sx: { fontSize: 13, py: 0 } }}
          sx={{ flex: 1, minWidth: 80 }}
        />
      </Box>
    </Box>
  )
}
