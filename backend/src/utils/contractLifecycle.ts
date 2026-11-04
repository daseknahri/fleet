import * as bookcarsTypes from ':bookcars-types'

export const inspectionTransition = (
  lifecycle: bookcarsTypes.ContractLifecycle | undefined,
  type: bookcarsTypes.InspectionType,
  status?: bookcarsTypes.BookingStatus,
): bookcarsTypes.ContractLifecycle | null => {
  const current = lifecycle || bookcarsTypes.ContractLifecycle.Draft
  if (type === bookcarsTypes.InspectionType.Handover
    && (current === bookcarsTypes.ContractLifecycle.Draft || current === bookcarsTypes.ContractLifecycle.Confirmed)
    && (current !== bookcarsTypes.ContractLifecycle.Draft
      || !status
      || [
        bookcarsTypes.BookingStatus.Pending,
        bookcarsTypes.BookingStatus.Deposit,
        bookcarsTypes.BookingStatus.Paid,
        bookcarsTypes.BookingStatus.PaidInFull,
        bookcarsTypes.BookingStatus.Reserved,
      ].includes(status))) {
    return bookcarsTypes.ContractLifecycle.Active
  }
  if (type === bookcarsTypes.InspectionType.Return && current === bookcarsTypes.ContractLifecycle.Active) {
    return bookcarsTypes.ContractLifecycle.ReturnReview
  }
  return null
}

export const validateInspectionFields = (input: {
  occurredAt?: Date | string
  odometer?: unknown
  fuelLevel?: unknown
  condition?: unknown
  damageNote?: unknown
  photoFiles?: unknown
  signatureFile?: unknown
}) => {
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date()
  const odometer = input.odometer === undefined || input.odometer === null ? undefined : Number(input.odometer)
  const fuelLevel = input.fuelLevel === undefined || input.fuelLevel === null ? undefined : Number(input.fuelLevel)
  const condition = String(input.condition || '').trim()
  const damageNote = String(input.damageNote || '').trim()
  const photoFiles = Array.isArray(input.photoFiles) ? input.photoFiles.map((file) => String(file).trim()) : []
  const safePhoto = photoFiles.every((file) => file.length <= 200 && /^[A-Za-z0-9._-]+$/.test(file))
  const signatureFile = input.signatureFile === undefined || input.signatureFile === null ? undefined : String(input.signatureFile).trim()
  const safeSignature = signatureFile === undefined || (signatureFile.length <= 200 && /^[A-Za-z0-9._-]+$/.test(signatureFile))
  if (Number.isNaN(occurredAt.getTime())
    || (odometer !== undefined && (!Number.isFinite(odometer) || odometer < 0))
    || (fuelLevel !== undefined && (!Number.isFinite(fuelLevel) || fuelLevel < 0 || fuelLevel > 100))
    || condition.length > 4000 || damageNote.length > 4000 || !safePhoto || !safeSignature) {
return null
}
  return { occurredAt, odometer, fuelLevel, condition: condition || undefined, damageNote: damageNote || undefined, photoFiles, signatureFile }
}


