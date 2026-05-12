import { useState } from 'react'
import { Box, Button, Dialog, IconButton, Stack, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'

const STORAGE_KEY = 'xhs_onboarding_done'

const STEPS = [
  {
    title: '智能创作对话',
    desc: '在「创作」页直接告诉 AI 你想写什么，它会帮你生成标题、正文、标签和封面图。支持多轮对话持续优化。',
    icon: '💬',
  },
  {
    title: '笔记管理 & 编辑',
    desc: '所有生成的笔记都在「笔记」页。点击进入可编辑内容、管理图片、查看版本历史，还能一键诊断质量。',
    icon: '📝',
  },
  {
    title: '多维度智能诊断',
    desc: '4 个 AI 专家从内容质量、视觉表现、增长潜力、用户体验维度打分，给出优化建议和模拟评论。',
    icon: '🔍',
  },
  {
    title: '违禁词实时检测',
    desc: '编辑笔记时自动检测小红书违禁词（广告法、医疗、金融等），并提供安全替代用语。',
    icon: '🛡️',
  },
  {
    title: '热门标签推荐',
    desc: '输入标签时自动推荐热门标签，显示热度等级（S/A/B/C），帮你获得更多流量曝光。',
    icon: '🏷️',
  },
]

export default function OnboardingDialog() {
  const [open, setOpen] = useState(() => !localStorage.getItem(STORAGE_KEY))
  const [step, setStep] = useState(0)

  function handleClose() {
    localStorage.setItem(STORAGE_KEY, '1')
    setOpen(false)
  }

  if (!open) return null

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 4,
          overflow: 'hidden',
          bgcolor: 'background.paper',
        },
      }}
    >
      <IconButton
        onClick={handleClose}
        sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}
        size="small"
      >
        <CloseIcon fontSize="small" />
      </IconButton>

      <Box sx={{ px: 4, pt: 5, pb: 3, textAlign: 'center' }}>
        <Box sx={{ fontSize: 48, mb: 2 }}>{current.icon}</Box>
        <Typography sx={{ fontSize: 20, fontWeight: 700, mb: 1.5 }}>
          {current.title}
        </Typography>
        <Typography sx={{ fontSize: 14, color: 'text.secondary', lineHeight: 1.7, minHeight: 60 }}>
          {current.desc}
        </Typography>
      </Box>

      <Stack direction="row" justifyContent="center" spacing={0.8} sx={{ mb: 2 }}>
        {STEPS.map((_, i) => (
          <Box
            key={i}
            sx={{
              width: i === step ? 20 : 8,
              height: 8,
              borderRadius: 4,
              bgcolor: i === step ? '#FF2741' : '#E0E0E0',
              transition: 'all .2s',
            }}
          />
        ))}
      </Stack>

      <Stack direction="row" spacing={1.5} sx={{ px: 4, pb: 4 }} justifyContent="center">
        {step > 0 && (
          <Button
            variant="outlined"
            onClick={() => setStep(s => s - 1)}
            sx={{ borderRadius: 99, px: 3, textTransform: 'none' }}
          >
            上一步
          </Button>
        )}
        {isLast ? (
          <Button
            variant="contained"
            onClick={handleClose}
            sx={{
              borderRadius: 99,
              px: 4,
              textTransform: 'none',
              background: 'linear-gradient(135deg,#FF2741,#FF7A00)',
              fontWeight: 600,
            }}
          >
            开始创作
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={() => setStep(s => s + 1)}
            sx={{
              borderRadius: 99,
              px: 4,
              textTransform: 'none',
              background: 'linear-gradient(135deg,#FF2741,#FF7A00)',
              fontWeight: 600,
            }}
          >
            下一步
          </Button>
        )}
      </Stack>
    </Dialog>
  )
}
