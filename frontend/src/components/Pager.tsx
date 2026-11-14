import React from 'react'
import { IconButton } from '@mui/material'
import {
  ArrowBackIos as PreviousPageIcon,
  ArrowForwardIos as NextPageIcon
} from '@mui/icons-material'
import { strings as commonStrings } from '@/lang/common'
import * as UserService from '@/services/UserService'

import '@/assets/css/pager.css'

interface PagerProps {
  page: number
  pageSize: number
  totalRecords: number
  rowCount: number
  onNext: () => void
  onPrevious: () => void
}

const Pager = ({
  page,
  pageSize,
  totalRecords,
  rowCount,
  onNext,
  onPrevious
}: PagerProps) => {
  // FRAR D-AR-06: in RTL the previous/next chevrons point the other way.
  const isAr = UserService.getLanguage() === 'ar'
  return (
    (((page > 1 || rowCount < totalRecords) && (
      <div className="pager-container">
        <div className="pager">
          <div className="row-count">{`${(page - 1) * pageSize + 1}-${rowCount} ${commonStrings.OF} ${totalRecords}`}</div>

          <div className="actions">
            <IconButton onClick={onPrevious} disabled={page === 1}>
              {isAr ? <NextPageIcon className="icon" /> : <PreviousPageIcon className="icon" />}
            </IconButton>

            <IconButton onClick={onNext} disabled={rowCount >= totalRecords}>
              {isAr ? <PreviousPageIcon className="icon" /> : <NextPageIcon className="icon" />}
            </IconButton>
          </div>
        </div>
      </div>
    )) || <></>)
  )
}

export default Pager
