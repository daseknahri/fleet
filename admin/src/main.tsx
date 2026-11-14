import React from 'react'
import ReactDOM from 'react-dom/client'
import { createTheme, ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { ToastContainer } from 'react-toastify'

import { disableDevTools } from ':disable-react-devtools'
import * as helper from '@/utils/helper'
import * as UserService from '@/services/UserService'
import { strings as commonStrings } from '@/lang/common'
import env from '@/config/env.config'
import App from '@/App'

import '@/assets/css/common.css'
import '@/assets/css/index.css'

if (import.meta.env.VITE_NODE_ENV === 'production') {
  disableDevTools()
}

let language = env.DEFAULT_LANGUAGE
const user = JSON.parse(localStorage.getItem('bc-be-user') ?? 'null')
let lang = UserService.getQueryLanguage()

if (lang) {
  if (!env.LANGUAGES.includes(lang)) {
    lang = localStorage.getItem('bc-be-language')

    if (lang && !env.LANGUAGES.includes(lang)) {
      lang = env.DEFAULT_LANGUAGE
    }
  }

  try {
    if (user) {
      language = user.language
      if (lang && lang.length === 2 && user.language !== lang) {
        const data = {
          id: user._id as string,
          language: lang,
        }

        const status = await UserService.validateAccessToken()

        if (status === 200) {
          const _status = await UserService.updateLanguage(data)
          if (_status !== 200) {
            helper.error(null, commonStrings.CHANGE_LANGUAGE_ERROR)
          }
        }

        language = lang
      }
    } else if (lang) {
      language = lang
    }
    UserService.setLanguage(language)
    commonStrings.setLanguage(language)
  } catch (err) {
    helper.error(err, commonStrings.CHANGE_LANGUAGE_ERROR)
  }
}

language = UserService.getLanguage()
const isFr = language === 'fr'
const isEs = language === 'es'
const isAr = language === 'ar'
document.documentElement.dir = isAr ? 'rtl' : 'ltr'
document.documentElement.lang = language

// Load only the resolved language's MUI locale objects: the theme is built once at boot,
// so the other languages' locale data stays out of the entry chunk.
const coreLocale = isFr
  ? (await import('@mui/material/locale')).frFR
  : isEs
    ? (await import('@mui/material/locale')).esES
    : isAr
      ? (await import('@mui/material/locale')).arSD
      : (await import('@mui/material/locale')).enUS
// NOTE (GA hardening Wave 5): this @mui/x-date-pickers version ships no Arabic
// locale at all, so ar falls back to enUS for picker chrome only; the app's own
// date rendering uses Intl ar-MA and is fully Arabic.
const pickerLocale = isFr
  ? (await import('@mui/x-date-pickers/locales')).frFR
  : isEs
    ? (await import('@mui/x-date-pickers/locales')).esES
    : (await import('@mui/x-date-pickers/locales')).enUS
const dataGridLocale = isFr
  ? (await import('@mui/x-data-grid/locales')).frFR
  : isEs
    ? (await import('@mui/x-data-grid/locales')).esES
    : isAr
      ? (await import('@mui/x-data-grid/locales')).arSD
      : (await import('@mui/x-data-grid/locales')).enUS

const theme = createTheme(
  {
    palette: {
      primary: {
        main: '#1a1a1a',
        // contrastText: '#003B95',
        // dark: '#003B95',
      },
    },
    typography: {
      fontFamily: [
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Roboto',
        '"Helvetica Neue"',
        'Arial',
        'sans-serif',
        '"Apple Color Emoji"',
        '"Segoe UI Emoji"',
        '"Segoe UI Symbol"',
      ].join(','),
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: '#fafafa',
          },
        },
      },
    },
  },
  pickerLocale,
  dataGridLocale,
  coreLocale,
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ThemeProvider theme={theme}>
    <CssBaseline>
      <App />
      <ToastContainer
        position={isAr ? 'bottom-left' : 'bottom-right'}
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        pauseOnFocusLoss={false}
        draggable={false}
        pauseOnHover
        theme="dark"
      />
    </CssBaseline>
  </ThemeProvider>,
)
