// was made obsolete by account-level ignore lists
// can run if that feature is acting up, but isn't necessary
const path = require('path')

// require() resolves against this file's own folder, which has no node_modules
// of its own, so borrow web-api's.
module.paths.push(path.join(__dirname, '../web-api/node_modules'))

require('dotenv').config({ path: path.join(__dirname, '../web-api/.env') })

const mongoose = require('mongoose')

const URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/PixieHollow'

async function main () {
  await mongoose.connect(URI)
  const db = mongoose.connection.db

  console.log(`[migrate-ignored] ${URI}`)

  const withLists = await db.collection('fairies').find(
    { ignored: { $exists: true, $ne: [] } },
    { projection: { _id: 1, name: 1, accountId: 1, ownerAccount: 1, ignored: 1 } }
  ).toArray()

  const perAccount = new Map()

  for (const fairy of withLists) {
    const key = fairy.accountId != null ? `id:${fairy.accountId}` : `name:${fairy.ownerAccount}`
    const set = perAccount.get(key) || new Set()
    for (const id of fairy.ignored) {
      const n = Number(id)
      if (Number.isFinite(n)) set.add(n)
    }
    perAccount.set(key, set)
  }

  let moved = 0

  for (const [key, set] of perAccount) {
    const query = key.startsWith('id:')
      ? { _id: Number(key.slice(3)) }
      : { username: key.slice(5) }

    const account = await db.collection('accounts').findOne(query, { projection: { ignored: 1 } })
    if (!account) {
      console.log(`  no account for ${key}, ${set.size} entries dropped`)
      continue
    }

    // Union, so a migration never un-ignores anyone.
    for (const id of account.ignored || []) {
      const n = Number(id)
      if (Number.isFinite(n)) set.add(n)
    }

    await db.collection('accounts').updateOne(query, { $set: { ignored: [...set] } })
    moved++
    console.log(`  ${key} -> ${set.size} ignored`)
  }

  const cleared = await db.collection('fairies').updateMany({}, { $unset: { ignored: '' } })

  console.log(`[migrate-ignored] accounts updated: ${moved}`)
  console.log(`[migrate-ignored] fairy documents cleaned: ${cleared.modifiedCount}`)

  await mongoose.disconnect()
}

main().catch(err => {
  console.error('[migrate-ignored] failed:', err.message)
  process.exit(1)
})
