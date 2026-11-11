import React, { useEffect, useState } from 'react'
import { Button, Paper, TextField, Typography } from '@mui/material'
import * as bookcarsTypes from ':bookcars-types'
import { strings } from '@/lang/setting'
import { strings as commonStrings } from '@/lang/common'
import * as AgencyReturnSettingsService from '@/services/AgencyReturnSettingsService'
import * as helper from '@/utils/helper'

interface Props {
  supplierId: string
}

/**
 * GA-PAR-06: "Return & settlement rates" section. Home choice (recorded):
 * the UpdateSupplier (agency profile) page — that is the surface agency
 * owners actually use for agency-level settings (PAR-01 fiscal identity
 * lives there); the admin Settings page edits the GLOBAL Setting singleton
 * for platform admins only and must not be used for per-agency rates.
 * This form edits only the per-agency AgencyReturnSettings document.
 */
const ReturnSettingsForm = ({ supplierId }: Props) => {
  const [form, setForm] = useState({ includedKmPerDay: '', extraKmPrice: '', fuelPricePerLitre: '', washFee: '', defaultDeposit: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    AgencyReturnSettingsService.getAgencyReturnSettings(supplierId)
      .then((settings) => {
        if (!cancelled && settings) {
          setForm({
            includedKmPerDay: settings.includedKmPerDay?.toString() || '',
            extraKmPrice: settings.extraKmPrice?.toString() || '',
            fuelPricePerLitre: settings.fuelPricePerLitre?.toString() || '',
            washFee: settings.washFee?.toString() || '',
            defaultDeposit: settings.defaultDeposit?.toString() || '',
          })
        }
      })
      .catch(() => { /* empty settings are a valid state */ })
    return () => { cancelled = true }
  }, [supplierId])

  const save = async () => {
    setBusy(true)
    try {
      const num = (value: string) => (value.trim() === '' ? null : Number(value))
      const payload: bookcarsTypes.UpdateAgencyReturnSettingsPayload = {
        includedKmPerDay: num(form.includedKmPerDay),
        extraKmPrice: num(form.extraKmPrice),
        fuelPricePerLitre: num(form.fuelPricePerLitre),
        washFee: num(form.washFee),
        defaultDeposit: num(form.defaultDeposit),
      }
      const res = await AgencyReturnSettingsService.updateAgencyReturnSettings(payload, supplierId)
      if (res.status === 200) {
        helper.info(strings.RETURN_SETTINGS_SAVED)
      } else {
        helper.error()
      }
    } catch (err) {
      helper.error(err)
    } finally {
      setBusy(false)
    }
  }

  const field = (label: string, key: keyof typeof form) => (
    <TextField
      label={label}
      type="number"
      value={form[key]}
      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      inputProps={{ min: 0 }}
    />
  )

  return (
    <Paper className="supplier-form-update" elevation={10} sx={{ mt: 2, p: 2 }}>
      <Typography variant="h6" component="h2">{strings.RETURN_SETTINGS}</Typography>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginTop: 8 }}>
        {field(strings.INCLUDED_KM_PER_DAY, 'includedKmPerDay')}
        {field(strings.EXTRA_KM_PRICE, 'extraKmPrice')}
        {field(strings.FUEL_PRICE_PER_LITRE, 'fuelPricePerLitre')}
        {field(strings.WASH_FEE, 'washFee')}
        {field(strings.DEFAULT_DEPOSIT, 'defaultDeposit')}
      </div>
      <Button sx={{ mt: 1 }} variant="contained" size="small" disabled={busy} onClick={save}>{commonStrings.SAVE}</Button>
    </Paper>
  )
}

export default ReturnSettingsForm
