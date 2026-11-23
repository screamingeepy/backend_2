// run with node migrate-friends-options-to-account.js [--apply]
const fs = require('fs')
const path = require('path')

module.paths.push(path.join(__dirname, '../web-api/node_modules'))

require('dotenv').config({ path: path.join(__dirname, '../web-api/.env') })

const mongoose = require('mongoose')

const URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/PixieHollow'
const MAX_FRIENDS = 300
const APPLY = process.argv.includes('--apply')

// Moves friends, ignored and optionsBitmask from the fairies onto their account.
// Dry run unless --apply. Fairy documents are never touched, so they stay as a fallback.
// Stop the game server before --apply: the friends manager caches lists and writes whole arrays.

function ids (list) {
  const out = []
  for (const value of Array.isArray(list) ? list : Object.values(list || {})) {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) out.push(n)
  }
  return out
}

function chosenFirst (account, fairies) {
  const raw = Array.isArray(account.playerId) ? account.playerId[0] : account.playerId
  const chosen = Number(raw)
  return [...fairies].sort((a, b) => {
    if (a._id === chosen) return -1
    if (b._id === chosen) return 1
    return new Date(a.created || 0) - new Date(b.created || 0)
  })
}

async function main () {
  await mongoose.connect(URI)
  const db = mongoose.connection.db

  console.log(`[migrate-account] ${URI} ${APPLY ? 'APPLY' : 'dry run'}`)

  const accounts = await db.collection('accounts').find({}, {
    projection: { _id: 1, username: 1, playerId: 1, friends: 1, ignored: 1, optionsBitmask: 1, deleted: 1 }
  }).toArray()

  const fairies = await db.collection('fairies').find(
    { deleted: { $ne: true }, famousFairy: { $ne: true } },
    { projection: { _id: 1, accountId: 1, ownerAccount: 1, created: 1, friends: 1, ignored: 1, optionsBitmask: 1 } }
  ).toArray()

  const byId = new Map(accounts.map(a => [a._id, a]))
  const byName = new Map(accounts.map(a => [a.username, a]))
  const live = new Set(accounts.filter(a => !a.deleted).map(a => a._id))

  const owned = new Map()
  for (const fairy of fairies) {
    const account = byId.get(fairy.accountId) || byName.get(fairy.ownerAccount)
    if (!account) continue
    if (!owned.has(account._id)) owned.set(account._id, [])
    owned.get(account._id).push(fairy)
  }

  const stats = {
    accounts: accounts.length, withFairies: owned.size, multiFairy: 0,
    friendEntries: 0, fromNonPrimary: 0, droppedUnknown: 0, droppedSelf: 0, truncated: 0,
    reciprocityAdded: 0, reciprocityDropped: 0,
    ignoredAdded: 0, optionsSet: 0, optionsDiffer: 0
  }

  const friends = new Map()
  const ignored = new Map()
  const options = new Map()

  for (const [accountId, theirs] of owned) {
    const account = byId.get(accountId)
    const ordered = chosenFirst(account, theirs)
    if (ordered.length > 1) stats.multiFairy++

    const seen = new Set()
    const list = []

    const take = (id, primary) => {
      if (id === accountId) { stats.droppedSelf++; return }
      if (!live.has(id)) { stats.droppedUnknown++; return }
      if (seen.has(id)) return
      seen.add(id)
      list.push(id)
      stats.friendEntries++
      if (!primary) stats.fromNonPrimary++
    }

    ids(account.friends).forEach(id => take(id, true))
    ordered.forEach((fairy, i) => ids(fairy.friends).forEach(id => take(id, i === 0)))

    if (list.length > MAX_FRIENDS) {
      stats.truncated++
      list.length = MAX_FRIENDS
    }
    friends.set(accountId, list)

    const merged = new Set(ids(account.ignored))
    const before = merged.size
    ordered.forEach(fairy => ids(fairy.ignored).forEach(id => merged.add(id)))
    merged.delete(accountId)
    stats.ignoredAdded += merged.size - before
    ignored.set(accountId, [...merged])

    if (typeof account.optionsBitmask !== 'number') {
      const masks = ordered.map(f => f.optionsBitmask).filter(m => typeof m === 'number')
      if (masks.length) {
        options.set(accountId, masks[0])
        stats.optionsSet++
        if (new Set(masks).size > 1) stats.optionsDiffer++
      }
    }
  }

  // every friendship is two-sided: add the missing half, or drop it when that list is full
  for (const [accountId, list] of friends) {
    for (const friendId of [...list]) {
      const theirs = friends.get(friendId)
      if (!theirs) {
        // a friend with no fairies in this pass keeps their existing list untouched
        continue
      }
      if (theirs.includes(accountId)) continue
      if (theirs.length < MAX_FRIENDS) {
        theirs.push(accountId)
        stats.reciprocityAdded++
      } else {
        list.splice(list.indexOf(friendId), 1)
        stats.reciprocityDropped++
      }
    }
  }

  console.log(stats)

  if (!APPLY) {
    console.log('[migrate-account] dry run, nothing written. Re-run with --apply.')
    await mongoose.disconnect()
    return
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFile = path.join(__dirname, `migrate-account-backup-${stamp}.json`)
  const backup = accounts.map(a => ({ _id: a._id, friends: a.friends ?? null, ignored: a.ignored ?? [], optionsBitmask: a.optionsBitmask ?? null }))
  fs.writeFileSync(backupFile, JSON.stringify(backup))
  console.log(`[migrate-account] backup of ${backup.length} accounts -> ${backupFile}`)

  const writes = []
  for (const accountId of owned.keys()) {
    const $set = { friends: friends.get(accountId), ignored: ignored.get(accountId) }
    if (options.has(accountId)) $set.optionsBitmask = options.get(accountId)
    writes.push({ updateOne: { filter: { _id: accountId }, update: { $set } } })
  }

  for (let i = 0; i < writes.length; i += 500) {
    await db.collection('accounts').bulkWrite(writes.slice(i, i + 500), { ordered: false })
  }

  console.log(`[migrate-account] accounts updated: ${writes.length}`)
  await mongoose.disconnect()
}

main().catch(err => {
  console.error('[migrate-account] failed:', err.message)
  process.exit(1)
})
