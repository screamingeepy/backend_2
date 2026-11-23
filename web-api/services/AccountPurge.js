/* global mongoose: writeable */

const DELETE_GRACE_DAYS = 30
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

const keptTicketCategories = ['memberReport', 'banAppeal']

async function purgeAccount (account) {
  const Account = require('../db/models/Account')
  const Fairy = require('../db/models/Fairy')
  const SupportTicket = require('../db/models/SupportTicket')

  await Fairy.deleteMany({ $or: [{ accountId: account._id }, { ownerAccount: account.username }] })
  await SupportTicket.deleteMany({ accountId: account._id, category: { $nin: keptTicketCategories } })
  await Account.deleteOne({ _id: account._id })
  console.log(`[AccountPurge] Permanently removed account ${account.username}`)
}

async function purgeExpired (now = new Date()) {
  const Account = require('../db/models/Account')

  const cutoff = new Date(now.getTime() - DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000)
  const expired = await Account.find({ deleted: true, deletedAt: { $lte: cutoff } })

  for (const account of expired) await purgeAccount(account)

  return expired.length
}

function start () {
  const run = () => purgeExpired().catch(err => console.error('[AccountPurge] Failed:', err.message))
  setTimeout(run, 60 * 1000).unref()
  setInterval(run, CHECK_EVERY_MS).unref()
  console.log(`[AccountPurge] Removes deleted accounts ${DELETE_GRACE_DAYS} days after deletion, checked every 6 hours.`)
}

module.exports = { start, purgeAccount, purgeExpired, DELETE_GRACE_DAYS }
