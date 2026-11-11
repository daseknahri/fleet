import * as bookcarsTypes from ':bookcars-types'
import axiosInstance from './axiosInstance'

// GA-PAR-15 — Excel imports API (scorecard #5). Every endpoint is gated
// server-side by the entity's create permission (ManageFleet /
// ManageClients / ManageBookings; GA-PAR-16: expenses → ManageExpenses,
// mirroring expense creation exactly); the supplier query parameter carries
// the agency selector for staff accounts, exactly like the reminders
// service.

export type ImportEntityName = 'cars' | 'clients' | 'bookings' | 'expenses'

export const downloadTemplate = async (entity: ImportEntityName, supplier?: string): Promise<number> => {
  const res = await axiosInstance.get(`/api/imports/${entity}/template`, {
    withCredentials: true,
    responseType: 'blob',
    params: supplier ? { supplier } : undefined,
  })
  const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `bookcars-import-${entity}-template.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
  return res.status
}

export const importFile = (
  entity: ImportEntityName,
  file: File,
  dryRun: boolean,
  supplier?: string,
): Promise<bookcarsTypes.ImportReport> => {
  const form = new FormData()
  form.append('file', file)
  form.append('dryRun', dryRun ? 'true' : 'false')
  if (supplier) {
    form.append('supplier', supplier)
  }
  return axiosInstance
    .post(`/api/imports/${entity}`, form, { withCredentials: true, params: supplier ? { supplier } : undefined })
    .then((res) => res.data)
}
