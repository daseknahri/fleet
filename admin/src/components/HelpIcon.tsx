import { IconButton, Tooltip } from '@mui/material'
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded'

/**
 * Next pass - item 5: the small (?) help icon on every field and button.
 * Hover (or tap on touch) shows the help text. The text is passed in
 * from the page's lang strings, so it is translated like the rest.
 */
const HelpIcon = ({ text, label }: { text: string, label?: string }) => (
  <Tooltip title={text} arrow enterTouchDelay={0}>
    <IconButton size="small" aria-label={label || text} className="help-icon" sx={{ padding: '2px', verticalAlign: 'middle', marginLeft: '4px' }}>
      <HelpOutlineRoundedIcon fontSize="small" />
    </IconButton>
  </Tooltip>
)

export default HelpIcon