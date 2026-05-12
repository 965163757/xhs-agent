import { useEffect, useRef, useState } from 'react'
import { Box, Chip, Paper, Stack, TextField, Typography } from '@mui/material'
import { HotTag, suggestHotTags } from '../api/client'

const HEAT_COLORS: Record<string, string> = {
  S: '#FF2442',
  A: '#FF6B35',
  B: '#FFB800',
  C: '#8A8A8F',
}

export default function TagInput({
  tags,
  onChange,
  category,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  category?: string
}) {
  const [input, setInput] = useState('')
  const [suggestions, setSuggestions] = useState<HotTag[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!input.trim() && !showSuggestions) return
    timerRef.current = setTimeout(async () => {
      try {
        const items = await suggestHotTags(input.replace(/^#/, ''), category || '', 12)
        setSuggestions(items.filter(t => !tags.includes(t.tag.replace(/^#/, ''))))
        setShowSuggestions(true)
        setActiveIdx(-1)
      } catch { /* ignore */ }
    }, 200)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [input, category, tags])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function addTag(raw: string) {
    const tag = raw.trim().replace(/^#/, '')
    if (tag && !tags.includes(tag)) {
      onChange([...tags, tag])
    }
    setInput('')
    setShowSuggestions(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' && showSuggestions) {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, suggestions.length - 1))
      return
    }
    if (e.key === 'ArrowUp' && showSuggestions) {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, -1))
      return
    }
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (activeIdx >= 0 && suggestions[activeIdx]) {
        addTag(suggestions[activeIdx].tag)
      } else if (input.trim()) {
        addTag(input)
      }
      return
    }
    if (e.key === 'Escape') {
      setShowSuggestions(false)
      return
    }
    if (e.key === 'Backspace' && !input && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  return (
    <Box ref={containerRef} sx={{ position: 'relative' }}>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5, fontWeight: 600 }}>
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
          onChange={e => { setInput(e.target.value); setShowSuggestions(true) }}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (suggestions.length || !input) { suggestHotTags(input.replace(/^#/, ''), category || '', 12).then(items => { setSuggestions(items.filter(t => !tags.includes(t.tag.replace(/^#/, '')))); setShowSuggestions(true) }).catch(() => {}) } }}
          onBlur={() => { setTimeout(() => { if (input.trim() && !showSuggestions) addTag(input) }, 150) }}
          InputProps={{ disableUnderline: true, sx: { fontSize: 13, py: 0 } }}
          sx={{ flex: 1, minWidth: 80 }}
        />
      </Box>

      {showSuggestions && suggestions.length > 0 && (
        <Paper
          elevation={4}
          sx={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            mt: 0.5,
            zIndex: 1200,
            maxHeight: 240,
            overflow: 'auto',
            borderRadius: 2,
          }}
        >
          {suggestions.map((s, idx) => (
            <Box
              key={s.tag}
              onMouseDown={(e) => { e.preventDefault(); addTag(s.tag) }}
              sx={{
                px: 1.5,
                py: 0.8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                bgcolor: idx === activeIdx ? 'action.hover' : 'transparent',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Typography sx={{ fontSize: 13 }}>{s.tag}</Typography>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: HEAT_COLORS[s.heat] || '#ccc',
                  }}
                />
                <Typography sx={{ fontSize: 11, color: HEAT_COLORS[s.heat] || '#999' }}>
                  {s.heat_label}
                </Typography>
              </Stack>
            </Box>
          ))}
        </Paper>
      )}
    </Box>
  )
}
