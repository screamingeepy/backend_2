// sends one message through the real EmailService to prove the smtp settings

require('dotenv').config()

const EmailService = require('../services/EmailService')

const to = process.argv[2]

if (!to) {
  console.error('Usage: node tools/send-test-email.js <address>')
  process.exit(1)
}

const configured = Boolean(process.env.SMTP_HOST)

console.log(configured
  ? `[test-email] SMTP_HOST=${process.env.SMTP_HOST} port=${process.env.SMTP_PORT || 587} secure=${process.env.SMTP_SECURE === 'true'} user=${process.env.SMTP_USER || '(none)'}`
  : '[test-email] No SMTP_HOST set -- this will log instead of sending.')

;(async () => {
  const stamp = new Date().toISOString()

  const ok = await EmailService.sendEmail({
    to,
    subject: `Pixie Hollow test message (${stamp})`,
    text: [
      'This is a test from the Pixie Hollow web-api.',
      '',
      'If it arrived in an inbox, outbound e-mail works and support tickets,',
      'staff replies and password resets will all use this same path.',
      '',
      `Sent at ${stamp}.`
    ].join('\n')
  })

  if (!configured) {
    console.log('[test-email] Logged, not sent. Fill in the SMTP_* values in .env to send for real.')
  } else if (ok) {
    console.log(`[test-email] Handed to the provider with no error. Check ${to} -- including its Spam folder.`)
  } else {
    console.log('[test-email] FAILED. The provider error is printed above by EmailService.')
    process.exitCode = 1
  }
})()
