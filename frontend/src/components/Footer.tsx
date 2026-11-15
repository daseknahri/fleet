import React from 'react'
import { useNavigate } from 'react-router-dom'
import { IconButton, Link } from '@mui/material'
import {
  MailOutline,
  FacebookTwoTone as FacebookIcon,
  X,
  LinkedIn,
  Instagram,
} from '@mui/icons-material'
import * as bookcarsTypes from ':bookcars-types'
import { strings } from '@/lang/footer'
import NewsletterForm from '@/components/NewsletterForm'
import env from '@/config/env.config'

import Stripe from '@/assets/img/stripe.png'
import PayPal from '@/assets/img/paypal.png'
import '@/assets/css/footer.css'

const SecurePayment = env.PAYMENT_GATEWAY === bookcarsTypes.PaymentGateway.Stripe ? Stripe : PayPal

const Footer = () => {
  const navigate = useNavigate()

  return (
    <div className="footer">
      <div className="header">{env.WEBSITE_NAME}</div>
      <section className="main">
        <div className="main-section">
          <div className="title">{strings.CORPORATE}</div>
          <ul className="links">
            <li><Link href="/about" underline="hover" color="inherit" onClick={(e) => { e.preventDefault(); navigate('/about') }}>{strings.ABOUT}</Link></li>
            <li><Link href="/cookie-policy" underline="hover" color="inherit" onClick={(e) => { e.preventDefault(); navigate('/cookie-policy') }}>{strings.COOKIE_POLICY}</Link></li>
            <li><Link href="/privacy" underline="hover" color="inherit" onClick={(e) => { e.preventDefault(); navigate('/privacy') }}>{strings.PRIVACY_POLICY}</Link></li>
            <li><Link href="/tos" underline="hover" color="inherit" onClick={(e) => { e.preventDefault(); navigate('/tos') }}>{strings.TOS}</Link></li>
          </ul>
        </div>
        <div className="main-section">
          <div className="title">{strings.RENT}</div>
          <ul className="links">
            {!env.HIDE_SUPPLIERS && <li><Link href="/suppliers" underline="hover" color="inherit" onClick={(e) => { e.preventDefault(); navigate('/suppliers') }}>{strings.SUPPLIERS}</Link></li>}
            <li><Link href="/locations" underline="hover" color="inherit" onClick={(e) => { e.preventDefault(); navigate('/locations') }}>{strings.LOCATIONS}</Link></li>
          </ul>
        </div>
        <div className="main-section">
          <div className="title">{strings.SUPPORT}</div>
          <ul className="links">
            <li><Link href="/contact" underline="hover" color="inherit" onClick={(e) => { e.preventDefault(); navigate('/contact') }}>{strings.CONTACT}</Link></li>
            <li><Link href="/faq" underline="hover" color="inherit" onClick={(e) => { e.preventDefault(); navigate('/faq') }}>{strings.FAQ}</Link></li>
          </ul>
          <div className="footer-contact">
            <MailOutline className="icon" />
            <a href={`mailto:${env.CONTACT_EMAIL}`}>{env.CONTACT_EMAIL}</a>
          </div>
          <div className="footer-contact">
            <IconButton href="https://www.facebook.com/" target="_blank" aria-label="Facebook" className="social-icon"><FacebookIcon /></IconButton>
            <IconButton href="https://x.com/" target="_blank" aria-label="X" className="social-icon"><X /></IconButton>
            <IconButton href="https://www.linkedin.com/" target="_blank" aria-label="LinkedIn" className="social-icon"><LinkedIn /></IconButton>
            <IconButton href="https://www.instagram.com/" target="_blank" aria-label="Instagram" className="social-icon"><Instagram /></IconButton>
          </div>
          <div className="newsletter">
            <NewsletterForm />
          </div>
        </div>
      </section>
      <section className="payment">
        <div
          className="payment-text"
          style={{ margin: env.PAYMENT_GATEWAY === bookcarsTypes.PaymentGateway.PayPal ? '0 20px' : '-25px 10px 0 0' }}
        >
          {strings.SECURE_PAYMENT}
        </div>
        <img
          src={SecurePayment}
          alt=""
          style={{ height: env.PAYMENT_GATEWAY === bookcarsTypes.PaymentGateway.PayPal ? 64 : 'auto' }}
        />
      </section>
      <section className="copyright">
        <div className="copyright">
          <span>{strings.COPYRIGHT_PART1}</span>
          <span>{strings.COPYRIGHT_PART2}</span>
        </div>
      </section>
    </div>
  )
}
export default Footer
