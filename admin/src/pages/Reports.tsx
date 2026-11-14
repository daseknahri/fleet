import React, { useCallback, useId, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Checkbox, CircularProgress, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import Layout from '@/components/Layout'
import * as ReportService from '@/services/ReportService'
import * as UserService from '@/services/UserService'
import * as SupplierService from '@/services/SupplierService'
import * as CarService from '@/services/CarService'
import * as helper from '@/utils/helper'
import * as bookcarsTypes from ':bookcars-types'
import strings from '@/lang/reports'
import env from '@/config/env.config'
import { useUserContext, UserContextType } from '@/context/UserContext'

type Preset = 'month' | '7' | '14' | '28' | 'custom'

const dayIso = (d: Date) => d.toISOString().slice(0, 10)
const rangeForPreset = (preset: Preset, customFrom: string, customTo: string) => {
  const now = new Date()
  if (preset === 'month') {
    return { from: dayIso(new Date(now.getFullYear(), now.getMonth(), 1)), to: dayIso(now) }
  }
  if (preset === 'custom') {
    return { from: customFrom, to: customTo }
  }
  const days = Number(preset)
  const start = new Date(now)
  start.setDate(start.getDate() - (days - 1))
  return { from: dayIso(start), to: dayIso(now) }
}

const Reports = () => {
  const { user } = useUserContext() as UserContextType
  const [from, setFrom] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10))
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [report, setReport] = useState<ReportService.ReportSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const agencyLabelId = useId()
  const carLabelId = useId()
  const groupLabelId = useId()
  const scopeLabelId = useId()
  const presetLabelId = useId()
  const [error, setError] = useState(false)
  const [suppliers, setSuppliers] = useState<bookcarsTypes.User[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [effectiveSupplier, setEffectiveSupplier] = useState('')

  // GA-PAR-14 — builder state
  const [preset, setPreset] = useState<Preset>('month')
  const [customFrom, setCustomFrom] = useState(from)
  const [customTo, setCustomTo] = useState(to)
  const [cars, setCars] = useState<bookcarsTypes.Car[]>([])
  const [carId, setCarId] = useState('')
  const [groupBy, setGroupBy] = useState<bookcarsTypes.ReportGroupBy>(bookcarsTypes.ReportGroupBy.Car)
  const [scope, setScope] = useState<bookcarsTypes.ReportScope>(bookcarsTypes.ReportScope.All)
  const [compare, setCompare] = useState(false)
  const [builderResult, setBuilderResult] = useState<bookcarsTypes.ReportBuilderResult | null>(null)
  const [builderLoading, setBuilderLoading] = useState(false)
  const [builderError, setBuilderError] = useState(false)
  const [expandedKey, setExpandedKey] = useState('')
  const [drill, setDrill] = useState<bookcarsTypes.ReportDrilldownResult | null>(null)
  const [views, setViews] = useState<bookcarsTypes.ReportView[]>([])
  const [viewName, setViewName] = useState('')
  const [viewSaved, setViewSaved] = useState(false)

  const runBuilder = useCallback(async (supplier: string, overrides?: Partial<{ preset: Preset, customFrom: string, customTo: string, carId: string, groupBy: bookcarsTypes.ReportGroupBy, compare: boolean, scope: bookcarsTypes.ReportScope }>) => {
    if (!supplier) {
      return
    }
    const p = overrides?.preset ?? preset
    const range = rangeForPreset(p, overrides?.customFrom ?? customFrom, overrides?.customTo ?? customTo)
    if (!range.from || !range.to) {
      return
    }
    setBuilderLoading(true)
    setBuilderError(false)
    setExpandedKey('')
    setDrill(null)
    try {
      const result = await ReportService.builder({
        from: range.from,
        to: range.to,
        groupBy: overrides?.groupBy ?? groupBy,
        carId: (overrides?.carId ?? carId) || undefined,
        compare: overrides?.compare ?? compare,
        scope: overrides?.scope ?? scope,
        supplier,
      })
      setBuilderResult(result)
    } catch {
      setBuilderError(true)
    } finally {
      setBuilderLoading(false)
    }
  }, [preset, customFrom, customTo, groupBy, carId, compare, scope])

  const loadViews = useCallback(async (supplier: string) => {
    try {
      setViews(await ReportService.listViews(supplier || undefined))
    } catch {
      setViews([])
    }
  }, [])

  const load = useCallback(async (u?: bookcarsTypes.User) => {
    if (!u) {
      return
    }
    setLoading(true)
    setError(false)
    try {
      let selectedSupplier = supplierId
      if (helper.admin(u)) {
        const available = await SupplierService.getAllSuppliers()
        setSuppliers(available)
        selectedSupplier = selectedSupplier || available[0]?._id || ''
        setSupplierId(selectedSupplier)
      } else {
        selectedSupplier = u._id || ''
      }
      setEffectiveSupplier(selectedSupplier)
      if (!selectedSupplier) {
        setReport(null)
        return
      }
      setReport(await ReportService.summary(from, to, selectedSupplier))
      try {
        const carResult = await CarService.getCars('', { suppliers: [selectedSupplier], includeAlreadyBookedCars: true, includeComingSoonCars: true }, 1, 1000)
        setCars(carResult?.[0]?.resultData || [])
      } catch {
        setCars([])
      }
      void loadViews(selectedSupplier)
      void runBuilder(selectedSupplier)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [from, to, supplierId, loadViews, runBuilder])

  const exportReport = async () => {
    try {
      const blob = await ReportService.exportCsv(from, to, supplierId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'gestion-auto-report.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError(true)
    }
  }

  const exportBuilder = async () => {
    const range = rangeForPreset(preset, customFrom, customTo)
    try {
      const blob = await ReportService.builderCsv({ from: range.from, to: range.to, groupBy, carId: carId || undefined, compare, scope, supplier: effectiveSupplier || undefined })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'gestion-auto-report-builder.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setBuilderError(true)
    }
  }

  const downloadCarPdf = async (row: bookcarsTypes.ReportBuilderRow) => {
    const range = rangeForPreset(preset, customFrom, customTo)
    const targetCarId = row.carId || row.key
    try {
      const blob = await ReportService.carPdf(targetCarId, range.from, range.to, effectiveSupplier || undefined)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `gestion-auto-car-report-${targetCarId}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setBuilderError(true)
    }
  }

  const toggleDrill = async (row: bookcarsTypes.ReportBuilderRow) => {
    if (expandedKey === row.key) {
      setExpandedKey('')
      setDrill(null)
      return
    }
    setExpandedKey(row.key)
    setDrill(null)
    const range = rangeForPreset(preset, customFrom, customTo)
    try {
      setDrill(await ReportService.drilldown({
        from: range.from, to: range.to, groupBy, carId: carId || undefined, compare, supplier: effectiveSupplier || undefined, bucket: row.key,
      }))
    } catch {
      setBuilderError(true)
    }
  }

  const saveView = async () => {
    if (!viewName.trim()) {
      return
    }
    const range = rangeForPreset(preset, customFrom, customTo)
    try {
      await ReportService.createView({
        supplier: effectiveSupplier || undefined,
        name: viewName.trim(),
        config: {
          periodPreset: preset, from: range.from, to: range.to, carId: carId || undefined, groupBy, compare,
        },
      })
      setViewName('')
      setViewSaved(true)
      void loadViews(effectiveSupplier)
    } catch {
      setBuilderError(true)
    }
  }

  const applyView = (view: bookcarsTypes.ReportView) => {
    const cfg = view.config
    const nextPreset = (cfg.periodPreset as Preset) || 'custom'
    const nextFrom = cfg.from || customFrom
    const nextTo = cfg.to || customTo
    setPreset(nextPreset)
    setCustomFrom(nextFrom)
    setCustomTo(nextTo)
    setCarId(cfg.carId || '')
    setGroupBy(cfg.groupBy)
    setCompare(!!cfg.compare)
    setScope(bookcarsTypes.ReportScope.All)
    void runBuilder(effectiveSupplier, {
      preset: nextPreset, customFrom: nextFrom, customTo: nextTo, carId: cfg.carId || '', groupBy: cfg.groupBy, compare: !!cfg.compare, scope: bookcarsTypes.ReportScope.All,
    })
  }

  const deleteView = async (view: bookcarsTypes.ReportView) => {
    if (!view._id) {
      return
    }
    try {
      await ReportService.deleteView(view._id, effectiveSupplier || undefined)
      void loadViews(effectiveSupplier)
    } catch {
      setBuilderError(true)
    }
  }

  const lang = UserService.getLanguage()
  strings.setLanguage(lang === 'ar' ? 'ar' : lang === 'fr' ? 'fr' : lang === 'es' ? 'es' : 'en')
  const value = (key: string) => report?.metrics[key] || 0
  const money = (n: number) => `${new Intl.NumberFormat(lang === 'ar' ? 'ar-MA' : lang === 'fr' ? 'fr-MA' : lang === 'es' ? 'es-ES' : 'en-GB', { maximumFractionDigits: 2 }).format(n)} ${report?.currency || env.CURRENCY}`
  const bMoney = (n: number) => `${new Intl.NumberFormat(lang === 'ar' ? 'ar-MA' : lang === 'fr' ? 'fr-MA' : lang === 'es' ? 'es-ES' : 'en-GB', { maximumFractionDigits: 2 }).format(n)} ${builderResult?.currency || env.CURRENCY}`
  const cards = [['revenueCollected', strings.REVENUE], ['depositsCollected', strings.DEPOSITS], ['receivable', strings.RECEIVABLE], ['expenses', strings.EXPENSES], ['estimatedMargin', strings.MARGIN]]
  const carName = (id?: string) => {
    const car = cars.find((c) => c._id === id)
    return car ? (car.licensePlate ? `${car.name} · ${car.licensePlate}` : car.name) : (id || '')
  }
  const groupOptions: Array<{ v: bookcarsTypes.ReportGroupBy, label: string }> = [
    { v: bookcarsTypes.ReportGroupBy.Day, label: strings.GROUP_DAY },
    { v: bookcarsTypes.ReportGroupBy.Week, label: strings.GROUP_WEEK },
    { v: bookcarsTypes.ReportGroupBy.Month, label: strings.GROUP_MONTH },
    { v: bookcarsTypes.ReportGroupBy.Car, label: strings.GROUP_CAR },
  ]
  const scopeOptions: Array<{ v: bookcarsTypes.ReportScope, label: string }> = [
    { v: bookcarsTypes.ReportScope.All, label: strings.SCOPE_ALL },
    { v: bookcarsTypes.ReportScope.Cash, label: strings.SCOPE_CASH },
    { v: bookcarsTypes.ReportScope.Bank, label: strings.SCOPE_BANK },
  ]
  return (
    <Layout strict onLoad={load}>
      <div className="agency-dashboard">
        <Box className="agency-dashboard__heading">
          <div>
            <Typography component="h1" className="agency-dashboard__title">{strings.TITLE}</Typography>
            <Typography>{strings.SUBTITLE}</Typography>
          </div>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {helper.admin(user) && (
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel id={agencyLabelId}>{strings.AGENCY}</InputLabel>
                <Select label={strings.AGENCY} labelId={agencyLabelId} value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setReport(null) }}>
                  {suppliers.map((supplier) => <MenuItem key={supplier._id} value={supplier._id}>{supplier.fullName}</MenuItem>)}
                </Select>
              </FormControl>
            )}
            <TextField size="small" type="date" label={strings.FROM} value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
            <TextField size="small" type="date" label={strings.TO} value={to} onChange={(e) => setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
            <Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={() => load(user || undefined)}>{strings.REFRESH}</Button>
            <Button variant="contained" startIcon={<DownloadRoundedIcon />} onClick={exportReport} disabled={!report}>{strings.EXPORT}</Button>
          </Box>
        </Box>
        {error && <Alert severity="error">{strings.ERROR}</Alert>}
        {loading ? (
          <Box sx={{ p: 5, textAlign: 'center' }}><CircularProgress /><Typography>{strings.LOADING}</Typography></Box>
        ) : !report ? <Typography sx={{ p: 3 }}>{strings.EMPTY}</Typography> : (
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {cards.map(([key, label]) => (
              <Box sx={{ flex: '1 1 220px', minWidth: 220 }} key={key}>
                <Card><CardContent><Typography color="text.secondary">{label}</Typography><Typography variant="h5" component="h2">{money(value(key))}</Typography></CardContent></Card>
              </Box>
            ))}
            <Box sx={{ flex: '1 1 220px', minWidth: 220 }}>
              <Card><CardContent><Typography color="text.secondary">{strings.UTILIZATION}</Typography><Typography variant="h5" component="h2">{value('utilizationPercent').toFixed(2)}%</Typography></CardContent></Card>
            </Box>
            <Box sx={{ width: '100%' }}>
              <Typography>{strings.CONTRACTS}: {value('contracts')} · {strings.INVOICES}: {value('invoiceCount')} · {report.timezone} · v{report.metricDictionaryVersion}</Typography>
            </Box>
          </Box>
        )}

        {/* GA-PAR-14 — reports builder */}
        <Box sx={{ mt: 4 }}>
          <Typography component="h2" variant="h6">{strings.BUILDER_TITLE}</Typography>
          <Typography>{strings.BUILDER_SUBTITLE}</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 2, alignItems: 'center' }}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id={presetLabelId}>{strings.BUILDER_TITLE}</InputLabel>
              <Select labelId={presetLabelId} label={strings.BUILDER_TITLE} value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
                <MenuItem value="month">{strings.PRESET_MONTH}</MenuItem>
                <MenuItem value="7">{strings.PRESET_7}</MenuItem>
                <MenuItem value="14">{strings.PRESET_14}</MenuItem>
                <MenuItem value="28">{strings.PRESET_28}</MenuItem>
                <MenuItem value="custom">{strings.PRESET_CUSTOM}</MenuItem>
              </Select>
            </FormControl>
            {preset === 'custom' && (
              <>
                <TextField size="small" type="date" label={strings.FROM} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
                <TextField size="small" type="date" label={strings.TO} value={customTo} onChange={(e) => setCustomTo(e.target.value)} InputLabelProps={{ shrink: true }} />
              </>
            )}
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel id={carLabelId}>{strings.CAR_SCOPE}</InputLabel>
              <Select labelId={carLabelId} label={strings.CAR_SCOPE} value={carId} onChange={(e) => setCarId(e.target.value)}>
                <MenuItem value="">{strings.ALL_CARS}</MenuItem>
                {cars.map((car) => <MenuItem key={car._id} value={car._id}>{car.licensePlate ? `${car.name} · ${car.licensePlate}` : car.name}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel id={groupLabelId}>{strings.GROUP_BY}</InputLabel>
              <Select labelId={groupLabelId} label={strings.GROUP_BY} value={groupBy} onChange={(e) => setGroupBy(e.target.value as bookcarsTypes.ReportGroupBy)}>
                {groupOptions.map((o) => <MenuItem key={o.v} value={o.v}>{o.label}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel id={scopeLabelId}>{strings.SCOPE}</InputLabel>
              <Select labelId={scopeLabelId} label={strings.SCOPE} value={scope} onChange={(e) => setScope(e.target.value as bookcarsTypes.ReportScope)}>
                {scopeOptions.map((o) => <MenuItem key={o.v} value={o.v}>{o.label}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControlLabel control={<Checkbox checked={compare} onChange={(e) => setCompare(e.target.checked)} />} label={strings.COMPARE} />
            <Button variant="contained" onClick={() => runBuilder(effectiveSupplier)}>{strings.RUN_BUILDER}</Button>
            <Button variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={exportBuilder} disabled={!builderResult}>{strings.EXPORT_BUILDER}</Button>
          </Box>

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 2, alignItems: 'center' }}>
            <Typography variant="subtitle1">{strings.SAVED_VIEWS}</Typography>
            <TextField size="small" label={strings.VIEW_NAME} value={viewName} onChange={(e) => { setViewName(e.target.value); setViewSaved(false) }} />
            <Button variant="outlined" onClick={saveView} disabled={!viewName.trim()}>{strings.SAVE_VIEW}</Button>
            {viewSaved && <Typography>{strings.VIEW_SAVED}</Typography>}
            {views.length === 0 ? <Typography>{strings.NO_VIEWS}</Typography> : views.map((view) => (
              <Box key={view._id} sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                <Typography>{view.name}</Typography>
                <Button size="small" onClick={() => applyView(view)}>{strings.APPLY_VIEW}</Button>
                <Button size="small" color="error" onClick={() => deleteView(view)}>{strings.DELETE_VIEW}</Button>
              </Box>
            ))}
          </Box>

          {builderError && <Alert severity="error" sx={{ mt: 2 }}>{strings.BUILDER_ERROR}</Alert>}
          {builderLoading ? (
            <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /><Typography>{strings.LOADING}</Typography></Box>
          ) : !builderResult ? <Typography sx={{ p: 2 }}>{strings.BUILDER_EMPTY}</Typography> : (
            <Table size="small" sx={{ mt: 2 }}>
              <TableHead>
                <TableRow>
                  <TableCell>{strings.COL_KEY}</TableCell>
                  <TableCell align="right">{strings.COL_AMOUNT}</TableCell>
                  <TableCell align="right">{strings.COL_COLLECTED}</TableCell>
                  <TableCell align="right">{strings.COL_REMAINING}</TableCell>
                  <TableCell align="right">{strings.COL_EXPENSES}</TableCell>
                  <TableCell align="right">{strings.COL_NET}</TableCell>
                  <TableCell align="right">{strings.COL_BOOKINGS}</TableCell>
                  <TableCell align="right">{strings.COL_OCCUPANCY}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {builderResult.rows.map((row) => (
                  <React.Fragment key={row.key}>
                    <TableRow hover onClick={() => toggleDrill(row)} sx={{ cursor: 'pointer' }}>
                      <TableCell>{builderResult.groupBy === bookcarsTypes.ReportGroupBy.Car ? carName(row.key) : row.key}{builderResult.groupBy === bookcarsTypes.ReportGroupBy.Car && (
                        <Button size="small" sx={{ ms: 1 }} onClick={(e) => { e.stopPropagation(); void downloadCarPdf(row) }}>{strings.CAR_PDF}</Button>
                      )}</TableCell>
                      <TableCell align="right">{bMoney(row.contractAmount)}</TableCell>
                      <TableCell align="right">{bMoney(row.collected)}</TableCell>
                      <TableCell align="right">{bMoney(row.remaining)}</TableCell>
                      <TableCell align="right">{bMoney(row.expenses)}</TableCell>
                      <TableCell align="right">{bMoney(row.net)}</TableCell>
                      <TableCell align="right">{row.bookingsCount}</TableCell>
                      <TableCell align="right">{row.occupancyPct !== undefined ? `${row.occupancyPct.toFixed(2)}%` : '—'}</TableCell>
                    </TableRow>
                    {expandedKey === row.key && (
                      <TableRow>
                        <TableCell colSpan={8}>
                          {!drill ? <CircularProgress size={18} /> : (
                            <Box>
                              <Typography>
                                {strings.DRILL_BOOKINGS}: {drill.bookings.map((b) => `${b.reference || b.id.slice(-8)} (${bMoney(b.contractAmount)} / ${bMoney(b.collected)} / ${bMoney(b.remaining)})`).join(' · ') || strings.DRILL_EMPTY}
                              </Typography>
                              <Typography>
                                {strings.DRILL_PAYMENTS}: {drill.payments.map((p) => `${p.id.slice(-8)} (${bMoney(p.amount)})`).join(' · ') || strings.DRILL_EMPTY}
                              </Typography>
                              <Typography>
                                {strings.DRILL_EXPENSES}: {drill.expenses.map((e) => `${e.id.slice(-8)} (${bMoney(e.amount)})`).join(' · ') || strings.DRILL_EMPTY}
                              </Typography>
                            </Box>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
                <TableRow>
                  <TableCell><strong>{strings.TOTAL}</strong></TableCell>
                  <TableCell align="right"><strong>{bMoney(builderResult.totals.contractAmount)}</strong></TableCell>
                  <TableCell align="right"><strong>{bMoney(builderResult.totals.collected)}</strong></TableCell>
                  <TableCell align="right"><strong>{bMoney(builderResult.totals.remaining)}</strong></TableCell>
                  <TableCell align="right"><strong>{bMoney(builderResult.totals.expenses)}</strong></TableCell>
                  <TableCell align="right"><strong>{bMoney(builderResult.totals.net)}</strong></TableCell>
                  <TableCell align="right"><strong>{builderResult.totals.bookingsCount}</strong></TableCell>
                  <TableCell align="right"><strong>{builderResult.totals.occupancyPct !== undefined ? `${builderResult.totals.occupancyPct.toFixed(2)}%` : '—'}</strong></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
          {builderResult?.comparison && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle1">{strings.PREVIOUS}: {builderResult.comparison.previousFrom.slice(0, 10)} → {builderResult.comparison.previousTo.slice(0, 10)}</Typography>
              {Object.entries(builderResult.comparison.deltas).map(([metric, d]) => (
                <Typography key={metric}>
                  {metric}: {strings.PREVIOUS} {metric === 'bookingsCount' ? String(d.previous) : bMoney(d.previous)} · {strings.DELTA} {metric === 'bookingsCount' ? String(d.delta) : bMoney(d.delta)}{d.deltaPct !== null ? ` (${d.deltaPct.toFixed(2)}%)` : ''}
                </Typography>
              ))}
            </Box>
          )}
        </Box>
      </div>
    </Layout>
  )
}
export default Reports
