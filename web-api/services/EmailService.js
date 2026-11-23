/* global db: writeable */


const nodemailer = require('nodemailer')

let transporter = null

function getTransporter () {
  if (transporter !== null) return transporter

  if (!process.env.SMTP_HOST) {
    console.log('[EmailService] SMTP_HOST not set -- emails will be logged, not sent.')
    transporter = false
    return transporter
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined
  })

  return transporter
}

// to is one address or an array
async function sendEmail ({ to, subject, text, html }) {
  const from = process.env.SMTP_FROM || 'Pixie Hollow <no-reply@pixiehollow.local>'
  const t = getTransporter()

  if (!t) {
    console.log(`[EmailService] (not sent, no SMTP_HOST) to=${to} subject=${JSON.stringify(subject)}\n${text || html}`)
    return true
  }

  try {
    await t.sendMail({ from, to, subject, text, html })
    return true
  } catch (err) {
    console.error('[EmailService] send failed:', err.message)
    return false
  }
}

module.exports = { sendEmail }
