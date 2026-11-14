import React, { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Input,
  InputLabel,
  FormControl,
  FormHelperText,
  Button,
  Paper,
  FormControlLabel,
  Switch
} from '@mui/material'
import { Info as InfoIcon } from '@mui/icons-material'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import Layout from '@/components/Layout'
import env from '@/config/env.config'
import { strings as commonStrings } from '@/lang/common'
import { strings as csStrings } from '@/lang/create-supplier'
import { visuallyHidden } from '@mui/utils'
import * as SupplierService from '@/services/SupplierService'
import * as UserService from '@/services/UserService'
import * as helper from '@/utils/helper'
import Error from '@/components/Error'
import Backdrop from '@/components/SimpleBackdrop'
import NoMatch from './NoMatch'
import Avatar from '@/components/Avatar'
import ContractList from '@/components/ContractList'
import ReturnSettingsForm from '@/components/ReturnSettingsForm'
import { schema, FormFields } from '@/models/SupplierForm'

import '@/assets/css/update-supplier.css'

const UpdateSupplier = () => {
  const navigate = useNavigate()

  const [user, setUser] = useState<bookcarsTypes.User>()
  const [supplier, setSupplier] = useState<bookcarsTypes.User>()
  const [submitError, setSubmitError] = useState(false)
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const [noMatch, setNoMatch] = useState(false)
  const [avatar, setAvatar] = useState('')
  const [avatarError, setAvatarError] = useState(false)
  // GA-PAR-14: agency stamp image for the contract snapshot PDF.
  const [stampFile, setStampFile] = useState('')
  const [stampUrl, setStampUrl] = useState('')
  const [stampBusy, setStampBusy] = useState(false)
  const stampInput = useRef<HTMLInputElement>(null)

  const {
    control,
    register,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    setFocus,
    formState: { errors, isSubmitting },
    trigger,
  } = useForm<FormFields>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: {
      fullName: '',
      email: '',
      phone: '',
      location: '',
      bio: '',
      blacklisted: false,
      payLater: false,
      licenseRequired: false,
      minimumRentalDays: '',
      priceChangeRate: '',
      supplierCarLimit: '',
      notifyAdminOnNewCar: false,
      ice: '',
      registreCommerce: '',
      identifiantFiscal: '',
      patente: '',
      rib: '',
      fiscalAddress: '',
      city: '',
      vatEnabled: false,
      vatRate: '',
    },
  })

  const payLater = useWatch({ control, name: 'payLater' })
  const licenseRequired = useWatch({ control, name: 'licenseRequired' })
  const notifyAdminOnNewCar = useWatch({ control, name: 'notifyAdminOnNewCar' })
  const blacklisted = useWatch({ control, name: 'blacklisted' })
  const vatEnabled = useWatch({ control, name: 'vatEnabled' })

  const onBeforeUpload = () => {
    setLoading(true)
  }

  const onAvatarChange = (_avatar: string) => {
    if (supplier && user) {
      const _supplier = bookcarsHelper.clone(supplier)
      _supplier.avatar = _avatar

      if (user._id === supplier._id) {
        const _user = bookcarsHelper.clone(user)
        _user.avatar = _avatar
        setUser(_user)
      }

      setLoading(false)
      setSupplier(_supplier)

      if (_avatar) {
        setAvatarError(false)
      }
    } else {
      helper.error()
    }
  }

  const onStampUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !supplier) {
      return
    }
    setStampBusy(true)
    try {
      const filename = await SupplierService.uploadStamp(supplier._id as string, file)
      setStampFile(filename)
      const _supplier = bookcarsHelper.clone(supplier)
      _supplier.stampFile = filename
      setSupplier(_supplier)
      const url = await SupplierService.fetchStampUrl(supplier._id as string)
      setStampUrl(url)
      helper.info(commonStrings.UPDATED)
    } catch (err) {
      helper.error(err)
    } finally {
      setStampBusy(false)
    }
  }

  const onStampRemove = async () => {
    if (!supplier) {
      return
    }
    setStampBusy(true)
    try {
      const status = await SupplierService.deleteStamp(supplier._id as string)
      if (status === 200) {
        setStampFile('')
        setStampUrl('')
        const _supplier = bookcarsHelper.clone(supplier)
        _supplier.stampFile = undefined
        setSupplier(_supplier)
        helper.info(commonStrings.UPDATED)
      } else {
        helper.error()
      }
    } catch (err) {
      helper.error(err)
    } finally {
      setStampBusy(false)
    }
  }

  const handleResendActivationLink = async () => {
    if (supplier) {
      try {
        const status = await UserService.resend(supplier.email, false, env.APP_TYPE)

        if (status === 200) {
          helper.info(commonStrings.ACTIVATION_EMAIL_SENT)
        } else {
          helper.error()
        }
      } catch (err) {
        helper.error(err)
      }
    }
  }

  const onLoad = async (_user?: bookcarsTypes.User) => {
    if (_user && _user.verified) {
      setLoading(true)
      setUser(_user)

      const params = new URLSearchParams(window.location.search)
      if (params.has('c')) {
        const id = params.get('c')
        if (id && id !== '') {
          try {
            const _supplier = await SupplierService.getSupplier(id)

            if (_supplier) {
              if (!(_user.type === bookcarsTypes.UserType.Admin || _user._id === _supplier._id)) {
                setLoading(false)
                setNoMatch(true)
                return
              }

              setSupplier(_supplier)
              setValue('email', _supplier.email || '')
              setAvatar(_supplier.avatar || '')
              setValue('fullName', _supplier.fullName || '')
              setValue('phone', _supplier.phone || '')
              setValue('location', _supplier.location || '')
              setValue('bio', _supplier.bio || '')
              setValue('payLater', !!_supplier.payLater)
              setValue('licenseRequired', !!_supplier.licenseRequired)
              setValue('minimumRentalDays', _supplier.minimumRentalDays?.toString() || '')
              setValue('priceChangeRate', _supplier.priceChangeRate?.toString() || '')
              setValue('supplierCarLimit', _supplier.supplierCarLimit?.toString() || '')
              setValue('notifyAdminOnNewCar', !!_supplier.notifyAdminOnNewCar)
              setValue('blacklisted', !!_supplier.blacklisted)
              setValue('ice', _supplier.ice || '')
              setValue('registreCommerce', _supplier.registreCommerce || '')
              setValue('identifiantFiscal', _supplier.identifiantFiscal || '')
              setValue('patente', _supplier.patente || '')
              setValue('rib', _supplier.rib || '')
              setValue('fiscalAddress', _supplier.fiscalAddress || '')
              setValue('city', _supplier.city || '')
              setValue('vatEnabled', !!_supplier.vatEnabled)
              setValue('vatRate', _supplier.vatRate?.toString() || '')
              setStampFile(_supplier.stampFile || '')
              if (_supplier.stampFile) {
                SupplierService.fetchStampUrl(_supplier._id as string).then(setStampUrl).catch(() => { /* stamp preview is best-effort */ })
              }
              setVisible(true)
              setLoading(false)
            } else {
              setLoading(false)
              setNoMatch(true)
            }
          } catch (err) {
            helper.error(err)
            setLoading(false)
            setSubmitError(true)
            setVisible(false)
          }
        } else {
          setLoading(false)
          setNoMatch(true)
        }
      } else {
        setLoading(false)
        setNoMatch(true)
      }
    }
  }

  const onSubmit = async (data: FormFields) => {
    try {
      if (!supplier) {
        helper.error()
        return
      }

      if (supplier.fullName !== data.fullName) {
        const status = await SupplierService.validate({ fullName: data.fullName })

        if (status !== 200) {
          setError('fullName', { message: csStrings.INVALID_SUPPLIER_NAME })
          setFocus('fullName')
          return
        }
      }

      if (!avatar) {
        setAvatarError(true)
        setSubmitError(false)
        return
      }

      const payload: bookcarsTypes.UpdateSupplierPayload = {
        _id: supplier._id as string,
        fullName: data.fullName,
        phone: data.phone!,
        location: data.location!,
        bio: data.bio!,
        payLater: !!data.payLater,
        licenseRequired: !!data.licenseRequired,
        minimumRentalDays: data.minimumRentalDays ? Number(data.minimumRentalDays) : undefined,
        priceChangeRate: data.priceChangeRate ? Number(data.priceChangeRate) : undefined,
        supplierCarLimit: data.supplierCarLimit ? Number(data.supplierCarLimit) : undefined,
        notifyAdminOnNewCar: data.notifyAdminOnNewCar,
        blacklisted: !!data.blacklisted,
        ice: data.ice?.trim() || undefined,
        registreCommerce: data.registreCommerce?.trim() || undefined,
        identifiantFiscal: data.identifiantFiscal?.trim() || undefined,
        patente: data.patente?.trim() || undefined,
        rib: data.rib?.trim() || undefined,
        fiscalAddress: data.fiscalAddress?.trim() || undefined,
        city: data.city?.trim() || undefined,
        vatEnabled: data.vatEnabled,
        vatRate: data.vatRate ? Number(data.vatRate) : undefined,
      }

      const res = await SupplierService.update(payload)

      if (res.status === 200) {
        setSupplier(res.data)
        helper.info(commonStrings.UPDATED)
      } else {
        helper.error()
      }
    } catch (err) {
      helper.error(err)
    }
  }

  const onError = () => {
    const firstErrorField = Object.keys(errors)[0] as keyof FormFields
    if (firstErrorField) {
      setFocus(firstErrorField)
    }
  }

  const admin = helper.admin(user)

  return (
    <Layout onLoad={onLoad} strict>
      {visible && (
        <div className="update-supplier">
          <Paper className="supplier-form-update" elevation={10}>
            <h1 style={visuallyHidden}>{csStrings.UPDATE_SUPPLIER_HEADING}</h1>
            <form onSubmit={handleSubmit(onSubmit, onError)}>
              <Avatar
                type={bookcarsTypes.RecordType.Supplier}
                mode="update"
                record={supplier}
                size="large"
                readonly={false}
                hideDelete
                onBeforeUpload={onBeforeUpload}
                onChange={onAvatarChange}
                color="disabled"
                className="avatar-ctn"
              />

              <div className="info">
                <InfoIcon />
                <span>{csStrings.RECOMMENDED_IMAGE_SIZE}</span>
              </div>

              <FormControl fullWidth margin="dense">
                <InputLabel className="required" htmlFor="us-full-name">{commonStrings.FULL_NAME}</InputLabel>
                <Input
                  id="us-full-name"
                  {...register('fullName')}
                  type="text"
                  error={!!errors.fullName}
                  required
                  autoComplete="off"
                />
                <FormHelperText error={!!errors.fullName}>
                  {errors.fullName?.message || ''}
                </FormHelperText>
              </FormControl>

              <FormControl fullWidth margin="dense">
                <InputLabel className="required" htmlFor="us-email">{commonStrings.EMAIL}</InputLabel>
                <Input
                  id="us-email"
                  {...register('email')}
                  type="text"
                  autoComplete="off"
                  disabled
                />
              </FormControl>

              <FormControl fullWidth margin="dense">
                <FormControlLabel
                  control={(
                    <Switch
                      {...register('blacklisted')}
                      checked={blacklisted}
                      onChange={(e) => {
                        setValue('blacklisted', e.target.checked)
                      }}
                      color="primary"
                    />
                  )}
                  label={commonStrings.BLACKLISTED}
                  title={commonStrings.BLACKLISTED_TOOLTIP}
                />
              </FormControl>

              <FormControl fullWidth margin="dense">
                <FormControlLabel
                  control={(
                    <Switch
                      {...register('payLater')}
                      checked={payLater}
                      onChange={(e) => {
                        setValue('payLater', e.target.checked)
                      }}
                      color="primary"
                    />
                  )}
                  label={commonStrings.PAY_LATER}
                />
              </FormControl>

              <FormControl fullWidth margin="dense">
                <FormControlLabel
                  control={(
                    <Switch
                      {...register('licenseRequired')}
                      checked={licenseRequired}
                      onChange={(e) => {
                        setValue('licenseRequired', e.target.checked)
                      }}
                      color="primary"
                    />
                  )}
                  label={commonStrings.LICENSE_REQUIRED}
                />
              </FormControl>

              <div className="info">
                <InfoIcon />
                <span>{commonStrings.OPTIONAL}</span>
              </div>

              <FormControl fullWidth margin="dense">
                <FormControlLabel
                  control={(
                    <Switch
                      {...register('notifyAdminOnNewCar')}
                      checked={notifyAdminOnNewCar}
                      disabled={user?.type === bookcarsTypes.UserType.Supplier}
                      onChange={(e) => {
                        setValue('notifyAdminOnNewCar', e.target.checked)
                      }}
                      color="primary"
                    />
                  )}
                  label={commonStrings.NOTIFY_ADMIN_ON_NEW_CAR}
                />
              </FormControl>

              <FormControl fullWidth margin="dense">
                <InputLabel htmlFor="us-supplier-car-limit">{commonStrings.SUPPLIER_CAR_LIMIT}</InputLabel>
                <Input
                  id="us-supplier-car-limit"
                  {...register('supplierCarLimit')}
                  type="text"
                  autoComplete="off"
                  error={!!errors.supplierCarLimit}
                  onChange={() => {
                    if (errors.supplierCarLimit) {
                      clearErrors('supplierCarLimit')
                    }
                  }}
                />
                <FormHelperText error={!!errors.supplierCarLimit}>
                  {errors.supplierCarLimit?.message || ''}
                </FormHelperText>
              </FormControl>

              <FormControl fullWidth margin="dense">
                <InputLabel htmlFor="us-minimum-rental-days">{commonStrings.MIN_RENTAL_DAYS}</InputLabel>
                <Input
                  id="us-minimum-rental-days"
                  {...register('minimumRentalDays')}
                  type="text"
                  autoComplete="off"
                  error={!!errors.minimumRentalDays}
                  onChange={() => {
                    if (errors.minimumRentalDays) {
                      clearErrors('minimumRentalDays')
                    }
                  }}
                />
                <FormHelperText error={!!errors.minimumRentalDays}>
                  {errors.minimumRentalDays?.message || ''}
                </FormHelperText>
              </FormControl>

              <FormControl fullWidth margin="dense">
                <InputLabel htmlFor="us-price-change-rate">{commonStrings.PRICE_CHANGE_RATE}</InputLabel>
                <Input
                  id="us-price-change-rate"
                  {...register('priceChangeRate')}
                  type="text"
                  autoComplete="off"
                  error={!!errors.priceChangeRate}
                  onChange={() => {
                    if (errors.priceChangeRate) {
                      clearErrors('priceChangeRate')
                    }
                  }}
                />
                <FormHelperText error={!!errors.priceChangeRate}>
                  {errors.priceChangeRate?.message || ''}
                </FormHelperText>
              </FormControl>

              <FormControl fullWidth margin="dense">
                <InputLabel htmlFor="us-phone">{commonStrings.PHONE}</InputLabel>
                <Input
                  id="us-phone"
                  {...register('phone', {
                    onBlur: () => trigger('phone'),
                  })}
                  type="text"
                  autoComplete="off"
                  error={!!errors.phone}
                  onChange={() => {
                    if (errors.phone) {
                      clearErrors('phone')
                    }
                  }}
                />
                <FormHelperText error={!!errors.phone}>
                  {errors.phone?.message || ''}
                </FormHelperText>
              </FormControl>

              <FormControl fullWidth margin="dense">
                <InputLabel htmlFor="us-location">{commonStrings.LOCATION}</InputLabel>
                <Input
                  id="us-location"
                  {...register('location')}
                  type="text"
                  autoComplete="off"
                />
              </FormControl>

              <FormControl fullWidth margin="dense">
                <InputLabel htmlFor="us-bio">{commonStrings.BIO}</InputLabel>
                <Input
                  id="us-bio"
                  {...register('bio')}
                  type="text"
                  autoComplete="off" />
              </FormControl>

            <div className="info">
              <InfoIcon />
              <span>{csStrings.FISCAL_HEADING}</span>
              </div>

              <FormControl fullWidth margin="dense">
                <InputLabel htmlFor="us-ice">{csStrings.FISCAL_ICE}</InputLabel>
                <Input
 id="us-ice"
                {...register('ice')}
                type="text"
                autoComplete="off"
                error={!!errors.ice}
                onChange={() => {
                  if (errors.ice) {
                    clearErrors('ice')
                  }
                }}
              />
              <FormHelperText error={!!errors.ice}>
                {errors.ice?.message || ''}
              </FormHelperText>
              </FormControl>

              <FormControl fullWidth margin="dense">
                <InputLabel htmlFor="us-registreCommerce">{csStrings.FISCAL_RC}</InputLabel>
                <Input
 id="us-registreCommerce"
                {...register('registreCommerce')}
                type="text"
                autoComplete="off"
                error={!!errors.registreCommerce}
                onChange={() => {
                  if (errors.registreCommerce) {
                    clearErrors('registreCommerce')
                  }
                }}
              />
              <FormHelperText error={!!errors.registreCommerce}>
                {errors.registreCommerce?.message || ''}
              </FormHelperText>
              </FormControl>

              <FormControl fullWidth margin="dense">
                <InputLabel htmlFor="us-identifiantFiscal">{csStrings.FISCAL_IF}</InputLabel>
                <Input
 id="us-identifiantFiscal"
                {...register('identifiantFiscal')}
                type="text"
                autoComplete="off"
                error={!!errors.identifiantFiscal}
                onChange={() => {
                  if (errors.identifiantFiscal) {
                    clearErrors('identifiantFiscal')
                  }
                }}
              />
              <FormHelperText error={!!errors.identifiantFiscal}>
                {errors.identifiantFiscal?.message || ''}
              </FormHelperText>
              </FormControl>

              <FormControl fullWidth margin="dense">
                <InputLabel htmlFor="us-patente">{csStrings.FISCAL_PATENTE}</InputLabel>
                <Input
 id="us-patente"
                {...register('patente')}
                type="text"
                autoComplete="off"
                error={!!errors.patente}
                onChange={() => {
                  if (errors.patente) {
                    clearErrors('patente')
                  }
                }}
              />
              <FormHelperText error={!!errors.patente}>
                {errors.patente?.message || ''}
              </FormHelperText>
              </FormControl>

              <FormControl fullWidth margin="dense">
                <InputLabel htmlFor="us-rib">{csStrings.FISCAL_RIB}</InputLabel>
                <Input
 id="us-rib"
                {...register('rib')}
                type="text"
                autoComplete="off"
                error={!!errors.rib}
                onChange={() => {
                  if (errors.rib) {
                    clearErrors('rib')
                  }
                }}
              />
              <FormHelperText error={!!errors.rib}>
                {errors.rib?.message || ''}
              </FormHelperText>
              </FormControl>

              <FormControl fullWidth margin="dense">
                <InputLabel htmlFor="us-fiscalAddress">{csStrings.FISCAL_ADDRESS}</InputLabel>
                <Input
 id="us-fiscalAddress"
                {...register('fiscalAddress')}
                type="text"
                autoComplete="off"
                error={!!errors.fiscalAddress}
                onChange={() => {
                  if (errors.fiscalAddress) {
                    clearErrors('fiscalAddress')
                  }
                }}
              />
              <FormHelperText error={!!errors.fiscalAddress}>
                {errors.fiscalAddress?.message || ''}
              </FormHelperText>
              </FormControl>

              <FormControl fullWidth margin="dense">
                <InputLabel htmlFor="us-city">{csStrings.FISCAL_CITY}</InputLabel>
                <Input
 id="us-city"
                {...register('city')}
                type="text"
                autoComplete="off"
                error={!!errors.city}
                onChange={() => {
                  if (errors.city) {
                    clearErrors('city')
                  }
                }}
              />
              <FormHelperText error={!!errors.city}>
                {errors.city?.message || ''}
              </FormHelperText>
              </FormControl>

              <FormControl fullWidth margin="dense">
              <FormControlLabel
                control={(
                  <Switch
                    {...register('vatEnabled')}
                    checked={vatEnabled}
                    onChange={(e) => {
                      setValue('vatEnabled', e.target.checked)
                    }}
                    color="primary"
                  />
                )}
                label={csStrings.FISCAL_VAT_ENABLED}
              />
              </FormControl>

              <FormControl fullWidth margin="dense">
                <InputLabel htmlFor="us-vat-rate">{csStrings.FISCAL_VAT_RATE}</InputLabel>
                <Input
 id="us-vat-rate"
                {...register('vatRate')}
                type="text"
                autoComplete="off"
                error={!!errors.vatRate}
                onChange={() => {
                  if (errors.vatRate) {
                    clearErrors('vatRate')
                  }
                }}
              />
              <FormHelperText error={!!errors.vatRate}>
                {errors.vatRate?.message || ''}
              </FormHelperText>
              </FormControl>

              <div className="info">
                <InfoIcon />
                <span>{csStrings.STAMP_HEADING}</span>
              </div>

              <input ref={stampInput} hidden type="file" accept="image/png,image/jpeg" onChange={onStampUpload} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button variant="outlined" size="small" disabled={stampBusy} onClick={() => stampInput.current?.click()}>
                  {csStrings.STAMP_UPLOAD}
                </Button>
                {stampFile && (
                  <Button variant="outlined" size="small" disabled={stampBusy} onClick={onStampRemove}>
                    {csStrings.STAMP_REMOVE}
                  </Button>
                )}
              </div>
              {stampFile ? (
                <div style={{ marginTop: 8 }}>
                  <div>{csStrings.STAMP_ON_FILE}</div>
                  {stampUrl && <img src={stampUrl} alt={csStrings.STAMP_ON_FILE} style={{ maxWidth: 200, maxHeight: 120, marginTop: 8 }} />}
                </div>
              ) : (
                <div className="info">
                  <span>{csStrings.STAMP_NONE}</span>
                </div>
              )}

              <FormControl fullWidth margin="dense">
                <ContractList supplier={supplier} />
              </FormControl>

              {admin && (
                <FormControl fullWidth margin="dense" className="resend-activation-link">
                  <Button
                    variant="outlined"
                    onClick={handleResendActivationLink}
                  >
                    {commonStrings.RESEND_ACTIVATION_LINK}
                  </Button>
                </FormControl>
              )}
              <div className="buttons">
                <Button variant="contained" className="btn-primary btn-margin btn-margin-bottom" size="small" onClick={() => navigate(`/change-password?u=${supplier && supplier._id}`)}>
                  {commonStrings.RESET_PASSWORD}
                </Button>
                <Button type="submit" variant="contained" className="btn-primary btn-margin-bottom" size="small" disabled={isSubmitting}>
                  {commonStrings.SAVE}
                </Button>
                <Button variant="contained" className="btn-secondary btn-margin-bottom" size="small" onClick={() => navigate('/suppliers')}>
                  {commonStrings.CANCEL}
                </Button>
              </div>

              <div className="form-error">
                {submitError && <Error message={commonStrings.GENERIC_ERROR} />}
                {avatarError && <Error message={commonStrings.IMAGE_REQUIRED} />}
              </div>
            </form>
          </Paper>
          {supplier && <ReturnSettingsForm supplierId={supplier._id as string} />}
        </div>
      )}
      {loading && <Backdrop text={commonStrings.PLEASE_WAIT} />}
      {submitError && !visible && <Error message={commonStrings.GENERIC_ERROR} />}
      {noMatch && <NoMatch hideHeader />}
    </Layout>
  )
}

export default UpdateSupplier
