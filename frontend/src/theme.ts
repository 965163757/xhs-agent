import { createTheme, type Theme } from '@mui/material/styles'

const serif = '"Source Serif 4","Noto Serif SC","Songti SC",Georgia,serif'
const sans = '"Inter","PingFang SC","HarmonyOS Sans SC","Noto Sans SC",system-ui,-apple-system,sans-serif'
const mono = '"JetBrains Mono","SF Mono",Menlo,Consolas,monospace'

const editorialMotion = '180ms cubic-bezier(0.16,1,0.3,1)'

const shared = {
  typography: {
    fontFamily: sans,
    h1: { fontFamily: serif, fontWeight: 800, letterSpacing: -1.4, lineHeight: 0.98 },
    h2: { fontFamily: serif, fontWeight: 700, letterSpacing: -0.8, lineHeight: 1.08 },
    h3: { fontFamily: serif, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.14 },
    h4: { fontFamily: serif, fontWeight: 700, letterSpacing: -0.3, lineHeight: 1.2 },
    h5: { fontFamily: serif, fontWeight: 650, lineHeight: 1.25 },
    h6: { fontFamily: serif, fontWeight: 650, lineHeight: 1.3 },
    subtitle1: { fontFamily: serif, fontStyle: 'italic' as const },
    button: { textTransform: 'none' as const, fontWeight: 600, letterSpacing: 0 },
    body1: { fontSize: 14, lineHeight: 1.72 },
    body2: { fontSize: 12.8, lineHeight: 1.62 },
    caption: { fontFamily: mono, fontSize: 10.5, letterSpacing: 0.8 },
  },
  shape: { borderRadius: 4 },
}

function components(tokens: {
  paper: string
  paperSoft: string
  ink: string
  inkSoft: string
  inkMute: string
  rule: string
  ruleSoft: string
  accent: string
  accentSoft: string
  appChrome: string
}) {
  const {
    paper,
    paperSoft,
    ink,
    inkSoft,
    inkMute,
    rule,
    ruleSoft,
    accent,
    accentSoft,
    appChrome,
  } = tokens

  return {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: paper,
          color: ink,
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          textRendering: 'optimizeLegibility',
        },
        '*': { boxSizing: 'border-box' },
        '*::-webkit-scrollbar': { width: 7, height: 7 },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
        '*::-webkit-scrollbar-thumb': { backgroundColor: rule, borderRadius: 999 },
        '*::-webkit-scrollbar-thumb:hover': { backgroundColor: inkMute },
        '::selection': { background: accentSoft, color: ink },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: paper,
          boxShadow: 'none',
          border: `1px solid ${rule}`,
          borderRadius: 0,
          transition: `border-color ${editorialMotion}, transform ${editorialMotion}, background-color ${editorialMotion}`,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: paper,
          boxShadow: 'none',
          border: `1px solid ${rule}`,
          borderRadius: 0,
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: 16,
          '&:last-child': { paddingBottom: 16 },
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: appChrome,
          color: ink,
          borderBottom: `1px solid ${rule}`,
          boxShadow: 'none',
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
        },
      },
    },
    MuiToolbar: {
      styleOverrides: {
        root: {
          minHeight: '56px !important',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          paddingInline: 14,
          paddingBlock: 7,
          minHeight: 32,
          fontSize: 12.5,
          boxShadow: 'none',
          transition: `transform ${editorialMotion}, background-color ${editorialMotion}, border-color ${editorialMotion}, color ${editorialMotion}`,
          '&:hover': { transform: 'translateY(-1px)', boxShadow: 'none' },
          '&:active': { transform: 'translateY(0)' },
        },
        contained: {
          backgroundColor: ink,
          color: paper,
          boxShadow: 'none',
          '&:hover': { backgroundColor: accent, boxShadow: 'none' },
        },
        outlined: {
          borderColor: rule,
          color: inkSoft,
          '&:hover': { borderColor: ink, backgroundColor: paperSoft },
        },
        text: {
          color: inkSoft,
          '&:hover': { color: ink, backgroundColor: paperSoft },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          height: 24,
          fontFamily: mono,
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: 0,
          backgroundColor: paperSoft,
          color: inkSoft,
          border: `1px solid ${rule}`,
          maxWidth: '100%',
          '& .MuiChip-label': {
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          },
        },
        colorPrimary: {
          backgroundColor: accentSoft,
          color: accent,
          borderColor: accent,
        },
        outlined: {
          backgroundColor: paper,
          borderColor: rule,
        },
      },
    },
    MuiTextField: { defaultProps: { size: 'small' as const } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          backgroundColor: paper,
          fontSize: 13,
          transition: `box-shadow ${editorialMotion}, border-color ${editorialMotion}`,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: rule },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: inkMute },
          '&.Mui-focused': { boxShadow: `0 0 0 3px ${accentSoft}` },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: accent, borderWidth: 1 },
        },
        input: {
          paddingTop: 9,
          paddingBottom: 9,
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          color: inkMute,
          fontSize: 12,
          '&.Mui-focused': { color: accent },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          color: inkSoft,
          transition: `transform ${editorialMotion}, background-color ${editorialMotion}, color ${editorialMotion}`,
          '&:hover': { backgroundColor: paperSoft, color: ink, transform: 'translateY(-1px)' },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: ink,
          color: paper,
          fontSize: 11,
          borderRadius: 0,
          padding: '6px 9px',
          fontFamily: mono,
          letterSpacing: 0.4,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          boxShadow: 'none',
          border: `1px solid ${ink}`,
          borderRadius: 0,
          backgroundColor: paper,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: paper,
          boxShadow: 'none',
          borderRight: `1px solid ${rule}`,
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          margin: '1px 0',
          borderLeft: '2px solid transparent',
          transition: `background-color ${editorialMotion}, border-color ${editorialMotion}, color ${editorialMotion}`,
          '&:hover': { backgroundColor: paperSoft },
          '&.Mui-selected': {
            backgroundColor: paperSoft,
            borderLeftColor: accent,
            color: ink,
            '&:hover': { backgroundColor: paperSoft },
          },
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 36,
          fontWeight: 600,
          fontSize: 12,
          fontFamily: mono,
          letterSpacing: 0.8,
          textTransform: 'uppercase' as const,
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: {
          backgroundColor: accent,
          height: 2,
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 0, height: 3, backgroundColor: ruleSoft },
        bar: { borderRadius: 0, backgroundColor: accent },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        switchBase: {
          '&.Mui-checked': { color: accent },
          '&.Mui-checked + .MuiSwitch-track': { backgroundColor: accent },
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: { borderColor: rule },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          border: `1px solid ${rule}`,
          boxShadow: 'none',
        },
      },
    },
  }
}

export const lightTheme: Theme = createTheme({
  ...shared,
  palette: {
    mode: 'light',
    primary: { main: '#C8302E', light: '#D95755', dark: '#8B2520', contrastText: '#F4F1EA' },
    secondary: { main: '#1A1814', light: '#5C564C', dark: '#0E0D0A', contrastText: '#F4F1EA' },
    background: { default: '#F4F1EA', paper: '#F4F1EA' },
    text: { primary: '#1A1814', secondary: '#5C564C', disabled: '#8C8578' },
    divider: '#D4CCBC',
    error: { main: '#8B2520' },
    success: { main: '#3E6B4E' },
    warning: { main: '#A87029' },
  },
  components: components({
    paper: '#F4F1EA',
    paperSoft: '#EDE8DD',
    ink: '#1A1814',
    inkSoft: '#5C564C',
    inkMute: '#8C8578',
    rule: '#D4CCBC',
    ruleSoft: '#E5DECF',
    accent: '#C8302E',
    accentSoft: '#F5DEDC',
    appChrome: '#EDE8DD',
  }),
})

export const darkTheme: Theme = createTheme({
  ...shared,
  palette: {
    mode: 'dark',
    primary: { main: '#E15D59', light: '#F0908C', dark: '#9E302B', contrastText: '#17130F' },
    secondary: { main: '#EDE8DD', light: '#F4F1EA', dark: '#A79F90', contrastText: '#17130F' },
    background: { default: '#17130F', paper: '#201B16' },
    text: { primary: '#F4F1EA', secondary: '#C2B9AA', disabled: '#8E8376' },
    divider: '#4A4035',
    error: { main: '#E15D59' },
    success: { main: '#7FA887' },
    warning: { main: '#D3A257' },
  },
  components: components({
    paper: '#201B16',
    paperSoft: '#2A241E',
    ink: '#F4F1EA',
    inkSoft: '#C2B9AA',
    inkMute: '#8E8376',
    rule: '#4A4035',
    ruleSoft: '#373028',
    accent: '#E15D59',
    accentSoft: 'rgba(225,93,89,0.16)',
    appChrome: '#201B16',
  }),
})

export const theme = lightTheme
