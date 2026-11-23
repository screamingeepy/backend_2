/* global mongoose: writeable */

const fs = require('fs')
const path = require('path')
const { XMLParser } = require('fast-xml-parser')

const itemTypes = [
  'Shirt', 'Belt', 'Skirt', 'WristItem', 'HeadItem', 'Necklace', 'AnkleItem', 'Shoes',
  'Eyes', 'Face', 'HairFront', 'HairBack', 'Wings', 'Furniture', 'Lamp', 'Decoration'
]
const storageTypes = ['Furniture', 'Lamp', 'Decoration']
const howAcquiredGranted = 11
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function normalizeCode (text) {
  return String(text || '').toUpperCase().replace(/[\s-]+/g, '')
}

function codePattern () {
  return /^[A-Z0-9]{4,32}$/
}

function randomCode (crypto) {
  let code = ''
  for (const byte of crypto.randomBytes(12)) code += alphabet[byte % alphabet.length]
  return code
}

function showCode (code) {
  return code.replace(/(.{4})(?=.)/g, '$1-')
}

function rewardKind (itemId) {
  if (itemId >= 1 && itemId < 8000) {
    const type = itemTypes[Math.floor(itemId / 500)]
    return { kind: storageTypes.includes(type) ? 'storage' : 'wardrobe', type }
  }
  return { kind: 'pouch', type: '' }
}

let rewardMap = null

function rewardDescriptions () {
  if (rewardMap) return rewardMap
  rewardMap = new Map()

  try {
    const file = path.join(__dirname, '../../web/franchise/fairies/pixie-hollow/xml/code-reward-map.xml')
    const parsed = new XMLParser().parse(fs.readFileSync(file, 'utf8'))
    const list = [].concat(parsed.rewards ? parsed.rewards.reward || [] : [])
    for (const reward of list) rewardMap.set(Number(reward.itemId), { name: String(reward.name || ''), description: String(reward.description || '') })
  } catch (err) {
    console.warn('[CodeRedemption] Could not read code-reward-map.xml:', err.message)
  }

  return rewardMap
}

let badgeNames = null

// badge names come from the client's own badges.xml (<name10598>...</name10598>).
function badgeInfo (badgeId) {
  if (!badgeNames) {
    badgeNames = new Map()

    try {
      const xml = fs.readFileSync(path.join(__dirname, '../../web/xml/badges.xml'), 'utf8')
      for (const m of xml.matchAll(/<name(\d+)[^>]*>([^<]*)<\/name\1>/g)) badgeNames.set(Number(m[1]), { name: m[2].trim() })
      for (const m of xml.matchAll(/<desc(\d+)[^>]*>([^<]*)<\/desc\1>/g)) {
        const entry = badgeNames.get(Number(m[1]))
        // A description with #GOAL# in it is a template for progress, not a sentence.
        if (entry && !/#/.test(m[2])) entry.description = m[2].trim()
      }
    } catch (err) {
      console.warn('[CodeRedemption] Could not read badges.xml:', err.message)
    }
  }

  return badgeNames.get(badgeId) || null
}

function rewardTypeOf (code) {
  return code.rewardType || 'item'
}

function describeReward (code, getItemInfo) {
  const type = rewardTypeOf(code)

  if (type === 'gold') {
    return { kind: 'gold', name: 'gold', description: '', where: 'your leaf journal', count: code.quantity }
  }

  if (type === 'badge') {
    const badge = badgeInfo(code.rewardId)
    return {
      kind: 'badge',
      name: (badge && badge.name) || 'a special badge',
      description: (badge && badge.description) || '',
      where: 'the badge book in your leaf journal',
      count: 1
    }
  }

  const itemId = code.rewardId
  const { kind } = rewardKind(itemId)
  const known = rewardDescriptions().get(itemId)
  const info = getItemInfo(itemId)
  const fallback = info && !/^Item #/.test(info.name) ? info.name : ''

  const where = {
    wardrobe: 'the wardrobe tab in your leaf journal',
    storage: 'the storage tab in your leaf journal',
    pouch: 'your pouch'
  }[kind]

  return {
    kind,
    name: (known && known.name) || fallback || (kind === 'pouch' ? 'an ingredient' : 'a special item'),
    description: (known && known.description) || '',
    where,
    count: code.quantity
  }
}

// fairy.gender is 1 for a fairy and 2 for a Sparrow Man; anything else is a fairy.
function isEligible (fairy, code) {
  return !code.gender || (fairy.gender === 2 ? 2 : 1) === code.gender
}

function hasEarnedBadge (fairy, badgeId) {
  const rows = (fairy.badgeData && fairy.badgeData.badges) || []
  return rows.some(row => row.badgeId === badgeId && (row.status === 'Earned' || row.dateEarned))
}

function itemsOf (fairy) {
  return (fairy.avatar && fairy.avatar.items) || []
}

function nextPouchSlot (pouch) {
  const used = new Set((pouch || []).map(entry => entry.slot).filter(slot => Number.isInteger(slot) && slot >= 0))
  let slot = 0
  while (used.has(slot)) slot += 1
  return slot
}

async function giveToFairy ({ Fairy, db, md }, fairy, code) {
  if (rewardTypeOf(code) === 'gold') {
    const updated = await Fairy.findOneAndUpdate({ _id: fairy._id }, { $inc: { gold: code.quantity } }, { new: true })

    try {
      if (md && updated) md.sendGold(fairy._id, updated.gold)
    } catch (err) {
      console.warn('[CodeRedemption] could not update live gold:', err.message)
    }

    return true
  }

  const { kind, type } = rewardKind(code.rewardId)

  if (kind === 'pouch') {
    const added = await Fairy.updateOne(
      { _id: fairy._id, 'pouch.item_id': code.rewardId },
      { $inc: { 'pouch.$.amount': code.quantity } }
    )
    if (!added.modifiedCount) {
      await Fairy.updateOne(
        { _id: fairy._id },
        { $push: { pouch: { item_id: code.rewardId, slot: nextPouchSlot(fairy.pouch), amount: code.quantity } } }
      )
    }
    return true
  }

  const owns = itemsOf(fairy).some(item => item.item_id === code.rewardId)
  if (owns) return false

  await Fairy.updateOne({ _id: fairy._id }, {
    $push: {
      'avatar.items': {
        inv_id: await db.getNextDoId(),
        type,
        item_id: code.rewardId,
        slot: -1,
        createdById: 0,
        createdByName: '',
        giftedById: 0,
        giftedByName: '',
        quality: 0,
        color1: code.color1 || 166,
        color2: code.color2 || 166,
        howAcquired: howAcquiredGranted,
        location: kind === 'storage' ? 'Storage' : 'Wardrobe'
      }
    }
  })
  return true
}

const BADGE_WAIT_MS = 7000
const BADGE_POLL_MS = 250

// badges go through the same queue the gm portal uses and wait for the answer
async function giveBadges ({ GmCommand, Account }, fairies, code) {
  const admin = await Account.findOne({ accountType: 'Administrator', deleted: { $ne: true } }, { _id: 1, username: 1 })
  if (!admin) return 'no Administrator account to issue the badge as'

  const queued = []
  for (const fairy of fairies) {
    queued.push(await GmCommand.create({
      issuedBy: admin._id,
      issuedByName: `secret code (${admin.username})`,
      accountType: 'Administrator',
      command: `give-badge ${code.rewardId} ${fairy._id}`,
      scope: 'global',
      category: 'accounts',
      status: 'pending'
    }))
  }

  const deadline = Date.now() + BADGE_WAIT_MS
  let problem = null

  for (const command of queued) {
    let doc = null

    while (Date.now() < deadline) {
      doc = await GmCommand.findById(command._id)
      if (doc && ['done', 'failed', 'unclaimed'].includes(doc.status)) break
      await new Promise(resolve => setTimeout(resolve, BADGE_POLL_MS))
    }

    if (doc && doc.status === 'done') continue

    if (!doc || doc.status === 'pending') {
      await GmCommand.updateOne({ _id: command._id, status: 'pending' }, { $set: { status: 'unclaimed', finishedAt: new Date() } })
    }

    problem = doc && doc.response ? doc.response : 'the game did not answer in time'
  }

  return problem
}

// every step two people could race on is one atomic update so a code can't be spent twice
async function redeemCode ({ Account, Fairy, RedeemableCode, GmCommand, db, md, getItemInfo }, account, rawCode) {
  const codeName = normalizeCode(rawCode)
  if (!codePattern().test(codeName)) return { ok: false, error: 'ERROR_INVALID_PARMS' }

  const code = await RedeemableCode.findOne({ codeName })
  if (!code) return { ok: false, error: 'ERROR_INVALID_PARMS' }
  if (code.expirationDate && code.expirationDate <= new Date()) return { ok: false, error: 'CODE_EXPIRED' }

  const repeatHours = typeof code.repeatHours === 'number' ? code.repeatHours : -1
  const repeats = repeatHours >= 0
  const usedKey = `codeLastUsed.${codeName}`
  const lastUsed = repeats && account.codeLastUsed && account.codeLastUsed[codeName] ? new Date(account.codeLastUsed[codeName]) : null

  if (!repeats && (account.codesRedeemed || []).includes(codeName)) return { ok: false, error: 'AT_MAX_USES' }

  if (lastUsed && repeatHours > 0) {
    const retryAt = new Date(lastUsed.getTime() + repeatHours * 60 * 60 * 1000)
    if (retryAt > new Date()) return { ok: false, error: 'TOO_SOON', retryAt }
  }

  const type = rewardTypeOf(code)

  const everyFairy = await Fairy.find({
    $or: [{ accountId: account._id }, { ownerAccount: account.username }],
    deleted: { $ne: true }
  })
  if (!everyFairy.length) return { ok: false, error: 'NO_FAIRY_ACTIVE' }

  const fairies = everyFairy.filter(fairy => isEligible(fairy, code))
  if (!fairies.length) return { ok: false, error: 'NO_ELIGIBLE_FAIRY' }

  const { kind } = rewardKind(code.rewardId)

  if (type === 'item' && kind !== 'pouch' && fairies.every(fairy => itemsOf(fairy).some(item => item.item_id === code.rewardId))) {
    return { ok: false, error: 'ALREADY_OWNED' }
  }
  if (type === 'badge' && fairies.every(fairy => hasEarnedBadge(fairy, code.rewardId))) {
    return { ok: false, error: 'ALREADY_OWNED' }
  }

  const cutoff = new Date(Date.now() - repeatHours * 60 * 60 * 1000)
  const claimed = repeats
    ? await Account.collection.updateOne(
      repeatHours > 0
        ? { _id: account._id, $or: [{ [usedKey]: { $exists: false } }, { [usedKey]: null }, { [usedKey]: { $lte: cutoff } }] }
        : { _id: account._id },
      { $set: { [usedKey]: new Date() } }
    )
    : await Account.updateOne({ _id: account._id, codesRedeemed: { $ne: codeName } }, { $push: { codesRedeemed: codeName } })
  if (!claimed.modifiedCount) return { ok: false, error: repeats ? 'TOO_SOON' : 'AT_MAX_USES' }

  const used = await RedeemableCode.updateOne(
    { _id: code._id, $or: [{ maxUses: { $in: [0, null] } }, { $expr: { $lt: ['$uses', '$maxUses'] } }] },
    { $inc: { uses: 1 } }
  )
  // undo the claim: forget this use, putting back the time of the one before.
  const unclaim = () => repeats
    ? Account.collection.updateOne({ _id: account._id }, lastUsed ? { $set: { [usedKey]: lastUsed } } : { $unset: { [usedKey]: '' } })
    : Account.updateOne({ _id: account._id }, { $pull: { codesRedeemed: codeName } })

  if (!used.modifiedCount) {
    await unclaim()
    return { ok: false, error: 'CODE_ALREADY_USED' }
  }

  const giveBack = async () => {
    await unclaim()
    await RedeemableCode.updateOne({ _id: code._id }, { $inc: { uses: -1 } })
  }

  const owned = []

  try {
    if (type === 'badge') {
      const missing = fairies.filter(fairy => !hasEarnedBadge(fairy, code.rewardId))
      for (const fairy of fairies) if (!missing.includes(fairy)) owned.push({ id: fairy._id, name: fairy.name })

      const problem = await giveBadges({ GmCommand, Account }, missing, code)
      if (problem) {
        console.warn(`[CodeRedemption] badge ${code.rewardId} for ${account.username} failed: ${problem}`)
        await giveBack()
        return { ok: false, error: 'GRANT_FAILED' }
      }
    } else {
      for (const fairy of fairies) {
        const given = await giveToFairy({ Fairy, db, md }, fairy, code)
        if (!given) owned.push({ id: fairy._id, name: fairy.name })
      }
    }
  } catch (err) {
    await giveBack()
    throw err
  }

  return { ok: true, reward: describeReward(code, getItemInfo), rewardId: code.rewardId || 0, owned }
}

module.exports = { redeemCode, normalizeCode, codePattern, randomCode, showCode, rewardKind, rewardTypeOf, describeReward, badgeInfo }
