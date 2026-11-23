const ACCOUNTS = 'accounts'
const TIERS = ['Player', 'Moderator', 'Administrator']

const env = (typeof process !== 'undefined' && process.env) || {}
const LIST = env.LIST === '1'
const USERNAME = env.USERNAME_ARG || env.USERNAME
const TYPE = env.TYPE

console.log('='.repeat(72))
console.log(`set account type -- database: ${db.getName()}`)
console.log('='.repeat(72))


if (LIST) {
  const staff = db.getCollection(ACCOUNTS)
    .find({ accountType: { $in: ['Moderator', 'Administrator'] } }, { _id: 1, username: 1, accountType: 1 })
    .sort({ accountType: -1, username: 1 })
    .toArray()

  if (staff.length === 0) {
    console.log('no accounts hold a staff tier')
  } else {
    for (const acct of staff) {
      console.log(`  ${String(acct.accountType).padEnd(14)} ${String(acct._id).padEnd(12)} ${acct.username}`)
    }
    console.log(`\n${staff.length} account(s)`)
  }
} else {

  if (!USERNAME || !TYPE) {
    console.log('usage: USERNAME=<username> TYPE=<Player|Moderator|Administrator> mongosh "<uri>" --file set-account-type.js')
    console.log('       LIST=1 mongosh "<uri>" --file set-account-type.js')
    quit(1)
  }


  if (!TIERS.includes(TYPE)) {
    console.log(`TYPE must be exactly one of: ${TIERS.join(', ')} (got ${JSON.stringify(TYPE)})`)
    quit(1)
  }


  const pattern = `^${USERNAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
  const matches = db.getCollection(ACCOUNTS)
    .find({ username: { $regex: pattern, $options: 'i' } }, { _id: 1, username: 1, accountType: 1 })
    .toArray()

  if (matches.length === 0) {
    console.log(`no account named ${JSON.stringify(USERNAME)}`)
    quit(1)
  }

  if (matches.length > 1) {
    console.log(`${matches.length} accounts match ${JSON.stringify(USERNAME)} -- refusing to guess:`)
    for (const acct of matches) console.log(`  ${acct._id}  ${acct.username}`)
    quit(1)
  }

  const account = matches[0]
  const before = account.accountType || 'Player'

  if (before === TYPE) {
    console.log(`${account.username} (${account._id}) is already ${TYPE} -- nothing to do`)
  } else {
    db.getCollection(ACCOUNTS).updateOne({ _id: account._id }, { $set: { accountType: TYPE } })

    console.log(`${account.username} (${account._id}): ${before} -> ${TYPE}`)
    console.log('takes effect at their next login (see the header of this file)')
  }
}
