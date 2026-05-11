import { createTheme } from '@mui/material/styles'

// Palette & feel: Xiaohongshu 创作中心
//  - background  #FAF7F2 (奶油米)
//  - card        #FFFFFF with 1px #EEE9E1
//  - primary     #FF2741 (红 · 饱和度拉满但克制使用)
//  - text        #1F1F1F (浓黑) / #8A8A8F (次信息)
//  - rounded     14-20px
//  - shadows     柔和灰，不要 ripple、elevation
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#FF2741',
      light: '#FF5B73',
      dark: '#D61030',
      contrastText: '#fff',
    },
    secondary: { main: '#FF7A00' },
    background: { default: '#FAF7F2', paper: '#FFFFFF' },
    text: { primary: '#1F1F1F', secondary: '#8A8A8F' },
    divider: '#EEE9E1',
    error: { main: '#E53935' },
    success: { main: '#16A34A' },
    warning: { main: '#F59E0B' },
  },
  typography: {
    fontFamily:
      '"PingFang SC","HarmonyOS Sans SC","Noto Sans SC","Microsoft YaHei","Inter","Helvetica Neue",system-ui,-apple-system,sans-serif',
    h1: { fontWeight: 800, letterSpacing: -1 },
    h2: { fontWeight: 800, letterSpacing: -0.8 },
    h3: { fontWeight: 800, letterSpacing: -0.4 },
    h4: { fontWeight: 800, letterSpacing: -0.3 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
    button: { textTransform: 'none', fontWeight: 600 },
    body1: { fontSize: 15, lineHeight: 1.75 },
    body2: { fontSize: 13.5, lineHeight: 1.7 },
  },
  shape: { borderRadius: 14 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: '#FAF7F2' },
        '*::-webkit-scrollbar': { width: 8, height: 8 },
        '*::-webkit-scrollbar-thumb': { backgroundColor: '#E6E0D4', borderRadius: 999 },
        '*::-webkit-scrollbar-thumb:hover': { backgroundColor: '#C9C2B2' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          boxShadow: 'none',
          border: '1px solid #EEE9E1',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: '#FFFFFF',
          color: '#1F1F1F',
          borderBottom: '1px solid #EEE9E1',
          boxShadow: 'none',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          paddingInline: 16,
          paddingBlock: 8,
          fontWeight: 600,
        },
        contained: {
          boxShadow: 'none',
          '&:hover': { boxShadow: 'none' },
        },
        outlined: {
          borderColor: '#E6E0D4',
          color: '#1F1F1F',
          '&:hover': { borderColor: '#1F1F1F', backgroundColor: '#F5EFE5' },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          fontWeight: 500,
          backgroundColor: '#F4EFE5',
          color: '#1F1F1F',
          border: '1px solid transparent',
        },
        outlined: { borderColor: '#E6E0D4', backgroundColor: '#fff' },
      },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          backgroundColor: '#fff',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: '#E6E0D4' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#1F1F1F' },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          '&:hover': { backgroundColor: '#F5EFE5' },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#1F1F1F',
          fontSize: 12,
          borderRadius: 8,
        },
      },
    },
  },
})
