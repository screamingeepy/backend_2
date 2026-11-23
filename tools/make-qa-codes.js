// create qa codes for testers
const path = require('path')

const webApi = path.join(__dirname, '..', 'web-api')
process.chdir(webApi)
require(path.join(webApi, 'node_modules', 'dotenv')).config({ path: path.join(webApi, '.env'), quiet: true })

const QA_CODES = [
  { code: 'QATESTERS', rewardType: 'gold', quantity: 100, note: 'QA: 100 gold for every fairy on the account' },
  { code: 'QAFURNITURE', rewardType: 'item', rewardId: 6514, note: 'QA: Daisy Bloom Swing (furniture, goes to storage)' },
  { code: 'QAFAIRYOUTFIT', rewardType: 'item', rewardId: 14, gender: 1, note: 'QA: Hibiscus Top, fairies only' },
  { code: 'QASPARROWOUTFIT', rewardType: 'item', rewardId: 122, gender: 2, note: 'QA: Twist-Sleeve Jacket, Sparrow Men only' },
  { code: 'BERRY', rewardType: 'item', rewardId: 8014, quantity: 100, repeatHours: 0, note: 'QA: 100 raspberries (pouch), reusable any time' },
  { code: 'QABADGE', rewardType: 'badge', rewardId: 10598, note: 'QA: 2008 Harvest Hustle Champion badge (needs the game server running)' }
]

async function main () {
  global.mongoose = require(path.join(webApi, 'node_modules', 'mongoose'))
  const Database = require(path.join(webApi, 'db', 'Database'))
  global.db = new Database()

  const RedeemableCode = require(path.join(webApi, 'db', 'models', 'RedeemableCode'))
  const GmCommand = require(path.join(webApi, 'db', 'models', 'GmCommand'))
  const { showCode } = require(path.join(webApi, 'services', 'CodeRedemption'))

  await global.db.connectWithRetry()

  for (const spec of QA_CODES) {
    const existing = await RedeemableCode.findOne({ codeName: spec.code })

    if (process.argv.includes('--list')) {
      console.log(`${showCode(spec.code)}  ${existing ? `exists, used ${existing.uses} time(s)` : 'not made yet'}  ${spec.note}`)
      continue
    }

    if (existing) {
      console.log(`${showCode(spec.code)}  already exists, left alone`)
      continue
    }

    await RedeemableCode.create({
      _id: await global.db.getNextDoId(),
      codeName: spec.code,
      rewardType: spec.rewardType,
      rewardId: spec.rewardId || 0,
      gender: spec.gender || 0,
      quantity: spec.quantity || 1,
      repeatHours: spec.repeatHours === undefined ? -1 : spec.repeatHours,
      maxUses: 0,
      note: spec.note,
      createdBy: 'make-qa-codes'
    })

    await GmCommand.create({
      issuedBy: 0,
      issuedByName: 'make-qa-codes script',
      accountType: 'Administrator',
      command: `make-codes ${spec.code} (${spec.note})`,
      scope: 'web',
      category: 'accounts',
      status: 'done',
      finishedAt: new Date(),
      response: '1 code made'
    })

    console.log(`${showCode(spec.code)}  made`)
  }

  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
