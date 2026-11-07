import React, { useCallback, useId, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, CircularProgress, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import Layout from '@/components/Layout'
import * as ReportService from '@/services/ReportService'
import * as UserService from '@/services/UserService'
import * as SupplierService from '@/services/SupplierService'
import * as helper from '@/utils/helper'
import * as bookcarsTypes from ':bookcars-types'
import strings from '@/lang/reports'
import env from '@/config/env.config'
import { useUserContext, UserContextType } from '@/context/UserContext'

const Reports = () => {
  const { user } = useUserContext() as UserContextType
  const [from, setFrom] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10))
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [report, setReport] = useState<ReportService.ReportSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const agencyLabelId = useId()
  const [error, setError] = useState(false)
  const [suppliers, setSuppliers] = useState<bookcarsTypes.User[]>([])
  const [supplierId, setSupplierId] = useState('')
  const load = useCallback(async (user?: bookcarsTypes.User) => {
    if (!user) {
return
}
    setLoading(true); setError(false)
    try {
      let selectedSupplier = supplierId
      if (helper.admin(user)) {
        const available = await SupplierService.getAllSuppliers()
        setSuppliers(available)
        selectedSupplier = selectedSupplier || available[0]?._id || ''
        setSupplierId(selectedSupplier)
      } else {
        selectedSupplier = user._id || ''
      }
      if (!selectedSupplier) {
        setReport(null)
        return
      }
      setReport(await ReportService.summary(from, to, selectedSupplier))
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [from, to, supplierId])
  const exportReport = async () => {
    try {
 const blob = await ReportService.exportCsv(from, to, supplierId); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'gestion-auto-report.csv'; a.click(); URL.revokeObjectURL(url) 
} catch {
 setError(true) 
}
  }
  const lang = UserService.getLanguage(); strings.setLanguage(lang === 'ar' ? 'ar' : lang === 'fr' ? 'fr' : lang === 'es' ? 'es' : 'en')
  const value = (key: string) => report?.metrics[key] || 0
  const money = (n: number) => `${new Intl.NumberFormat(lang === 'ar' ? 'ar-MA' : lang === 'fr' ? 'fr-MA' : lang === 'es' ? 'es-ES' : 'en-GB', { maximumFractionDigits: 2 }).format(n)} ${report?.currency || env.CURRENCY}`
  const cards = [['revenueCollected', strings.REVENUE], ['depositsCollected', strings.DEPOSITS], ['receivable', strings.RECEIVABLE], ['expenses', strings.EXPENSES], ['estimatedMargin', strings.MARGIN]]
  return <Layout strict onLoad={load}><div className="agency-dashboard">
    <Box className="agency-dashboard__heading"><div><Typography component="h1" className="agency-dashboard__title">{strings.TITLE}</Typography><Typography>{strings.SUBTITLE}</Typography></div><Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>{helper.admin(user) && <FormControl size="small" sx={{ minWidth: 220 }}><InputLabel id={agencyLabelId}>{strings.AGENCY}</InputLabel><Select label={strings.AGENCY} labelId={agencyLabelId} value={supplierId} onChange={e => {
 setSupplierId(e.target.value); setReport(null) 
}}>{suppliers.map(supplier => <MenuItem key={supplier._id} value={supplier._id}>{supplier.fullName}</MenuItem>)}</Select></FormControl>}<TextField size="small" type="date" label={strings.FROM} value={from} onChange={e => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} /><TextField size="small" type="date" label={strings.TO} value={to} onChange={e => setTo(e.target.value)} InputLabelProps={{ shrink: true }} /><Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={() => load(user || undefined)}>{strings.REFRESH}</Button><Button variant="contained" startIcon={<DownloadRoundedIcon />} onClick={exportReport} disabled={!report}>{strings.EXPORT}</Button></Box></Box>
    {error && <Alert severity="error">{strings.ERROR}</Alert>}
    {loading ? <Box sx={{ p: 5, textAlign: 'center' }}><CircularProgress /><Typography>{strings.LOADING}</Typography></Box> : !report ? <Typography sx={{ p: 3 }}>{strings.EMPTY}</Typography> : <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
      {cards.map(([key, label]) => <Box sx={{ flex: '1 1 220px', minWidth: 220 }} key={key}><Card><CardContent><Typography color="text.secondary">{label}</Typography><Typography variant="h5" component="h2">{money(value(key))}</Typography></CardContent></Card></Box>)}
      <Box sx={{ flex: '1 1 220px', minWidth: 220 }}><Card><CardContent><Typography color="text.secondary">{strings.UTILIZATION}</Typography><Typography variant="h5" component="h2">{value('utilizationPercent').toFixed(2)}%</Typography></CardContent></Card></Box>
      <Box sx={{ width: '100%' }}><Typography>{strings.CONTRACTS}: {value('contracts')} · {strings.INVOICES}: {value('invoiceCount')} · {report.timezone} · v{report.metricDictionaryVersion}</Typography></Box>
    </Box>}
  </div></Layout>
}
export default Reports

