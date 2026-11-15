import React, { ReactNode, useEffect, useRef } from 'react'

import '@/assets/css/accordion.css'

interface AccordionProps {
  title?: string
  className?: string
  collapse?: boolean
  offsetHeight?: number
  children: ReactNode
}

const Accordion = ({
  title,
  className,
  collapse,
  offsetHeight = 0,
  children
}: AccordionProps) => {
  const accordionRef = useRef<HTMLSpanElement>(null)
  // B-F-12: keyboard-operable role=button span — Enter/Space fire the same action.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.currentTarget.click()
    }
  }

  const handleAccordionClick = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.classList.toggle('accordion-active')
    const panel = e.currentTarget.nextElementSibling as HTMLDivElement
    const _collapse = panel.classList.contains('panel-collapse')

    if (panel.style.maxHeight || _collapse) {
      if (_collapse) {
        panel.classList.remove('panel-collapse')
        panel.classList.add('panel')
      }

      panel.style.maxHeight = ''
    } else {
      panel.style.maxHeight = `${panel.scrollHeight + offsetHeight}px`
    }
  }

  useEffect(() => {
    if (collapse && accordionRef.current) {
      accordionRef.current.classList.add('accordion-active')
    }
  }, [collapse])

  useEffect(() => {
    if (collapse && accordionRef.current) {
      const panel = accordionRef.current.nextElementSibling as HTMLDivElement
      panel.style.maxHeight = `${panel.scrollHeight + offsetHeight}px`
    }
  }, [offsetHeight]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`${className ? `${className} ` : ''}accordion-container`}>
      <span
        ref={accordionRef}
        className="accordion"
        onClick={handleAccordionClick}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        style={{ minHeight: 44, padding: '9px 2px' }}
      >
        {title}
      </span>
      <div className={collapse ? 'panel-collapse' : 'panel'}>{children}</div>
    </div>
  )
}

export default Accordion
