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
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import Layout from '@/components/Layout'
import { strings as commonStrings } from '@/lang/common'
import { strings } from '@/lang/settings'
import * as UserService from '@/services/UserService'
import Backdrop from '@/components/SimpleBackdrop'
import DatePicker from '@/components/DatePicker'
import Avatar from '@/components/Avatar'
import * as helper from '@/utils/helper'
import DriverLicense from '@/components/DriverLicense'
import Footer from '@/components/Footer'
import { useUserContext, UserContextType } from '@/context/UserContext'
import { schema, FormFields } from '@/models/SettingsForm'

import '@/assets/css/settings.css'

const Settings = () => {
  const navigate = useNavigate()

  const { user, setUser } = useUserContext() as UserContextType
  const [visible, setVisible] = useState(false)
  const [loading, setLoading] = useState(true)
  const [enableEmailNotifications, setEnableEmailNotifications] = useState(false)

  const { register, control, handleSubmit, formState: { errors, isSubmitting }, clearErrors, setValue } = useForm<FormFields>({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
  })

  const birthDate = useWatch({ control, name: 'birthDate' })

  const handleEmailNotificationsChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (user && user._id) {
        const _user = bookcarsHelper.clone(user) as bookcarsTypes.User
        setEnableEmailNotifications(e.target.checked)

        _user.enableEmailNotifications = e.target.checked

        const payload: bookcarsTypes.UpdateEmailNotificationsPayload = {
          _id: user._id,
          enableEmailNotifications: _user.enableEmailNotifications
        }
        const status = await UserService.updateEmailNotifications(payload)

        if (status === 200) {
          setUser(_user)
          helper.info(strings.SETTINGS_UPDATED)
        }
      } else {
        helper.error()
      }
    } catch (err) {
      helper.error(err)
    }
  }

  const onBeforeUpload = () => {
    setLoading(true)
  }

  const onAvatarChange = (_user: bookcarsTypes.User) => {
    setUser(_user)
    setLoading(false)
  }

  const onSubmit = async (data: FormFields) => {
    try {
      if (!user || !user._id) {
        return
      }

      const payload: bookcarsTypes.UpdateUserPayload = {
        _id: user._id,
        fullName: data.fullName,
        birthDate: data.birthDate,
        phone: data.phone,
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

  const onLoad = (_user?: bookcarsTypes.User) => {
    if (_user) {
      setUser(_user)
      setValue('email', _user.email!)
      setValue('fullName', _user.fullName)
      setValue('phone', _user.phone || '')
      setValue('birthDate', new Date(_user.birthDate!))
      setValue('location', _user.location || '')
      setValue('bio', _user.bio || '')
      setEnableEmailNotifications(_user.enableEmailNotifications ?? true)
      setVisible(true)
      setLoading(false)
    }
  }

  return (
    <Layout onLoad={onLoad} strict>
      {visible && user && (
        <>
          <div className="settings">

            <Paper className="settings-form settings-form-wrapper" elevation={10}>
              <form onSubmit={handleSubmit(onSubmit)} noValidate>
                <Avatar
                  loggedUser={user}
                  user={user}
                  size="large"
                  readonly={false}
                  onBeforeUpload={onBeforeUpload}
                  onChange={onAvatarChange}
                  color="disabled"
                  className="avatar-ctn"
                />
                <FormControl fullWidth margin="dense" error={!!errors.fullName}>
                  <InputLabel className="required" htmlFor="settings-fullName">{commonStrings.FULL_NAME}</InputLabel>
                  <Input id="settings-fullName" {...register('fullName')} type="text" required autoComplete="off" />
                  <FormHelperText>{errors.fullName?.message || ''}</FormHelperText>
                </FormControl>
                <FormControl fullWidth margin="dense">
                  <InputLabel className="required" htmlFor="settings-email">{commonStrings.EMAIL}</InputLabel>
                  <Input id="settings-email" {...register('email')} type="text" disabled />
                </FormControl>
                <FormControl fullWidth margin="dense" error={!!errors.phone}>
                  <InputLabel className="required" htmlFor="settings-phone">{commonStrings.PHONE}</InputLabel>
                  <Input
                    id="settings-phone"
                    {...register('phone')}
                    type="text"
                    required
                    autoComplete="off"
                    onChange={() => {
                      if (errors.phone) {
                        clearErrors('phone')
                      }
                    }}
                  />
                  <FormHelperText>{errors.phone?.message || ''}</FormHelperText>
                </FormControl>
                <FormControl fullWidth margin="dense" error={!!errors.birthDate}>
                  <DatePicker
                    label={commonStrings.BIRTH_DATE}
                    variant="standard"
                    required
                    value={birthDate || undefined}
                    onChange={(date) => {
                      if (date) {
                        if (errors.birthDate) {
                          clearErrors('birthDate')
                        }
                        setValue('birthDate', date, { shouldValidate: true })
                      }
                    }}
                    language={user.language}
                  />
                  <FormHelperText>{errors.birthDate?.message || ''}</FormHelperText>
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
                  <Button
                    variant="contained"
                    className="btn-primary btn-margin btn-margin-bottom"
                    disabled={isSubmitting}
                    onClick={(e) => {
                      e.preventDefault()
                      navigate('/change-password')
                    }}
                  >
                    {commonStrings.RESET_PASSWORD}
                  </Button>
                  <Button type="submit" variant="contained" className="btn-primary btn-margin-bottom" disabled={isSubmitting}>
                    {commonStrings.SAVE}
                  </Button>
                  <Button
                    variant="outlined"
                    color="primary"
                    className="btn-margin-bottom"
                    onClick={(e) => {
                      e.preventDefault()
                      navigate('/')
                    }}
                  >
                    {commonStrings.CANCEL}
                  </Button>
                </div>
              </form>
            </Paper>

            <Paper className="settings-form settings-form-wrapper" elevation={10}>
              <h1 className="settings-form-title">{commonStrings.DRIVER_LICENSE}</h1>
              <DriverLicense user={user} />
            </Paper>

            <Paper className="settings-net settings-net-wrapper" elevation={10}>
              <h1 className="settings-form-title">{strings.NETWORK_SETTINGS}</h1>
              <FormControl component="fieldset">
                <FormControlLabel control={<Switch checked={enableEmailNotifications} onChange={handleEmailNotificationsChange} />} label={strings.SETTINGS_EMAIL_NOTIFICATIONS} />
              </FormControl>
            </Paper>

          </div>

          <Footer />
        </>
      )}
      {loading && <Backdrop text={commonStrings.PLEASE_WAIT} />}
    </Layout>
  )
}

export default Settings
