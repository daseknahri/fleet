import React, { useState, useEffect } from 'react'
import {
  InputLabel,
  Select,
  MenuItem,
  SelectChangeEvent,
  TextFieldVariants
} from '@mui/material'

interface DoorsListProps {
  value?: string
  label?: string
  required?: boolean
  variant?: TextFieldVariants
  onChange?: (value: string) => void
}

const DoorsList = ({
  value: doorsListValue,
  label,
  required,
  variant,
  onChange
}: DoorsListProps) => {
  const [value, setValue] = useState('')

  useEffect(() => {
    setValue(doorsListValue === undefined ? '' : doorsListValue)
  }, [doorsListValue])

  const handleChange = (e: SelectChangeEvent<string>) => {
    const _value = e.target.value
    setValue(_value)

    if (onChange) {
      onChange(_value)
    }
  }

  const selectId = React.useId().replace(/:/g, '')

  return (
    <div>
      <InputLabel id={`${selectId}-label`} className={required ? 'required' : ''}>{label}</InputLabel>
      <Select labelId={`${selectId}-label`} id={selectId} label={label} value={value} onChange={handleChange} variant={variant || 'standard'} required={required} fullWidth>
        <MenuItem value={0}>0</MenuItem>
        <MenuItem value={1}>1</MenuItem>
        <MenuItem value={2}>2</MenuItem>
        <MenuItem value={3}>3</MenuItem>
        <MenuItem value={4}>4</MenuItem>
        <MenuItem value={5}>5</MenuItem>
      </Select>
    </div>
  )
}

export default DoorsList
