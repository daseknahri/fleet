import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, CardContent, Divider, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material'
import * as bookcarsTypes from ':bookcars-types'
import strings from '@/lang/contract-operations'
import * as ContractOperationService from '@/services/ContractOperationService'
import * as UserService from '@/services/UserService'
import * as helper from '@/utils/helper'

const uiLocale = () => {
  const language = UserService.getLanguage()
  return language === 'fr' ? 'fr-MA' : language === 'ar' ? 'ar-MA' : language === 'es' ? 'es-ES' : 'en-GB'
}

const formatDateTime = (date: Date | string) => new Intl.DateTimeFormat(uiLocale(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date))

interface Props {
  bookingId: string
  supplierId?: string
  lifecycle?: bookcarsTypes.ContractLifecycle
  onCompleted: () => void
}

const chargeTypeLabel = (type: bookcarsTypes.ContractChargeType) => (
  type === bookcarsTypes.ContractChargeType.Fee ? strings.CHARGE_FEE : strings.CHARGE_DAMAGE
)

const ContractOperations = ({ bookingId, supplierId, lifecycle, onCompleted }: Props) => {
  const [inspections, setInspections] = useState<bookcarsTypes.ContractInspection[]>([])
  const [charges, setCharges] = useState<bookcarsTypes.ContractCharge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [snapshot, setSnapshot] = useState<bookcarsTypes.ContractSnapshot>()
  const [currentLifecycle, setCurrentLifecycle] = useState(lifecycle)
  const [form, setForm] = useState({ odometer: '', fuelLevel: '', condition: '', damageNote: '' })
  const [chargeForm, setChargeForm] = useState({ type: bookcarsTypes.ContractChargeType.Damage as bookcarsTypes.ContractChargeType, amount: '', currency: 'MAD', reason: '' })
  const [busy, setBusy] = useState(false)
  const [photoFiles, setPhotoFiles] = useState<string[]>([])
  const [signatureFile, setSignatureFile] = useState('')
  const photoInput = useRef<HTMLInputElement>(null)
  const signatureInput = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [i, c] = await Promise.all([
        ContractOperationService.list(bookingId, supplierId),
        ContractOperationService.listCharges(bookingId, supplierId),
      ])
      setInspections(i)
      setCharges(c)
      const hasReturn = i.some((inspection) => inspection.type === bookcarsTypes.InspectionType.Return)
      const hasHandover = i.some((inspection) => inspection.type === bookcarsTypes.InspectionType.Handover)
      if (hasReturn) {
        setCurrentLifecycle(bookcarsTypes.ContractLifecycle.ReturnReview)
      } else if (hasHandover) {
        setCurrentLifecycle(bookcarsTypes.ContractLifecycle.Active)
      }
    } catch (err) {
      setError(helper.getErrorMessage(err, strings.ERROR))
    } finally {
      setLoading(false)
    }
  }, [bookingId, supplierId])

  useEffect(() => {
    setCurrentLifecycle(lifecycle)
    reload()
  }, [reload, lifecycle])

  const openBlob = async (loader: () => Promise<string>) => {
    try {
      const url = await loader()
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (err) {
      setError(helper.getErrorMessage(err, strings.ERROR))
    }
  }

  const openPhoto = (filename: string) => openBlob(() => ContractOperationService.fetchFileUrl(bookingId, filename, supplierId))

  const upload = async (file: File, kind: 'photo' | 'signature') => {
    setBusy(true)
    setError('')
    try {
      const uploaded = await ContractOperationService.uploadFile(bookingId, file, kind, supplierId)
      if (uploaded.kind === 'signature') {
        setSignatureFile(uploaded.filename)
      } else {
        setPhotoFiles((current) => [...current, uploaded.filename])
      }
    } catch (err) {
      setError(helper.getErrorMessage(err, strings.ERROR))
    } finally {
      setBusy(false)
    }
  }

  const onPick = async (event: React.ChangeEvent<HTMLInputElement>, kind: 'photo' | 'signature') => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) {
      await upload(file, kind)
    }
  }

  const inspection = async (type: 'handover' | 'return') => {
    setBusy(true)
    setError('')
    try {
      const payload: bookcarsTypes.CreateContractInspectionPayload = {
        occurredAt: new Date().toISOString(),
        photoFiles,
        signatureFile: signatureFile || undefined,
        odometer: form.odometer ? Number(form.odometer) : undefined,
        fuelLevel: form.fuelLevel ? Number(form.fuelLevel) : undefined,
        condition: form.condition,
        damageNote: form.damageNote,
      }
      const result = await ContractOperationService.createInspection(bookingId, type, payload, supplierId)
      setCurrentLifecycle(result.booking.lifecycle)
      setForm({ odometer: '', fuelLevel: '', condition: '', damageNote: '' })
      setPhotoFiles([])
      setSignatureFile('')
      await reload()
    } catch (err) {
      setError(helper.getErrorMessage(err, strings.ERROR))
    } finally {
      setBusy(false)
    }
  }

  const createCharge = async () => {
    setBusy(true)
    setError('')
    try {
      await ContractOperationService.createCharge(bookingId, { ...chargeForm, amount: Number(chargeForm.amount) }, supplierId)
      setChargeForm({ ...chargeForm, amount: '', reason: '' })
      await reload()
    } catch (err) {
      setError(helper.getErrorMessage(err, strings.ERROR))
    } finally {
      setBusy(false)
    }
  }

  const decide = async (charge: bookcarsTypes.ContractCharge, decision: bookcarsTypes.ApprovalDecision) => {
    setBusy(true)
    setError('')
    try {
      await ContractOperationService.decideCharge(bookingId, charge._id!, decision, undefined, supplierId)
      await reload()
    } catch (err) {
      setError(helper.getErrorMessage(err, strings.ERROR))
    } finally {
      setBusy(false)
    }
  }

  const makeSnapshot = async () => {
    setBusy(true)
    setError('')
    try {
      const s = await ContractOperationService.createSnapshot(bookingId, supplierId)
      setSnapshot(s)
      await reload()
    } catch (err) {
      setError(helper.getErrorMessage(err, strings.ERROR))
    } finally {
      setBusy(false)
    }
  }

  const downloadSnapshot = async () => {
    if (snapshot) {
      await openBlob(() => ContractOperationService.fetchSnapshotUrl(bookingId, snapshot.pdfFile, supplierId))
    }
  }

  const complete = async () => {
    setBusy(true)
    setError('')
    try {
      await ContractOperationService.complete(bookingId, supplierId)
      onCompleted()
    } catch (err) {
      setError(helper.getErrorMessage(err, strings.ERROR))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="contract-operations" data-testid="contract-operations">
      <CardContent>
        <Typography variant="h6">{strings.TITLE}</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {loading ? <Typography>{strings.LOADING}</Typography> : (
          <>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle1">{strings.INSPECTIONS}</Typography>
            {!inspections.length && <Typography color="text.secondary">{strings.EMPTY}</Typography>}
            {inspections.map((x) => (
              <div key={x._id} style={{ marginBottom: 4 }}>
                <Typography variant="body2">{`${x.type} | ${formatDateTime(x.occurredAt)} | ${x.odometer ?? '-'} | ${x.fuelLevel ?? '-'}% | ${x.damageNote || x.condition || ''}`}</Typography>
                {(x.photoFiles?.length || x.signatureFile) && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {(x.photoFiles || []).map((file) => (
                      <Button key={file} size="small" onClick={() => openPhoto(file)}>{`${strings.PHOTO}: ${file}`}</Button>
                    ))}
                    {x.signatureFile && (
                      <Button size="small" onClick={() => openPhoto(x.signatureFile!)}>{`${strings.SIGNATURE}: ${x.signatureFile}`}</Button>
                    )}
                  </div>
                )}
              </div>
            ))}
            <Divider sx={{ my: 1 }} />
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
              <TextField label={strings.ODOMETER} type="number" value={form.odometer} onChange={(e) => setForm({ ...form, odometer: e.target.value })} />
              <TextField label={strings.FUEL} type="number" value={form.fuelLevel} onChange={(e) => setForm({ ...form, fuelLevel: e.target.value })} />
              <TextField label={strings.CONDITION} value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} />
              <TextField label={strings.DAMAGE} value={form.damageNote} onChange={(e) => setForm({ ...form, damageNote: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input ref={photoInput} hidden type="file" accept="image/*,.pdf" onChange={(e) => onPick(e, 'photo')} />
              <input ref={signatureInput} hidden type="file" accept="image/*,.pdf" onChange={(e) => onPick(e, 'signature')} />
              <Button disabled={busy} variant="outlined" onClick={() => photoInput.current?.click()}>{strings.UPLOAD_PHOTO}</Button>
              <Button disabled={busy} variant="outlined" onClick={() => signatureInput.current?.click()}>{strings.UPLOAD_SIGNATURE}</Button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Typography variant="caption">{strings.ATTACHMENTS}</Typography>
              {!photoFiles.length && !signatureFile && <Typography variant="caption" color="text.secondary">{strings.NO_FILES}</Typography>}
              {photoFiles.map((file) => <Button key={file} size="small" disabled={busy} onClick={() => openPhoto(file)}>{`${strings.PHOTO}: ${file}`}</Button>)}
              {signatureFile && <Button size="small" disabled={busy} onClick={() => openPhoto(signatureFile)}>{`${strings.SIGNATURE}: ${signatureFile}`}</Button>}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <Button disabled={busy || loading || (currentLifecycle !== undefined && currentLifecycle !== bookcarsTypes.ContractLifecycle.Draft && currentLifecycle !== bookcarsTypes.ContractLifecycle.Confirmed)} variant="contained" onClick={() => inspection('handover')}>{strings.HANDOVER}</Button>
              <Button disabled={busy || loading || currentLifecycle !== bookcarsTypes.ContractLifecycle.Active} variant="contained" onClick={() => inspection('return')}>{strings.RETURN}</Button>
            </div>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle1">{strings.CHARGES}</Typography>
            {!charges.length && <Typography color="text.secondary">{strings.EMPTY}</Typography>}
            {charges.map((x) => (
              <div key={x._id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="body2">{`${chargeTypeLabel(x.type)} | ${x.amount} ${x.currency} | ${x.reason} | ${x.status}`}</Typography>
                {x.status === bookcarsTypes.ApprovalDecision.Pending && (
                  <>
                    <Button size="small" disabled={busy} onClick={() => decide(x, bookcarsTypes.ApprovalDecision.Approved)}>{strings.APPROVE}</Button>
                    <Button size="small" disabled={busy} onClick={() => decide(x, bookcarsTypes.ApprovalDecision.Rejected)}>{strings.REJECT}</Button>
                  </>
                )}
              </div>
            ))}
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', marginTop: 8 }}>
              <FormControl><InputLabel>{strings.CURRENCY}</InputLabel><Select label={strings.CURRENCY} value={chargeForm.currency} onChange={(e) => setChargeForm({ ...chargeForm, currency: e.target.value })}><MenuItem value="MAD">MAD</MenuItem><MenuItem value="EUR">EUR</MenuItem><MenuItem value="USD">USD</MenuItem></Select></FormControl>
              <FormControl><InputLabel>{strings.TYPE}</InputLabel><Select label={strings.TYPE} value={chargeForm.type} onChange={(e) => setChargeForm({ ...chargeForm, type: e.target.value as bookcarsTypes.ContractChargeType })}><MenuItem value={bookcarsTypes.ContractChargeType.Damage}>{strings.CHARGE_DAMAGE}</MenuItem><MenuItem value={bookcarsTypes.ContractChargeType.Fee}>{strings.CHARGE_FEE}</MenuItem></Select></FormControl>
              <TextField label={strings.AMOUNT} type="number" value={chargeForm.amount} onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })} />
              <TextField label={strings.REASON} value={chargeForm.reason} onChange={(e) => setChargeForm({ ...chargeForm, reason: e.target.value })} />
            </div>
            <Button sx={{ mt: 1 }} disabled={busy || !chargeForm.amount || chargeForm.reason.length < 3} onClick={createCharge}>{strings.ADD_CHARGE}</Button>
            <Divider sx={{ my: 1 }} />
            <Button variant="contained" disabled={busy} onClick={makeSnapshot}>{strings.SNAPSHOT}</Button>
            {snapshot && <Button sx={{ ml: 1 }} disabled={busy} onClick={downloadSnapshot}>{strings.DOWNLOAD}</Button>}
            <Button sx={{ ml: 1 }} variant="outlined" disabled={busy || loading || currentLifecycle !== bookcarsTypes.ContractLifecycle.ReturnReview} onClick={complete}>{strings.COMPLETE}</Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default ContractOperations
