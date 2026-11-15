import React, { useState } from 'react'
import {
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material'
import {
  Upload as UploadIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material'
import * as bookcarsTypes from ':bookcars-types'
import * as bookcarsHelper from ':bookcars-helper'
import { strings as commonStrings } from '@/lang/common'
import { strings } from '@/lang/create-car'
import * as CarService from '@/services/CarService'
import * as helper from '@/utils/helper'
import env from '@/config/env.config'

import '@/assets/css/car-media.css'

interface CarMediaProps {
  car: bookcarsTypes.Car
  className?: string
  onChange?: (car: bookcarsTypes.Car) => void
}

/** F5b (W2-14): localised labels — raw enum values are never rendered. */
export const carDocumentKindLabel = (kind?: string): string => {
  switch (kind) {
    case bookcarsTypes.CarDocumentKind.Insurance:
      return strings.CAR_DOCUMENT_KIND_INSURANCE
    case bookcarsTypes.CarDocumentKind.TechnicalInspection:
      return strings.CAR_DOCUMENT_KIND_TECHNICAL_INSPECTION
    case bookcarsTypes.CarDocumentKind.Vignette:
      return strings.CAR_DOCUMENT_KIND_VIGNETTE
    default:
      return strings.CAR_DOCUMENT_KIND_OTHER
  }
}

const CAR_GALLERY_MAX_IMAGES = 8

/**
 * F5b (W2-14): gallery + car documents for one car, managed from
 * UpdateCar (the car must exist first, so CreateCar has no gallery).
 * Mirrors ClientDocuments: the gallery is additional photos beyond the
 * cover `image` (served from the public cars store); the documents are
 * privately stored (insurance, technical inspection, vignette, other)
 * and downloaded through the authenticated document route.
 */
const CarMedia = ({ car, className, onChange }: CarMediaProps) => {
  const [images, setImages] = useState<string[]>(car.images || [])
  const [documents, setDocuments] = useState<bookcarsTypes.CarDocument[]>(car.documents || [])
  const [kind, setKind] = useState<string>(bookcarsTypes.CarDocumentKind.Insurance)
  const [expiryDate, setExpiryDate] = useState<string>('')
  const [uploading, setUploading] = useState(false)

  const galleryInputId = `upload-car-image-${car._id}`
  const documentInputId = `upload-car-document-${car._id}`
  const galleryFull = images.length >= CAR_GALLERY_MAX_IMAGES

  const handleGalleryUploadClick = () => {
    const upload = document.getElementById(galleryInputId) as HTMLInputElement
    upload.value = ''
    setTimeout(() => {
      upload.click()
    }, 0)
  }

  const handleGalleryChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) {
      return
    }
    const file = e.target.files[0]
    try {
      setUploading(true)
      const filename = await CarService.uploadCarImage(car._id!, file)
      if (filename) {
        const _images = [...images, filename]
        setImages(_images)
        if (onChange) {
          onChange({ ...car, images: _images })
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

  const handleGalleryDelete = async (file: string) => {
    try {
      const status = await CarService.deleteCarImage(car._id!, file)
      if (status === 200) {
        const _images = images.filter((image) => image !== file)
        setImages(_images)
        if (onChange) {
          onChange({ ...car, images: _images })
        }
      } else {
        helper.error()
      }
    } catch (err) {
      helper.error(err)
    }
  }

  const handleDocumentUploadClick = () => {
    const upload = document.getElementById(documentInputId) as HTMLInputElement
    upload.value = ''
    setTimeout(() => {
      upload.click()
    }, 0)
  }

  const handleDocumentChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) {
      return
    }
    const file = e.target.files[0]
    try {
      setUploading(true)
      const res = await CarService.uploadCarDocument(car._id!, file, kind, expiryDate || undefined)
      if (res.status === 200 && res.data) {
        const _documents = [...documents, res.data]
        setDocuments(_documents)
        if (onChange) {
          onChange({ ...car, documents: _documents })
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

  const handleDocumentDelete = async (doc: bookcarsTypes.CarDocument) => {
    try {
      const status = await CarService.deleteCarDocument(car._id!, doc.file)
      if (status === 200) {
        const _documents = documents.filter((d) => d.file !== doc.file)
        setDocuments(_documents)
        if (onChange) {
          onChange({ ...car, documents: _documents })
        }
      } else {
        helper.error()
      }
    } catch (err) {
      helper.error(err)
    }
  }

  return (
    <div className={`car-media ${className || ''}`}>
      <Typography variant="subtitle2" className="car-media-title">{strings.GALLERY_HEADING}</Typography>
      {images.length === 0 && (
        <Typography variant="body2" className="car-media-empty">—</Typography>
      )}
      <div className="car-media-gallery">
        {images.map((image) => (
          <div key={image} className="car-media-thumb">
            <img src={bookcarsHelper.joinURL(env.CDN_CARS, image)} alt={car.name} />
            <IconButton size="small" onClick={() => handleGalleryDelete(image)} className="car-media-thumb-delete">
              <DeleteIcon className="icon" />
            </IconButton>
          </div>
        ))}
      </div>
      <div className="car-media-upload">
        <IconButton size="small" onClick={handleGalleryUploadClick} disabled={uploading || galleryFull} title={commonStrings.UPLOAD_DOCUMENT}>
          <UploadIcon className="icon" />
        </IconButton>
        <span className="car-media-upload-label">{galleryFull ? strings.CAR_GALLERY_MAX : commonStrings.UPLOAD_DOCUMENT}</span>
      </div>
      <input id={galleryInputId} type="file" accept="image/*" hidden onChange={handleGalleryChange} />

      <Typography variant="subtitle2" className="car-media-title">{strings.CAR_DOCUMENTS_HEADING}</Typography>
      {documents.length === 0 && (
        <Typography variant="body2" className="car-media-empty">—</Typography>
      )}
      <List dense disablePadding>
        {documents.map((doc) => (
          <ListItem key={doc.file} disableGutters className="car-media-item">
            <ListItemText
              primary={doc.originalName || doc.file}
              secondary={doc.expiryDate
                ? `${carDocumentKindLabel(doc.kind)} · ${new Date(doc.expiryDate).toISOString().slice(0, 10)}`
                : carDocumentKindLabel(doc.kind)}
            />
            <IconButton
              size="small"
              onClick={() => {
                const url = `${env.API_HOST.replace(/\/$/, '')}/api/car-document/${car._id}/${encodeURIComponent(doc.file)}`
                helper.downloadURI(url)
              }}
            >
              <ViewIcon className="icon" />
            </IconButton>
            <IconButton size="small" onClick={() => handleDocumentDelete(doc)}>
              <DeleteIcon className="icon" />
            </IconButton>
          </ListItem>
        ))}
      </List>
      <div className="car-media-upload">
        <Select
          size="small"
          variant="standard"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="car-media-kind"
        >
          <MenuItem value={bookcarsTypes.CarDocumentKind.Insurance}>{strings.CAR_DOCUMENT_KIND_INSURANCE}</MenuItem>
          <MenuItem value={bookcarsTypes.CarDocumentKind.TechnicalInspection}>{strings.CAR_DOCUMENT_KIND_TECHNICAL_INSPECTION}</MenuItem>
          <MenuItem value={bookcarsTypes.CarDocumentKind.Vignette}>{strings.CAR_DOCUMENT_KIND_VIGNETTE}</MenuItem>
          <MenuItem value={bookcarsTypes.CarDocumentKind.Other}>{strings.CAR_DOCUMENT_KIND_OTHER}</MenuItem>
        </Select>
        <TextField
          size="small"
          type="date"
          variant="standard"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
          className="car-media-expiry"
        />
        <IconButton size="small" onClick={handleDocumentUploadClick} disabled={uploading} title={commonStrings.UPLOAD_DOCUMENT}>
          <UploadIcon className="icon" />
        </IconButton>
        <span className="car-media-upload-label">{commonStrings.UPLOAD_DOCUMENT}</span>
      </div>
      <input id={documentInputId} type="file" hidden onChange={handleDocumentChange} />
    </div>
  )
}

export default CarMedia
