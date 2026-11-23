const SiteSetting = require('../db/models/SiteSetting')
const { chatPlusAllowed } = require('../utils/accountAge')

// the switches on /gm/admin
const KEYS = ['globalSpeedChat', 'lockLogins', 'lockRegistrations', 'lockTickets', 'lockSubmissions', 'lockContests', 'lockApplications']
const LOGIN_ANNOUNCEMENT = 'admin.loginAnnouncement'
const REFRESH_MS = 5000

const idOf = key => `admin.${key}`

// read on every login, ticket and upload, so it's kept in memory and refreshed
const values = new Map()

async function refresh () {
  const rows = await SiteSetting.find({ _id: { $in: [...KEYS.map(idOf), LOGIN_ANNOUNCEMENT] } }).lean()
  for (const row of rows) values.set(row._id, row.value)
}

refresh().catch(() => {})
setInterval(() => refresh().catch(() => {}), REFRESH_MS).unref()

function isOn (key) {
  return values.get(idOf(key)) === true
}

function isStaff (account) {
  return Boolean(account) && ['Moderator', 'Administrator'].includes(account.accountType)
}

// staff always get in, they're the ones who have to turn the lock off again
function isLockedOut (key, account) {
  return isOn(key) && !isStaff(account)
}

// global speedchat takes speedchat+ and open chat off everyone but staff, at their next login
function chatPlusFor (account) {
  return chatPlusAllowed(account) && !isLockedOut('globalSpeedChat', account)
}

async function set (key, enabled) {
  if (!KEYS.includes(key)) throw new Error(`unknown setting ${key}`)
  await SiteSetting.updateOne({ _id: idOf(key) }, { $set: { value: Boolean(enabled) } }, { upsert: true })
  values.set(idOf(key), Boolean(enabled))
}

function all () {
  return Object.fromEntries(KEYS.map(key => [key, isOn(key)]))
}

function loginAnnouncement () {
  return String(values.get(LOGIN_ANNOUNCEMENT) || '')
}

async function setLoginAnnouncement (message) {
  await SiteSetting.updateOne({ _id: LOGIN_ANNOUNCEMENT }, { $set: { value: message } }, { upsert: true })
  values.set(LOGIN_ANNOUNCEMENT, message)
}

module.exports = { KEYS, isOn, isStaff, isLockedOut, chatPlusFor, set, all, loginAnnouncement, setLoginAnnouncement }
