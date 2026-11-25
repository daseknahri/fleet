import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Input,
  InputLabel,
  FormHelperText,
  FormControl,
  FormControlLabel,
  Switch,
  Button,
  Paper
} from '@mui/material'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import Layout from '@/components/Layout'
import { strings as commonStrings } from '@/lang/common'
import { strings } from '@/lang/settings'
import * as UserService from '@/services/UserService'
import * as BankDetailsService from '@/services/BankDetailsService'
import * as SettingService from '@/services/SettingService'
import * as AgencyReturnSettingsService from '@/services/AgencyReturnSettingsService'
import Backdrop from '@/components/SimpleBackdrop'
import Avatar from '@/components/Avatar'
import * as helper from '@/utils/helper'
import { useUserContext, UserContextType } from '@/context/UserContext'
import BankDetailsForm from '@/components/BankDetailsForm'
import { schema, FormFields } from '@/models/SettingsForm'
import SettingForm from '@/components/SettingForm'

import '@/assets/css/settings.css'

const Settings = () => {
  const navigate = useNavigate()

  const { user, setUser } = useUserContext() as UserContextType

  const [admin, setAdmin] = useState(false)
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(true)
  const [enableEmailNotifications, setEnableEmailNotifications] = useState(false)
  const [bankDetails, setBankDetails] = useState<bookcarsTypes.BankDetails | null>(null)
  const [settings, setSettings] = useState<bookcarsTypes.Setting | null>(null)
  // F8 / W5 S1 — MAP sections that were missing from /settings.
  const [connections, setConnections] = useState<bookcarsTypes.SettingsConnections | null>(null)
  const [returnSettings, setReturnSettings] = useState<bookcarsTypes.AgencyReturnSettings | null>(null)

  const isSupplier = user?.type === bookcarsTypes.UserType.Supplier

  const { register, handleSubmit, formState: { errors, isSubmitting }, clearErrors, setValue } = useForm<FormFields>({
    resolver: zodResolver(schema),
    mode: 'onSubmit'
  })


  const handleEmailNotificationsChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // F8 / W5 S3 — optimistic toggle with rollback: the previous value
    // is restored when the save fails (non-200 or exception) instead
    // of leaving the switch showing a state the server never stored.
    const previous = enableEmailNotifications
    try {
      if (user) {
        setEnableEmailNotifications(e.target.checked)

        const _user = bookcarsHelper.clone(user) as bookcarsTypes.User
        _user.enableEmailNotifications = e.target.checked

        const payload: bookcarsTypes.UpdateEmailNotificationsPayload = {
          _id: user._id as string,
          enableEmailNotifications: _user.enableEmailNotifications
        }
        const status = await UserService.updateEmailNotifications(payload)

        if (status === 200) {
          setUser(_user)
          helper.info(strings.SETTINGS_UPDATED)
        } else {
          setEnableEmailNotifications(previous)
          helper.error()
        }
      } else {
        helper.error()
      }
    } catch (err) {
      setEnableEmailNotifications(previous)
      helper.error(err)
    }
  }


  // GA-PAR-13 (#43): per-category email toggles beside the master switch.
  // Stored on the user via the same updateEmailNotifications endpoint;
  // the master boolean gates all email, categories gate their own.
  const [emailCategories, setEmailCategories] = useState<bookcarsTypes.EmailNotificationCategories>({
    returnsDue: true, carDueDates: true, signedContracts: true, weeklyRecap: true, tips: true, news: true,
  })

  // F8 / W5 S2 — `tips` and `news` have NO content producer anywhere
  // (no sender, no feed, no job), so their toggles were dead controls
  // that promised emails nobody would ever send. They are removed
  // from the UI rather than wired to a producer that does not exist;
  // the stored prefs stay harmless on the user record. The four live
  // categories are wired to their consumers: returnsDue → the
  // automatic return reminders, carDueDates → car-due + expiry
  // reminders, signedContracts → the signed-contract email,
  // weeklyRecap → the weekly recap (all in autoReminders.ts /
  // reminderNotify.ts). Toggles gate EMAIL ONLY.
  const emailCategoryRows: { key: keyof bookcarsTypes.EmailNotificationCategories, label: string }[] = [
    { key: 'returnsDue', label: strings.SETTINGS_EMAIL_RETURNS_DUE },
    { key: 'carDueDates', label: strings.SETTINGS_EMAIL_CAR_DUE_DATES },
    { key: 'signedContracts', label: strings.SETTINGS_EMAIL_SIGNED_CONTRACTS },
    { key: 'weeklyRecap', label: strings.SETTINGS_EMAIL_WEEKLY_RECAP },
  ]

  const handleEmailCategoryChange = (key: keyof bookcarsTypes.EmailNotificationCategories) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    // F8 / W5 S3 — same rollback as the master switch above.
    const previous = emailCategories
    try {
      if (user) {
        const next = { ...emailCategories, [key]: e.target.checked }
        setEmailCategories(next)
        const _user = bookcarsHelper.clone(user) as bookcarsTypes.User
        _user.emailNotificationCategories = next
        const payload: bookcarsTypes.UpdateEmailNotificationsPayload = {
          _id: user._id as string,
          emailNotificationCategories: next,
        }
        const status = await UserService.updateEmailNotifications(payload)
        if (status === 200) {
          setUser(_user)
          helper.info(strings.SETTINGS_UPDATED)
        } else {
          setEmailCategories(previous)
          helper.error()
        }
      } else {
        helper.error()
      }
    } catch (err) {
      setEmailCategories(previous)
      helper.error(err)
    }
  }

  const loadEmailCategories = (_user: bookcarsTypes.User) => {
    setEmailCategories({
      returnsDue: _user.emailNotificationCategories?.returnsDue !== false,
      carDueDates: _user.emailNotificationCategories?.carDueDates !== false,
      signedContracts: _user.emailNotificationCategories?.signedContracts !== false,
      weeklyRecap: _user.emailNotificationCategories?.weeklyRecap !== false,
      tips: _user.emailNotificationCategories?.tips !== false,
      news: _user.emailNotificationCategories?.news !== false,
    })
  }

  const onBeforeUpload = () => {
    setLoading(true)
  }

  const onAvatarChange = (avatar: string) => {
    const _user = bookcarsHelper.clone(user)
    _user.avatar = avatar
    setUser(_user)
    setLoading(false)
  }

  const onSubmit = async (data: FormFields) => {
    try {
      if (!user) {
        return
      }

      const payload: bookcarsTypes.UpdateUserPayload = {
        _id: user._id!,
        fullName: data.fullName,
        phone: data.phone || '',
        location: data.location || '',
        bio: data.bio || '',
      }

      const status = await UserService.updateUser(payload)

      if (status === 200) {
        helper.info(strings.SETTINGS_UPDATED)
      } else {
        helper.error()
      }
    } catch (err) {
      helper.error(err)
    }
  }


  const onLoad = async (_user?: bookcarsTypes.User) => {
    if (_user) {
      setUser(_user)
      setAdmin(helper.admin(_user))
      setValue('email', _user.email!)
      setValue('fullName', _user.fullName)
      setValue('phone', _user.phone || '')
      setValue('location', _user.location || '')
      setValue('bio', _user.bio || '')
      setEnableEmailNotifications(_user.enableEmailNotifications || false)
      loadEmailCategories(_user)

      try {
        // H-022 (hardening Wave 4): only the platform admin uses the bank
        // details below (the form renders for admins only); other roles
        // either cannot read the endpoint (staff - it 403'd here too) or
        // never see the form (suppliers), so only fetch it for admins.
        if (helper.admin(_user)) {
          const bankDetails = await BankDetailsService.getBankDetails()
          if (bankDetails) {
            setBankDetails(bankDetails)
          }
        }

        const settings = await SettingService.getSettings()
        if (settings) {
          setSettings(settings)
        }

        // F8 / W5 S1 — connections status for every signed-in user
        // (booleans only, no secrets), and the agency's return rates
        // for Supplier users (read-only here; edited on UpdateSupplier).
        const connections = await SettingService.getConnections()
        if (connections) {
          setConnections(connections)
        }
        if (_user.type === bookcarsTypes.UserType.Supplier) {
          const returnSettings = await AgencyReturnSettingsService.getAgencyReturnSettings()
          if (returnSettings) {
            setReturnSettings(returnSettings)
          }
        }
      } catch (err) {
        helper.error(err)
      } finally {
        setVisible(true)
        setLoading(false)
      }
    }
  }

  return (
    <Layout onLoad={onLoad} strict>
      {visible && user && (
        <div className="settings">

          <Paper className="settings-form settings-form-wrapper" elevation={10}>
            <form onSubmit={handleSubmit(onSubmit)}>
              <Avatar
                type={user.type}
                mode="update"
                record={user}
                size="large"
                readonly={false}
                onBeforeUpload={onBeforeUpload}
                onChange={onAvatarChange}
                hideDelete={!admin}
                color="disabled"
                className="avatar-ctn"
              />
              <FormControl fullWidth margin="dense">
                <InputLabel className="required" htmlFor="settings-fullName">{commonStrings.FULL_NAME}</InputLabel>
                <Input id="settings-fullName" {...register('fullName')} type="text" required autoComplete="off" />
              </FormControl>
              <FormControl fullWidth margin="dense">
                <InputLabel className="required" htmlFor="settings-email">{commonStrings.EMAIL}</InputLabel>
                <Input id="settings-email" {...register('email')} type="text" disabled />
              </FormControl>
              <FormControl fullWidth margin="dense" error={!!errors.phone}>
                <InputLabel htmlFor="settings-phone">{commonStrings.PHONE}</InputLabel>
                <Input
                  id="settings-phone"
                  {...register('phone')}
                  type="text"
                  autoComplete="off"
                  onChange={() => {
                    if (errors.phone) {
                      clearErrors('phone')
                    }
                  }}
                />
                <FormHelperText>{errors.phone?.message || ''}</FormHelperText>
              </FormControl>
              <FormControl fullWidth margin="dense">
                <InputLabel htmlFor="settings-location">{commonStrings.LOCATION}</InputLabel>
                <Input id="settings-location" {...register('location')} type="text" autoComplete="off" />
              </FormControl>
              <FormControl fullWidth margin="dense">
                <InputLabel htmlFor="settings-bio">{commonStrings.BIO}</InputLabel>
                <Input id="settings-bio" {...register('bio')} type="text" autoComplete="off" />
              </FormControl>
              <div className="buttons">
                <Button variant="contained" className="btn-primary btn-margin btn-margin-bottom" size="small" onClick={() => navigate('/change-password')}>
                  {commonStrings.RESET_PASSWORD}
                </Button>
                <Button type="submit" variant="contained" className="btn-primary btn-margin-bottom" size="small" disabled={isSubmitting}>
                  {commonStrings.SAVE}
                </Button>
                <Button variant="contained" className="btn-secondary btn-margin-bottom" size="small" onClick={() => navigate('/')}>
                  {commonStrings.CANCEL}
                </Button>
              </div>
            </form>
          </Paper>

          <Paper className="settings-net settings-net-wrapper" elevation={10}>
            <h1 className="settings-form-title">{strings.NETWORK_SETTINGS}</h1>
            <FormControl component="fieldset">
              <FormControlLabel
                control={(
                  <Switch
                    checked={enableEmailNotifications}
                    onChange={handleEmailNotificationsChange}
                  />
                )}
                label={strings.SETTINGS_EMAIL_NOTIFICATIONS}
              />

              {emailCategoryRows.map((row) => (
                <FormControlLabel
                  key={row.key}
                  control={(
                    <Switch
                      checked={emailCategories[row.key] !== false}
                      onChange={handleEmailCategoryChange(row.key)}
                    />
                  )}
                  label={row.label}
                />
              ))}
            </FormControl>
          </Paper>

          {user.type === bookcarsTypes.UserType.Admin && (
            <SettingForm
              settings={settings}
              onSubmit={(data) => setSettings(data)}
            />
          )}

          {user.type === bookcarsTypes.UserType.Admin && (
            <BankDetailsForm
              bankDetails={bankDetails}
              onSubmit={(data) => setBankDetails(data)}
            />
          )}

          {(admin || isSupplier) && (
            <Paper className="settings-net settings-net-wrapper" elevation={10}>
              <h1 className="settings-form-title">{strings.AGENCY_SECTION}</h1>
              <p>{strings.AGENCY_SECTION_DESC}</p>
              {isSupplier && returnSettings && (
                <div>
                  <h2>{strings.RETURN_RATES}</h2>
                  <p>{`${strings.RETURN_INCLUDED_KM}: ${returnSettings.includedKmPerDay ?? '—'}`}</p>
                  <p>{`${strings.RETURN_EXTRA_KM_PRICE}: ${returnSettings.extraKmPrice ?? '—'}`}</p>
                  <p>{`${strings.RETURN_FUEL_PRICE}: ${returnSettings.fuelPricePerLitre ?? '—'}`}</p>
                  <p>{`${strings.RETURN_WASH_FEE}: ${returnSettings.washFee ?? '—'}`}</p>
                  <p>{`${strings.RETURN_DEFAULT_DEPOSIT}: ${returnSettings.defaultDeposit ?? '—'}`}</p>
                  {returnSettings.includedKmPerDay == null && returnSettings.extraKmPrice == null && returnSettings.fuelPricePerLitre == null && returnSettings.washFee == null && returnSettings.defaultDeposit == null && (
                    <p>{strings.RETURN_RATES_NOT_SET}</p>
                  )}
                </div>
              )}
              <div className="buttons">
                <Button
                  variant="contained"
                  className="btn-primary btn-margin-bottom"
                  size="small"
                  onClick={() => navigate(isSupplier ? `/update-supplier?c=${user._id}` : '/suppliers')}
                >
                  {strings.AGENCY_OPEN}
                </Button>
              </div>
            </Paper>
          )}

          <Paper className="settings-net settings-net-wrapper" elevation={10}>
            <h1 className="settings-form-title">{strings.SECURITY_SECTION}</h1>
            <p>{strings.SECURITY_SECTION_DESC}</p>
            <div className="buttons">
              <Button variant="contained" className="btn-primary btn-margin-bottom" size="small" onClick={() => navigate('/change-password')}>
                {commonStrings.RESET_PASSWORD}
              </Button>
            </div>
          </Paper>

          <Paper className="settings-net settings-net-wrapper" elevation={10}>
            <h1 className="settings-form-title">{strings.CONNECTIONS_SECTION}</h1>
            <p>{strings.CONNECTIONS_DESC}</p>
            {connections && (
              <div>
                <p>{`${strings.CONN_STRIPE}: ${connections.stripe ? strings.CONN_CONFIGURED : strings.CONN_NOT_CONFIGURED}`}</p>
                <p>{`${strings.CONN_PAYPAL}: ${connections.paypal ? strings.CONN_CONFIGURED : strings.CONN_NOT_CONFIGURED}`}</p>
                <p>{`${strings.CONN_SMTP}: ${connections.smtp ? strings.CONN_CONFIGURED : strings.CONN_NOT_CONFIGURED}`}</p>
                <p>{`${strings.CONN_PUSH}: ${connections.push ? strings.CONN_CONFIGURED : strings.CONN_NOT_CONFIGURED}`}</p>
              </div>
            )}
          </Paper>
        </div>
      )}

      {loading && <Backdrop text={commonStrings.PLEASE_WAIT} />}
    </Layout>
  )
}

export default Settings
