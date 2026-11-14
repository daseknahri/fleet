import { Request, Response } from 'express'
import mongoose from 'mongoose'
import path from 'node:path'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import { PDFDocument } from 'pdf-lib'
import * as bookcarsTypes from ':bookcars-types'
import Booking from '../models/Booking'
import Car from '../models/Car'
import User from '../models/User'
import * as env from '../config/env.config'
import * as logger from '../utils/logger'
import i18n from '../lang/i18n'
import { agencySupplierId } from '../utils/agencyAuthorization'
import { createSigningToken, newSigningNonce, parseSigningToken } from '../utils/bookingSigning'
import { detectFileType } from '../utils/fileContent'
import { notifyClientSignedOnline } from '../utils/reminderNotify'

/**
 * GA-PAR-12 — online client signing.
 *
 * Staff side (authJwt + agency context + ManageBookings, wired in
 * routes/signingRoutes.ts):
 * - POST /api/bookings/:id/signing-link          → issue a shareable link
 * - POST /api/bookings/:id/signing-link/revoke   → revoke (nonce rotation)
 *
 * Public side (unauthenticated BY DESIGN — the HMAC capability token
 * minted over the booking's current `signingNonce` is the credential;
 * see utils/bookingSigning.ts):
 * - GET  /api/sign/:token → display-safe summary for that one booking
 * - POST /api/sign/:token → record the drawn signature
 *
 * Invariants:
 * - the nonce and any live token NEVER appear in a response payload;
 *   booking payloads elsewhere expose only `onlineSignature.signedAt`;
 * - every public failure is ONE generic invalid-link error (400
 *   SIGN_LINK_INVALID) — bad MAC, wrong nonce, expired and
 *   non-signable state are indistinguishable to the caller and are
 *   logged server-side only. The single exception is the
 *   already-signed state (409 SIGN_ALREADY_SIGNED), reachable only
 *   with a MAC-valid, unexpired token that was genuinely issued for
 *   that booking, which the public page needs as a distinct state;
 * - a successful signing consumes the link: the nonce rotates inside
 *   the same conditional update that records the signature;
 * - the signature PNG lives in the private contracts store
 *   (env.CDN_CONTRACTS) under the same discipline as contract
 *   snapshots / inspection signatures: never statically served, only
 *   embedded into the authenticated contract snapshot PDF;
 * - both public endpoints answer `Referrer-Policy: no-referrer` so the
 *   capability URL cannot leak through a Referer header.
 */

const GENERIC_INVALID = 'SIGN_LINK_INVALID'
const MAX_SIGNATURE_BYTES = 1024 * 1024 // 1 MB, decoded PNG bytes

/**
 * GA-PAR-12 fix (QA12 security battery 6b) — deep PNG validation for the
 * SIGNING path only. The shared `detectFileType` in utils/fileContent.ts
 * intentionally keeps its magic-prefix semantics for the other upload
 * flows; here a magic prefix is not enough, because the stored bytes are
 * recorded as the client's legally-meaningful signature and are later
 * embedded into the contract snapshot PDF.
 *
 * A candidate is accepted only if ALL of the following hold:
 * - chunk walk: well-formed length/type/data/CRC32 framing, first chunk
 *   is a 13-byte IHDR, an IEND terminates the file with no trailing
 *   bytes, and there is at least one IDAT (a PLTE precedes IDAT for
 *   palette images);
 * - IHDR plausibility: dimensions 1..4096 per side, and a bit depth
 *   that is legal for the colour type;
 * - the concatenated IDAT is a valid zlib stream that inflates; for
 *   the common non-interlaced 8-bit case (what the signing canvas and
 *   ordinary encoders produce) the inflated length must equal the
 *   exact scanline total and every scanline filter byte must be 0..4;
 * - pdf-lib can embed it (`PDFDocument.embedPng`) — the same mechanism
 *   the snapshot generator uses, so an accepted signature is always
 *   embeddable in the signed contract.
 *
 * Limits (stated honestly): interlaced or sub-8-bit images are checked
 * for chunk/CRC framing, IHDR legality and zlib inflatability but not
 * for exact inflated length or scanline filters; pixel content itself
 * is not judged (a structurally valid blank or noise PNG still passes,
 * as it should — it is a real PNG). pdf-lib alone would NOT have been
 * sufficient: it embeds a forged-IHDR + garbage-IDAT file without
 * decoding the IDAT, which is why the zlib inflation check exists.
 */
const PNG_CRC_TABLE = (() => {
  const table: number[] = []
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

const pngCrc32 = (buf: Buffer): number => {
  let c = 0xffffffff
  for (const byte of buf) {
    c = PNG_CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

const PNG_CHANNELS: Record<number, number> = {
  0: 1, 2: 3, 3: 1, 4: 2, 6: 4,
}
const PNG_BIT_DEPTHS: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16],
}

const isStructurallyValidSignaturePng = async (bytes: Buffer): Promise<boolean> => {
  try {
    // 8-byte signature + at least IHDR (25 bytes) and IEND (12 bytes).
    if (bytes.length < 8 + 25 + 12) {
      return false
    }
    let offset = 8
    let firstChunk = true
    let seenIhdr = false
    let seenPlte = false
    let seenIdat = false
    let seenIend = false
    const idatParts: Buffer[] = []
    let width = 0
    let height = 0
    let bitDepth = 0
    let colorType = -1
    let interlace = 0
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) {
        return false
      }
      const length = bytes.readUInt32BE(offset)
      const type = bytes.toString('ascii', offset + 4, offset + 8)
      if (!/^[A-Za-z]{4}$/.test(type) || offset + 12 + length > bytes.length) {
        return false
      }
      const dataStart = offset + 8
      const dataEnd = dataStart + length
      const storedCrc = bytes.readUInt32BE(dataEnd)
      if (pngCrc32(bytes.subarray(offset + 4, dataEnd)) !== storedCrc) {
        return false
      }
      if (firstChunk && type !== 'IHDR') {
        return false
      }
      firstChunk = false
      if (type === 'IHDR') {
        if (seenIhdr || length !== 13) {
          return false
        }
        seenIhdr = true
        width = bytes.readUInt32BE(dataStart)
        height = bytes.readUInt32BE(dataStart + 4)
        bitDepth = bytes[dataStart + 8]
        colorType = bytes[dataStart + 9]
        const compression = bytes[dataStart + 10]
        const filterMethod = bytes[dataStart + 11]
        interlace = bytes[dataStart + 12]
        if (width < 1 || width > 4096 || height < 1 || height > 4096
          || !(colorType in PNG_BIT_DEPTHS) || !PNG_BIT_DEPTHS[colorType].includes(bitDepth)
          || compression !== 0 || filterMethod !== 0 || (interlace !== 0 && interlace !== 1)) {
          return false
        }
      } else if (type === 'PLTE') {
        seenPlte = true
      } else if (type === 'IDAT') {
        if (!seenIhdr || (colorType === 3 && !seenPlte)) {
          return false
        }
        seenIdat = true
        idatParts.push(bytes.subarray(dataStart, dataEnd))
      } else if (type === 'IEND') {
        if (length !== 0) {
          return false
        }
        seenIend = true
      }
      offset = dataEnd + 4
      if (seenIend) {
        break
      }
    }
    if (!seenIhdr || !seenIdat || !seenIend || offset !== bytes.length) {
      return false
    }
    // The image data must be a real zlib stream — a forged IHDR with a
    // garbage body fails here even though pdf-lib would embed it.
    let inflated: Buffer
    try {
      inflated = inflateSync(Buffer.concat(idatParts))
    } catch {
      return false
    }
    if (inflated.length === 0) {
      return false
    }
    if (interlace === 0 && bitDepth === 8) {
      const rowBytes = width * PNG_CHANNELS[colorType]
      const expected = height * (1 + rowBytes)
      if (inflated.length !== expected) {
        return false
      }
      for (let y = 0; y < height; y += 1) {
        if (inflated[y * (1 + rowBytes)] > 4) {
          return false
        }
      }
    }
    // Same embed the snapshot generator performs: an accepted
    // signature must actually be embeddable in the contract PDF.
    const pdf = await PDFDocument.create()
    await pdf.embedPng(bytes)
    return true
  } catch {
    return false
  }
}

const hardenPublicResponse = (res: Response) => {
  res.set('Referrer-Policy', 'no-referrer')
  res.set('Cache-Control', 'private, no-store')
}

const genericInvalid = (req: Request, res: Response, reason: string) => {
  logger.error(`[signing.public] invalid link (${reason}) ${req.method} ${req.path}`)
  res.status(400).json({ message: GENERIC_INVALID })
}

const isSignable = (booking: env.Booking) => (
  !booking.expireAt
  // GA-PAR-22: a trashed booking can never be signed (public GET/POST
  // fall through to the generic-invalid response — no oracle).
  && !booking.deletedAt
  && booking.status !== bookcarsTypes.BookingStatus.Cancelled
  && booking.status !== bookcarsTypes.BookingStatus.Void
  && booking.lifecycle !== bookcarsTypes.ContractLifecycle.Completed
  && booking.lifecycle !== bookcarsTypes.ContractLifecycle.Cancelled
)

/**
 * Agency-scope guard shared by the staff endpoints — mirrors
 * bookingAmendmentController.amend: the caller must be agency staff of
 * the booking's agency, or a platform Admin.
 */
const loadStaffBooking = async (req: Request, res: Response) => {
  const { id } = req.params
  if (!mongoose.isValidObjectId(id)) {
    res.sendStatus(404)
    return null
  }
  const booking = await Booking.findById(id).select('+signingNonce')
  if (!booking) {
    res.sendStatus(404)
    return null
  }
  // GA-PAR-22: staff signing actions refuse a trashed booking 409
  // TRASHED (after the agency/ownership check below, before any
  // other business validation — the wall sits here so both
  // issue/revoke inherit it).
  if (booking.deletedAt) {
    res.status(409).send('TRASHED: This booking is trashed and cannot be modified. Restore it first.')
    return null
  }
  const sessionUserId = req.user?._id
  const sessionUser = sessionUserId ? await User.findById(sessionUserId) : null
  const sessionAgencyId = agencySupplierId(req)
  const isAgencyUser = !!sessionUser
    && [bookcarsTypes.UserType.Supplier, bookcarsTypes.UserType.Staff].includes(sessionUser.type as bookcarsTypes.UserType)
  if (!sessionUser || sessionUser.type === bookcarsTypes.UserType.User
    || (isAgencyUser && sessionAgencyId !== booking.supplier?.toString())) {
    logger.error(`[signing.staff] Unauthorized attempt on booking ${booking._id.toString()} by user ${sessionUserId}`)
    res.status(403).send('Forbidden: You cannot manage signing links for this booking')
    return null
  }
  return booking
}

export const issueSigningLink = async (req: Request, res: Response) => {
  try {
    const booking = await loadStaffBooking(req, res)
    if (!booking) {
      return
    }
    if (booking.onlineSignature?.signedAt) {
      res.status(409).send('SIGN_ALREADY_SIGNED: This booking is already signed online.')
      return
    }
    if (!isSignable(booking)) {
      res.status(409).send('SIGN_NOT_SIGNABLE: A cancelled, void, completed or unfinalised booking cannot be signed online.')
      return
    }
    if (!booking.signingNonce) {
      booking.signingNonce = newSigningNonce()
      await booking.save()
    }
    const { token, expiresAt } = createSigningToken(booking._id.toString(), booking.signingNonce)
    const base = String(env.FRONTEND_HOST || '').replace(/\/+$/, '')
    const response: bookcarsTypes.SigningLinkResponse = {
      url: `${base}/sign/${token}`,
      expiresAt,
    }
    res.json(response)
  } catch (err) {
    logger.error('[signing.issueSigningLink]', err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

export const revokeSigningLink = async (req: Request, res: Response) => {
  try {
    const booking = await loadStaffBooking(req, res)
    if (!booking) {
      return
    }
    if (booking.onlineSignature?.signedAt) {
      res.status(409).send('SIGN_ALREADY_SIGNED: This booking is already signed online.')
      return
    }
    // Revocation IS nonce rotation: every outstanding link dies at once.
    booking.signingNonce = newSigningNonce()
    await booking.save()
    res.json({ revoked: true })
  } catch (err) {
    logger.error('[signing.revokeSigningLink]', err)
    res.status(400).send(i18n.t('ERROR'))
  }
}

type PublicContext = {
  booking: env.Booking
  nonce: string
}

/**
 * Shared public validation pipeline. Answers the request itself and
 * returns null on any failure; on success returns the booking loaded
 * WITH its nonce plus the token's nonce. Check order is deliberate:
 * MAC/expiry first (generic), already-signed second (distinct state,
 * MAC-valid tokens only), nonce and signable state last (generic).
 */
const loadPublicBooking = async (req: Request, res: Response): Promise<PublicContext | null> => {
  hardenPublicResponse(res)
  const parsed = parseSigningToken(String(req.params.token || ''))
  if (!parsed) {
    genericInvalid(req, res, 'mac-or-expiry')
    return null
  }
  if (!mongoose.isValidObjectId(parsed.bookingId)) {
    genericInvalid(req, res, 'booking-id-shape')
    return null
  }
  const booking = await Booking.findById(parsed.bookingId).select('+signingNonce')
  if (!booking) {
    genericInvalid(req, res, 'booking-missing')
    return null
  }
  if (booking.onlineSignature?.signedAt) {
    res.status(409).json({ message: 'SIGN_ALREADY_SIGNED' })
    return null
  }
  if (!booking.signingNonce || booking.signingNonce !== parsed.nonce) {
    genericInvalid(req, res, 'nonce-mismatch')
    return null
  }
  if (!isSignable(booking)) {
    genericInvalid(req, res, 'not-signable')
    return null
  }
  return { booking, nonce: parsed.nonce }
}

export const getSigningSummary = async (req: Request, res: Response) => {
  try {
    const ctx = await loadPublicBooking(req, res)
    if (!ctx) {
      return
    }
    const { booking } = ctx
    const [supplier, car, driver] = await Promise.all([
      User.findById(booking.supplier).select('fullName').lean(),
      Car.findById(booking.car).select('name licensePlate').lean(),
      User.findById(booking.driver).select('fullName').lean(),
    ])
    const summary: bookcarsTypes.SigningSummary = {
      agencyName: supplier?.fullName || '',
      reference: booking.reference,
      carName: car?.name || '',
      carPlate: car?.licensePlate,
      from: booking.from,
      to: booking.to,
      clientName: driver?.fullName || '',
      rentalTotal: booking.financialSnapshot?.rentalTotal ?? booking.price,
      depositAmount: booking.financialSnapshot?.depositAmount ?? 0,
      currency: booking.financialSnapshot?.baseCurrency || env.BASE_CURRENCY,
    }
    res.json(summary)
  } catch (err) {
    logger.error('[signing.getSigningSummary]', err)
    if (!res.headersSent) {
      res.status(400).send(i18n.t('ERROR'))
    }
  }
}

export const signBooking = async (req: Request, res: Response) => {
  let storedFile: string | undefined
  try {
    const ctx = await loadPublicBooking(req, res)
    if (!ctx) {
      return
    }
    const { booking, nonce } = ctx

    const base64 = (req.body as bookcarsTypes.SignBookingPayload | undefined)?.signaturePngBase64
    if (typeof base64 !== 'string' || base64.length === 0 || base64.length > Math.ceil((MAX_SIGNATURE_BYTES * 4) / 3) + 4) {
      res.status(400).json({ message: 'SIGN_SIGNATURE_INVALID' })
      return
    }
    const bytes = Buffer.from(base64, 'base64')
    // PNG only, content-sniffed (the codebase's upload-validation
    // approach: magic bytes, never the claimed type), at most 1 MB —
    // and, in the signing path only (QA12 6b), structurally valid:
    // the deep check runs BEFORE any file is written or any state
    // changes, so a rejection consumes nothing and the client can
    // retry the same link with a real signature.
    if (bytes.length === 0 || bytes.length > MAX_SIGNATURE_BYTES || detectFileType(bytes) !== 'png'
      || !(await isStructurallyValidSignaturePng(bytes))) {
      res.status(400).json({ message: 'SIGN_SIGNATURE_INVALID' })
      return
    }

    storedFile = `onlinesig_${booking._id}_${crypto.randomUUID()}.png`
    await fs.writeFile(path.resolve(env.CDN_CONTRACTS, storedFile), bytes, { flag: 'wx' })
    const contentHash = crypto.createHash('sha256').update(bytes).digest('hex')
    const signedAt = new Date()

    // Record + consume in ONE conditional update: it only lands while
    // the presented nonce is still current and the booking is still
    // unsigned, so a revoked/consumed link can never sign twice, even
    // under a race. The fresh nonce replaces the consumed one.
    const result = await Booking.updateOne(
      { _id: booking._id, signingNonce: nonce, 'onlineSignature.signedAt': { $exists: false } },
      {
        $set: {
          onlineSignature: { file: storedFile, signedAt, contentHash },
          signingNonce: newSigningNonce(),
        },
      },
    )
    if (result.modifiedCount === 1) {
      // GA-PAR-13 (#43): "client signed online" email to the agency —
      // a never-throwing side-effect (the helper logs and swallows
      // every failure); the signing result never depends on it. Gated
      // by the owner's master boolean + signedContracts category.
      void notifyClientSignedOnline(booking._id.toString())
    }
    if (result.modifiedCount !== 1) {
      await fs.unlink(path.resolve(env.CDN_CONTRACTS, storedFile)).catch(() => undefined)
      storedFile = undefined
      genericInvalid(req, res, 'consume-race')
      return
    }

    res.json({ signed: true, signedAt })
  } catch (err) {
    logger.error('[signing.signBooking]', err)
    if (storedFile) {
      await fs.unlink(path.resolve(env.CDN_CONTRACTS, storedFile)).catch(() => undefined)
    }
    if (!res.headersSent) {
      hardenPublicResponse(res)
      res.status(400).send(i18n.t('ERROR'))
    }
  }
}
