import React, { useState } from 'react'
import { FormControl, Input, InputLabel, Paper } from '@mui/material'
import * as bookcarsTypes from ':bookcars-types'
import * as helper from '@/utils/helper'
import * as BankDetailsService from '@/services/BankDetailsService'
import { strings } from '@/lang/bank-details-form'
import Layout from '@/components/Layout'
import NoMatch from './NoMatch'

import '@/assets/css/bank-details.css'

const BankDetails = () => {
  const [bankDetails, setBankDetails] = useState<bookcarsTypes.BankDetails | null>(null)
  const [noMatch, setNoMatch] = useState(false)

  const onLoad = async () => {
    try {
      const _bankDetails = await BankDetailsService.getBankDetails()
      setBankDetails(_bankDetails)
      if (!_bankDetails?.showBankDetailsPage) {
        setNoMatch(true)
      }
    } catch (err) {
      helper.error(err)
    }
  }

  return (
    <Layout onLoad={onLoad} strict>
      <div className="bank-details">

        {bankDetails && !noMatch && (
          <Paper className="bank-details-form bank-details-form-wrapper" elevation={10}>
            <h1 className="bank-details-form-title">{strings.BANK_DETAILS}</h1>

            <FormControl fullWidth margin="dense">
              <InputLabel htmlFor="bankDetails-accountHolder">{strings.ACCOUNT_HOLDER}</InputLabel>
              <Input id="bankDetails-accountHolder" type="text" readOnly autoComplete="off" value={bankDetails.accountHolder} />
            </FormControl>

            <FormControl fullWidth margin="dense">
              <InputLabel htmlFor="bankDetails-bankName">{strings.BANK_NAME}</InputLabel>
              <Input id="bankDetails-bankName" type="text" readOnly autoComplete="off" value={bankDetails.bankName} />
            </FormControl>

            <FormControl fullWidth margin="dense">
              <InputLabel htmlFor="bankDetails-iban">{strings.IBAN}</InputLabel>
              <Input id="bankDetails-iban" type="text" readOnly autoComplete="off" value={bankDetails.iban} />
            </FormControl>

            <FormControl fullWidth margin="dense">
              <InputLabel htmlFor="bankDetails-swiftBic">{strings.SWIFT_BIC}</InputLabel>
              <Input id="bankDetails-swiftBic" type="text" readOnly autoComplete="off" value={bankDetails.swiftBic} />
            </FormControl>

          </Paper>
        )}
      </div>

      {noMatch && <NoMatch hideHeader />}
    </Layout>
  )
}

export default BankDetails
