import React, { useEffect, useState } from 'react'
const MEDIA_FALLBACK = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400"><rect width="640" height="400" fill="#eef2f7"/><path d="M168 246h304l-28-84H196z" fill="#c7d2e0"/><circle cx="230" cy="266" r="24" fill="#7d8da6"/><circle cx="410" cy="266" r="24" fill="#7d8da6"/><rect x="214" y="184" width="212" height="62" rx="18" fill="#9eafc4"/></svg>')}`

interface SafeImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src?: string
  fallbackSrc?: string
}

// Keep optional CDN media from breaking a whole route when an asset is absent.
const SafeImage = ({ src, fallbackSrc = MEDIA_FALLBACK, onError, ...props }: SafeImageProps) => {
  const initialSrc = src || fallbackSrc
  const [currentSrc, setCurrentSrc] = useState(initialSrc)

  useEffect(() => {
    setCurrentSrc(initialSrc)
  }, [initialSrc])

  const handleError = (event: React.SyntheticEvent<HTMLImageElement, Event>) => {
    if (onError) {
      onError(event)
    }

    if (currentSrc !== fallbackSrc) {
      setCurrentSrc(fallbackSrc)
    }
  }

  return (
    <img
      {...props}
      src={currentSrc}
      onError={handleError}
    />
  )
}

export default SafeImage
