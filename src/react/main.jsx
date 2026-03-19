import React from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import App from './App.jsx';

const theme = createTheme({
  typography: {
    // MUI default is 14. Bump overall UI readability.
    fontSize: 16,
    fontFamily: [
      'Open Sans',
      'system-ui',
      '-apple-system',
      'Segoe UI',
      'Roboto',
      'Helvetica',
      'Arial',
      'sans-serif',
    ].join(','),
    h5: { fontWeight: 900, fontSize: '1.45rem' },
    h6: { fontWeight: 900 },
    body2: { fontSize: '0.98rem' },
    caption: { fontSize: '0.9rem' },
  },
  components: {
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 700 },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 800 },
      },
    },
  },
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);

