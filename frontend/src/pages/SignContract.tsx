import React, { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Paper, TextField } from '@mui/material'
import * as bookcarsTypes from ':bookcars-types'
import * as SigningService from '@/services/SigningService'
import { strings } from '@/lang/sign-contract'
import { formatDateTimeCasablanca } from '@/utils/dateHelper'
import * as langHelper from '@/utils/langHelper'

import '@/assets/css/sign-contract.css'

/**
 * GA-PAR-12 — public online contract signing page (/sign/:token).
 *
 * Standalone by design: it renders OUTSIDE the app layout (no header,
 * footer or third-party providers), loads no external resources and
 * contains no outbound links, so the capability URL in the address bar
 * cannot leak through a Referer header (the API also answers
 * `Referrer-Policy: no-referrer`). The token is the only credential.
 */

type PageState = 'loading' | 'ready' | 'success' | 'already' | 'invalid' | 'failed'

const errorMessage = (err: unknown): string => {
  const e = err as { response?: { data?: { message?: string } } }
  return e?.response?.data?.message || ''
}

const SignContract = () => {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<PageState>('loading')
  const [summary, setSummary] = useState<bookcarsTypes.SigningSummary>()
  const [submitting, setSubmitting] = useState(false)
  const [signatureMissing, setSignatureMissing] = useState(false)
  const [typedName, setTypedName] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const drawnRef = useRef(false)
  const lastPointRef = useRef<{ x: number, y: number } | null>(null)

  const language = langHelper.getLanguage()
  const dir = language === 'ar' ? 'rtl' : 'ltr'

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!token) {
        setState('invalid')
        return
      }
      try {
        const data = await SigningService.getSigningSummary(token)
        if (!cancelled) {
          setSummary(data)
          setState('ready')
        }
      } catch (err) {
        if (!cancelled) {
          setState(errorMessage(err) === 'SIGN_ALREADY_SIGNED' ? 'already' : 'invalid')
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [token])

  // Size the canvas bitmap to its displayed box once it is on screen.
  useEffect(() => {
    if (state !== 'ready') {
      return
    }
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const rect = canvas.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(rect.width * ratio))
    canvas.height = Math.max(1, Math.round(rect.height * ratio))
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.lineWidth = 2 * ratio
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#1a1a2e'
    }
  }, [state])

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    return {
      x: (e.clientX - rect.left) * ratio,
      y: (e.clientY - rect.top) * ratio,
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    canvasRef.current?.setPointerCapture(e.pointerId)
    drawingRef.current = true
    lastPointRef.current = pointFromEvent(e)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) {
      return
    }
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const last = lastPointRef.current
    if (!canvas || !ctx || !last) {
      return
    }
    const point = pointFromEvent(e)
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
    lastPointRef.current = point
    drawnRef.current = true
    setSignatureMissing(false)
  }

  const stopDrawing = () => {
    drawingRef.current = false
    lastPointRef.current = null
  }

  const handleClear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) {
      return
    }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    drawnRef.current = false
  }

  // B-F-39: typed-signature fallback — draw the typed name onto the
  // canvas so keyboard-only users (or anyone who cannot draw) can sign.
  // No API change: the canvas bitmap is submitted exactly as before.
  const applyTypedSignature = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const name = typedName.trim()
    if (!canvas || !ctx || !name) {
      return
    }
    const ratio = window.devicePixelRatio || 1
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#1a1a2e'
    ctx.font = `${48 * ratio}px "Segoe Script", "Brush Script MT", cursive`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(name, canvas.width / 2, canvas.height / 2)
    drawnRef.current = true
    setSignatureMissing(false)
  }

  const handleSubmit = async () => {
    const canvas = canvasRef.current
    if (!token || !canvas) {
      return
    }
    if (!drawnRef.current) {
      setSignatureMissing(true)
      return
    }
    setSubmitting(true)
    try {
      const dataUrl = canvas.toDataURL('image/png')
      const base64 = dataUrl.split(',')[1] || ''
      const status = await SigningService.signBooking(token, base64)
      setState(status === 200 ? 'success' : 'failed')
    } catch (err) {
      setState(errorMessage(err) === 'SIGN_ALREADY_SIGNED' ? 'already' : 'failed')
    } finally {
      setSubmitting(false)
    }
  }

  const formatAmount = (n?: number) => (n === undefined ? '' : n.toLocaleString(language))

  return (
    <div className="sign-contract" dir={dir}>
      <Paper className="sign-contract-card" elevation={10}>
        <h1>{strings.TITLE}</h1>

        {state === 'loading' && <p>{strings.LOADING}</p>}

        {state === 'invalid' && (
          <>
            <h2>{strings.INVALID_TITLE}</h2>
            <p>{strings.INVALID_TEXT}</p>
          </>
        )}

        {state === 'already' && (
          <>
            <h2>{strings.ALREADY_TITLE}</h2>
            <p>{strings.ALREADY_TEXT}</p>
          </>
        )}

        {state === 'success' && (
          <>
            <h2>{strings.SUCCESS_TITLE}</h2>
            <p>{strings.SUCCESS_TEXT}</p>
          </>
        )}

        {state === 'failed' && (
          <>
            <h2>{strings.INVALID_TITLE}</h2>
            <p>{strings.SIGNING_FAILED}</p>
          </>
        )}

        {state === 'ready' && summary && (
          <>
            <p>{strings.INTRO}</p>
            <dl className="sign-contract-summary">
              <div>
                <dt>{strings.AGENCY}</dt>
                <dd>{summary.agencyName}</dd>
              </div>
              {summary.reference && (
                <div>
                  <dt>{strings.REFERENCE}</dt>
                  <dd>{summary.reference}</dd>
                </div>
              )}
              <div>
                <dt>{strings.CLIENT}</dt>
                <dd>{summary.clientName}</dd>
              </div>
              <div>
                <dt>{strings.CAR}</dt>
                <dd>{summary.carName}</dd>
              </div>
              {summary.carPlate && (
                <div>
                  <dt>{strings.PLATE}</dt>
                  <dd>{summary.carPlate}</dd>
                </div>
              )}
              <div>
                <dt>{strings.FROM}</dt>
                <dd>{`${formatDateTimeCasablanca(summary.from)} (${strings.TIMEZONE_MOROCCO})`}</dd>
              </div>
              <div>
                <dt>{strings.TO}</dt>
                <dd>{`${formatDateTimeCasablanca(summary.to)} (${strings.TIMEZONE_MOROCCO})`}</dd>
              </div>
              <div>
                <dt>{strings.RENTAL_TOTAL}</dt>
                <dd>{`${formatAmount(summary.rentalTotal)} ${summary.currency}`}</dd>
              </div>
              <div>
                <dt>{strings.DEPOSIT}</dt>
                <dd>{`${formatAmount(summary.depositAmount)} ${summary.currency}`}</dd>
              </div>
              <div>
                <dt>{strings.PAID}</dt>
                <dd>{`${formatAmount(summary.paidAmount)} ${summary.currency}`}</dd>
              </div>
              <div>
                <dt>{strings.DUE_AT_PICKUP}</dt>
                <dd>{`${formatAmount(summary.balanceDue)} ${summary.currency}`}</dd>
              </div>
              {summary.pickupLocation && (
                <div>
                  <dt>{strings.PICKUP_LOCATION}</dt>
                  <dd>{summary.pickupLocation}</dd>
                </div>
              )}
            </dl>

            <span className="sign-contract-label">{strings.SIGN_HERE}</span>
            <canvas
              ref={canvasRef}
              className="sign-contract-canvas"
              role="img"
              aria-label={strings.SIGN_HERE}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={stopDrawing}
              onPointerLeave={stopDrawing}
              onPointerCancel={stopDrawing}
            />
            {signatureMissing && <p className="sign-contract-error">{strings.SIGNATURE_REQUIRED}</p>}

            <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
              <TextField
                label={strings.TYPE_NAME}
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                size="small"
                fullWidth
                disabled={submitting}
              />
              <Button variant="outlined" onClick={applyTypedSignature} disabled={!typedName.trim() || submitting} sx={{ whiteSpace: 'nowrap' }}>
                {strings.USE_TYPED_SIGNATURE}
              </Button>
            </div>

            <div className="sign-contract-buttons">
              <Button variant="outlined" onClick={handleClear} disabled={submitting}>
                {strings.CLEAR}
              </Button>
              <Button variant="contained" className="btn-primary" onClick={handleSubmit} disabled={submitting}>
                {strings.SUBMIT}
              </Button>
            </div>
          </>
        )}
      </Paper>
    </div>
  )
}

export default SignContract
