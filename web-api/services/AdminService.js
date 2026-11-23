// the endpoints behind /gm/admin, Administrator only
const express = require('express')
const fs = require('fs')
const path = require('path')
const GmCommand = require('../db/models/GmCommand')
const Account = require('../db/models/Account')
const { isUnderThirteen } = require('../utils/accountAge')
const AdminSettings = require('./AdminSettings')
const SiteSetting = require('../db/models/SiteSetting')

// how many fairies an account can hold, read by WebService when a fairy is made. It is on unless
// switched off, so it lives with the game's settings rather than the site's
const MULTI_FAIRY = 'multiFairy'

const multiFairyCollection = () => SiteSetting.db.collection('settings')

async function multiFairyOn () {
  const setting = await multiFairyCollection().findOne({ _id: MULTI_FAIRY })
  return !setting || setting.enabled !== false
}

const MAX_ANNOUNCEMENT = 300
// how long to wait for the uberdog to pick the broadcast up
const CLAIM_WAIT_MS = 6000
const CLAIM_POLL_MS = 300

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const escapeRegex = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')


// the game reads this same setting, holidays.json says what each holiday turns on
const HOLIDAYS_SETTING = 'admin.holidays'
const HOLIDAY_CATALOG = path.join(__dirname, '..', '..', 'game-server', 'assets', 'holidays.json')
const DEFAULT_HOLIDAYS = ['masquerade']
const TAG_NAME = /^[A-Za-z0-9_]{1,64}$/

const readCatalog = () => JSON.parse(fs.readFileSync(HOLIDAY_CATALOG, 'utf8')).holidays

async function readHolidays () {
  const row = await SiteSetting.findById(HOLIDAYS_SETTING).lean()
  const value = row && row.value

  if (value && typeof value === 'object') {
    return { enabled: (value.enabled || []).map(String), extra: (value.extra || []).map(String) }
  }

  return { enabled: [...DEFAULT_HOLIDAYS], extra: [] }
}

const saveHolidays = state => SiteSetting.updateOne({ _id: HOLIDAYS_SETTING }, { $set: { value: state } }, { upsert: true })

function withEntry (list, entry, on) {
  const rest = list.filter(one => one !== entry)
  return on ? [...rest, entry] : rest
}

module.exports = ({ app, requireStaff }) => {
  async function requireAdmin (req, res) {
    const account = await requireStaff(req, res)
    if (!account) return null

    if (account.accountType !== 'Administrator') {
      res.status(403).send({ message: 'This needs an Administrator.' })
      return null
    }

    return account
  }

  // the history in the commands tab shows who changed what
  function logChange (account, command, response) {
    return GmCommand.create({
      command,
      scope: 'web',
      category: 'accounts',
      issuedBy: account._id,
      issuedByName: account.username,
      accountType: account.accountType,
      status: 'done',
      claimedBy: 'web-api',
      finishedAt: new Date(),
      response
    })
  }

  // who holds a staff tier, for the moderators card
  app.get('/fairies/api/gm/admin/staff', async (req, res) => {
    const account = await requireAdmin(req, res)
    if (!account) return

    const staff = await Account.find(
      { accountType: { $in: ['Moderator', 'Administrator'] }, deleted: { $ne: true } },
      { username: 1, accountType: 1 }
    )

    // by tier, not by the word: sorting the names puts Moderator ahead of Administrator
    const rank = one => (one.accountType === 'Administrator' ? 0 : 1)
    staff.sort((a, b) => rank(a) - rank(b) || a.username.localeCompare(b.username))

    res.send(staff.map(one => ({
      accountId: one._id, username: one.username, accountType: one.accountType, you: one._id === account._id
    })))
  })

  // a player becomes a Moderator, a Moderator goes back to a player, nothing else changes tier here
  app.post('/fairies/api/gm/admin/staff', express.json(), async (req, res) => {
    const account = await requireAdmin(req, res)
    if (!account) return

    const name = String(req.body?.username || '').trim()
    const tier = req.body?.tier

    if (!name) return res.status(400).send({ success: false, message: 'Type the Account ID first.' })
    if (!['Moderator', 'Player'].includes(tier)) {
      return res.status(400).send({ success: false, message: 'A tier can only be set to Moderator or Player here.' })
    }

    const found = await Account.find({ username: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } }).limit(2)
    if (found.length !== 1 || found[0].deleted) {
      return res.status(404).send({ success: false, message: `There is no account with the Account ID "${name}".` })
    }

    const target = found[0]
    const current = target.accountType || 'Player'

    if (target._id === account._id) {
      return res.status(403).send({ success: false, message: "You can't change your own tier." })
    }
    if (current === 'Administrator') {
      return res.status(403).send({ success: false, message: `${target.username} is an Administrator, and that can't be changed here.` })
    }
    if (current === tier) {
      return res.status(409).send({ success: false, message: `${target.username} is already ${tier === 'Moderator' ? 'a Moderator' : 'a player'}.` })
    }
    if (tier === 'Moderator' && isUnderThirteen(target)) {
      return res.status(400).send({ success: false, message: `${target.username} belongs to a player under 13, so it can't be made a Moderator.` })
    }

    await Account.updateOne({ _id: target._id }, { $set: { accountType: tier } })
    await logChange(account, `set-tier ${target.username} ${tier}`, `${target.username} is now ${tier === 'Moderator' ? 'a Moderator' : 'a player'}`)

    // a demotion has to reach a game they're already in, where the old tier stays until they log out
    if (tier === 'Player') {
      await GmCommand.create({
        command: `kick ${target._id}`,
        scope: 'global',
        category: 'moderation',
        issuedBy: account._id,
        issuedByName: account.username,
        accountType: account.accountType
      })
    }

    res.send({
      success: true,
      message: tier === 'Moderator'
        ? `${target.username} is now a Moderator. They need to log out and back in for the in-game commands.`
        : `${target.username} is a player again, and has been disconnected if they were in the game.`
    })
  })

  app.get('/fairies/api/gm/admin/holidays', async (req, res) => {
    const account = await requireAdmin(req, res)
    if (!account) return

    const state = await readHolidays()
    res.send({
      holidays: readCatalog().map(one => ({ id: one.id, label: one.label, tags: one.tags, enabled: state.enabled.includes(one.id) })),
      extra: state.extra
    })
  })

  app.post('/fairies/api/gm/admin/holiday', express.json(), async (req, res) => {
    const account = await requireAdmin(req, res)
    if (!account) return

    const { id, enabled } = req.body || {}
    const holiday = readCatalog().find(one => one.id === id)

    if (!holiday || typeof enabled !== 'boolean') {
      return res.status(400).send({ success: false, message: 'That is not a holiday.' })
    }

    const state = await readHolidays()
    await saveHolidays({ ...state, enabled: withEntry(state.enabled, holiday.id, enabled) })
    await logChange(account, `holiday ${holiday.id} ${enabled ? 'on' : 'off'}`, `${holiday.label} is now ${enabled ? 'on' : 'off'}`)
    res.send({ success: true })
  })

  // any single tag, for something the list doesn't group
  app.post('/fairies/api/gm/admin/holiday-tag', express.json(), async (req, res) => {
    const account = await requireAdmin(req, res)
    if (!account) return

    const tag = String(req.body?.tag || '').trim()
    const enabled = req.body?.enabled

    if (!TAG_NAME.test(tag) || typeof enabled !== 'boolean') {
      return res.status(400).send({ success: false, message: 'A tag is letters, numbers and underscores only.' })
    }

    const state = await readHolidays()
    await saveHolidays({ ...state, extra: withEntry(state.extra, tag, enabled) })
    await logChange(account, `holiday-tag ${tag} ${enabled ? 'on' : 'off'}`, `tag ${tag} is now ${enabled ? 'on' : 'off'}`)
    res.send({ success: true })
  })

  app.get('/fairies/api/gm/admin/settings', async (req, res) => {
    const account = await requireAdmin(req, res)
    if (!account) return

    res.send({ ...AdminSettings.all(), multiFairy: await multiFairyOn(), timeSpanMessage: AdminSettings.loginAnnouncement() })
  })

  app.post('/fairies/api/gm/admin/toggle', express.json(), async (req, res) => {
    const account = await requireAdmin(req, res)
    if (!account) return

    const { key, enabled } = req.body || {}

    if (key === MULTI_FAIRY && typeof enabled === 'boolean') {
      await multiFairyCollection().updateOne({ _id: MULTI_FAIRY }, { $set: { enabled } }, { upsert: true })
      await logChange(account, `admin-toggle ${key} ${enabled ? 'on' : 'off'}`, `${key} is now ${enabled ? 'on' : 'off'}`)
      return res.send({ success: true })
    }

    if (!AdminSettings.KEYS.includes(key) || typeof enabled !== 'boolean') {
      return res.status(400).send({ success: false, message: 'That is not a setting.' })
    }

    await AdminSettings.set(key, enabled)
    await logChange(account, `admin-toggle ${key} ${enabled ? 'on' : 'off'}`, `${key} is now ${enabled ? 'on' : 'off'}`)
    res.send({ success: true })
  })

  // any staff can broadcast and change the welcome message
  app.post('/fairies/api/gm/admin/announcement', express.json(), async (req, res) => {
    const account = await requireStaff(req, res)
    if (!account) return

    const message = String(req.body?.message || '').replace(/\s+/g, ' ').trim()

    if (!message) return res.status(400).send({ success: false, message: 'Please enter an announcement message.' })
    if (message.length > MAX_ANNOUNCEMENT) {
      return res.status(400).send({ success: false, message: `Keep it under ${MAX_ANNOUNCEMENT} characters.` })
    }

    // saved first, the uberdog re-reads it when it runs the command
    if (req.body?.saveAsLoginAnnouncement) await AdminSettings.setLoginAnnouncement(message)

    const doc = await GmCommand.create({
      command: `announce ${message}`,
      scope: 'global',
      category: 'moderation',
      issuedBy: account._id,
      issuedByName: account.username,
      accountType: account.accountType
    })

    for (let waited = 0; waited < CLAIM_WAIT_MS; waited += CLAIM_POLL_MS) {
      await sleep(CLAIM_POLL_MS)
      const row = await GmCommand.findById(doc._id).lean()

      if (row.status === 'done') return res.send({ success: true })
      if (row.status === 'failed') return res.status(500).send({ success: false, message: row.response || 'The game server could not send it.' })
    }

    res.status(504).send({ success: false, message: 'The game server did not pick it up. Is it running?' })
  })
}
