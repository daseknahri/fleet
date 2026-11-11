import React, { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Paper } from '@mui/material'
import * as bookcarsTypes from ':bookcars-types'
import * as SigningService from '@/services/SigningService'
import { strings } from '@/lang/sign-contract'
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

  const formatDate = (d?: Date | string) => (d ? new Date(d).toLocaleString(language) : '')
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
                <dd>{formatDate(summary.from)}</dd>
              </div>
              <div>
                <dt>{strings.TO}</dt>
                <dd>{formatDate(summary.to)}</dd>
              </div>
              <div>
                <dt>{strings.RENTAL_TOTAL}</dt>
                <dd>{`${formatAmount(summary.rentalTotal)} ${summary.currency}`}</dd>
              </div>
              <div>
                <dt>{strings.DEPOSIT}</dt>
                <dd>{`${formatAmount(summary.depositAmount)} ${summary.currency}`}</dd>
              </div>
            </dl>

            <span className="sign-contract-label">{strings.SIGN_HERE}</span>
            <canvas
              ref={canvasRef}
              className="sign-contract-canvas"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={stopDrawing}
              onPointerLeave={stopDrawing}
              onPointerCancel={stopDrawing}
            />
            {signatureMissing && <p className="sign-contract-error">{strings.SIGNATURE_REQUIRED}</p>}

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
