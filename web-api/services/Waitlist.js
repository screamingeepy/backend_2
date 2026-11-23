const crypto = require('crypto')

const SiteSetting = require('../db/models/SiteSetting')
const WaitlistEntry = require('../db/models/WaitlistEntry')
const EmailService = require('./EmailService')

const DEFAULT_DAILY_CAP = 20
const MAX_DAILY_CAP = 10000
const CHECK_EVERY_MS = 60 * 60 * 1000
const TOKEN_PATTERN = /^[a-f0-9]{48}$/

let draining = false

function hashToken (token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

function normalizeEmail (email) {
  return String(email || '').trim().toLowerCase()
}

function startOfUtcDay (now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

async function readSetting (name, fallback) {
  const row = await SiteSetting.findById(name).lean()
  return row && row.value !== undefined ? row.value : fallback
}

async function writeSetting (name, value) {
  await SiteSetting.updateOne({ _id: name }, { $set: { value } }, { upsert: true })
}

async function getSettings () {
  return {
    enabled: (await readSetting('waitlistEnabled', false)) === true,
    dailyCap: Number(await readSetting('waitlistDailyCap', DEFAULT_DAILY_CAP))
  }
}

async function isOn () {
  return (await getSettings()).enabled
}

async function setSettings ({ enabled, dailyCap }) {
  if (enabled !== undefined) await writeSetting('waitlistEnabled', enabled === true)
  if (dailyCap !== undefined) await writeSetting('waitlistDailyCap', dailyCap)
  return getSettings()
}

async function rememberBase (base) {
  if (process.env.SITE_URL || !base) return
  await writeSetting('waitlistSiteBase', String(base).replace(/\/+$/, ''))
}

async function baseUrl () {
  if (process.env.SITE_URL) return String(process.env.SITE_URL).replace(/\/+$/, '')
  return readSetting('waitlistSiteBase', '')
}

function inviteLink (base, token) {
  return `${base}/register.html?invite=${token}`
}

async function sendInvite (email, link) {
  return EmailService.sendEmail({
    to: email,
    subject: 'Your Pixie Hollow Rewritten invitation',
    text: `It is your turn! Open this link to make your Pixie Hollow Rewritten account:\n${link}\n\n` +
      'The link is just for you and works once, so please do not share it. If you did not ask to join the waitlist, you can ignore this message.'
  })
}

async function join (email) {
  const address = normalizeEmail(email)
  try {
    await WaitlistEntry.create({ email: address })
    return 'joined'
  } catch (err) {
    if (err && err.code === 11000) return 'already'
    throw err
  }
}

async function invitedTodayCount (now = new Date()) {
  return WaitlistEntry.countDocuments({ invitedAt: { $gte: startOfUtcDay(now) }, bypass: { $ne: true } })
}

async function inviteOne (entry, base, now) {
  const token = crypto.randomBytes(24).toString('hex')
  const claimed = await WaitlistEntry.findOneAndUpdate(
    { _id: entry._id, invitedAt: null },
    { $set: { invitedAt: now, tokenHash: hashToken(token) } },
    { returnDocument: 'after' }
  )
  if (!claimed) return false

  const delivered = await sendInvite(claimed.email, inviteLink(base, token)).catch(() => false)
  if (!delivered) {
    await WaitlistEntry.updateOne({ _id: claimed._id }, { $set: { invitedAt: null, tokenHash: '' } })
    console.error(`[Waitlist] Could not e-mail an invite to ${claimed.email}; it stays in the queue.`)
    return false
  }
  return true
}

async function drain (now = new Date()) {
  if (draining) return 0
  draining = true

  try {
    const { enabled, dailyCap } = await getSettings()
    if (!enabled) return 0

    const base = await baseUrl()
    if (!base) {
      console.warn('[Waitlist] No site address known yet, so no invites can go out. Set SITE_URL, or open the waitlist box in the GM portal once.')
      return 0
    }

    let remaining = dailyCap - await invitedTodayCount(now)
    if (remaining <= 0) return 0

    let sent = 0
    const skipped = []
    while (remaining > 0) {
      const next = await WaitlistEntry.findOne({ invitedAt: null, _id: { $nin: skipped } }).sort({ joinedAt: 1 })
      if (!next) break
      if (await inviteOne(next, base, now)) {
        sent++
        remaining--
      } else {
        skipped.push(next._id)
      }
    }

    if (sent) console.log(`[Waitlist] Sent ${sent} invite${sent === 1 ? '' : 's'}.`)
    return sent
  } finally {
    draining = false
  }
}

async function bypass (email) {
  const address = normalizeEmail(email)
  const base = await baseUrl()
  if (!base) throw new Error('no site address known yet -- set SITE_URL, or open the waitlist box in the GM portal once')

  const existing = await WaitlistEntry.findOne({ email: address })
  if (existing && existing.used) throw new Error(`${address} has already made an account from an invite`)

  const token = crypto.randomBytes(24).toString('hex')
  const now = new Date()
  const keepsBypass = existing && existing.invitedAt ? existing.bypass : true
  await WaitlistEntry.updateOne(
    { email: address },
    { $set: { invitedAt: now, tokenHash: hashToken(token), bypass: keepsBypass, revokedAt: null }, $setOnInsert: { joinedAt: now } },
    { upsert: true }
  )

  const link = inviteLink(base, token)
  const delivered = await sendInvite(address, link).catch(() => false)
  return { delivered, link }
}

const views = {
  waiting: { invitedAt: null },
  invited: { invitedAt: { $ne: null }, used: { $ne: true }, revokedAt: null },
  registered: { used: true },
  revoked: { revokedAt: { $ne: null }, used: { $ne: true } },
  all: {}
}

function statusOf (entry) {
  if (entry.used) return 'registered'
  if (entry.revokedAt) return 'revoked'
  if (entry.invitedAt) return 'invited'
  return 'waiting'
}

async function list ({ view = 'waiting', search = '', page = 1, pageSize = 10 } = {}) {
  const query = { ...(views[view] || views.waiting) }
  const term = String(search || '').trim().toLowerCase()
  if (term) query.email = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

  const size = Math.max(1, Math.min(50, Number(pageSize) || 10))
  const skip = (Math.max(1, Number(page) || 1) - 1) * size
  const order = view === 'waiting' || view === 'all' ? { joinedAt: 1 } : { invitedAt: -1 }

  const [total, rows] = await Promise.all([
    WaitlistEntry.countDocuments(query),
    WaitlistEntry.find(query).sort(order).skip(skip).limit(size).lean()
  ])

  return {
    total,
    items: rows.map(row => ({
      id: String(row._id),
      email: row.email,
      joinedAt: row.joinedAt,
      invitedAt: row.invitedAt,
      revokedAt: row.revokedAt,
      bypass: row.bypass === true,
      usedBy: row.usedBy || '',
      status: statusOf(row)
    }))
  }
}

async function inviteNow (id) {
  const base = await baseUrl()
  if (!base) throw new Error('no site address known yet -- set SITE_URL, or save the waitlist settings once')

  const token = crypto.randomBytes(24).toString('hex')
  const before = await WaitlistEntry.findOneAndUpdate(
    { _id: id, used: { $ne: true }, $or: [{ invitedAt: null }, { revokedAt: { $ne: null } }] },
    { $set: { invitedAt: new Date(), tokenHash: hashToken(token), bypass: false, revokedAt: null } },
    { returnDocument: 'before' }
  )
  if (!before) throw new Error('that address is not waiting for an invite (it may already have one, or have signed up)')

  const delivered = await sendInvite(before.email, inviteLink(base, token)).catch(() => false)
  if (!delivered) {
    await WaitlistEntry.updateOne({ _id: id }, {
      $set: { invitedAt: before.invitedAt, tokenHash: before.tokenHash, bypass: before.bypass, revokedAt: before.revokedAt }
    })
    throw new Error(`the e-mail to ${before.email} could not be sent, so nothing changed`)
  }
  return before.email
}

async function revoke (id) {
  const entry = await WaitlistEntry.findOneAndUpdate(
    { _id: id, used: { $ne: true }, invitedAt: { $ne: null }, revokedAt: null },
    { $set: { tokenHash: '', revokedAt: new Date() } },
    { returnDocument: 'after' }
  )
  if (!entry) throw new Error('that invite is not outstanding (it may already be used or revoked)')
  return entry.email
}

async function checkToken (token) {
  if (!TOKEN_PATTERN.test(String(token || ''))) return null
  return WaitlistEntry.findOne({ tokenHash: hashToken(token), used: { $ne: true } })
}

async function claimToken (token) {
  if (!TOKEN_PATTERN.test(String(token || ''))) return null
  return WaitlistEntry.findOneAndUpdate(
    { tokenHash: hashToken(token), used: { $ne: true } },
    { $set: { used: true, usedAt: new Date() } },
    { returnDocument: 'after' }
  )
}

async function releaseToken (entry) {
  if (entry) await WaitlistEntry.updateOne({ _id: entry._id }, { $set: { used: false, usedAt: null, usedBy: '' } })
}

async function markUsedBy (entry, username) {
  if (entry) await WaitlistEntry.updateOne({ _id: entry._id }, { $set: { usedBy: username } })
}

async function overview () {
  const settings = await getSettings()
  const [waiting, invitedToday, invited, registered, outstanding, revoked] = await Promise.all([
    WaitlistEntry.countDocuments(views.waiting),
    invitedTodayCount(),
    WaitlistEntry.countDocuments({ invitedAt: { $ne: null } }),
    WaitlistEntry.countDocuments(views.registered),
    WaitlistEntry.countDocuments(views.invited),
    WaitlistEntry.countDocuments(views.revoked)
  ])

  return {
    ...settings,
    waiting,
    invitedToday,
    remainingToday: Math.max(0, settings.dailyCap - invitedToday),
    invited,
    outstanding,
    revoked,
    registered
  }
}

function start () {
  const run = () => drain().catch(err => console.error('[Waitlist] Failed:', err.message))
  setTimeout(run, 60 * 1000).unref()
  setInterval(run, CHECK_EVERY_MS).unref()
  console.log('[Waitlist] When the waitlist is on, sends the day\'s invites (oldest first), checked every hour.')
}

module.exports = {
  start,
  drain,
  join,
  bypass,
  list,
  inviteNow,
  revoke,
  isOn,
  getSettings,
  setSettings,
  rememberBase,
  checkToken,
  claimToken,
  releaseToken,
  markUsedBy,
  overview,
  normalizeEmail,
  startOfUtcDay,
  MAX_DAILY_CAP
}
