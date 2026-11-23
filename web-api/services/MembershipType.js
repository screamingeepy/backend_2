/* global mongoose: writeable */

// monthly diamond allowance

const { memberDaysFor } = require('../utils/memberDays')

const DIAMONDS_BY_TIER = {
  0: 0,
  1: 30,
  2: 60,
  3: 120,
  4: 240,
  5: 0,
}

const TIER_LABELS = {
  0: 'Free',
  1: 'Weekly',
  2: 'Monthly',
  3: 'Semiannual',
  4: 'Annual',
  5: 'Member (No Diamonds)',
}

const DRIP_DAYS = 30

async function runMembershipDrip({ dryRun = false } = {}) {
  const Account = require('../db/models/Account')
  const Fairy = require('../db/models/Fairy')

  const accounts = await Account.find({ membershipTier: { $gte: 1 }, deleted: { $ne: true } })

  let awarded = 0
  let baselined = 0

  for (const account of accounts) {
    const days = await memberDaysFor(account)
    if (days < 0) continue

    const due = Math.floor(days / DRIP_DAYS)
    const paid = account.membershipDripsPaid

    if (paid === null || paid === undefined) {
      if (!dryRun) await Account.updateOne({ _id: account._id, membershipDripsPaid: null }, { $set: { membershipDripsPaid: due } })
      baselined++
      continue
    }

    if (due <= paid) continue

    const tier = account.membershipTier ?? 4
    const diamonds = DIAMONDS_BY_TIER[tier] ?? 0

    if (diamonds === 0) {
      if (!dryRun) await Account.updateOne({ _id: account._id, membershipDripsPaid: paid }, { $set: { membershipDripsPaid: due } })
      continue
    }

    const fairies = await Fairy.find({ $or: [{ ownerAccount: account.username }, { accountId: account._id }] })
    if (!fairies.length) {
      console.warn(`[MembershipType] No fairies found for account ${account._id} (playerId ${account.username})`)
      continue
    }

    const total = diamonds * (due - paid)
    const newTotal = Math.max(...fairies.map(f => f.gold || 0)) + total

    if (dryRun) {
      console.log(`[MembershipType] dry run: ${account.username} day ${days}, periods ${paid} -> ${due}, would add ${total} diamonds (wallet ${newTotal})`)
      awarded++
      continue
    }

    const claim = await Account.updateOne({ _id: account._id, membershipDripsPaid: paid }, { $set: { membershipDripsPaid: due } })
    if (claim.modifiedCount !== 1) continue

    await Fairy.updateMany(
      { _id: { $in: fairies.map(f => f._id) } },
      { $set: { gold: newTotal } }
    )

    console.log(`[MembershipType] +${total} diamonds (${due - paid} period${due - paid === 1 ? '' : 's'}) → shared wallet now ${newTotal} (${fairies.length} fairies, ${TIER_LABELS[tier]} member, account ${account._id})`)
    awarded++
  }

  if (awarded || baselined) {
    console.log(`[MembershipType] ${dryRun ? 'Dry run' : 'Done'}. ${awarded} paid, ${baselined} baselined.`)
  }
  return { awarded, baselined }
}

const INTERVAL_MS = 60 * 60 * 1000

function runQuietly() {
  runMembershipDrip().catch(err =>
    console.error('[MembershipType] Error during drip:', err)
  )
}

function start() {
  setInterval(runQuietly, INTERVAL_MS)
  setTimeout(runQuietly, 30 * 1000)
  console.log('[MembershipType] Scheduler started - checks hourly, pays one allowance per 30 days of membership.')
}

module.exports = { start, runMembershipDrip, DIAMONDS_BY_TIER, TIER_LABELS, DRIP_DAYS }
