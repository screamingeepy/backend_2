const DAY_MS = 24 * 60 * 60 * 1000

async function memberDaysFor(account) {
  if (!account || !(Number(account.membershipTier) >= 1)) return -1

  if (!account.membershipSince) {
    const Fairy = require('../db/models/Fairy')
    const first = await Fairy.findOne({ $or: [{ ownerAccount: account.username }, { accountId: account._id }] }).sort({ created: 1 })
    account.membershipSince = first?.created ?? new Date()
    await account.save()
  }

  return Math.max(0, Math.floor((Date.now() - new Date(account.membershipSince).getTime()) / DAY_MS))
}

module.exports = { memberDaysFor }
