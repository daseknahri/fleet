import React from 'react'
import { Accordion, AccordionDetails, AccordionSummary, FormControl, InputLabel, MenuItem, Select, Typography } from '@mui/material'
import { ExpandMore as ExpandMoreIcon } from '@mui/icons-material'
import * as bookcarsTypes from ':bookcars-types'
import { strings as csStrings } from '@/lang/cars'

interface FleetStatusFilterProps {
  value: bookcarsTypes.CarFleetStatus | 'all'
  onChange: (value: bookcarsTypes.CarFleetStatus | 'all') => void
}

// Fleet statuses (scorecard #15): single-select filter for the fleet
// list — All / Available / Rented / Maintenance / Stopped. The per-status
// counts are rendered by CarList, next to the rows.
const FleetStatusFilter = ({ value, onChange }: FleetStatusFilterProps) => (
  <Accordion className="fleet-status-filter" defaultExpanded>
    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
      <Typography>{csStrings.FLEET_STATUS}</Typography>
    </AccordionSummary>
    <AccordionDetails>
      <FormControl fullWidth>
        <InputLabel>{csStrings.FLEET_STATUS}</InputLabel>
        <Select
          value={value}
          label={csStrings.FLEET_STATUS}
          onChange={(e) => onChange(e.target.value as bookcarsTypes.CarFleetStatus | 'all')}
        >
          <MenuItem value="all">{csStrings.FLEET_STATUS_ALL}</MenuItem>
          <MenuItem value="available">{csStrings.AVAILABLE}</MenuItem>
          <MenuItem value="rented">{csStrings.FLEET_STATUS_RENTED}</MenuItem>
          <MenuItem value="maintenance">{csStrings.FLEET_STATUS_MAINTENANCE}</MenuItem>
          <MenuItem value="stopped">{csStrings.FLEET_STATUS_STOPPED}</MenuItem>
        </Select>
      </FormControl>
    </AccordionDetails>
  </Accordion>
)

export default FleetStatusFilter
