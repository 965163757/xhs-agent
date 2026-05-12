import { createTheme, type Theme } from '@mui/material/styles'

const shared = {
  typography: {
    fontFamily:
      '"Inter","PingFang SC","HarmonyOS Sans SC","Noto Sans SC","SF Pro Display",system-ui,-apple-system,sans-serif',
    h1: { fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.1 },
    h2: { fontWeight: 800, letterSpacing: -1, lineHeight: 1.15 },
    h3: { fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.2 },
    h4: { fontWeight: 700, letterSpacing: -0.3, lineHeight: 1.25 },
    h5: { fontWeight: 700, lineHeight: 1.3 },
    h6: { fontWeight: 700, lineHeight: 1.35 },
    button: { textTransform: 'none' as const, fontWeight: 600, letterSpacing: 0.1 },
    body1: { fontSize: 15, lineHeight: 1.7 },
    body2: { fontSize: 13.5, lineHeight: 1.65 },
  },
  shape: { borderRadius: 16 },
}

export const lightTheme: Theme = createTheme({
  ...shared,
  palette: {
    mode: 'light',
    primary: { main: '#FF2442', light: '#FF6B7F', dark: '#D61030', contrastText: '#fff' },
    secondary: { main: '#FF7A00', light: '#FFB366', dark: '#CC6200' },
    background: { default: '#F8F8F6', paper: '#FFFFFF' },
    text: { primary: '#1A1A1A', secondary: '#6B6B6B' },
    divider: 'rgba(0,0,0,0.06)',
    error: { main: '#DC2626' },
    success: { main: '#16A34A' },
    warning: { main: '#D97706' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#F8F8F6',
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        },
        '*::-webkit-scrollbar': { width: 5, height: 5 },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
        '*::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(0,0,0,0.08)', borderRadius: 999 },
        '*::-webkit-scrollbar-thumb:hover': { backgroundColor: 'rgba(0,0,0,0.15)' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03), 0 4px 12px rgba(0,0,0,0.04)',
          border: '1px solid rgba(0,0,0,0.06)',
          borderRadius: 16,
          transition: 'box-shadow 0.25s cubic-bezier(0.4,0,0.2,1), border-color 0.25s ease, transform 0.25s ease',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: 'rgba(248,248,246,0.72)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          color: '#1A1A1A',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          paddingInline: 20,
          paddingBlock: 9,
          fontWeight: 600,
          fontSize: 13.5,
          transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
        },
        contained: {
          boxShadow: '0 2px 8px rgba(255,36,66,0.2), 0 1px 2px rgba(255,36,66,0.1)',
          '&:hover': {
            boxShadow: '0 6px 20px rgba(255,36,66,0.28), 0 2px 6px rgba(255,36,66,0.15)',
            transform: 'translateY(-1px)',
          },
          '&:active': { transform: 'translateY(0.5px)', boxShadow: '0 1px 4px rgba(255,36,66,0.15)' },
        },
        outlined: {
          borderColor: 'rgba(0,0,0,0.1)',
          color: '#1A1A1A',
          '&:hover': { borderColor: 'rgba(0,0,0,0.2)', backgroundColor: 'rgba(0,0,0,0.02)' },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontWeight: 500,
          fontSize: 12,
          backgroundColor: 'rgba(0,0,0,0.04)',
          color: '#1A1A1A',
          border: '1px solid transparent',
          transition: 'all 0.15s ease',
        },
        outlined: { borderColor: 'rgba(0,0,0,0.08)', backgroundColor: '#fff' },
      },
    },
    MuiTextField: { defaultProps: { size: 'small' as const } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          backgroundColor: '#fff',
          transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(0,0,0,0.08)', transition: 'border-color 0.2s ease' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(0,0,0,0.18)' },
          '&.Mui-focused': { boxShadow: '0 0 0 3px rgba(255,36,66,0.08)' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#FF2442', borderWidth: 1.5 },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          transition: 'all 0.15s ease',
          '&:hover': { backgroundColor: 'rgba(0,0,0,0.04)', transform: 'scale(1.05)' },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#1A1A1A',
          fontSize: 12,
          borderRadius: 8,
          padding: '6px 12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          boxShadow: '0 24px 80px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.08)',
          border: '1px solid rgba(0,0,0,0.06)',
          borderRadius: 20,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          boxShadow: '8px 0 40px rgba(0,0,0,0.08)',
          border: 'none',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          margin: '2px 8px',
          transition: 'all 0.15s ease',
          '&:hover': { backgroundColor: 'rgba(0,0,0,0.03)' },
          '&.Mui-selected': { backgroundColor: 'rgba(255,36,66,0.06)', '&:hover': { backgroundColor: 'rgba(255,36,66,0.09)' } },
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          fontSize: 14,
          textTransform: 'none',
          transition: 'color 0.2s ease',
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 999, height: 6 },
        bar: { borderRadius: 999 },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        root: {
          '& .MuiSwitch-switchBase.Mui-checked': { color: '#FF2442' },
          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#FF2442' },
        },
      },
    },
  },
})

export const darkTheme: Theme = createTheme({
  ...shared,
  palette: {
    mode: 'dark',
    primary: { main: '#FF4D63', light: '#FF8A99', dark: '#D61030', contrastText: '#fff' },
    secondary: { main: '#FF9A33', light: '#FFBE73', dark: '#CC7A00' },
    background: { default: '#0A0A0B', paper: '#141416' },
    text: { primary: '#F5F5F5', secondary: '#8C8C8C' },
    divider: 'rgba(255,255,255,0.06)',
    error: { main: '#EF4444' },
    success: { main: '#22C55E' },
    warning: { main: '#F59E0B' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#0A0A0B',
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        },
        '*::-webkit-scrollbar': { width: 5, height: 5 },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
        '*::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 999 },
        '*::-webkit-scrollbar-thumb:hover': { backgroundColor: 'rgba(255,255,255,0.15)' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          boxShadow: '0 1px 2px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 16,
          transition: 'box-shadow 0.25s cubic-bezier(0.4,0,0.2,1), border-color 0.25s ease, transform 0.25s ease',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: 'rgba(10,10,11,0.72)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          color: '#F5F5F5',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          paddingInline: 20,
          paddingBlock: 9,
          fontWeight: 600,
          fontSize: 13.5,
          transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
        },
        contained: {
          boxShadow: '0 2px 8px rgba(255,77,99,0.3), 0 1px 2px rgba(255,77,99,0.2)',
          '&:hover': {
            boxShadow: '0 6px 20px rgba(255,77,99,0.4), 0 2px 6px rgba(255,77,99,0.2)',
            transform: 'translateY(-1px)',
          },
          '&:active': { transform: 'translateY(0.5px)', boxShadow: '0 1px 4px rgba(255,77,99,0.2)' },
        },
        outlined: {
          borderColor: 'rgba(255,255,255,0.1)',
          color: '#F5F5F5',
          '&:hover': { borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.03)' },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontWeight: 500,
          fontSize: 12,
          backgroundColor: 'rgba(255,255,255,0.06)',
          color: '#F5F5F5',
          border: '1px solid transparent',
          transition: 'all 0.15s ease',
        },
        outlined: { borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#141416' },
      },
    },
    MuiTextField: { defaultProps: { size: 'small' as const } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          backgroundColor: '#1A1A1E',
          transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.08)', transition: 'border-color 0.2s ease' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.15)' },
          '&.Mui-focused': { boxShadow: '0 0 0 3px rgba(255,77,99,0.12)' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#FF4D63', borderWidth: 1.5 },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          transition: 'all 0.15s ease',
          '&:hover': { backgroundColor: 'rgba(255,255,255,0.06)', transform: 'scale(1.05)' },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#2A2A2E',
          fontSize: 12,
          borderRadius: 8,
          padding: '6px 12px',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          boxShadow: '0 24px 80px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.4)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 20,
          backgroundColor: '#1A1A1E',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          boxShadow: '8px 0 40px rgba(0,0,0,0.4)',
          border: 'none',
          backgroundColor: '#141416',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          margin: '2px 8px',
          transition: 'all 0.15s ease',
          '&:hover': { backgroundColor: 'rgba(255,255,255,0.04)' },
          '&.Mui-selected': { backgroundColor: 'rgba(255,77,99,0.1)', '&:hover': { backgroundColor: 'rgba(255,77,99,0.14)' } },
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          fontSize: 14,
          textTransform: 'none',
          transition: 'color 0.2s ease',
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 999, height: 6 },
        bar: { borderRadius: 999 },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        root: {
          '& .MuiSwitch-switchBase.Mui-checked': { color: '#FF4D63' },
          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: '#FF4D63' },
        },
      },
    },
  },
})

export const theme = lightTheme
