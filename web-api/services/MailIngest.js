
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const { ImapFlow } = require('imapflow')
const { simpleParser } = require('mailparser')

const SupportTicket = require('../db/models/SupportTicket')
const Account = require('../db/models/Account')
const EmailService = require('./EmailService')
const DiscordService = require('./DiscordService')
const { sniffImageType, uploadFileName, ACCEPTED_IMAGE_TYPES } = require('../utils/images')

const WEB_ROOT = path.join(__dirname, '../../web')
const TICKET_UPLOAD_DIR = 'site/uploads/tickets'
const MAX_ATTACHMENTS = 5

const POLL_MS = Number(process.env.MAIL_POLL_MS || 60 * 1000)
const MAILBOX = process.env.IMAP_MAILBOX || 'INBOX'
const MAX_UNSEEN = Number(process.env.MAIL_INGEST_MAX_UNSEEN || 25)
const MAX_PER_POLL = Number(process.env.MAIL_INGEST_MAX_PER_POLL || 20)
const CONFIRMED = String(process.env.MAIL_INGEST_CONFIRM || '').toLowerCase() === 'yes'

const SINCE = process.env.MAIL_INGEST_SINCE ? new Date(process.env.MAIL_INGEST_SINCE) : null

// MAIL_INGEST_IGNORE_DOMAINS adds more, comma separated. A listed domain also covers its subdomains
const IGNORED_DOMAINS = [
  'hetzner.com', 'hetzner.de', 'hetzner.cloud', 'your-server.de',
  ...String(process.env.MAIL_INGEST_IGNORE_DOMAINS || '').split(',')
].map(domain => domain.trim().toLowerCase().replace(/^@/, '')).filter(Boolean)

// a support desk or system mailbox writing to us, as opposed to a person
const SYSTEM_SENDER = /^(support|helpdesk|abuse|billing|invoices?|accounts?|security|notifications?|alerts?|status|system|admin|administrator|hostmaster|webmaster|noc|monitoring)([._+-]|$)/i

function config () {
  // IMAP_HOST must be set on purpose, sending and receiving are separate decisions
  const host = process.env.IMAP_HOST
  const user = process.env.IMAP_USER || process.env.SMTP_USER
  const pass = process.env.IMAP_PASS || process.env.SMTP_PASS

  if (!host || !user || !pass) return null

  return {
    host,
    port: Number(process.env.IMAP_PORT || 993),
    secure: process.env.IMAP_SECURE !== 'false',
    auth: { user, pass },
    logger: false
  }
}

// never turn automatic mail into a ticket
function shouldIgnore (parsed, ourAddress) {
  const header = name => String(parsed.headers.get(name) || '').toLowerCase()

  const autoSubmitted = header('auto-submitted')
  if (autoSubmitted && autoSubmitted !== 'no') return 'auto-submitted'

  const precedence = header('precedence')
  if (['bulk', 'list', 'junk', 'auto_reply'].includes(precedence)) return 'precedence: ' + precedence

  if (parsed.headers.get('list-id') || parsed.headers.get('list-unsubscribe')) return 'mailing list'
  if (parsed.headers.get('x-autoreply') || parsed.headers.get('x-autorespond')) return 'autoresponder'

  const from = fromAddress(parsed)
  if (!from) return 'no sender'

  const local = from.split('@')[0]
  if (/(^|[._+-])(mailer-daemon|postmaster|no-?reply|do-?not-?reply|donotreply)([._+-]|$)/i.test(local)) {
    return 'automated sender'
  }
  if (ourAddress && from === ourAddress.toLowerCase()) return 'our own address'

  const domain = from.split('@')[1] || ''
  if (IGNORED_DOMAINS.some(listed => domain === listed || domain.endsWith('.' + listed))) return 'ignored sender domain'
  if (SYSTEM_SENDER.test(local)) return 'support or system sender'

  return null
}

function fromAddress (parsed) {
  const first = parsed.from && parsed.from.value && parsed.from.value[0]
  return first && first.address ? String(first.address).toLowerCase() : ''
}

// cut quoted history so a reply doesn't drag the whole thread back in
const QUOTE_MARKERS = [
  /^On .*wrote:\s*$/m,
  /^-{2,}\s*Original Message\s*-{2,}/mi,
  /^_{10,}\s*$/m,
  /^-{3,}\s*Forwarded message\s*-{3,}/mi,
  /^From:\s.*\son\s.*:?\s*$/mi,
  /^\s*Sent from my \w+/m
]

function stripQuoted (text) {
  let cut = String(text || '')

  for (const marker of QUOTE_MARKERS) {
    const found = cut.search(marker)
    if (found > 0) cut = cut.slice(0, found)
  }

  const lines = cut.split(/\r?\n/)
  while (lines.length && /^\s*>/.test(lines[lines.length - 1])) lines.pop()

  return lines.join('\n').trim()
}

async function saveAttachments (parsed) {
  const saved = []
  const skipped = []

  for (const file of parsed.attachments || []) {
    const label = String(file.filename || 'attachment').slice(0, 120)

    if (saved.length >= MAX_ATTACHMENTS) {
      skipped.push({ label, reason: `more than ${MAX_ATTACHMENTS} attachments` })
      continue
    }
    if (!file.content || !file.content.length) {
      skipped.push({ label, reason: 'empty' })
      continue
    }
    if (file.content.length > 4 * 1024 * 1024) {
      skipped.push({ label, reason: 'over 4MB' })
      continue
    }

    const type = sniffImageType(file.content)
    if (!type) {
      skipped.push({ label, reason: `not a supported image type (${ACCEPTED_IMAGE_TYPES})` })
      continue
    }

    const dir = path.join(WEB_ROOT, TICKET_UPLOAD_DIR)
    await fs.promises.mkdir(dir, { recursive: true })

    const name = uploadFileName(file.filename, type.ext)
    await fs.promises.writeFile(path.join(dir, name), file.content)

    saved.push({ url: `/${TICKET_UPLOAD_DIR}/${name}`, name: label })
  }

  if (skipped.length) {
    console.log('[MailIngest] dropped ' + skipped.length + ' attachment(s): ' +
      skipped.map(s => `"${s.label}" (${s.reason})`).join(', '))
  }

  return { saved, skipped }
}

const TICKET_TAG = /\[Ticket #([a-f0-9]{24})\]/i

async function handleMessage (parsed, ourAddress) {
  const messageId = String(parsed.messageId || '').slice(0, 300)

  // the same mail twice is the normal outcome of dying mid-poll, not an error.
  if (messageId && await SupportTicket.exists({ 'messages.emailMessageId': messageId })) {
    return 'already filed'
  }

  const ignore = shouldIgnore(parsed, ourAddress)
  if (ignore) return 'ignored (' + ignore + ')'

  const from = fromAddress(parsed)
  const subject = String(parsed.subject || '').trim().slice(0, 120) || '(no subject)'
  let body = stripQuoted(parsed.text || parsed.textAsHtml || '').slice(0, 5000) || '(empty message)'
  const { saved: attachments, skipped } = await saveAttachments(parsed)

  if (skipped.length) {
    body += '\n\n[' + skipped.map(s => `Could not attach "${s.label}" (${s.reason}).`).join(' ') + ']'
    body = body.slice(0, 5000)
  }

  const tagged = subject.match(TICKET_TAG)

  if (tagged) {
    const ticket = await SupportTicket.findById(tagged[1]).catch(() => null)

    // the ticket tag is in a subject anyone can type
    if (ticket && String(ticket.email || '').toLowerCase() === from) {
      ticket.messages.push({ from: 'player', body, emailMessageId: messageId })
      if (attachments.length) ticket.attachments.push(...attachments)
      ticket.status = 'open'
      ticket.updatedAt = new Date()
      await ticket.save()
      return `appended to #${ticket._id}`
    }
  }

  const matches = await Account.find({ email: new RegExp('^' + from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }).sort({ _id: 1 })

  // an email can sit on several accounts and nothing in the message says which one it is about,
  // so only link the ticket when there is exactly one. otherwise staff are shown the candidates
  const account = matches.length === 1 ? matches[0] : null
  const details = matches.length > 1 ? { 'Accounts on this email': matches.map(a => a.username).join(', ') } : {}

  const ticket = await SupportTicket.create({
    accountId: account ? account._id : null,
    viewToken: account ? '' : crypto.randomBytes(24).toString('hex'),
    email: from,
    category: 'general',
    subject,
    playerName: account ? account.username : '',
    source: 'email',
    details,
    attachments,
    messages: [{ from: 'player', body, emailMessageId: messageId }]
  })

  await EmailService.sendEmail({
    to: from,
    subject: `[Ticket #${ticket._id}] ${subject}`,
    text: `We've got your message and will reply here by email.${matches.length > 1 ? '\n\nThis email address is on more than one account, so please tell us which account or fairy name this is about.' : ''}${ticket.viewToken && process.env.SITE_URL ? `\n\nYou can also read our reply and write back here:\n${String(process.env.SITE_URL).replace(/\/+$/, '')}/contactUs.html?ticket=${ticket.viewToken}\n\nKeep it to yourself -- anyone with the link can read this message.` : ''}`
  })

  await DiscordService.notifyTicket({
    ticketId: ticket._id,
    subject,
    category: 'E-mail',
    fromEmail: from,
    playerName: ticket.playerName,
    reportedName: ''
  }).catch(() => null)

  return `opened #${ticket._id}`
}

let running = false

async function pollOnce () {
  const settings = config()
  if (!settings || running) return

  running = true
  const client = new ImapFlow(settings)

  try {
    await client.connect()
    const lock = await client.getMailboxLock(MAILBOX)

    try {
      const criteria = { seen: false }
      if (SINCE && !isNaN(SINCE)) criteria.since = SINCE

      const unseen = (await client.search(criteria)) || []

      if (unseen.length > MAX_UNSEEN && !CONFIRMED) {
        console.error(
          `[MailIngest] ${unseen.length} unread messages in ${MAILBOX} -- that is more than MAX_UNSEEN (${MAX_UNSEEN}), ` +
          'so nothing has been read. This usually means it is pointed at an ordinary inbox rather than a support mailbox. ' +
          'Point IMAP_MAILBOX at the right folder, or set MAIL_INGEST_SINCE to skip the backlog, or set MAIL_INGEST_CONFIRM=yes if this really is all support mail.'
        )
        return
      }

      for (const uid of unseen.slice(0, MAX_PER_POLL)) {
        const downloaded = await client.download(uid)
        const parsed = await simpleParser(downloaded.content)

        let outcome
        try {
          outcome = await handleMessage(parsed, settings.auth.user)
        } catch (err) {
          // leave it unseen so the next poll tries again, and say why.
          console.error('[MailIngest] Could not file a message:', err.message)
          continue
        }

        await client.messageFlagsAdd(uid, ['\\Seen'])
        console.log(`[MailIngest] ${outcome} (from ${fromAddress(parsed) || 'unknown'})`)
      }
    } finally {
      lock.release()
    }
  } catch (err) {
    console.error('[MailIngest] Poll failed:', err.message)
  } finally {
    try { await client.logout() } catch { /* already gone */ }
    running = false
  }
}

function start () {
  const settings = config()

  if (!settings) {
    console.log('[MailIngest] IMAP_HOST is not set -- inbound mail is not being read.')
    return
  }

  setInterval(() => { pollOnce().catch(() => null) }, POLL_MS)
  pollOnce().catch(() => null)
  console.log(
    `[MailIngest] Watching ${settings.auth.user} (${MAILBOX}) every ${Math.round(POLL_MS / 1000)}s` +
    `${SINCE && !isNaN(SINCE) ? `, ignoring anything before ${SINCE.toISOString().slice(0, 10)}` : ''}.`
  )
}

module.exports = { start, pollOnce, stripQuoted, shouldIgnore, handleMessage }
