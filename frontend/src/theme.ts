import { createTheme, type Theme } from '@mui/material/styles'

const shared = {
  typography: {
    fontFamily:
      '"PingFang SC","HarmonyOS Sans SC","Noto Sans SC","Microsoft YaHei","Inter","Helvetica Neue",system-ui,-apple-system,sans-serif',
    h1: { fontWeight: 800, letterSpacing: -1 },
    h2: { fontWeight: 800, letterSpacing: -0.8 },
    h3: { fontWeight: 800, letterSpacing: -0.4 },
    h4: { fontWeight: 800, letterSpacing: -0.3 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
    button: { textTransform: 'none' as const, fontWeight: 600 },
    body1: { fontSize: 15, lineHeight: 1.75 },
    body2: { fontSize: 13.5, lineHeight: 1.7 },
  },
  shape: { borderRadius: 14 },
}

export const lightTheme: Theme = createTheme({
  ...shared,
  palette: {
    mode: 'light',
    primary: { main: '#FF2741', light: '#FF5B73', dark: '#D61030', contrastText: '#fff' },
    secondary: { main: '#FF7A00' },
    background: { default: '#FAF7F2', paper: '#FFFFFF' },
    text: { primary: '#1F1F1F', secondary: '#8A8A8F' },
    divider: '#EEE9E1',
    error: { main: '#E53935' },
    success: { main: '#16A34A' },
    warning: { main: '#F59E0B' },
  },
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
      styleOverrides: { root: { backgroundImage: 'none', boxShadow: 'none', border: '1px solid #EEE9E1' } },
    },
    MuiAppBar: {
      styleOverrides: { root: { background: '#FFFFFF', color: '#1F1F1F', borderBottom: '1px solid #EEE9E1', boxShadow: 'none' } },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 999, paddingInline: 16, paddingBlock: 8, fontWeight: 600 },
        contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
        outlined: { borderColor: '#E6E0D4', color: '#1F1F1F', '&:hover': { borderColor: '#1F1F1F', backgroundColor: '#F5EFE5' } },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 999, fontWeight: 500, backgroundColor: '#F4EFE5', color: '#1F1F1F', border: '1px solid transparent' },
        outlined: { borderColor: '#E6E0D4', backgroundColor: '#fff' },
      },
    },
    MuiTextField: { defaultProps: { size: 'small' as const } },
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
    MuiIconButton: { styleOverrides: { root: { borderRadius: 12, '&:hover': { backgroundColor: '#F5EFE5' } } } },
    MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: '#1F1F1F', fontSize: 12, borderRadius: 8 } } },
  },
})

export const darkTheme: Theme = createTheme({
  ...shared,
  palette: {
    mode: 'dark',
    primary: { main: '#FF4D63', light: '#FF7A8A', dark: '#D61030', contrastText: '#fff' },
    secondary: { main: '#FF9A33' },
    background: { default: '#1A1A1A', paper: '#242424' },
    text: { primary: '#E8E8E8', secondary: '#9A9A9A' },
    divider: '#333333',
    error: { main: '#EF5350' },
    success: { main: '#4CAF50' },
    warning: { main: '#FFB74D' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: '#1A1A1A' },
        '*::-webkit-scrollbar': { width: 8, height: 8 },
        '*::-webkit-scrollbar-thumb': { backgroundColor: '#444', borderRadius: 999 },
        '*::-webkit-scrollbar-thumb:hover': { backgroundColor: '#555' },
      },
    },
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: 'none', boxShadow: 'none', border: '1px solid #333' } },
    },
    MuiAppBar: {
      styleOverrides: { root: { background: '#242424', color: '#E8E8E8', borderBottom: '1px solid #333', boxShadow: 'none' } },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 999, paddingInline: 16, paddingBlock: 8, fontWeight: 600 },
        contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
        outlined: { borderColor: '#444', color: '#E8E8E8', '&:hover': { borderColor: '#888', backgroundColor: '#2A2A2A' } },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 999, fontWeight: 500, backgroundColor: '#2A2A2A', color: '#E8E8E8', border: '1px solid transparent' },
        outlined: { borderColor: '#444', backgroundColor: '#1A1A1A' },
      },
    },
    MuiTextField: { defaultProps: { size: 'small' as const } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          backgroundColor: '#2A2A2A',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: '#444' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#888' },
        },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 12, '&:hover': { backgroundColor: '#333' } } } },
    MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: '#333', fontSize: 12, borderRadius: 8 } } },
  },
})

// Keep backward compat export
export const theme = lightTheme
