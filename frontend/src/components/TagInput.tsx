import { useEffect, useRef, useState } from 'react'
import { Box, Chip, Paper, Stack, TextField, Typography } from '@mui/material'
import { HotTag, suggestHotTags } from '../api/client'

const HEAT_COLORS: Record<string, string> = {
  S: '#C8302E',
  A: '#A87029',
  B: '#D3A257',
  C: '#8C8578',
}

export default function TagInput({
  tags,
  onChange,
  category,
  showLabel = true,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  category?: string
  showLabel?: boolean
}) {
  const [input, setInput] = useState('')
  const [suggestions, setSuggestions] = useState<HotTag[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const containerRef = useRef<HTMLDivElement>(null)
  const normalizeTag = (raw: string) => raw.trim().replace(/^[#＃]+/, '').trim()
  const normalizedTags = tags.map(t => normalizeTag(t)).filter(Boolean)
  const tagsRef = useRef(normalizedTags)
  tagsRef.current = normalizedTags

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!input.trim() && !showSuggestions) return
    timerRef.current = setTimeout(async () => {
      try {
        const items = await suggestHotTags(input.replace(/^[#＃]+/, ''), category || '', 12)
        setSuggestions(items.filter(t => !tagsRef.current.includes(normalizeTag(t.tag))))
        setShowSuggestions(true)
        setActiveIdx(-1)
      } catch { /* ignore */ }
    }, 200)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [input, category])

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
    const tag = normalizeTag(raw)
    if (tag && !normalizedTags.includes(tag)) {
      onChange([...normalizedTags, tag])
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
    if (e.key === 'Backspace' && !input && normalizedTags.length > 0) {
      onChange(normalizedTags.slice(0, -1))
    }
  }

  return (
    <Box ref={containerRef} sx={{ position: 'relative', zIndex: showSuggestions ? 30 : 1, overflow: 'visible' }}>
      {showLabel && (
        <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 0.5, fontWeight: 800, fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: 0 }}>
          TAGS
        </Typography>
      )}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          columnGap: 0.65,
          rowGap: 0.65,
          alignItems: 'flex-start',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 0,
          px: 1.2,
          py: 1,
          minHeight: 48,
          bgcolor: 'background.paper',
          '&:focus-within': {
            borderColor: 'primary.main',
            bgcolor: 'var(--accent-soft)',
          },
          transition: 'border-color .15s, background-color .15s',
        }}
      >
        {normalizedTags.map((t, i) => (
          <Chip
            key={t}
            label={`#${t}`}
            size="small"
            onDelete={() => onChange(normalizedTags.filter((_, idx) => idx !== i))}
            sx={{
              fontSize: 12,
              minHeight: 26,
              height: 'auto',
              borderRadius: 0,
              bgcolor: 'var(--paper-soft)',
              border: '1px solid',
              borderColor: 'var(--rule)',
              color: 'text.primary',
              maxWidth: '100%',
              '& .MuiChip-label': {
                px: 0.8,
                py: 0.25,
                lineHeight: 1.35,
                whiteSpace: 'normal',
                overflowWrap: 'anywhere',
              },
              '& .MuiChip-deleteIcon': {
                color: 'text.secondary',
                fontSize: 15,
                mr: 0.4,
                '&:hover': { color: 'primary.main' },
              },
            }}
          />
        ))}
        <TextField
          variant="standard"
          placeholder={normalizedTags.length === 0 ? '输入标签，回车添加' : ''}
          value={input}
          onChange={e => { setInput(e.target.value); setShowSuggestions(true) }}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (suggestions.length || !input) { suggestHotTags(input.replace(/^[#＃]+/, ''), category || '', 12).then(items => { setSuggestions(items.filter(t => !normalizedTags.includes(normalizeTag(t.tag)))); setShowSuggestions(true) }).catch(() => {}) } }}
          onBlur={() => { setTimeout(() => { if (input.trim() && !showSuggestions) addTag(input) }, 150) }}
          InputProps={{ disableUnderline: true, sx: { fontSize: 13, py: 0.2, lineHeight: 1.6 } }}
          sx={{ flex: '1 1 140px', minWidth: 120 }}
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
            mt: 0.75,
            zIndex: theme => theme.zIndex.modal + 10,
            maxHeight: 240,
            overflow: 'auto',
            borderRadius: 0,
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: 'none',
            bgcolor: 'background.paper',
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
                borderBottom: idx === suggestions.length - 1 ? 0 : '1px solid',
                borderColor: 'divider',
                bgcolor: idx === activeIdx ? 'background.default' : 'background.paper',
                '&:hover': { bgcolor: 'background.default' },
              }}
            >
              <Typography sx={{ fontSize: 13, fontFamily: 'var(--serif)', fontWeight: 700 }}>#{normalizeTag(s.tag)}</Typography>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: 0,
                    bgcolor: HEAT_COLORS[s.heat] || '#ccc',
                  }}
                />
                <Typography sx={{ fontSize: 11, color: HEAT_COLORS[s.heat] || '#999', fontFamily: 'var(--mono)', fontWeight: 800 }}>
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
