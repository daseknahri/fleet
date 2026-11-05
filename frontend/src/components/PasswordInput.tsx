import React, { useId, useState } from 'react'
import {
  InputLabel,
  FormControl,
  FormHelperText,
  InputAdornment,
  IconButton,
  Input,
  OutlinedInput,
  FilledInput,
  InputProps,
  OutlinedInputProps,
  FilledInputProps,
  FormControlProps,
} from '@mui/material'
import { Visibility, VisibilityOff } from '@mui/icons-material'
import { strings as commonStrings } from '@/lang/common'

type Variant = 'standard' | 'outlined' | 'filled'

type CombinedProps = {
  label: string
  variant?: Variant
  error?: boolean
  helperText?: React.ReactNode
  formControlProps?: FormControlProps
} & (
    | (InputProps & { variant?: 'standard' })
    | (OutlinedInputProps & { variant: 'outlined' })
    | (FilledInputProps & { variant: 'filled' })
  )

const PasswordInput: React.FC<CombinedProps> = ({
  label,
  error,
  helperText,
  formControlProps,
  variant = 'standard',
  ...inputProps
}) => {
  const [showPassword, setShowPassword] = useState(false)
  const autoId = useId()
  const inputId = inputProps.id || autoId

  const toggleVisibility = () => {
    setShowPassword((prev) => !prev)
  }

  const commonProps = {
    ...inputProps,
    id: inputId,
    type: showPassword ? 'text' : 'password',
    endAdornment: (
      <InputAdornment position="end">
        <IconButton
          onClick={toggleVisibility}
          edge="end"
          size="small"
          tabIndex={-1}
          aria-label={showPassword ? commonStrings.HIDE_PASSWORD : commonStrings.SHOW_PASSWORD}
        >
          {showPassword ? <VisibilityOff /> : <Visibility />}
        </IconButton>
      </InputAdornment>
    ),
  }

  const InputComponent =
    variant === 'outlined'
      ? OutlinedInput
      : variant === 'filled'
        ? FilledInput
        : Input

  return (
    <FormControl
      fullWidth
      margin="dense"
      error={error}
      variant={variant}
      size={inputProps.size}
      {...formControlProps}
    >
      <InputLabel
        htmlFor={inputId}
      >
        {label}
      </InputLabel>
      <InputComponent
        {...commonProps}
        label={variant === 'outlined' ? label : undefined}
      />
      <FormHelperText>{helperText}</FormHelperText>
    </FormControl>
  )
}

export default PasswordInput
