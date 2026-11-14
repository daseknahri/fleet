import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Alert, Button, Card, CardContent, Checkbox, Divider, FormControl, FormControlLabel, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import * as bookcarsTypes from ':bookcars-types'
import strings from '@/lang/contract-operations'
import * as ContractOperationService from '@/services/ContractOperationService'
import { contractWhatsAppUrl } from '@/utils/whatsapp'
import * as UserService from '@/services/UserService'
import * as helper from '@/utils/helper'

interface Props {
  bookingId: string
  supplierId?: string
  lifecycle?: bookcarsTypes.ContractLifecycle
  depositAmount?: number
  /** GA-PAR-11: amendment history rows from the booking (read-only). */
  amendmentHistory?: bookcarsTypes.BookingAmendment[]
  /** GA-PAR-23: WhatsApp contract send — supplied by the booking detail page. */
  whatsApp?: {
    phone?: string | null
    clientName: string
    reference: string
    carLabel: string
    from: Date | string
    to: Date | string
    agencyName: string
  }
  onCompleted: () => void
}

const PHOTO_SLOTS: bookcarsTypes.InspectionPhotoSlot[] = [
  bookcarsTypes.InspectionPhotoSlot.Front,
  bookcarsTypes.InspectionPhotoSlot.Rear,
  bookcarsTypes.InspectionPhotoSlot.Right,
  bookcarsTypes.InspectionPhotoSlot.Left,
  bookcarsTypes.InspectionPhotoSlot.Dashboard,
  bookcarsTypes.InspectionPhotoSlot.Interior,
  bookcarsTypes.InspectionPhotoSlot.Extra,
]

const slotLabel = (slot: bookcarsTypes.InspectionPhotoSlot) => ({
  [bookcarsTypes.InspectionPhotoSlot.Front]: strings.SLOT_FRONT,
  [bookcarsTypes.InspectionPhotoSlot.Rear]: strings.SLOT_REAR,
  [bookcarsTypes.InspectionPhotoSlot.Right]: strings.SLOT_RIGHT,
  [bookcarsTypes.InspectionPhotoSlot.Left]: strings.SLOT_LEFT,
  [bookcarsTypes.InspectionPhotoSlot.Dashboard]: strings.SLOT_DASHBOARD,
  [bookcarsTypes.InspectionPhotoSlot.Interior]: strings.SLOT_INTERIOR,
  [bookcarsTypes.InspectionPhotoSlot.Extra]: strings.SLOT_EXTRA,
}[slot])

const CHECKLIST_ITEMS: { key: keyof bookcarsTypes.InspectionChecklist; label: () => string }[] = [
  { key: 'spareWheelAndTools', label: () => strings.SPARE_WHEEL_AND_TOOLS },
  { key: 'radio', label: () => strings.RADIO_ITEM },
  { key: 'washed', label: () => strings.WASHED_ITEM },
]

const omissionLabel = (reason: string) => {
  if (reason === 'unlimitedIncludedKm') return strings.REASON_UNLIMITED
  if (reason === 'withinAllowance') return strings.REASON_WITHIN_ALLOWANCE
  if (reason === 'missingTankCapacity') return strings.REASON_MISSING_TANK
  if (reason === 'noFuelShortfall') return strings.REASON_NO_SHORTFALL
  if (reason === 'washedAtReturn') return strings.REASON_WASHED
  if (reason.startsWith('missingHandover') || reason.startsWith('missingReturn')) return strings.REASON_MISSING_INSPECTION
  return strings.REASON_MISSING_RATE
}

const uiLocale = () => {
  const language = UserService.getLanguage()
  return language === 'fr' ? 'fr-MA' : language === 'ar' ? 'ar-MA' : language === 'es' ? 'es-ES' : 'en-GB'
}

const formatDateTime = (date: Date | string) => new Intl.DateTimeFormat(uiLocale(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date))

const formatDate = (date: Date | string) => new Intl.DateTimeFormat(uiLocale(), { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(date))

const chargeTypeLabel = (type: bookcarsTypes.ContractChargeType) => {
  if (type === bookcarsTypes.ContractChargeType.Fee) return strings.CHARGE_FEE
  if (type === bookcarsTypes.ContractChargeType.ExtraKm) return strings.CHARGE_EXTRA_KM
  if (type === bookcarsTypes.ContractChargeType.Fuel) return strings.CHARGE_FUEL
  if (type === bookcarsTypes.ContractChargeType.Wash) return strings.CHARGE_WASH
  return strings.CHARGE_DAMAGE
}

const chargeStatusLabel = (status: bookcarsTypes.ApprovalDecision) => (
  status === bookcarsTypes.ApprovalDecision.Approved ? strings.APPROVED
    : status === bookcarsTypes.ApprovalDecision.Rejected ? strings.REJECTED : strings.PENDING
)

const inspectionTypeLabel = (type: bookcarsTypes.InspectionType) => (
  type === bookcarsTypes.InspectionType.Return ? strings.RETURN : strings.HANDOVER
)

const ContractOperations = ({ bookingId, supplierId, lifecycle, depositAmount, amendmentHistory, whatsApp, onCompleted }: Props) => {
  const [inspections, setInspections] = useState<bookcarsTypes.ContractInspection[]>([])
  const [charges, setCharges] = useState<bookcarsTypes.ContractCharge[]>([])
  const [loading, setLoading] = useState(true)
  const currencyLabelId = useId()
  const typeLabelId = useId()
  const [error, setError] = useState('')
  const [snapshot, setSnapshot] = useState<bookcarsTypes.ContractSnapshot>()
  const [currentLifecycle, setCurrentLifecycle] = useState(lifecycle)
  const [form, setForm] = useState({ odometer: '', fuelLevel: '', condition: '', damageNote: '' })
  const [chargeForm, setChargeForm] = useState({ type: bookcarsTypes.ContractChargeType.Damage as bookcarsTypes.ContractChargeType, amount: '', currency: 'MAD', reason: '' })
  const [busy, setBusy] = useState(false)
  const [photoFiles, setPhotoFiles] = useState<string[]>([])
  const [signatureFile, setSignatureFile] = useState('')
  const [checklist, setChecklist] = useState<bookcarsTypes.InspectionChecklist>({})
  const [slotPhotos, setSlotPhotos] = useState<Partial<Record<bookcarsTypes.InspectionPhotoSlot, string>>>({})
  const pendingSlot = useRef<bookcarsTypes.InspectionPhotoSlot | null>(null)
  const slotInput = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<bookcarsTypes.SettlementPreview>()
  const [previewLines, setPreviewLines] = useState<{ kind: bookcarsTypes.ContractChargeType; amount: string; include: boolean }[]>([])
  const [deposit, setDeposit] = useState({ held: '', kept: '', method: '', note: '' })

  useEffect(() => {
    if (depositAmount !== undefined && depositAmount !== null) {
      setDeposit((current) => (current.held ? current : { ...current, held: String(depositAmount) }))
    }
  }, [depositAmount])
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
      } else if (pendingSlot.current) {
        const slot = pendingSlot.current
        pendingSlot.current = null
        setSlotPhotos((current) => ({ ...current, [slot]: uploaded.filename }))
      } else {
        setPhotoFiles((current) => [...current, uploaded.filename])
      }
    } catch (err) {
      setError(helper.getErrorMessage(err, strings.ERROR))
    } finally {
      setBusy(false)
    }
  }

  const onPickSlot = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) {
      await upload(file, 'photo')
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
        checklist,
        photos: PHOTO_SLOTS.filter((slot) => slotPhotos[slot]).map((slot) => ({ slot, file: slotPhotos[slot]! })),
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
      setSlotPhotos({})
      setChecklist({})
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

  // GA-PAR-14: withStamp requests the agency stamp in the generated PDF
  // (a stamp-less agency renders a valid PDF without a stamp).
  const makeSnapshot = async (withStamp = false) => {
    setBusy(true)
    setError('')
    try {
      const s = await ContractOperationService.createSnapshot(bookingId, supplierId, withStamp)
      setSnapshot(s)
      await reload()
    } catch (err) {
      setError(helper.getErrorMessage(err, strings.ERROR))
    } finally {
      setBusy(false)
    }
  }

  // GA-PAR-23: opens the wa.me deep link in a new tab (no backend call).
  const openWhatsApp = (url: string | null) => {
    if (url) {
      window.open(url, '_blank', 'noopener')
    }
  }

  const downloadSnapshot = async () => {
    if (snapshot) {
      await openBlob(() => ContractOperationService.fetchSnapshotUrl(bookingId, snapshot.pdfFile, supplierId))
    }
  }

  const loadPreview = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await ContractOperationService.settlementPreview(bookingId, supplierId)
      setPreview(result)
      setPreviewLines(result.lines.map((line) => ({ kind: line.kind, amount: String(line.amount), include: true })))
    } catch (err) {
      setError(helper.getErrorMessage(err, strings.ERROR))
    } finally {
      setBusy(false)
    }
  }

  const confirmSettlement = async () => {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      for (const line of previewLines.filter((l) => l.include)) {
        // Persisting a proposed line = the existing createCharge flow;
        // dropped lines are simply never created. No netting against
        // the deposit happens here or anywhere else.
        await ContractOperationService.createCharge(bookingId, { type: line.kind, amount: Number(line.amount), currency: preview.currency, reason: chargeTypeLabel(line.kind) }, supplierId)
      }
      setPreview(undefined)
      setPreviewLines([])
      await reload()
    } catch (err) {
      setError(helper.getErrorMessage(err, strings.ERROR))
    } finally {
      setBusy(false)
    }
  }

  const complete = async () => {
    setBusy(true)
    setError('')
    try {
      const hasDeposit = deposit.held !== '' || deposit.kept !== ''
      const settlement: bookcarsTypes.DepositSettlement | undefined = hasDeposit ? {
        heldAmount: Number(deposit.held),
        keptAmount: Number(deposit.kept || 0),
        // Returned is displayed as held - kept for operator confirmation
        // and stored exactly as confirmed here — never auto-netted from
        // charge sums (the kept amount is typed by the operator).
        returnedAmount: Number(deposit.held) - Number(deposit.kept || 0),
        method: deposit.method || undefined,
        note: deposit.note || undefined,
      } : undefined
      await ContractOperationService.complete(bookingId, supplierId, settlement)
      onCompleted()
    } catch (err) {
      setError(helper.getErrorMessage(err, strings.ERROR))
    } finally {
      setBusy(false)
    }
  }

  const handoverInsp = inspections.filter((x) => x.type === bookcarsTypes.InspectionType.Handover).slice(-1)[0]
  const returnInsp = inspections.filter((x) => x.type === bookcarsTypes.InspectionType.Return).slice(-1)[0]
  const hasPendingCharge = charges.some((x) => x.status === bookcarsTypes.ApprovalDecision.Pending)

  // GA-PAR-23: wa.me deep link for the contract send. Null when the client
  // has no usable stored phone (the button then renders disabled with the
  // WA_NO_PHONE tooltip). Same view-level gating as Snapshot/Download: no
  // extra permission — anyone who can open this booking detail can use it.
  const waUrl = whatsApp ? contractWhatsAppUrl({
    phone: whatsApp.phone,
    template: strings.WA_CONTRACT_MESSAGE,
    clientName: whatsApp.clientName,
    reference: whatsApp.reference,
    carLabel: whatsApp.carLabel,
    fromText: formatDate(whatsApp.from),
    toText: formatDate(whatsApp.to),
    agencyName: whatsApp.agencyName,
  }) : null

  return (
    <Card className="contract-operations" data-testid="contract-operations">
      <CardContent>
        <Typography variant="h6" component="h2">{strings.TITLE}</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {loading ? <Typography>{strings.LOADING}</Typography> : (
          <>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle1" component="h3">{strings.INSPECTIONS}</Typography>
            {!inspections.length && <Typography color="text.secondary">{strings.EMPTY}</Typography>}
            {inspections.map((x) => (
              <div key={x._id} style={{ marginBottom: 4 }}>
                <Typography variant="body2">{`${inspectionTypeLabel(x.type)} | ${formatDateTime(x.occurredAt)} | ${x.odometer ?? '-'} | ${x.fuelLevel ?? '-'}% | ${x.damageNote || x.condition || ''}`}</Typography>
                {x.checklist && CHECKLIST_ITEMS.filter((item) => x.checklist![item.key] !== undefined).map((item) => (
                  <Typography key={item.key} variant="body2" color="text.secondary">{`${item.label()}: ${x.checklist![item.key] ? strings.YES : strings.NO}`}</Typography>
                ))}
                {(x.photos || []).map((photo) => (
                  <Button key={`${photo.slot}-${photo.file}`} size="small" onClick={() => openPhoto(photo.file)}>{`${slotLabel(photo.slot)}: ${photo.file}`}</Button>
                ))}
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
            {handoverInsp && returnInsp && (
              <>
                <Typography variant="subtitle1" component="h3">{strings.COMPARISON}</Typography>
                {CHECKLIST_ITEMS.filter((item) => handoverInsp.checklist?.[item.key] !== undefined || returnInsp.checklist?.[item.key] !== undefined).map((item) => (
                  <Typography key={item.key} variant="body2">{`${item.label()}: ${handoverInsp.checklist?.[item.key] ? strings.YES : strings.NO} → ${returnInsp.checklist?.[item.key] ? strings.YES : strings.NO}`}</Typography>
                ))}
                {PHOTO_SLOTS.map((slot) => {
                  const hPhoto = handoverInsp.photos?.find((photo) => photo.slot === slot)
                  const rPhoto = returnInsp.photos?.find((photo) => photo.slot === slot)
                  if (!hPhoto && !rPhoto) return null
                  return (
                    <div key={slot} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="body2">{slotLabel(slot)}</Typography>
                      {hPhoto ? <Button size="small" onClick={() => openPhoto(hPhoto.file)}>{`${strings.HANDOVER_SHORT}: ${hPhoto.file}`}</Button> : <Typography variant="caption" color="text.secondary">{`${strings.HANDOVER_SHORT}: ${strings.NO_PHOTO_SLOT}`}</Typography>}
                      {rPhoto ? <Button size="small" onClick={() => openPhoto(rPhoto.file)}>{`${strings.RETURN_SHORT}: ${rPhoto.file}`}</Button> : <Typography variant="caption" color="text.secondary">{`${strings.RETURN_SHORT}: ${strings.NO_PHOTO_SLOT}`}</Typography>}
                    </div>
                  )
                })}
              </>
            )}
            <Divider sx={{ my: 1 }} />
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
              <TextField label={strings.ODOMETER} type="number" value={form.odometer} onChange={(e) => setForm({ ...form, odometer: e.target.value })} />
              <TextField label={strings.FUEL} type="number" value={form.fuelLevel} onChange={(e) => setForm({ ...form, fuelLevel: e.target.value })} />
              <TextField label={strings.CONDITION} value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} />
              <TextField label={strings.DAMAGE} value={form.damageNote} onChange={(e) => setForm({ ...form, damageNote: e.target.value })} />
            </div>
            <Typography variant="subtitle2" component="h4">{strings.CHECKLIST}</Typography>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {CHECKLIST_ITEMS.map((item) => (
                <span key={item.key}>
                  <FormControlLabel
                    control={<Checkbox checked={!!checklist[item.key]} onChange={(e) => setChecklist({ ...checklist, [item.key]: e.target.checked })} />}
                    label={item.label()}
                  />
                  {handoverInsp && currentLifecycle === bookcarsTypes.ContractLifecycle.Active && handoverInsp.checklist?.[item.key] !== undefined && (
                    <Typography variant="caption" display="block" color="text.secondary">{handoverInsp.checklist[item.key] ? strings.WAS_PRESENT_AT_DEPARTURE : strings.WAS_ABSENT_AT_DEPARTURE}</Typography>
                  )}
                </span>
              ))}
            </div>
            <Typography variant="subtitle2" component="h4">{strings.PHOTO_SLOTS}</Typography>
            <input ref={slotInput} hidden type="file" accept="image/*,.pdf" onChange={onPickSlot} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PHOTO_SLOTS.map((slot) => (
                <span key={slot}>
                  <Button size="small" variant="outlined" disabled={busy} onClick={() => { pendingSlot.current = slot; slotInput.current?.click() }}>{`${slotLabel(slot)}: ${strings.UPLOAD_SLOT}`}</Button>
                  {slotPhotos[slot] && <Typography variant="caption" display="block">{slotPhotos[slot]}</Typography>}
                </span>
              ))}
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
            {!!amendmentHistory?.length && (
              <>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle1" component="h3">{strings.AMENDMENT_HISTORY}</Typography>
                {amendmentHistory.map((row, index) => (
                  <Typography key={`${row.at}-${index}`} variant="body2">
                    {`${formatDateTime(row.at)} | ${strings.AMENDMENT_REASON}: ${row.reason} | ${strings.AMENDMENT_FROM}: ${formatDateTime(row.fromBefore)} -> ${formatDateTime(row.fromAfter)} | ${strings.AMENDMENT_TO}: ${formatDateTime(row.toBefore)} -> ${formatDateTime(row.toAfter)} | ${strings.AMENDMENT_TOTAL}: ${row.rentalTotalBefore} -> ${row.rentalTotalAfter} (${row.priceDelta >= 0 ? '+' : ''}${row.priceDelta})`}
                  </Typography>
                ))}
              </>
            )}
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle1" component="h3">{strings.CHARGES}</Typography>
            {!charges.length && <Typography color="text.secondary">{strings.EMPTY}</Typography>}
            {charges.map((x) => (
              <div key={x._id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="body2">{`${chargeTypeLabel(x.type)} | ${x.amount} ${x.currency} | ${x.reason} | ${chargeStatusLabel(x.status)}`}</Typography>
                {x.status === bookcarsTypes.ApprovalDecision.Pending && (
                  <>
                    <Button size="small" disabled={busy} onClick={() => decide(x, bookcarsTypes.ApprovalDecision.Approved)}>{strings.APPROVE}</Button>
                    <Button size="small" disabled={busy} onClick={() => decide(x, bookcarsTypes.ApprovalDecision.Rejected)}>{strings.REJECT}</Button>
                  </>
                )}
              </div>
            ))}
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', marginTop: 8 }}>
              <FormControl><InputLabel id={currencyLabelId}>{strings.CURRENCY}</InputLabel><Select label={strings.CURRENCY} labelId={currencyLabelId} value={chargeForm.currency} onChange={(e) => setChargeForm({ ...chargeForm, currency: e.target.value })}><MenuItem value="MAD">MAD</MenuItem><MenuItem value="EUR">EUR</MenuItem><MenuItem value="USD">USD</MenuItem></Select></FormControl>
              <FormControl><InputLabel id={typeLabelId}>{strings.TYPE}</InputLabel><Select label={strings.TYPE} labelId={typeLabelId} value={chargeForm.type} onChange={(e) => setChargeForm({ ...chargeForm, type: e.target.value as bookcarsTypes.ContractChargeType })}><MenuItem value={bookcarsTypes.ContractChargeType.Damage}>{strings.CHARGE_DAMAGE}</MenuItem><MenuItem value={bookcarsTypes.ContractChargeType.Fee}>{strings.CHARGE_FEE}</MenuItem><MenuItem value={bookcarsTypes.ContractChargeType.ExtraKm}>{strings.CHARGE_EXTRA_KM}</MenuItem><MenuItem value={bookcarsTypes.ContractChargeType.Fuel}>{strings.CHARGE_FUEL}</MenuItem><MenuItem value={bookcarsTypes.ContractChargeType.Wash}>{strings.CHARGE_WASH}</MenuItem></Select></FormControl>
              <TextField label={strings.AMOUNT} type="number" value={chargeForm.amount} onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })} />
              <TextField label={strings.REASON} value={chargeForm.reason} onChange={(e) => setChargeForm({ ...chargeForm, reason: e.target.value })} />
            </div>
            <Button sx={{ mt: 1 }} disabled={busy || !chargeForm.amount || chargeForm.reason.length < 3} onClick={createCharge}>{strings.ADD_CHARGE}</Button>
            {hasPendingCharge && <Alert severity="warning" sx={{ mt: 1 }}>{strings.AWAITING_APPROVAL}</Alert>}
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle1" component="h3">{strings.SETTLEMENT}</Typography>
            <Button disabled={busy} variant="outlined" onClick={loadPreview}>{strings.PREVIEW_SETTLEMENT}</Button>
            {preview && (
              <>
                <Typography variant="body2">{`${strings.SETTLEMENT_LINES} — ${preview.rentalDays} d — ${preview.currency}`}</Typography>
                {previewLines.map((line, index) => (
                  <div key={line.kind} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <FormControlLabel control={<Checkbox checked={line.include} onChange={(e) => setPreviewLines(previewLines.map((l, i) => (i === index ? { ...l, include: e.target.checked } : l)))} />} label={strings.INCLUDE_LINE} />
                    <Typography variant="body2">{chargeTypeLabel(line.kind)}</Typography>
                    <TextField label={strings.AMOUNT} type="number" value={line.amount} onChange={(e) => setPreviewLines(previewLines.map((l, i) => (i === index ? { ...l, amount: e.target.value } : l)))} />
                    <Button size="small" disabled={busy} onClick={() => setPreviewLines(previewLines.filter((_, i) => i !== index))}>{strings.REJECT}</Button>
                  </div>
                ))}
                {preview.unavailable.map((item) => (
                  <Typography key={`${item.kind}-${item.reason}`} variant="body2" color="text.secondary">{`${chargeTypeLabel(item.kind as bookcarsTypes.ContractChargeType)}: ${strings.UNAVAILABLE} — ${omissionLabel(item.reason)}`}</Typography>
                ))}
                <Button sx={{ mt: 1 }} disabled={busy || !previewLines.some((l) => l.include)} variant="contained" onClick={confirmSettlement}>{strings.CONFIRM_SETTLEMENT}</Button>
              </>
            )}
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle1" component="h3">{strings.DEPOSIT_SETTLEMENT}</Typography>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', marginTop: 8 }}>
              <TextField label={strings.DEPOSIT_HELD} type="number" value={deposit.held} onChange={(e) => setDeposit({ ...deposit, held: e.target.value })} />
              <TextField label={strings.DEPOSIT_KEPT} type="number" value={deposit.kept} onChange={(e) => setDeposit({ ...deposit, kept: e.target.value })} />
              <TextField label={strings.DEPOSIT_RETURNED} type="number" value={deposit.held !== '' ? Number(deposit.held) - Number(deposit.kept || 0) : ''} InputProps={{ readOnly: true }} />
              <TextField label={strings.DEPOSIT_METHOD} value={deposit.method} onChange={(e) => setDeposit({ ...deposit, method: e.target.value })} />
              <TextField label={strings.DEPOSIT_NOTE} value={deposit.note} onChange={(e) => setDeposit({ ...deposit, note: e.target.value })} />
            </div>
            <Divider sx={{ my: 1 }} />
            <Button variant="contained" disabled={busy} onClick={() => makeSnapshot(false)}>{strings.SNAPSHOT}</Button>
            <Button sx={{ ms: 1 }} variant="outlined" disabled={busy} onClick={() => makeSnapshot(true)}>{strings.SNAPSHOT_WITH_STAMP}</Button>
            {snapshot && <Button sx={{ ms: 1 }} disabled={busy} onClick={downloadSnapshot}>{strings.DOWNLOAD}</Button>}
            {whatsApp && <Button sx={{ ms: 1 }} variant="outlined" startIcon={<WhatsAppIcon />} disabled={busy || !waUrl} title={waUrl ? undefined : strings.WA_NO_PHONE} onClick={() => openWhatsApp(waUrl)}>{strings.WA_SEND}</Button>}
            <Button sx={{ ms: 1 }} variant="outlined" disabled={busy || loading || currentLifecycle !== bookcarsTypes.ContractLifecycle.ReturnReview} onClick={complete}>{strings.COMPLETE}</Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default ContractOperations
