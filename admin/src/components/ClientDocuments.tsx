import React, { useState } from 'react'
import {
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Typography,
} from '@mui/material'
import {
  Upload as UploadIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material'
import * as bookcarsTypes from ':bookcars-types'
import { strings as commonStrings } from '@/lang/common'
import * as UserService from '@/services/UserService'
import * as helper from '@/utils/helper'
import env from '@/config/env.config'

import '@/assets/css/client-documents.css'

interface ClientDocumentsProps {
  user: bookcarsTypes.User
  className?: string
  onChange?: (documents: bookcarsTypes.ClientDocument[]) => void
}

/** GA-PAR-04: localised labels — raw enum values are never rendered. */
export const clientStatusLabel = (status?: string): string => {
  switch (status) {
    case bookcarsTypes.ClientStatus.UnderReview:
      return commonStrings.CLIENT_STATUS_UNDER_REVIEW
    case bookcarsTypes.ClientStatus.Blocked:
      return commonStrings.CLIENT_STATUS_BLOCKED
    default:
      return commonStrings.CLIENT_STATUS_ACTIVE
  }
}

export const clientTypeLabel = (type?: string): string => (
  type === bookcarsTypes.ClientType.Company
    ? commonStrings.CLIENT_TYPE_COMPANY
    : commonStrings.CLIENT_TYPE_INDIVIDUAL
)

export const clientDocumentKindLabel = (kind?: string): string => {
  switch (kind) {
    case bookcarsTypes.ClientDocumentKind.Cin:
      return commonStrings.DOCUMENT_KIND_CIN
    case bookcarsTypes.ClientDocumentKind.Passport:
      return commonStrings.DOCUMENT_KIND_PASSPORT
    case bookcarsTypes.ClientDocumentKind.License:
      return commonStrings.DOCUMENT_KIND_LICENSE
    default:
      return commonStrings.DOCUMENT_KIND_OTHER
  }
}

const ClientDocuments = ({ user, className, onChange }: ClientDocumentsProps) => {
  const [documents, setDocuments] = useState<bookcarsTypes.ClientDocument[]>(user.clientDocuments || [])
  const [kind, setKind] = useState<string>(bookcarsTypes.ClientDocumentKind.Cin)
  const [uploading, setUploading] = useState(false)

  const inputId = `upload-client-document-${user._id}`

  const handleUploadClick = () => {
    const upload = document.getElementById(inputId) as HTMLInputElement
    upload.value = ''
    setTimeout(() => {
      upload.click()
    }, 0)
  }

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) {
      return
    }
    const file = e.target.files[0]
    try {
      setUploading(true)
      const res = await UserService.uploadClientDocument(user._id!, file, kind)
      if (res.status === 200 && res.data) {
        const _documents = [...documents, res.data]
        setDocuments(_documents)
        if (onChange) {
          onChange(_documents)
        }
      } else {
        helper.error()
      }
    } catch (err) {
      helper.error(err)
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (doc: bookcarsTypes.ClientDocument) => {
    try {
      const status = await UserService.deleteClientDocument(user._id!, doc.file)
      if (status === 200) {
        const _documents = documents.filter((d) => d.file !== doc.file)
        setDocuments(_documents)
        if (onChange) {
          onChange(_documents)
        }
      } else {
        helper.error()
      }
    } catch (err) {
      helper.error(err)
    }
  }

  return (
    <div className={`client-documents ${className || ''}`}>
      <Typography variant="subtitle2" className="client-documents-title">{commonStrings.CLIENT_DOCUMENTS}</Typography>
      {documents.length === 0 && (
        <Typography variant="body2" className="client-documents-empty">—</Typography>
      )}
      <List dense disablePadding>
        {documents.map((doc) => (
          <ListItem key={doc.file} disableGutters className="client-documents-item">
            <ListItemText
              primary={doc.originalName || doc.file}
              secondary={clientDocumentKindLabel(doc.kind)}
            />
            <IconButton
              size="small"
              onClick={() => {
                const url = `${env.API_HOST.replace(/\/$/, '')}/api/client-document/${user._id}/${encodeURIComponent(doc.file)}`
                helper.downloadURI(url)
              }}
            >
              <ViewIcon className="icon" />
            </IconButton>
            <IconButton size="small" onClick={() => handleDelete(doc)}>
              <DeleteIcon className="icon" />
            </IconButton>
          </ListItem>
        ))}
      </List>
      <div className="client-documents-upload">
        <Select
          size="small"
          variant="standard"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="client-documents-kind"
        >
          <MenuItem value={bookcarsTypes.ClientDocumentKind.Cin}>{commonStrings.DOCUMENT_KIND_CIN}</MenuItem>
          <MenuItem value={bookcarsTypes.ClientDocumentKind.Passport}>{commonStrings.DOCUMENT_KIND_PASSPORT}</MenuItem>
          <MenuItem value={bookcarsTypes.ClientDocumentKind.License}>{commonStrings.DOCUMENT_KIND_LICENSE}</MenuItem>
          <MenuItem value={bookcarsTypes.ClientDocumentKind.Other}>{commonStrings.DOCUMENT_KIND_OTHER}</MenuItem>
        </Select>
        <IconButton size="small" onClick={handleUploadClick} disabled={uploading} title={commonStrings.UPLOAD_DOCUMENT}>
          <UploadIcon className="icon" />
        </IconButton>
        <span className="client-documents-upload-label">{commonStrings.UPLOAD_DOCUMENT}</span>
      </div>
      <input id={inputId} type="file" hidden onChange={handleChange} />
    </div>
  )
}

export default ClientDocuments
