const path = require('path')

module.paths.push(path.join(__dirname, '../web-api/node_modules'))

require('dotenv').config({ path: path.join(__dirname, '../web-api/.env') })

const mongoose = require('mongoose')

const URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/PixieHollow'

async function main () {
  await mongoose.connect(URI)
  const db = mongoose.connection.db

  console.log(`[migrate-gmvisible] ${URI}`)

  const flagged = await db.collection('fairies').find(
    { gmVisible: true },
    { projection: { _id: 1, name: 1, accountId: 1, ownerAccount: 1 } }
  ).toArray()

  if (!flagged.length) {
    console.log('[migrate-gmvisible] No fairy has gmVisible set. Nothing to move.')
  }

  let moved = 0
  const missing = []

  for (const fairy of flagged) {
    const query = fairy.accountId != null
      ? { _id: fairy.accountId }
      : { username: fairy.ownerAccount }

    const result = await db.collection('accounts').updateOne(query, { $set: { gmVisible: true } })

    if (result.matchedCount) {
      moved++
      console.log(`  ${fairy.name} -> account ${fairy.accountId ?? fairy.ownerAccount}`)
    } else {
      missing.push(fairy.name)
    }
  }

 
  const cleared = await db.collection('fairies').updateMany({}, { $unset: { gmVisible: '' } })

  console.log(`[migrate-gmvisible] accounts switched on: ${moved}`)
  console.log(`[migrate-gmvisible] fairy documents cleaned: ${cleared.modifiedCount}`)
  if (missing.length) {
    console.log(`[migrate-gmvisible] no account found for: ${missing.join(', ')} (flag dropped)`)
  }

  await mongoose.disconnect()
}

main().catch(err => {
  console.error('[migrate-gmvisible] failed:', err.message)
  process.exit(1)
})
