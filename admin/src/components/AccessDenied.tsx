import React from 'react'
import { Alert, Box } from '@mui/material'
import { strings as commonStrings } from '@/lang/common'

// The one consistent denial state for agency surfaces the signed-in role
// cannot use (H-038): an explicit access message instead of a silently
// empty grid or a misleading load error.
const AccessDenied = () => (
  <Box sx={{ p: 3 }}>
    <Alert severity="warning">{commonStrings.ACCESS_DENIED}</Alert>
  </Box>
)

export default AccessDenied
