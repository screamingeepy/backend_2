// run with node assign-fairy-addresses.js
const path = require('path')

module.paths.push(path.join(__dirname, '../web-api/node_modules'))

require('dotenv').config({ path: path.join(__dirname, '../web-api/.env') })

const mongoose = require('mongoose')
const { allocateAddress } = require('../web-api/utils/addresses')

const URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/PixieHollow'
const WRITE = process.argv.includes('--write')
const DEFAULT_ADDRESS = '1234CatepillerCorral'

async function main () {
  await mongoose.connect(URI)
  const fairies = mongoose.connection.db.collection('fairies')

  console.log(`[addresses] ${URI}${WRITE ? '' : '  (dry run -- pass --write to apply)'}`)

  // Everything already spoken for, so a new one never lands on it.
  const taken = new Set(
    (await fairies.distinct('address', { address: { $nin: [null, '', DEFAULT_ADDRESS] } })).map(String)
  )

  const needing = await fairies.find(
    { $or: [{ address: DEFAULT_ADDRESS }, { address: '' }, { address: null }, { address: { $exists: false } }] },
    { projection: { name: 1 } }
  ).toArray()

  console.log(`[addresses] ${needing.length} fairies need one; ${taken.size} addresses already in use`)

  for (const fairy of needing) {
    const address = await allocateAddress(async candidate => taken.has(candidate))
    taken.add(address)

    if (WRITE) await fairies.updateOne({ _id: fairy._id }, { $set: { address } })

    console.log(`  ${(fairy.name || fairy._id).toString().padEnd(22)} -> ${address}`)
  }

  console.log(WRITE
    ? `[addresses] ${needing.length} written`
    : '[addresses] nothing written')

  await mongoose.disconnect()
}

main().catch(err => {
  console.error('[addresses] failed:', err.message)
  process.exit(1)
})
