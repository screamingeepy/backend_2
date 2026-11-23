/* global app:writable */
/* global db:writeable */
/* global md:writeable */
// this file is a monster, sorry
app = global.app

const createXML = require('../utils/xml')

const express = require('express')

const CryptoJS = require('crypto-js')

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { XMLParser } = require('fast-xml-parser')

const { normalizeFairyName } = require('../utils/name')
const { isHomePrivate, normalizeMoreOptions } = require('../utils/moreOptions')
const { pickleFromAvatar } = require('../utils/pickle')
const { sniffImageType, uploadFileName, ACCEPTED_IMAGE_TYPES } = require('../utils/images')
const { bioRows, postcardDesign, themeFor } = require('../utils/profileText')
const { guestbookChoices, guestbookLine, isSayable } = require('../utils/guestbookText')
const { readableAddress, allocateAddress } = require('../utils/addresses')
const { exportFairy, buildFairyDocument } = require('../utils/fairyTransfer')
const { catalog: contentCatalog } = require('../utils/contentCatalog')
const { makeLimiter, allowAll, makeRepeatGuard, hourMs, dayMs } = require('../utils/rateLimit')
const { currentAge, isUnderThirteen, needsOwnEmail, chatPlusAllowed } = require('../utils/accountAge')
const { memberDaysFor } = require('../utils/memberDays')
const { readChat, toText } = require('../utils/chatLogs')
const { DELETE_GRACE_DAYS, purgeAccount } = require('./AccountPurge')
const { redeemCode, normalizeCode, codePattern, randomCode, showCode, rewardKind, rewardTypeOf, describeReward, badgeInfo } = require('./CodeRedemption')

const Fairy = require('../db/models/Fairy')
const GmCommand = require('../db/models/GmCommand')
const RedeemableCode = require('../db/models/RedeemableCode')
const SupportTicket = require('../db/models/SupportTicket')
const Message = require('../db/models/Message')
const Poll = require('../db/models/Poll')
const PollVote = require('../db/models/PollVote')
const Quiz = require('../db/models/Quiz')
const GuestbookEntry = require('../db/models/GuestbookEntry')
const BlogEntry = require('../db/models/BlogEntry')
const StaffFairy = require('../db/models/StaffFairy')
const Event = require('../db/models/Event')
const Account = require('../db/models/Account')
const EmailService = require('./EmailService')
const Waitlist = require('./Waitlist')
const AdminSettings = require('./AdminSettings')
const DiscordService = require('./DiscordService')
const ApplicationForms = require('./ApplicationForms')
const { getItemInfo, getColorName } = require('../utils/itemNames')

const loginQueue = []

app.use(express.static(require('path').join(__dirname, '../public')))

app.get('/', (req, res) => {
  res.send('Pixie Hollow API service.')
})

// discord bot api, every route needs the bot token

function verifyBotToken(req, res) {
  const auth = (req.headers['authorization'] || '').trim()
  const expectedToken = (process.env.BOT_API_TOKEN || '').trim()
  const expectedAuth = `Bearer ${expectedToken}`

  if (!expectedToken || auth !== expectedAuth) {
    console.warn(`[verifyBotToken] Auth failed! Received: "${auth}" | Expected: "${expectedAuth}"`)
    res.status(403).json({ success: false, error: 'FORBIDDEN' })
    return false
  }
  return true
}

app.post('/bot/attach', async (req, res) => {
  if (!verifyBotToken(req, res)) return

  const { discordId, username, password } = req.body
  if (!discordId || !username || !password)
    return res.json({ success: false, error: 'MISSING_FIELDS' })

  const valid = await db.verifyCredentials(username.toLowerCase(), password)
  if (!valid)
    return res.json({ success: false, error: 'INVALID_CREDENTIALS' })

  const account = await db.retrieveAccountFromUser(username.toLowerCase())
  if (!account)
    return res.json({ success: false, error: 'ACCOUNT_NOT_FOUND' })

  if (account.discordId && account.discordId !== discordId)
    return res.json({ success: false, error: 'ALREADY_LINKED' })

  account.discordId = discordId
  await account.save()
  return res.json({ success: true })
})

app.get('/bot/inventory', async (req, res) => {
  if (!verifyBotToken(req, res)) return

  const { discordId } = req.query
  if (!discordId)
    return res.json({ success: false, error: 'MISSING_DISCORD_ID' })

  const fairy = await db.getFairyByDiscordId(discordId)
  if (!fairy)
    return res.json({ success: false, error: 'ACCOUNT_NOT_LINKED' })

  const rawItems = fairy.avatar?.items || []
  const seenInvIds = new Set()
  const items = []

  for (const i of rawItems) {
    if (!i || !i.inv_id || seenInvIds.has(i.inv_id)) continue

    const isEquipped = i.location === 'Equipped' || (i.slot !== undefined && i.slot !== null && i.slot !== -1 && i.slot > 0)
    if (isEquipped) continue

    if (i.location !== 'Wardrobe' && i.location !== 'Storage') continue

    seenInvIds.add(i.inv_id)

    const info = getItemInfo(i.item_id)
    items.push({
      inv_id: i.inv_id,
      item_id: i.item_id,
      name: info.name,
      itemGender: info.gender,
      type: i.type,
      slot: i.slot,
      color1: i.color1,
      color2: i.color2,
      color1Name: getColorName(i.color1),
      color2Name: getColorName(i.color2),
      quality: i.quality,
      location: i.location,
    })
  }

  return res.json({ success: true, items, fairyGender: fairy.gender })
})

app.get('/bot/friends', async (req, res) => {
  if (!verifyBotToken(req, res)) return

  const { discordId } = req.query
  if (!discordId)
    return res.json({ success: false, error: 'MISSING_DISCORD_ID' })

  const donorFairy = await db.getFairyByDiscordId(discordId)
  if (!donorFairy)
    return res.json({ success: false, error: 'ACCOUNT_NOT_LINKED' })

  const friendAccountIds = friendIdsFor(await ownerOfFairy(donorFairy), donorFairy)
  if (friendAccountIds.length === 0)
    return res.json({ success: true, friends: [] })

  const friendFairies = await Fairy.find(
    { accountId: { $in: friendAccountIds } },
    { _id: 1, name: 1, ownerAccount: 1, accountId: 1, gender: 1 }
  )

  const friends = friendFairies.map(f => ({
    fairyName: f.name,
    username: f.ownerAccount,
    accountId: f.accountId,
    fairyGender: f.gender,
  }))

  return res.json({ success: true, friends })
})

app.post('/bot/gift', async (req, res) => {
  if (!verifyBotToken(req, res)) return

  const { donorDiscordId, recipientFairyName, invId } = req.body
  if (!donorDiscordId || !recipientFairyName || invId === undefined)
    return res.json({ success: false, error: 'MISSING_FIELDS' })

  const donorFairy = await db.getFairyByDiscordId(donorDiscordId)
  if (!donorFairy)
    return res.json({ success: false, error: 'DONOR_NOT_LINKED' })

  const recipientFairy = await db.getFairyByName(recipientFairyName)
  if (!recipientFairy)
    return res.json({ success: false, error: 'RECIPIENT_NOT_FOUND' })

  if (String(donorFairy._id) === String(recipientFairy._id))
    return res.json({ success: false, error: 'CANNOT_GIFT_SELF' })

  if (donorFairy.gender !== undefined && recipientFairy.gender !== undefined && donorFairy.gender !== recipientFairy.gender) {
    return res.json({ success: false, error: 'GENDER_MISMATCH' })
  }

  const friendAccountIds = friendIdsFor(await ownerOfFairy(donorFairy), donorFairy)
  if (!friendAccountIds.includes(Number(recipientFairy.accountId)))
    return res.json({ success: false, error: 'NOT_FRIENDS' })

  const item = (donorFairy.avatar?.items || []).find(i => i.inv_id === Number(invId))
  if (!item)
    return res.json({ success: false, error: 'ITEM_NOT_FOUND' })

  const isEquipped = item.location === 'Equipped' || (item.slot !== undefined && item.slot !== null && item.slot !== -1 && item.slot > 0)
  if (isEquipped)
    return res.json({ success: false, error: 'ITEM_IS_EQUIPPED' })

  const pullResult = await mongoose.connection
    .collection('fairies')
    .updateOne(
      { _id: donorFairy._id },
      { $pull: { 'avatar.items': { inv_id: Number(invId) } } }
    )

  if (pullResult.modifiedCount === 0)
    return res.json({ success: false, error: 'TRANSFER_FAILED' })

  const giftedItem = {
    ...item.toObject ? item.toObject() : { ...item },
    giftedById: donorFairy._id,
    giftedByName: donorFairy.name,
    howAcquired: 14,
    location: 'Wardrobe',
    slot: -1,
  }

  await mongoose.connection
    .collection('fairies')
    .updateOne(
      { _id: recipientFairy._id },
      { $push: { 'avatar.items': giftedItem } }
    )

  const INV_MGR_DO_ID = parseInt(process.env.INVENTORY_MGR_DO_ID || '0')
  if (INV_MGR_DO_ID) {
    md.sendWardrobeRemove(INV_MGR_DO_ID, donorFairy._id, Number(invId))
    md.sendWardrobeAdd(INV_MGR_DO_ID, recipientFairy._id, giftedItem)
  }

  return res.json({ success: true })
})


function parseFairyNames () {
  const xml = fs.readFileSync('assets/nameGenerator.xml', 'utf-8')
  const parser = new XMLParser({ ignoreAttributes: false })

  const names = parser.parse(xml).NameGenerator.NameSelector

  const namesList = {}

  for (const ns of names) {
    const type = ns['@_type']
    namesList[type] = []

    for (const name of ns.name) {
      namesList[type].push(name['#text'])
    }
  }

  return namesList
}

const fairyNames = parseFairyNames()

function validateFairyName (name) {
  const nameParts = normalizeFairyName(name).split(' ')
  if (nameParts.length > 2) return false

  const [firstName, lastName] = nameParts

  function validateLastName(lastName) {
    for (const prefix of fairyNames['Prefix']) {
      if (lastName.startsWith(prefix)) {
        const suffix = lastName.slice(prefix.length)
        if (fairyNames['Suffix'].includes(suffix)) {
          return true
        }
      }
    }

    return false
  }

  if (nameParts.length === 1) {
    return fairyNames['First'].includes(firstName) || validateLastName(firstName)
  }

  return fairyNames['First'].includes(firstName) && validateLastName(lastName)
}

// First Last, drawn from the same lists validateFairyName checks against
function randomFairyName () {
  const pick = names => names[Math.floor(Math.random() * names.length)]

  for (let attempt = 0; attempt < 50; attempt++) {
    const name = `${pick(fairyNames['First'])} ${pick(fairyNames['Prefix'])}${pick(fairyNames['Suffix'])}`
    if (validateFairyName(name)) return name
  }

  return pick(fairyNames['First'])
}

function verifyAuthorization (token) {
  return token === process.env.API_TOKEN
}

function generateRandomNumber () {
  return Math.floor(Math.random() * 101)
}

async function generateToken (username) {
  const accData = await db.retrieveAccountData(username)

  const data = {
    playToken: username,
    SpeedChatPlus: accData.SpeedChatPlus,
    OpenChat: accData.OpenChat,
    Member: accData.Member,
    Timestamp: Math.floor(new Date().getTime() / 1000) + 10 * 60,
    dislId: accData.dislId,
    accountType: accData.accountType,
    LinkedToParent: accData.LinkedToParent,
    token: '',
    Banned: accData.Banned,
    Terminated: accData.Terminated
  }

  const key = CryptoJS.enc.Hex.parse(process.env.TOKEN_KEY)
  const iv = CryptoJS.lib.WordArray.random(16)

  const encrypted = CryptoJS.AES.encrypt(JSON.stringify(data), key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  })

  const ivBase64 = CryptoJS.enc.Base64.stringify(iv)
  const encryptedBase64 = encrypted.toString()

  return btoa(JSON.stringify({
    iv: ivBase64,
    data: encryptedBase64
  }))
}

async function handleWhoAmIRequest (req, res) {
  const ses = req.session

  let success = false
  let status = 'not_logged_in'
  let accountId = -1
  let userName = ''
  let speedChatPrompt = 'false'

  if (ses.success || req.query.isFirst === undefined) {
    success = true
  }

  if (ses.logged && ses.username && ses.userId) {
    status = 'logged_in_fairy'

    accountId = ses.userId
    userName = ses.username

    const accData = await db.retrieveAccountData(userName)
    speedChatPrompt = `${Boolean(!accData.SpeedChatPlus)}`
  }

  res.setHeader('content-type', 'text/xml')
  res.send(createXML({
    WhoAmIResponse: {
      success: success,
      status: status,
      username: userName,
      account: {
        '@account_id': accountId,
        '#': {
          first_name: '',
          dname: userName,
          age: 0,
          isChild: true,
          access: 'basic',
          touAccepted: true,
          speed_chat_prompt: speedChatPrompt,
          dname_submitted: true,
          dname_approved: true
        }
      },
      userTestAccessAllowed: false,
      'server-time': {
        day: new Date().toLocaleDateString('en-ZA', { timeZone: 'America/Los_Angeles' }),
        time: new Date().toLocaleTimeString('en-ZA', { timeZone: 'America/Los_Angeles' })
      },
      fairy_id: ses.fairyId
    }
  }))
}

app.get('/fairies/api/AccountLogoutRequest', async (req, res) => {
  req.session.destroy()

  res.setHeader('content-type', 'text/xml')
  res.send(createXML({
    AccountLogoutResponse: {
      success: true
    }
  }))
})

app.get('/fairies/api/WhoAmIRequest', async (req, res) => {
  await handleWhoAmIRequest(req, res)
})

app.post('/fairies/api/WhoAmIRequest', async (req, res) => {
  await handleWhoAmIRequest(req, res)
})

app.get('/dxd/flashAPI/login', async (req, res) => {
  await db.handleFlashLogin(req, res)
})

app.post('/dxd/flashAPI/login', async (req, res) => {
  await db.handleFlashLogin(req, res)
})

app.post('/dxd/flashAPI/checkUsernameAvailability', async (req, res) => {
  const username = req.body.username.toLowerCase()
  let status

  if (process.env.LOCALHOST_INSTANCE === 'true') {
    status = await db.isUsernameAvailable(username)
  } else {
    // TODO: register against the Sunrise database and re-enable in-game signup
    status = false
  }

  const responseData = {
    success: status
  }

  if (!status) {
    const words = [
      'Amazing',
      'Cool',
      'Super',
      'Fantastic'
    ]

    const randomIndex = Math.floor(Math.random() * words.length)

    responseData.results = {
      suggestedUsername1: `${username}${generateRandomNumber()}`,
      suggestedUsername2: `${username}${generateRandomNumber()}`,
      suggestedUsername3: `${words[randomIndex]}${username}`
    }
  }

  res.setHeader('content-type', 'text/xml')
  res.send(createXML({
    response: responseData
  }))
})

app.post('/dxd/flashAPI/createAccount', async (req, res) => {
  const username = req.body.username.toLowerCase()
  const status = await Waitlist.isOn() ? false : await db.createAccount(username, req.body.password)
  const accountId = status ? await db.getAccountIdFromUser(username) : -1

  // TODO: redirect instead when they are already signed in?
  if (!req.session.logged) {
    await db.createSession(req, username, accountId, true)
  }

  res.setHeader('content-type', 'text/xml')
  res.send(createXML({
    response: {
      success: !!status,
      results: {
        userId: accountId
      }
    }
  }))
})

app.post('/fairies/api/AccountLoginRequest', async (req, res) => {
  await db.handleAccountLogin(req, res)
})

app.get('/fairies/api/AccountLoginRequest', async (req, res) => {
  await db.handleAccountLogin(req, res)
})

app.get('/fairies/api/GameEntranceRequest', (req, res) => {
  res.setHeader('content-type', 'text/xml')
  res.send(createXML({
    GameEntranceRequestResponse: {
      success: true,
      queue: {
        can_enter_game: loginQueue.length > 0 ? 'false' : 'true'
      }
    }
  }))
})

app.get('/fairies/api/QueueStatsRequest', (req, res) => {
  res.setHeader('content-type', 'text/xml')
  res.send(createXML({
    QueueStatsRequestResponse: {
      queue: {
        est_queue_before_you: 0
      }
    }
  }))
})

// the client asks for these when it starts. There is no news or alert feed, so they answer empty rather than
// leaving a 404 in every player's console
app.post('/fairies/api/NewsRequest', (req, res) => {
  res.setHeader('content-type', 'text/xml')
  res.send(createXML({ response: { success: true, news: '' } }))
})

app.post('/fairies/api/FairiesAlertRequest', (req, res) => {
  res.setHeader('content-type', 'text/xml')
  res.send(createXML({ response: { success: true, alerts: '' } }))
})

// the client's old telemetry went to Playdom's weblogger, which is gone. phPlayer.js points it here instead
app.all('/fairies/api/FlashLog', (req, res) => {
  res.status(204).end()
})

app.post('/fairies/api/GenerateTokenRequest', async (req, res) => {
  const ses = req.session

  const success = ses ? 'true' : 'false'

  const responseData = {
    success
  }

  if (ses.username) {
    responseData.token = process.env.LOCALHOST_INSTANCE === 'true' ? ses.username : await generateToken(ses.username)
  }

  res.setHeader('content-type', 'text/xml')
  res.send(createXML({
    GenerateTokenRequestResponse: responseData
  }))
})

app.get('/fairies/api/internal/fairyPickle/:fairyId', async (req, res) => {
  if (!verifyAuthorization(req.headers.authorization)) {
    return res.status(401).send('Authorization failed.')
  }

  const fairyId = Number(req.params.fairyId)

  if (!Number.isInteger(fairyId)) {
    return res.status(400).send('Expected a numeric fairy id.')
  }

  const fairy = await db.retrieveFairyById(fairyId)

  if (!fairy) {
    return res.status(404).send('No such fairy.')
  }

  try {
    res.type('text/plain').send(pickleFromAvatar(fairy.avatar, fairy.gender))
  } catch (e) {
    console.error(`fairyPickle ${fairyId}: ${e.message}`)
    res.status(500).send(`Could not build a pickle for ${fairyId}: ${e.message}`)
  }
})

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/

function isLocalRequest (req) {
  if (process.env.LOCALHOST_INSTANCE === 'true') return true

  if (!LOOPBACK.test(req.socket.remoteAddress || '')) return false

  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',').map(part => part.trim()).filter(Boolean)

  return forwarded.every(address => LOOPBACK.test(address))
}

// local only, flash can't set an Authorization header so this is gated on the request instead
app.post('/fairies/api/internal/renderResult',
  express.raw({ type: '*/*', limit: '16mb' }),
  (req, res) => {
    if (!isLocalRequest(req)) {
      return res.status(404).send('Not found.')
    }

    const name = renderName(req.query.name)
    const dir = path.join(__dirname, '..', '..', 'web', 'rendered')
    fs.mkdirSync(dir, { recursive: true })

    if (req.query.error) {
      const message = String(req.query.error).slice(0, 500)
      fs.writeFileSync(path.join(dir, `${name}.error`), message)
      console.log(`renderResult: ${name} failed: ${message}`)
      return res.send('noted')
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).send('Expected a PNG body.')
    }

    // write then rename so a reader never sees a half written png
    const file = path.join(dir, `${name}.png`)
    const partial = `${file}.part`

    fs.writeFileSync(partial, req.body)
    fs.renameSync(partial, file)

    fs.rmSync(path.join(dir, `${name}.error`), { force: true })

    console.log(`renderResult: wrote ${req.body.length} bytes to ${file}`)
    res.send(`${req.body.length}`)
  })

function renderName (value) {
  return String(value || 'render').replace(/[^a-z0-9_-]/gi, '').slice(0, 64) || 'render'
}

// serving rendered avatars

const RENDERED_DIR = path.join(__dirname, '..', '..', 'web', 'rendered')

const PLACEHOLDER_SIZE = { bust: [123, 178], full: [315, 681], home: [880, 379], homefull: [880, 379] }
const placeholders = {}

function transparentPNG (width, height) {
  // local crc32, zlib.crc32 needs node 22.2 and package.json declares no minimum
  const crc32 = buffer => {
    let crc = 0xffffffff

    for (const byte of buffer) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
      }
    }

    return (crc ^ 0xffffffff) >>> 0
  }

  const chunk = (type, body) => {
    const out = Buffer.alloc(8 + body.length + 4)
    out.writeUInt32BE(body.length, 0)
    out.write(type, 4, 'ascii')
    body.copy(out, 8)
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])), 8 + body.length)
    return out
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8    // bit depth
  ihdr[9] = 6    // truecolor + alpha

  // One filter byte per scanline, then RGBA zeroes: transparent black.
  const raw = Buffer.alloc(height * (1 + width * 4))

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function placeholderFor (mode) {
  if (!placeholders[mode]) {
    placeholders[mode] = transparentPNG(...PLACEHOLDER_SIZE[mode])
  }

  return placeholders[mode]
}

const RENDER_WAIT_MS = Number(process.env.RENDER_WAIT_MS || 8000)
const RENDER_WAIT_POLL_MS = 100

const RENDER_MAX_WAITERS = Number(process.env.RENDER_MAX_WAITERS || 64)
let renderWaiters = 0

async function waitForRender (hash, req) {
  const png = path.join(RENDERED_DIR, `${hash}.png`)
  const failed = path.join(RENDERED_DIR, `${hash}.error`)
  const started = Date.now()
  const deadline = started + RENDER_WAIT_MS

  while (Date.now() < deadline) {
    if (req.destroyed) return false

    await new Promise(resolve => setTimeout(resolve, RENDER_WAIT_POLL_MS))

    if (fs.existsSync(png)) return true

    if (writtenSince(failed, started)) return false
  }

  return false
}

function writtenSince (file, since) {
  try {
    return fs.statSync(file).mtimeMs >= since
  } catch {
    return false
  }
}

function sendPlaceholder (res, mode) {
  res.set('Cache-Control', 'no-store')
  res.set('X-Render-Status', 'queued')
  res.type('image/png').send(placeholderFor(mode))
}

// keeping web/rendered from growing forever
const RENDER_KEEP_DAYS = Number(process.env.RENDER_KEEP_DAYS || 30)
const RENDER_SWEEP_EVERY_MS = 6 * 60 * 60 * 1000
const RENDER_TOUCH_AFTER_MS = 24 * 60 * 60 * 1000

const RENDER_FILE = /^[0-9a-f]{40}\.(png|error|png\.part)$/

function touchRender (file) {
  fs.stat(file, (err, stat) => {
    if (err || Date.now() - stat.mtimeMs < RENDER_TOUCH_AFTER_MS) return

    const now = new Date()
    fs.utimes(file, now, now, () => {})
  })
}

async function sweepRenders () {
  if (!(RENDER_KEEP_DAYS > 0)) return

  const cutoff = Date.now() - RENDER_KEEP_DAYS * 24 * 60 * 60 * 1000
  let files = 0
  let bytes = 0

  try {
    for (const name of await fs.promises.readdir(RENDERED_DIR)) {
      if (!RENDER_FILE.test(name)) continue

      const file = path.join(RENDERED_DIR, name)
      const stat = await fs.promises.stat(file).catch(() => null)

      if (!stat || stat.mtimeMs >= cutoff) continue

      await fs.promises.rm(file, { force: true })
      files++
      bytes += stat.size
    }

    const jobs = await db.pruneRenderJobs(new Date(cutoff))

    if (files || jobs) {
      console.log(`[render] sweep: removed ${files} unused image(s) (${Math.round(bytes / 1024)} KB) and ${jobs} old job record(s)`)
    }
  } catch (e) {
    console.error(`[render] sweep failed: ${e.message}`)
  }
}

setTimeout(sweepRenders, 60 * 1000).unref()
setInterval(sweepRenders, RENDER_SWEEP_EVERY_MS).unref()

// scale is part of the cache key on a public route
// 3 and 4 are for pictures people save or print, which are drawn at full size
const ALLOWED_RENDER_SCALES = [0, 1, 1.4, 2, 3, 4]

function snapScale (value) {
  const wanted = Number(value)

  if (!Number.isFinite(wanted) || wanted <= 0) return 0

  return ALLOWED_RENDER_SCALES.slice(1).reduce((best, scale) =>
    Math.abs(scale - wanted) < Math.abs(best - wanted) ? scale : best)
}

const DEFAULT_AVATAR_DIR = path.join(__dirname, '..', '..', 'web', 'site', 'img', 'default')

function sendFallback (res, mode, fairy) {
  if (mode === 'home' || mode === 'homefull') return sendPlaceholder(res, mode)

  const who = Number(fairy.gender) === 2 ? 'defaultSparrowMan' : 'defaultFairy'
  const file = path.join(DEFAULT_AVATAR_DIR, `${who}${mode === 'full' ? 'Full' : 'Bust'}.png`)

  if (!fs.existsSync(file)) return sendPlaceholder(res, mode)

  res.set('Cache-Control', 'public, max-age=300')
  res.set('X-Render-Status', 'fallback')
  res.sendFile(file)
}

// rendering ahead of the first viewer
const RENDER_PREWARM = process.env.RENDER_PREWARM !== '0'
const RENDER_WARM_MAX_QUEUE = Number(process.env.RENDER_WARM_MAX_QUEUE || 100)
const RENDER_WARM_THROTTLE_MS = 5 * 60 * 1000
const WARM_IMAGES = [['bust', 0], ['bust', 1.4], ['full', 2]]
const lastWarmed = new Map()

async function warmFairy (fairy) {
  if (!RENDER_PREWARM || !fairy || fairy.deleted) return

  const last = lastWarmed.get(fairy._id)
  if (last && Date.now() - last < RENDER_WARM_THROTTLE_MS) return
  lastWarmed.set(fairy._id, Date.now())

  if (lastWarmed.size > 5000) lastWarmed.delete(lastWarmed.keys().next().value)

  try {
    for (const [mode, scale] of WARM_IMAGES) {
      const hash = db.renderHash(await db.renderSubject(fairy, mode), mode, scale)

      if (fs.existsSync(path.join(RENDERED_DIR, `${hash}.png`))) continue

      if ((await db.renderQueueDepth()).queued >= RENDER_WARM_MAX_QUEUE) return

      await db.enqueueRender(fairy._id, mode, scale, { warm: true, fairy })
    }
  } catch (e) {
    console.error(`[render] could not warm fairy ${fairy._id}: ${e.message}`)
  }
}

function nameDownload (req, res, fairy, mode) {
  if (!req.query.download) return

  const base = String(fairy.name || 'fairy').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-') || 'fairy'
  res.set('Content-Disposition', 'attachment; filename="' + base + (mode === 'bust' ? '' : '-' + mode) + '.png"')
}

async function serveRender (req, res, mode) {
  const fairyId = Number(req.params.fairyId)

  const scale = snapScale(req.query.scale)

  if (!Number.isInteger(fairyId)) {
    return res.status(400).send('Expected a numeric fairy id.')
  }

  const fairy = await db.retrieveFairyById(fairyId)

  if (!fairy) {
    return res.status(404).send('No such fairy.')
  }

  let hash

  try {
    hash = db.renderHash(await db.renderSubject(fairy, mode), mode, scale)
  } catch (e) {
    console.error(`serveRender ${fairyId}: ${e.message}`)
    return res.status(500).send('Could not describe that fairy.')
  }

  const file = path.join(RENDERED_DIR, `${hash}.png`)

  if (fs.existsSync(file)) {
    res.set('Cache-Control', 'public, no-cache')
    res.set('X-Render-Status', 'hit')
    nameDownload(req, res, fairy, mode)
    touchRender(file)
    return res.sendFile(file)
  }

  try {
    const job = await db.enqueueRender(fairyId, mode, scale, { requeueIfDone: true, fairy })

    if (db.isRenderGivenUp(job)) {
      return sendFallback(res, mode, fairy)
    }
  } catch (e) {
    console.error(`serveRender ${fairyId}: could not enqueue: ${e.message}`)

    return sendPlaceholder(res, mode)
  }

  if (renderWaiters >= RENDER_MAX_WAITERS) {
    return sendPlaceholder(res, mode)
  }

  renderWaiters++

  let ready

  try {
    ready = await waitForRender(hash, req)
  } finally {
    renderWaiters--
  }

  if (ready) {
    res.set('Cache-Control', 'public, no-cache')
    res.set('X-Render-Status', 'rendered')
    nameDownload(req, res, fairy, mode)
    return res.sendFile(file)
  }

  sendPlaceholder(res, mode)
}

app.get('/fairies-render/render/:fairyId', (req, res) => serveRender(req, res, 'bust'))

app.get('/fairies-render/render/:fairyId/:variant', (req, res) => {
  const variant = req.params.variant

  if (variant === '' || variant === 'bust') return serveRender(req, res, 'bust')
  if (variant === 'full') return serveRender(req, res, 'full')

  if (variant === 'home') return serveRender(req, res, 'home')
  if (variant === 'homefull') return serveRender(req, res, 'homefull')

  res.status(404).send(`Unknown render variant '${variant}'.`)
})

// the render queue for render/worker.js

app.post('/fairies/api/internal/render/enqueue', async (req, res) => {
  if (!verifyAuthorization(req.headers.authorization)) {
    return res.status(401).send('Authorization failed.')
  }

  const fairyId = Number(req.query.fairyId)
  const mode = ['full', 'home', 'homefull'].includes(req.query.mode) ? req.query.mode : 'bust'

  const scale = Number(req.query.scale) || 0

  if (!Number.isInteger(fairyId)) {
    return res.status(400).send('Expected a numeric fairyId.')
  }

  try {
    const job = await db.enqueueRender(fairyId, mode, scale)
    res.json({ id: job._id, hash: job.hash, status: job.status })
  } catch (e) {
    res.status(404).send(e.message)
  }
})

app.post('/fairies/api/internal/render/claim', async (req, res) => {
  if (!verifyAuthorization(req.headers.authorization)) {
    return res.status(401).send('Authorization failed.')
  }

  const job = await db.claimNextRender()

  if (!job) {
    return res.json(null)
  }

  res.json({
    id: job._id,
    fairyId: job.fairyId,
    pickle: job.pickle,
    mode: job.mode,
    scale: job.scale,
    hash: job.hash,
    attempts: job.attempts
  })
})

app.post('/fairies/api/internal/render/finish/:id', async (req, res) => {
  if (!verifyAuthorization(req.headers.authorization)) {
    return res.status(401).send('Authorization failed.')
  }

  const job = await db.finishRender(req.params.id, {
    error: String(req.query.error || '').slice(0, 500)
  })

  if (!job) {
    return res.status(404).send('No such job.')
  }

  res.json({ id: job._id, status: job.status })
})

app.get('/fairies/api/internal/render/status', async (req, res) => {
  if (!verifyAuthorization(req.headers.authorization)) {
    return res.status(401).send('Authorization failed.')
  }

  res.json(await db.renderQueueDepth())
})

app.use(express.json())

app.post('/fairies/api/internal/setFairyData', async (req, res) => {
  if (!verifyAuthorization(req.headers.authorization)) {
    return res.status(401).send('Authorization failed.')
  }

  const data = req.body

  if (!data.fieldData) {
    return res.status(400).send({ success: false, message: 'Missing fieldData.' })
  }

  let fairy

  if (data.fairyId !== undefined && data.fairyId !== null) {
    fairy = await db.retrieveFairyById(data.fairyId)

    if (!fairy) {
      return res.status(404).send({ success: false, message: `Fairy ${data.fairyId} not found.` })
    }
  } else if (data.playToken) {
    const fairies = await db.retrieveFairiesByOwnerAccount(data.playToken)

    if (fairies.length === 0) {
      return res.status(404).send({ success: false, message: `No fairy found for playToken ${data.playToken}.` })
    }

    if (fairies.length > 1) {
      return res.status(409).send({
        success: false,
        message: `playToken ${data.playToken} owns ${fairies.length} fairies; address this write by fairyId.`
      })
    }

    fairy = fairies[0]
  } else {
    return res.status(400).send({ success: false, message: 'Missing fairyId (or playToken).' })
  }

  // an empty lua table arrives as {}, mongoose would drop the write
  if (data.fieldData.friends !== undefined && !Array.isArray(data.fieldData.friends)) {
    data.fieldData.friends = Object.values(data.fieldData.friends)
  }
  if (data.fieldData.ignored !== undefined) {
    const ignored = Array.isArray(data.fieldData.ignored) ? data.fieldData.ignored : Object.values(data.fieldData.ignored)
    data.fieldData.ignored = [...new Set(ignored.map(Number).filter(Number.isFinite))]
  }

  Object.assign(fairy, data.fieldData)
  await fairy.save()

  if (Object.keys(data.fieldData).some(key => key === 'gender' || key === 'avatar' || key.startsWith('avatar.'))) {
    lastWarmed.delete(fairy._id)
    warmFairy(fairy)
  }

  return res.status(200).send({ success: true, message: 'Success.' })
})

async function expireModeration (account) {
  const now = new Date()
  let changed = false
  if (account.banned && account.banUntil && account.banUntil <= now) {
    account.banned = 0
    account.banUntil = null
    changed = true
  }
  if (account.muted && account.mutedUntil && account.mutedUntil <= now) {
    account.muted = 0
    account.mutedUntil = null
    changed = true
  }
  if (changed) await account.save()
}

// three per account, FairyClient.lua's maxAvatars has to agree
const MAX_FAIRIES_PER_ACCOUNT = 3

async function fairiesForAccount (account) {
  return Fairy.find({
    $or: [{ accountId: account._id }, { ownerAccount: account.username }],
    deleted: { $ne: true }
  }).sort({ created: 1 })
}

// playerId has been stored as a bare id and as a one element array, both are read
function chosenIdOf (account) {
  const raw = Array.isArray(account.playerId) ? account.playerId[0] : account.playerId
  const id = Number(raw)
  return Number.isFinite(id) && id > 0 ? id : null
}

// the multi-fairy switch, written by the multiFairy switch on /gm/admin
async function multiFairyEnabled () {
  const setting = await db.db.collection('settings').findOne({ _id: 'multiFairy' })
  return !setting || setting.enabled !== false
}

// off caps accounts with one fairy or none at one, accounts that already have several keep all their slots
async function fairyLimitFor (account) {
  if (await multiFairyEnabled()) return MAX_FAIRIES_PER_ACCOUNT

  const live = await fairiesForAccount(account)
  return live.length > 1 ? MAX_FAIRIES_PER_ACCOUNT : 1
}

// the fairy an account last chose, else its oldest
function chosenOf (account, fairies) {
  if (!fairies.length) return null

  const chosen = chosenIdOf(account)
  return fairies.find(fairy => fairy._id === chosen) || fairies[0]
}

async function fairyForAccount (account) {
  return chosenOf(account, await fairiesForAccount(account))
}

async function fairyChosenBy (playToken) {
  const account = await db.retrieveAccountFromUser(playToken)
  if (!account) return db.retrieveFairyByOwnerAccount(playToken)
  return fairyForAccount(account)
}

// the account that owns a fairy, for settings that belong to the person and not the fairy
async function ownerOfFairy (fairy) {
  if (fairy.accountId) return Account.findOne({ _id: fairy.accountId })
  if (fairy.ownerAccount) return Account.findOne({ username: fairy.ownerAccount })
  return null
}

const MAX_FRIENDS = 300

// the friends list is the account's; an account not moved over yet still has its fairy's
function friendIdsFor (owner, fairy) {
  const list = owner && Array.isArray(owner.friends) ? owner.friends : (fairy && fairy.friends) || []
  return list.map(Number).filter(Number.isFinite)
}

// sound, music, tutorial and whisper settings are the account's; null means not moved over yet
function accountOptionsMask (owner, fairyMask) {
  return owner && typeof owner.optionsBitmask === 'number' ? owner.optionsBitmask : fairyMask
}

async function addIgnoreFor (account, ignoreId) {
  if (!ignoreId || ignoreId === account._id) return false
  await Account.updateOne({ _id: account._id }, { $addToSet: { ignored: ignoreId } })
  return true
}

app.post('/fairies/api/internal/setFriends', async (req, res) => {
  if (!verifyAuthorization(req.headers.authorization)) {
    return res.status(401).send('Authorization failed.')
  }
  const account = await Account.findById(Number(req.body.accountId))
  if (!account) return res.status(404).send({ success: false })

  // an empty lua table arrives as {}
  const sent = Array.isArray(req.body.friends) ? req.body.friends : Object.values(req.body.friends || {})
  const friends = [...new Set(sent.map(Number).filter(id => Number.isFinite(id) && id !== account._id))].slice(0, MAX_FRIENDS)

  await Account.updateOne({ _id: account._id }, { $set: { friends } })
  res.send({ success: true, friends })
})

app.post('/fairies/api/internal/removeIgnore', async (req, res) => {
  if (!verifyAuthorization(req.headers.authorization)) {
    return res.status(401).send('Authorization failed.')
  }
  const account = await Account.findById(Number(req.body.accountId))
  if (!account) return res.status(404).send({ success: false })

  const ignoreId = Number(req.body.ignoreId)
  await Account.updateOne({ _id: account._id }, { $pull: { ignored: { $in: [ignoreId, String(ignoreId)] } } })
  res.send({ success: true })
})

app.post('/fairies/api/internal/addIgnore', async (req, res) => {
  if (!verifyAuthorization(req.headers.authorization)) {
    return res.status(401).send('Authorization failed.')
  }
  const account = await Account.findById(Number(req.body.accountId))
  if (!account) return res.status(404).send({ success: false })
  res.send({ success: await addIgnoreFor(account, Number(req.body.ignoreId)) })
})

app.get('/fairies/api/internal/retrieveAccount', async (req, res) => {
  if (!verifyAuthorization(req.headers.authorization)) {
    return res.status(401).send('Authorization failed.')
  }

  res.setHeader('content-type', 'application/json')
  if (req.query.userName) {
    let account = await db.retrieveAccountFromUser(req.query.userName)
    if (account) {
      await expireModeration(account)
      account = account.toObject()
      account.mutedUntilEpoch = account.mutedUntil ? Math.floor(new Date(account.mutedUntil).getTime() / 1000) : 0
      account.speedChatPlus = AdminSettings.chatPlusFor(account)
      account.loginLocked = AdminSettings.isLockedOut('lockLogins', account)
      delete account.password
      delete account.passwordResetToken
      delete account.emailConfirmToken
      delete account.parentPortalToken
      if (Array.isArray(account.playerId)) {
        account.playerId = account.playerId[0] ?? 0
      }
      return res.end(JSON.stringify(
        account
      ))
    }
  }

  return res.status(404).send({ message: `Could not find account from username ${req.query.userName}` })
})

app.post('/fairies/api/internal/retrieveFairies', async (req, res) => {
  if (!verifyAuthorization(req.headers.authorization)) {
    return res.status(401).send('Authorization failed.')
  }

  const identifiers = req.body?.identifiers

  if (!Array.isArray(identifiers)) {
    return res.status(400).send({ success: false, message: 'Missing identifiers array.' })
  }

  res.setHeader('content-type', 'application/json')

  const wanted = identifiers.map(Number).filter(id => !Number.isNaN(id))

  if (wanted.length === 0) {
    return res.end(JSON.stringify({}))
  }

  // fairy ids (online friends, as the fairy they're playing) or account ids (the fairy that account chose)
  // they come off one counter so they never collide
  const toSummary = fairy => ({
    _id: fairy._id,
    accountId: fairy.accountId,
    name: fairy.name,
    ownerAccount: fairy.ownerAccount
  })

  const byIdentifier = {}

  const direct = await db.retrieveFairySummaries(wanted)
  for (const fairy of direct) {
    byIdentifier[fairy._id] = toSummary(fairy)
  }

  const accountIds = wanted.filter(id => !byIdentifier[id])
  if (accountIds.length) {
    const accounts = await Account.find({ _id: { $in: accountIds } }, { _id: 1, username: 1, playerId: 1 })

    if (accounts.length) {
      const owned = await Fairy.find({
        $or: [
          { accountId: { $in: accounts.map(account => account._id) } },
          { ownerAccount: { $in: accounts.map(account => account.username) } }
        ],
        deleted: { $ne: true }
      }, { _id: 1, accountId: 1, name: 1, ownerAccount: 1 }).sort({ created: 1 })

      for (const account of accounts) {
        const theirs = owned.filter(fairy => fairy.accountId === account._id || fairy.ownerAccount === account.username)
        const fairy = chosenOf(account, theirs)
        if (fairy) byIdentifier[account._id] = toSummary(fairy)
      }
    }
  }

  return res.end(JSON.stringify(byIdentifier))
})

app.get('/fairies/api/internal/retrieveFairy', async (req, res) => {
  if (!verifyAuthorization(req.headers.authorization)) {
    return res.status(401).send('Authorization failed.')
  }

  res.setHeader('content-type', 'application/json')
  if (req.query.identifier) {
    // a fairy id, or an account id for the fairy that account chose
    const id = Number(req.query.identifier)
    let fairy = false

    if (Number.isSafeInteger(id)) {
      fairy = await db.retrieveFairyById(id)

      if (!fairy) {
        const account = await db.retrieveAccountFromIdentifier(id)
        fairy = (account && await fairyForAccount(account)) || false
      }
    }

    if (fairy) {
      // friends and ignored are the account's, whichever of its fairies this is
      fairy = fairy.toObject ? fairy.toObject() : fairy
      const owner = await ownerOfFairy(fairy)
      fairy.friends = friendIdsFor(owner, fairy)
      fairy.ignored = (owner && owner.ignored) || []
    }

    res.end(JSON.stringify(fairy))
    return
  }

  if (req.query.playToken) {
    let fairy = await fairyChosenBy(req.query.playToken)
    if (fairy && fairy.famousFairy) {
      fairy = fairy.toObject ? fairy.toObject() : fairy
      fairy.puppetActive = Boolean(await db.db.collection('puppets').findOne({ _id: fairy._id }))
    }
    if (fairy) {
      // gmVisible is the account's
      fairy = fairy.toObject ? fairy.toObject() : fairy
      const owner = await db.retrieveAccountFromUser(req.query.playToken)
      fairy.gmVisible = Boolean(owner && owner.gmVisible)
      // same for the ignore list and the friends
      fairy.ignored = (owner && owner.ignored) || []
      fairy.friends = friendIdsFor(owner, fairy)
    }
    res.end(JSON.stringify(fairy))
    return
  }

  return res.status(400).send({})
})

app.post('/fairies/api/internal/report', async (req, res) => {
  if (!verifyAuthorization(req.headers.authorization)) {
    return res.status(401).send({ message: 'Authorization failed.' })
  }

  const body = req.body || {}
  const reporterAvId = Number(body.reporterAvId) || 0
  const targetAvId = Number(body.targetAvId) || 0

  const reporterKey = String(Number(body.reporterDISLId) || reporterAvId || 'unknown')
  if (isRepeatMessage(`report:${reporterKey}`, `${targetAvId}:${body.categoryCode || body.category || ''}:${body.message || ''}`)) {
    return res.status(429).send({ success: false, message: 'That report was already filed.' })
  }
  if (!allowAll([[gameReportsByPlayer, reporterKey]])) {
    return res.status(429).send({ success: false, message: 'Too many reports from this player.' })
  }

  const [reporter, target] = await Promise.all([
    reporterAvId ? Fairy.findById(reporterAvId).catch(() => null) : null,
    targetAvId ? Fairy.findById(targetAvId).catch(() => null) : null
  ])

  const reporterName = (reporter && reporter.name) || String(body.reporterName || '').slice(0, 40)
  const reportedName = (target && target.name) || (targetAvId ? `Fairy ${targetAvId}` : '')
  const what = String(body.category || 'Report').slice(0, 60)
  const message = String(body.message || '').trim().slice(0, 5000)

  const ticket = await SupportTicket.create({
    accountId: Number(body.reporterDISLId) || null,
    email: (reporter && reporter.email) || '',
    category: 'memberReport',
    subject: reportedName ? `${what}: ${reportedName}` : what,
    playerName: reporterName,
    reportedName,
    source: 'game',
    details: {
      reportCategory: what,
      reportCategoryCode: String(body.categoryCode || '').slice(0, 60),
      reportedFairyId: targetAvId ? String(targetAvId) : '',
      reportedAccountId: Number(body.targetDISLId) ? String(body.targetDISLId) : '',
      reporterFairyId: reporterAvId ? String(reporterAvId) : ''
    },
    messages: [{ from: 'player', body: message || '(the player sent no message with this report)' }]
  })

  await DiscordService.notifyTicket({
    ticketId: ticket._id,
    subject: ticket.subject,
    category: 'In-game report',
    fromEmail: '',
    playerName: reporterName,
    reportedName
  }).catch(() => null)

  res.send({ success: true, ticketId: ticket._id })
})

app.get('/fairies/api/internal/retrieveObject/:identifier', async (req, res) => {
  if (!verifyAuthorization(req.headers.authorization)) {
    return res.status(401).send('Authorization failed.')
  }

  res.setHeader('content-type', 'application/json')
  if (req.params.identifier) {
    let account = await db.retrieveAccountFromIdentifier(req.params.identifier)
    if (account) {
      account = account.toObject()
      delete account.password

      if (Array.isArray(account.playerId)) {
        account.playerId = account.playerId[0] ?? 0
      }

      account.objectName = 'Account'
      return res.end(JSON.stringify(
        account
      ))
    }

    let fairy = await db.retrieveFairy(req.params.identifier)
    if (fairy) {
      fairy = fairy.toObject()

      if (fairy._id === Number(req.params.identifier)) {
        fairy.objectName = 'DistributedFairyPlayer'
        fairy.optionsBitmask = accountOptionsMask(await ownerOfFairy(fairy), fairy.optionsBitmask)
      } else {
        fairy.objectName = 'Unknown'
      }

      return res.end(JSON.stringify(
        fairy
      ))
    }

    return res.status(404).send({ message: `Object ${req.params.identifier} not found!` })
  }
})

function normalizeBio (value) {
  if (!Array.isArray(value)) {
    return value
  }

  return value.map((answer, i) => {
    if (Array.isArray(answer)) {
      return { id: answer[0], answer: answer[1] }
    }

    if (answer && typeof answer === 'object') {
      return {
        id: answer.id ?? answer.questionId ?? i + 1,
        answer: answer.answer ?? answer.answerId ?? 0
      }
    }

    return answer
  })
}

app.post('/fairies/api/internal/updateObject/:identifier', async (req, res) => {
  if (!verifyAuthorization(req.headers.authorization)) {
    return res.status(401).send('Authorization failed.')
  }

  const data = req.body

  let updated = false
  if (req.params.identifier) {
    const account = await db.retrieveAccountFromIdentifier(req.params.identifier)
    if (account) {
      Object.assign(account, data)
      await account.save()
      updated = true
    }

    if (!updated) {
      const fairy = await db.retrieveFairy(req.params.identifier)
      if (fairy) {
        const fairyDNAFieldMap = {
          talent: 'talent',
          head: 'avatar.proportions.head',
          height: 'avatar.proportions.height',
          body: 'avatar.proportions.body',
          hair_back: 'avatar.hair_back',
          hair_front: 'avatar.hair_front',
          face: 'avatar.face',
          eye: 'avatar.eye',
          wing: 'avatar.wing',
          hair_color: 'avatar.hair_color',
          hair_color2: 'avatar.hair_color2',
          eye_color: 'avatar.eye_color',
          skin_color: 'avatar.skin_color',
          wing_color: 'avatar.wing_color',
          gender: 'gender',
          head_rot: 'avatar.rotations.head_rot',
          ul_arm_rot: 'avatar.rotations.ul_arm_rot',
          ur_arm_rot: 'avatar.rotations.ur_arm_rot',
          ll_arm_rot: 'avatar.rotations.ll_arm_rot',
          lr_arm_rot: 'avatar.rotations.lr_arm_rot',
          ul_leg_rot: 'avatar.rotations.ul_leg_rot',
          ur_leg_rot: 'avatar.rotations.ur_leg_rot',
          ll_leg_rot: 'avatar.rotations.ll_leg_rot',
          lr_leg_rot: 'avatar.rotations.lr_leg_rot'
        }

        for (const [key, value] of Object.entries(data)) {
          if (fairyDNAFieldMap[key]) {
            fairy.set(fairyDNAFieldMap[key], value)
          } else if (key === 'name') {
            fairy.name = normalizeFairyName(value)
          } else if (key === 'bio') {
            fairy.bio = normalizeBio(value)
          } else if (key === 'moreOptions') {
            fairy.moreOptions = normalizeMoreOptions(value)
          } else if (key === 'optionsBitmask') {
            const owner = await ownerOfFairy(fairy)
            if (owner) {
              await Account.updateOne({ _id: owner._id }, { $set: { optionsBitmask: Number(value) } })
            } else {
              fairy.optionsBitmask = value
            }
          } else {
            fairy[key] = value
          }
        }

        await fairy.save()
        updated = true
      }
    }

    if (updated) {
      return res.send({ message: 'Updated successfully!' })
    } else {
      return res.status(404).send({ message: `Could not update ${req.params.identifier}` })
    }
  }
})

// gm portal command queue

const GM_COMMAND_STALE_MS = 8000

// resolves to the caller's account if they are a Moderator or Administrator
async function requireStaff (req, res) {
  const ses = req.session

  if (!ses || !ses.logged || !ses.userId) {
    res.status(401).send({ message: 'Not logged in.' })
    return null
  }

  const account = await db.retrieveAccountFromIdentifier(ses.userId)

  if (!account || !['Moderator', 'Administrator'].includes(account.accountType)) {
    res.status(403).send({ message: 'This account is not staff.' })
    return null
  }

  return account
}

// still pending after GM_COMMAND_STALE_MS means nobody claimed it (fairy offline, or the uberdog is down)
async function sweepStaleCommands () {
  await GmCommand.updateMany(
    { status: 'pending', issuedAt: { $lt: new Date(Date.now() - GM_COMMAND_STALE_MS) } },
    { $set: { status: 'unclaimed', finishedAt: new Date() } }
  )
}

function gmRegistryCollection () {
  return db.db.collection('gmRegistry')
}

async function findAccountByUsername (username) {
  const escaped = String(username).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return Account.findOne({ username: { $regex: `^${escaped}$`, $options: 'i' } })
}

async function queueGmCommand (staff, command, scope, category) {
  return GmCommand.create({
    command,
    scope,
    category,
    issuedBy: staff._id,
    issuedByName: staff.username,
    accountType: staff.accountType
  })
}

const TIER_RANK = { Player: 0, Moderator: 1, Administrator: 2 }

// staff can change their own account and any account below their own tier, never a peer's
function assertCanEditAccount (staff, account) {
  if (String(account._id) === String(staff._id)) return

  const theirs = account.accountType || 'Player'
  if ((TIER_RANK[theirs] || 0) >= (TIER_RANK[staff.accountType] || 0)) {
    throw new Error(`${account.username} is ${theirs === 'Administrator' ? 'an' : 'a'} ${theirs}, and ${staff.accountType === 'Administrator' ? 'an' : 'a'} ${staff.accountType} can only change accounts below their own tier`)
  }
}

const webGmCommands = {
  'rename-account': {
    usage: 'rename-account <current Account ID> <new Account ID>',
    tier: 'Moderator',
    description: 'Change the Account ID a player logs in with. Their fairy moves with it, and they are disconnected if online.',
    async run (args, staff) {
      if (args.length !== 2) throw new Error('usage: rename-account <current Account ID> <new Account ID>')
      const account = await findAccountByUsername(args[0])
      if (!account) throw new Error(`no account ${args[0]}`)
      assertCanEditAccount(staff, account)
      const newName = args[1].toLowerCase()
      if (!accountIdPattern.test(newName)) throw new Error('Account IDs are 3 to 20 letters or numbers')
      if (!await db.isUsernameAvailable(newName)) throw new Error(`${newName} is already taken`)
      const oldName = account.username
      account.username = newName
      await account.save()
      await Fairy.updateMany({ ownerAccount: oldName }, { $set: { ownerAccount: newName } })
      await queueGmCommand(staff, `kick ${account._id}`, 'global', 'moderation')
      return `renamed account ${oldName} to ${newName}`
    }
  },
  'set-email': {
    usage: 'set-email <Account ID> <e-mail>',
    tier: 'Moderator',
    description: "Change the e-mail on a player's account.",
    async run (args, staff) {
      if (args.length !== 2) throw new Error('usage: set-email <Account ID> <e-mail>')
      const account = await findAccountByUsername(args[0])
      if (!account) throw new Error(`no account ${args[0]}`)
      assertCanEditAccount(staff, account)
      if (!emailPattern.test(args[1])) throw new Error('that is not a valid e-mail address')
      account.email = args[1]
      await account.save()
      return `e-mail for ${account.username} is now ${args[1]}`
    }
  },
  'delete-account': {
    usage: 'delete-account <Account ID>',
    description: "Delete a player's account for them, for example when a parent asks. It works the same as the player deleting it: locked now, and removed for good after 30 days unless restored.",
    tier: 'Administrator',
    async run (args) {
      if (args.length !== 1) throw new Error('usage: delete-account <Account ID>')
      const account = await findAccountByUsername(args[0])
      if (!account) throw new Error(`no account ${args[0]}`)
      if (account.deleted) throw new Error(`${account.username} is already deleted`)
      if (account.accountType && account.accountType !== 'Player') throw new Error(`${account.username} is staff -- change their tier first`)

      await softDeleteAccount(account)
      return `${account.username} is deleted, and will be removed for good in ${DELETE_GRACE_DAYS} days unless you run restore-account`
    }
  },
  'restore-account': {
    usage: 'restore-account <Account ID>',
    description: 'Bring back an account its owner deleted, with the fairies that went with it. Only possible until it is removed for good (30 days).',
    tier: 'Moderator',
    async run (args) {
      if (args.length !== 1) throw new Error('usage: restore-account <Account ID>')
      const account = await findAccountByUsername(args[0])
      if (!account) throw new Error(`no account ${args[0]} -- it may already have been removed for good`)
      if (!account.deleted) throw new Error(`${account.username} has not been deleted`)

      const restored = await restoreDeletedAccount(account)
      return `${account.username} is back, with ${restored} fairies`
    }
  },
  'invite-bypass': {
    usage: 'invite-bypass <e-mail>',
    description: 'E-mail a fresh one-time registration link to an address right now, skipping the waitlist queue and the daily cap. A link sent earlier to that address stops working.',
    tier: 'Moderator',
    async run (args) {
      if (args.length !== 1) throw new Error('usage: invite-bypass <e-mail>')
      const email = Waitlist.normalizeEmail(args[0])
      if (!emailPattern.test(email)) throw new Error('that is not a valid e-mail address')

      const { delivered, link } = await Waitlist.bypass(email)
      return delivered
        ? `sent a new invite link to ${email}`
        : `the e-mail to ${email} could not be sent -- give them this link yourself: ${link}`
    }
  },
  'create-account': {
    usage: 'create-account <Account ID> <e-mail> <password>',
    description: 'Make an account directly, without an invite or the waitlist. It starts with no age on file, so the owner is asked for one the first time they log in.',
    secretFrom: 3,
    tier: 'Moderator',
    async run (args) {
      if (args.length !== 3) throw new Error('usage: create-account <Account ID> <e-mail> <password>')
      const username = args[0].toLowerCase()
      if (!accountIdPattern.test(username)) throw new Error('Account IDs are 3 to 20 letters or numbers')
      if (!emailPattern.test(args[1])) throw new Error('that is not a valid e-mail address')
      if (args[2].length < 6 || args[2].toLowerCase() === username) throw new Error('passwords need at least 6 characters and cannot be the Account ID')
      if (!await db.isUsernameAvailable(username)) throw new Error(`${username} is already taken`)

      const created = await db.createAccount(username, args[2])
      if (!created) throw new Error(`${username} is already taken`)
      await Account.updateOne({ _id: created._id }, { $set: { email: args[1] } })
      return `created account ${username} (${args[1]}) -- tell them the password privately; they are asked for an age at first login`
    }
  },
  'set-password': {
    usage: 'set-password <Account ID> <new password>',
    description: "Set a new password on a player's account. Tell them the new password privately.",
    secretFrom: 2,
    tier: 'Moderator',
    async run (args, staff) {
      if (args.length !== 2) throw new Error('usage: set-password <Account ID> <new password>')
      const account = await findAccountByUsername(args[0])
      if (!account) throw new Error(`no account ${args[0]}`)
      assertCanEditAccount(staff, account)
      if (args[1].length < 6) throw new Error('passwords need at least 6 characters')
      account.password = await bcrypt.hash(args[1], 12)
      await account.save()
      return `password changed for ${account.username}`
    }
  },
  'set-birthday': {
    usage: 'set-birthday <Account ID> <YYYY-MM-DD>',
    tier: 'Moderator',
    description: "Set a player's birthday. Their age is worked out from it and keeps counting up on each birthday.",
    async run (args, staff) {
      if (args.length !== 2) throw new Error('usage: set-birthday <Account ID> <YYYY-MM-DD>')
      const account = await findAccountByUsername(args[0])
      if (!account) throw new Error(`no account ${args[0]}`)
      assertCanEditAccount(staff, account)
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(args[1])
      if (!match) throw new Error('write the birthday as YYYY-MM-DD')
      const [year, month, day] = match.slice(1).map(Number)
      const birthday = new Date(year, month - 1, day)
      if (birthday.getMonth() !== month - 1 || birthday.getDate() !== day) throw new Error(`${args[1]} is not a real date`)
      const now = new Date()
      if (birthday > now) throw new Error('that birthday is in the future')

      // age as of the most recent birthday, anchored there so currentAge ticks up on the next one
      let age = now.getFullYear() - year
      let lastBirthday = new Date(now.getFullYear(), month - 1, day)
      if (lastBirthday > now) {
        age -= 1
        lastBirthday = new Date(now.getFullYear() - 1, month - 1, day)
      }
      if (age < 1 || age > 120) throw new Error(`that would make them ${age}`)
      await Account.updateOne({ _id: account._id }, { $set: { age, ageGivenAt: lastBirthday } })
      return `${account.username} is now ${age} (born ${args[1]}) -- chat settings update at their next login`
    }
  },
  'set-speedchat-only': {
    usage: 'set-speedchat-only <Account ID> <on|off>',
    tier: 'Moderator',
    category: 'moderation',
    description: "Limit a player to SpeedChat: no SpeedChat Plus or open chat whatever their age or parental settings, but they can still use the quick phrases. It applies at their next login, so run kick on them to apply it now.",
    async run (args, staff) {
      const setting = (args[1] || '').toLowerCase()
      if (args.length !== 2 || !['on', 'off'].includes(setting)) throw new Error('usage: set-speedchat-only <Account ID> <on|off>')
      const account = await findAccountByUsername(args[0])
      if (!account) throw new Error(`no account ${args[0]}`)
      assertCanEditAccount(staff, account)
      await Account.updateOne({ _id: account._id }, { $set: { speedChatOnly: setting === 'on' } })
      return `${account.username} is ${setting === 'on' ? 'limited to SpeedChat' : 'no longer limited to SpeedChat'} from their next login`
    }
  },
  'email-lookup': {
    usage: 'email-lookup <email or part of email>',
    description: 'Find all accounts matching an email address (partial match supported).',
    tier: 'Moderator',
    async run (args, staff) {
      if (args.length === 0) throw new Error('usage: email-lookup <email or part of email>')
      const query = args.join(' ').toLowerCase()
      const accounts = await Account.find({ email: new RegExp(query, 'i') })
      if (accounts.length === 0) {
        return 'no accounts found'
      }
      return accounts.map(a => `${a.username} - ${a.email}`).join('\n')
    }
  },
  // same as the gm-mode magic word, the flag is on the account and covers every fairy on it
  'gm-mode': {
    usage: 'gm-mode <on|off>',
    description: 'Whether your fairies log in wearing the GM avatar. Applies to the whole account; log out and back in for it to take effect.',
    tier: 'Moderator',
    category: 'moderation',
    async run (args, staff) {
      const setting = (args[0] || '').toLowerCase()
      if (args.length !== 1 || !['on', 'off'].includes(setting)) throw new Error('usage: gm-mode <on|off>')
      await Account.updateOne({ _id: staff._id }, { $set: { gmVisible: setting === 'on' } })
      return `gm avatar ${setting} for ${staff.username} -- log out and back in for it to take effect`
    }
  },
  // this only sets your online status as invisible to others
  'set-self-invisible': {
    usage: 'set-self-invisible',
    description: 'Toggle your online visibility to other players. You must be logged in with GM Mode enabled.',
    tier: 'Moderator',
    category: 'moderation',
    async run (args, staff) {
      if (args.length !== 0) throw new Error('usage: set-self-invisible')
      if (!staff.gmVisible) throw new Error('you must log in with GM mode enabled to use this')
      await queueGmCommand(staff, 'set-self-invisible', 'global', 'moderation')
      return 'invisibility toggled -- check your status in-game'
    }
  }
}

function webRegistry () {
  return Object.entries(webGmCommands).map(([name, cmd]) => ({
    name,
    usage: cmd.usage,
    tier: cmd.tier || 'Administrator',
    scope: 'web',
    category: cmd.category || 'accounts',
    description: cmd.description
  }))
}

app.get('/fairies/api/gm/gm-mode', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  res.send({ on: Boolean(account.gmVisible), username: account.username })
})

app.get('/fairies/api/gm/invisibility', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  res.send({ canToggle: Boolean(account.gmVisible), gmVisible: Boolean(account.gmVisible), username: account.username })
})

app.get('/fairies/api/gm/registry', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const commands = await gmRegistryCollection().find({}).toArray()
  res.send([...commands, ...webRegistry()].sort((a, b) => a.name.localeCompare(b.name)))
})

app.get('/fairies/api/gm/lookup', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const q = String(req.query.q || '').trim()
  if (q.length < 2) return res.send({ items: [] })

  const term = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  const fairyFields = 'name accountId ownerAccount talent level'

  const [byFairyName, byUsername] = await Promise.all([
    Fairy.find({ name: term, deleted: { $ne: true } }).select(fairyFields).limit(25).lean(),
    Account.find({ username: term }).select('_id username').limit(25).lean()
  ])

  const usernameAccountIds = byUsername.map(a => a._id)
  const theirFairies = usernameAccountIds.length
    ? await Fairy.find({ accountId: { $in: usernameAccountIds }, deleted: { $ne: true } }).select(fairyFields).limit(50).lean()
    : []

  const rows = new Map()
  for (const f of [...byFairyName, ...theirFairies]) {
    rows.set(f._id, { fairyId: f._id, fairyName: f.name, talent: f.talent, level: f.level, accountId: f.accountId, username: f.ownerAccount })
  }
  for (const a of byUsername) {
    if (![...rows.values()].some(row => row.accountId === a._id)) {
      rows.set('account-' + a._id, { fairyId: null, fairyName: '', talent: null, level: null, accountId: a._id, username: a.username })
    }
  }

  const accountIds = [...new Set([...rows.values()].map(row => row.accountId))]
  const accounts = accountIds.length
    ? await Account.find({ _id: { $in: accountIds } }).select('_id accountType banned muted').lean()
    : []
  const accountsById = new Map(accounts.map(a => [a._id, a]))

  const items = [...rows.values()].slice(0, 30).map(row => {
    const acct = accountsById.get(row.accountId)
    return { ...row, accountType: (acct && acct.accountType) || 'Player', banned: Boolean(acct && acct.banned), muted: Boolean(acct && acct.muted) }
  })

  res.send({ items })
})

app.post('/fairies/api/gm/commands', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const { command } = req.body

  if (!command || typeof command !== 'string' || !command.trim()) {
    return res.status(400).send({ message: 'command is required.' })
  }

  const trimmed = command.trim()
  const name = trimmed.split(/\s+/)[0].toLowerCase()

  const webCommand = webGmCommands[name]
  if (webCommand) {
    await Waitlist.rememberBase(siteUrl(req)).catch(() => {})
    const tier = webCommand.tier || 'Administrator'
    if (tier === 'Administrator' && account.accountType !== 'Administrator') {
      return res.status(403).send({ message: `${name} needs Administrator; this account is ${account.accountType}.` })
    }
    const words = trimmed.split(/\s+/)
    const logged = webCommand.secretFrom ? [...words.slice(0, webCommand.secretFrom), '••••••'].join(' ') : trimmed
    const doc = await GmCommand.create({
      command: logged,
      scope: 'web',
      category: webCommand.category || 'accounts',
      issuedBy: account._id,
      issuedByName: account.username,
      accountType: account.accountType,
      status: 'running',
      claimedBy: 'web-api'
    })
    let status = 'done'
    let response
    try {
      response = await webCommand.run(words.slice(1), account)
    } catch (err) {
      status = 'failed'
      response = err.message
    }
    await GmCommand.updateOne({ _id: doc._id }, { $set: { status, response, finishedAt: new Date() } })
    return res.send({ _id: doc._id, status })
  }

  const known = await gmRegistryCollection().findOne({ name })

  if (!known) {
    return res.status(400).send({ message: `Unknown command "${name}".` })
  }

  if (!['Moderator', 'Administrator'].includes(account.accountType) ||
      (known.tier === 'Administrator' && account.accountType !== 'Administrator')) {
    return res.status(403).send({ message: `${name} needs ${known.tier}; this account is ${account.accountType}.` })
  }

  const doc = await GmCommand.create({
    command: trimmed,
    scope: known.scope,
    category: known.category || 'debug',
    issuedBy: account._id,
    issuedByName: account.username,
    accountType: account.accountType
  })

  res.send({ _id: doc._id, status: doc.status })
})

app.get('/fairies/api/gm/commands/:id', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  await sweepStaleCommands()

  const doc = await GmCommand.findById(req.params.id)
  if (!doc) {
    return res.status(404).send({ message: 'No such command.' })
  }

  res.send(doc)
})

function paginationParams (req) {
  const page = Math.max(1, parseInt(req.query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 10))
  return { page, pageSize, skip: (page - 1) * pageSize }
}

function searchRegex (req) {
  const term = String(req.query.search || '').trim()
  if (!term) return null
  return new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
}

app.get('/fairies/api/gm/commands', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  await sweepStaleCommands()

  const { page, pageSize, skip } = paginationParams(req)
  const term = searchRegex(req)
  const filter = term ? { $or: [{ command: term }, { issuedByName: term }] } : {}

  const [items, total] = await Promise.all([
    GmCommand.find(filter).sort({ issuedAt: -1 }).skip(skip).limit(pageSize),
    GmCommand.countDocuments(filter)
  ])
  res.send({ items, total, page, pageSize })
})

// support tickets

// resolves to the logged in account, or sends 401 and returns null
async function requirePlayer (req, res) {
  const ses = req.session

  if (!ses || !ses.logged || !ses.userId) {
    res.status(401).send({ message: 'Not logged in.' })
    return null
  }

  const account = await db.retrieveAccountFromIdentifier(ses.userId)

  if (!account) {
    res.status(401).send({ message: 'Account not found.' })
    return null
  }

  return account
}

// where the player's copy of the site lives
function siteUrl (req) {
  if (process.env.SITE_URL) return String(process.env.SITE_URL).replace(/\/+$/, '')
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http'
  return `${proto}://${req.headers.host}`
}

const ticketCategories = {
  account: 'Account',
  tech: 'Tech',
  bugSite: 'Bug Report: Site',
  bugGame: 'Bug Report: Game',
  memberReport: 'Member Report',
  banAppeal: 'Ban Appeal',
  forgotCredentials: 'Forgot Username or Password',
  general: 'General Inquiry',
  ...ApplicationForms.categories
}

// filed from the application page only, never by the contact form
const isApplicationCategory = category => Object.prototype.hasOwnProperty.call(ApplicationForms.categories, category)

const guestTicketsByIp = makeLimiter(5, hourMs)
const guestTicketsByIpDaily = makeLimiter(10, dayMs)
const guestTicketsAll = makeLimiter(100, hourMs)
const accountTickets = makeLimiter(5, hourMs)
const accountTicketsDaily = makeLimiter(20, dayMs)
const ticketsByEmail = makeLimiter(3, hourMs)
const ticketsByEmailDaily = makeLimiter(10, dayMs)
const accountReplies = makeLimiter(30, hourMs)
const gameReportsByPlayer = makeLimiter(10, hourMs)
const isRepeatMessage = makeRepeatGuard(hourMs)

const MAX_OPEN_TICKETS_PER_ACCOUNT = 10
const MAX_MESSAGES_PER_TICKET = 300

function ticketFilingAllowed (account, ip, address) {
  const emailChecks = [[ticketsByEmail, address.toLowerCase()], [ticketsByEmailDaily, address.toLowerCase()]]

  if (account) {
    return allowAll([[accountTickets, account._id], [accountTicketsDaily, account._id], ...emailChecks])
  }

  return allowAll([[guestTicketsByIp, ip], [guestTicketsByIpDaily, ip], [guestTicketsAll, 'all'], ...emailChecks])
}

async function accountHasTooManyOpenTickets (account) {
  const open = await SupportTicket.countDocuments({ accountId: account._id, status: { $in: ['open', 'pending'] } })
  return open >= MAX_OPEN_TICKETS_PER_ACCOUNT
}

// attachments need no staff or login since someone appealing a ban can't log in
const TICKET_UPLOAD_DIR = 'site/uploads/tickets'
// 10 per message and 50 per thread, high on purpose so evidence can build up over days
const MAX_TICKET_ATTACHMENTS = 10
const MAX_TICKET_ATTACHMENTS_TOTAL = 50

const ticketUploadsByIp = makeLimiter(60, hourMs)
const ticketUploadsByIpDaily = makeLimiter(200, dayMs)
const ticketUploadsAll = makeLimiter(500, hourMs)

function ticketUploadAllowed (ip) {
  return allowAll([[ticketUploadsByIp, ip], [ticketUploadsByIpDaily, ip], [ticketUploadsAll, 'all']])
}

// details are a map so a new form isn't a schema change
function acceptedDetails (raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}

  const details = {}

  for (const [key, value] of Object.entries(raw).slice(0, 12)) {
    const name = String(key).replace(/[^A-Za-z0-9_]/g, '').slice(0, 40)
    const text = String(value == null ? '' : value).trim().slice(0, 2000)
    if (name && text) details[name] = text
  }

  return details
}

// only keep attachment urls this route wrote
function acceptedAttachments (raw) {
  if (!Array.isArray(raw)) return []

  const allowed = /^\/site\/uploads\/tickets\/[A-Za-z0-9_-]+\.(png|jpg|gif)$/

  return raw
    .filter(item => item && typeof item === 'object' && allowed.test(String(item.url || '')))
    .slice(0, MAX_TICKET_ATTACHMENTS)
    .map(item => ({
      url: String(item.url),
      name: String(item.name || '').slice(0, 120)
    }))
}

function addAttachments (ticket, raw) {
  const room = MAX_TICKET_ATTACHMENTS_TOTAL - (ticket.attachments || []).length
  if (room <= 0) return 0

  const adding = acceptedAttachments(raw).slice(0, room)
  if (adding.length) ticket.attachments.push(...adding)

  return adding.length
}

app.post('/fairies/api/support/uploads',
  express.raw({ type: 'application/octet-stream', limit: '4mb' }),
  async (req, res) => {
    if (AdminSettings.isOn('lockTickets')) return res.status(403).send({ error: 'LOCKED', message: 'Support tickets are closed right now. Please try again later.' })

    if (!ticketUploadAllowed(req.ip)) {
      return res.status(429).send({ error: 'TOO_MANY', message: 'That is a lot of files. Please try again in an hour.' })
    }
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).send({ error: 'NO_FILE', message: 'No file was sent.' })
    }

    const type = sniffImageType(req.body)
    if (!type) {
      return res.status(400).send({ error: 'NOT_IMAGE', message: `Please attach a ${ACCEPTED_IMAGE_TYPES} image.` })
    }

    const dir = path.join(WEB_ROOT, TICKET_UPLOAD_DIR)
    await fs.promises.mkdir(dir, { recursive: true })

    const name = uploadFileName(req.query.name, type.ext)
    await fs.promises.writeFile(path.join(dir, name), req.body)

    res.send({ success: true, url: `/${TICKET_UPLOAD_DIR}/${name}`, name: String(req.query.name || name).slice(0, 120) })
  })

app.get('/fairies/api/support/categories', (req, res) => {
  res.send(Object.fromEntries(Object.entries(ticketCategories).filter(([key]) => !isApplicationCategory(key))))
})

app.get('/fairies/api/support/application-forms', (req, res) => {
  res.send({ open: !AdminSettings.isOn('lockApplications'), forms: ApplicationForms.publicForms() })
})

const applicationsByAccount = makeLimiter(3, dayMs)

app.post('/fairies/api/support/applications', async (req, res) => {
  if (AdminSettings.isOn('lockApplications')) return res.status(403).send({ error: 'LOCKED', message: 'Applications are closed right now. Please watch the Discord for when they open.' })

  if (String(req.body.website || '').trim()) {
    return res.send({ _id: crypto.randomBytes(3).toString('hex').toUpperCase(), status: 'open' })
  }

  const ses = req.session
  const account = ses && ses.logged && ses.userId ? await db.retrieveAccountFromIdentifier(ses.userId) : null

  const category = String(req.body.form || '')
  const form = ApplicationForms.formFor(category)
  if (!form) return res.status(400).send({ error: 'INVALID_FORM', message: 'Please pick which team you are applying to.' })

  const checked = ApplicationForms.checkAnswers(form, req.body.answers)
  if (checked.errors) return res.status(400).send({ error: 'INVALID_ANSWERS', message: 'Some answers need another look.', fields: checked.errors })

  // nothing from this application is kept unless they are old enough
  if (ApplicationForms.MIN_AGE && Number(checked.answers.age) < ApplicationForms.MIN_AGE) {
    return res.status(400).send({ error: 'TOO_YOUNG', message: `Sorry, applications are only open to people ${ApplicationForms.MIN_AGE} and older right now. We'd love to hear from you when you're older!` })
  }

  const address = String((account && account.email) || req.body.email || '').trim()
  if (!address || !emailPattern.test(address)) {
    return res.status(400).send({ error: 'INVALID_EMAIL', message: 'Please enter a valid e-mail address so we can reply.', fields: { email: 'Please enter a valid e-mail address.' } })
  }

  const accountName = account ? account.username : String(req.body.accountName || '').trim().slice(0, 40)

  const alreadyApplied = await SupportTicket.exists({
    category,
    status: { $in: ['open', 'pending'] },
    $or: [
      ...(account ? [{ accountId: account._id }] : []),
      { email: new RegExp('^' + address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
    ]
  })
  if (alreadyApplied) {
    return res.status(409).send({ error: 'ALREADY_APPLIED', message: 'You already have an application in for this team. We\'ll be in touch by e-mail.' })
  }

  if (!allowAll([[applicationsByAccount, account ? account._id : req.ip]]) || !ticketFilingAllowed(account, req.ip, address)) {
    return res.status(429).send({ error: 'TOO_MANY', message: 'You have sent a lot of messages. Please try again later.' })
  }

  const subject = `${form.title} application: ${checked.answers.discord}`.slice(0, 120)
  const ticket = await SupportTicket.create({
    accountId: account ? account._id : null,
    viewToken: account ? '' : crypto.randomBytes(24).toString('hex'),
    email: address,
    category,
    subject,
    playerName: accountName,
    source: 'site',
    details: ApplicationForms.summaryOf(checked.answers),
    messages: [{ from: 'player', body: ApplicationForms.composeBody(form, checked.answers) }]
  })

  await EmailService.sendEmail({
    to: address,
    subject: `[Ticket #${ticket._id}] ${form.title} application`,
    text: `Thank you for applying to the ${form.title}! We've got your application and will be in touch here by e-mail. Please watch the Discord for when we plan to review applications.${ticket.viewToken ? `

You applied without signing in, so here is your own link to read our reply and write back:
${siteUrl(req)}/contactUs.html?ticket=${ticket.viewToken}

Keep it to yourself -- anyone with the link can read this.` : ''}`
  }).catch(err => console.error('[applications] confirmation e-mail failed:', err.message))

  await DiscordService.sendToDiscord(process.env.APPLICATIONS_WEBHOOK_URL || process.env.TICKETS_WEBHOOK_URL, {
    title: 'New Team Application',
    message: subject,
    color: 0x60d4c4,
    fields: [
      { name: 'Team', value: form.title, inline: true },
      { name: 'Discord', value: checked.answers.discord.slice(0, 100), inline: true },
      { name: 'Ticket', value: String(ticket._id), inline: true }
    ]
  })

  res.send({ _id: ticket._id, status: ticket.status })
})

app.post('/fairies/api/support/tickets', async (req, res) => {
  if (AdminSettings.isOn('lockTickets')) return res.status(403).send({ message: 'Support tickets are closed right now. Please try again later.' })

  const ses = req.session
  const account = ses && ses.logged && ses.userId ? await db.retrieveAccountFromIdentifier(ses.userId) : null

  const category = String(req.body.category || '')
  const subject = String(req.body.subject || '').trim().slice(0, 120)
  const body = String(req.body.body || '').trim().slice(0, 5000)
  const email = String(req.body.email || '').trim()
  const playerName = String(req.body.playerName || '').trim().slice(0, 40)
  const reportedName = String(req.body.reportedName || '').trim().slice(0, 40)
  const details = acceptedDetails(req.body.details)
  const attachments = acceptedAttachments(req.body.attachments)

  if (String(req.body.website || '').trim()) {
    return res.send({ _id: crypto.randomBytes(3).toString('hex').toUpperCase(), status: 'open' })
  }

  if (!ticketCategories[category] || isApplicationCategory(category)) {
    return res.status(400).send({ error: 'INVALID_CATEGORY', message: 'Please pick what your message is about.' })
  }
  if (!subject || !body) {
    return res.status(400).send({ error: 'MISSING_FIELDS', message: 'Please fill in a subject and a message.' })
  }
  if (!account && !playerName) {
    return res.status(400).send({ error: 'MISSING_NAME', message: 'Please tell us your Account ID or Fairy name.' })
  }

  const address = (account && account.email) || email
  if (!address || !emailPattern.test(address)) {
    return res.status(400).send({ error: 'INVALID_EMAIL', message: 'Please enter a valid e-mail address so we can reply.' })
  }
  if (account && await accountHasTooManyOpenTickets(account)) {
    return res.status(429).send({ error: 'TOO_MANY_OPEN', message: 'You already have several open messages. Please add to one of those, or wait for us to reply.' })
  }
  if (isRepeatMessage(account ? `account:${account._id}` : `ip:${req.ip}`, subject + body)) {
    return res.status(429).send({ error: 'DUPLICATE', message: 'It looks like you already sent us that exact message. We have it, and we will reply soon.' })
  }
  if (!ticketFilingAllowed(account, req.ip, address)) {
    return res.status(429).send({ error: 'TOO_MANY', message: 'You have sent a lot of messages. Please try again in an hour.' })
  }

  if (account && !account.email) {
    account.email = address
    await account.save()
  }

  const ticket = await SupportTicket.create({
    accountId: account ? account._id : null,
    viewToken: account ? '' : crypto.randomBytes(24).toString('hex'),
    email: address,
    category,
    subject,
    playerName: playerName || (account ? account.username : ''),
    reportedName: category === 'memberReport' ? reportedName : '',
    source: 'site',
    details,
    attachments,
    messages: [{ from: 'player', body }]
  })

  await EmailService.sendEmail({
    to: address,
    subject: `[Ticket #${ticket._id}] ${subject}`,
    text: `We've got your message and will reply here by email.\n\n${body}${ticket.viewToken ? `\n\nYou sent this without signing in, so here is your own link to read our reply and write back:\n${siteUrl(req)}/contactUs.html?ticket=${ticket.viewToken}\n\nKeep it to yourself -- anyone with the link can read this message.` : ''}`
  })
  await DiscordService.notifyTicket({
    ticketId: ticket._id,
    subject,
    category: ticketCategories[category],
    fromEmail: address,
    playerName: ticket.playerName,
    reportedName: ticket.reportedName
  })

  res.send({ _id: ticket._id, status: ticket.status })
})

app.get('/fairies/api/support/tickets', async (req, res) => {
  const account = await requirePlayer(req, res)
  if (!account) return

  const docs = await SupportTicket.find({ accountId: account._id }).sort({ updatedAt: -1 })
  res.send(docs)
})

app.get('/fairies/api/support/tickets/:id', async (req, res) => {
  const account = await requirePlayer(req, res)
  if (!account) return

  const ticket = await SupportTicket.findById(req.params.id)
  if (!ticket || ticket.accountId !== account._id) {
    return res.status(404).send({ message: 'No such ticket.' })
  }

  res.send(ticket)
})

app.post('/fairies/api/support/tickets/:id/reply', async (req, res) => {
  const account = await requirePlayer(req, res)
  if (!account) return

  const ticket = await SupportTicket.findById(req.params.id)
  if (!ticket || ticket.accountId !== account._id) {
    return res.status(404).send({ message: 'No such ticket.' })
  }

  const body = String(req.body.body || '').trim().slice(0, 5000)
  if (!body) {
    return res.status(400).send({ message: 'body is required.' })
  }
  if (ticket.messages.length >= MAX_MESSAGES_PER_TICKET) {
    return res.status(429).send({ message: 'This conversation is very long. Please wait for us to reply before adding more.' })
  }
  if (isRepeatMessage(`account:${account._id}`, ticket._id + body)) {
    return res.status(429).send({ message: 'It looks like you already sent us that exact message.' })
  }
  if (!allowAll([[accountReplies, account._id]])) {
    return res.status(429).send({ message: 'That is a lot of messages. Please try again in an hour.' })
  }

  ticket.messages.push({ from: 'player', body })
  addAttachments(ticket, req.body.attachments)
  ticket.status = 'open'
  ticket.updatedAt = new Date()
  await ticket.save()

  res.send({ status: ticket.status, attachments: ticket.attachments.length })
})

// tickets by view token, for people who filed without an account

const tokenReplies = makeLimiter(20, hourMs)
const tokenRepliesByIp = makeLimiter(60, hourMs)

function tokenReplyAllowed (token, ip) {
  return allowAll([[tokenReplies, token], [tokenRepliesByIp, ip]])
}

function ticketForToken (token) {
  const clean = String(token || '')
  if (!/^[a-f0-9]{48}$/.test(clean)) return null
  return SupportTicket.findOne({ viewToken: clean })
}

function ticketForPlayer (ticket) {
  return {
    _id: ticket._id,
    subject: ticket.subject,
    category: ticket.category,
    status: ticket.status,
    playerName: ticket.playerName,
    reportedName: ticket.reportedName,
    details: ticket.details,
    attachments: ticket.attachments,
    messages: ticket.messages,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt
  }
}

app.get('/fairies/api/support/tickets/by-token/:token', async (req, res) => {
  const ticket = await ticketForToken(req.params.token)
  if (!ticket) return res.status(404).send({ message: 'That link is not valid.' })

  res.send(ticketForPlayer(ticket))
})

app.post('/fairies/api/support/tickets/by-token/:token/reply', async (req, res) => {
  const ticket = await ticketForToken(req.params.token)
  if (!ticket) return res.status(404).send({ message: 'That link is not valid.' })

  const body = String(req.body.body || '').trim().slice(0, 5000)
  if (!body) return res.status(400).send({ message: 'Please write a message.' })

  if (ticket.messages.length >= MAX_MESSAGES_PER_TICKET) {
    return res.status(429).send({ message: 'This conversation is very long. Please wait for us to reply before adding more.' })
  }
  if (isRepeatMessage(`token:${ticket.viewToken}`, body)) {
    return res.status(429).send({ message: 'It looks like you already sent us that exact message.' })
  }
  if (!tokenReplyAllowed(ticket.viewToken, req.ip)) {
    return res.status(429).send({ message: 'That is a lot of messages. Please try again in an hour.' })
  }

  ticket.messages.push({ from: 'player', body })
  addAttachments(ticket, req.body.attachments)
  ticket.status = 'open'
  ticket.updatedAt = new Date()
  await ticket.save()

  res.send({ status: ticket.status, attachments: ticket.attachments.length })
})

// staff side

// chat logs are read back from the game server's event logs
const CHAT_LOG_MAX_DAYS = 31
const CHAT_LOG_MAX_ROWS = 20000
const chatLogDownloads = makeLimiter(20, hourMs)

function localDate (date) {
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

async function chatLogTargets (who) {
  const accountIds = new Set()
  const avatarIds = new Set()

  function addFairy (fairy) {
    avatarIds.add(fairy._id)
    accountIds.add(fairy.accountId)
  }

  async function addAccount (account) {
    accountIds.add(account._id)
    const fairies = await Fairy.find({ accountId: account._id }, { _id: 1, accountId: 1 })
    fairies.forEach(addFairy)
  }

  const number = Number(who)
  if (Number.isInteger(number)) {
    const fairy = await Fairy.findById(number, { _id: 1, accountId: 1 })
    if (fairy) addFairy(fairy)
    const account = await Account.findById(number, { _id: 1 })
    if (account) await addAccount(account)
  } else {
    const fairies = await Fairy.find({ name: who }, { _id: 1, accountId: 1 }).collation({ locale: 'en', strength: 2 })
    fairies.forEach(addFairy)
    const account = await Account.findOne({ username: who.toLowerCase() }, { _id: 1 })
    if (account) await addAccount(account)
  }

  return avatarIds.size || accountIds.size ? { accountIds, avatarIds } : null
}

app.get('/fairies/api/gm/chat-logs', async (req, res) => {
  const staff = await requireStaff(req, res)
  if (!staff) return

  if (!allowAll([[chatLogDownloads, staff._id]])) {
    return res.status(429).send({ message: 'That is a lot of downloads. Please try again in an hour.' })
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/
  const today = new Date()
  const weekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000)
  const to = String(req.query.to || localDate(today))
  const from = String(req.query.from || localDate(weekAgo))

  if (!datePattern.test(from) || !datePattern.test(to) || from > to) {
    return res.status(400).send({ message: 'Please give a start date that is on or before the end date.' })
  }

  const days = (new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / (24 * 60 * 60 * 1000)
  if (days >= CHAT_LOG_MAX_DAYS) {
    return res.status(400).send({ message: `Please ask for ${CHAT_LOG_MAX_DAYS} days or fewer at a time.` })
  }

  const who = String(req.query.who || '').trim().slice(0, 60)
  const contains = String(req.query.contains || '').trim().slice(0, 100)

  let targets = null
  if (who) {
    targets = await chatLogTargets(who)
    if (!targets) return res.status(404).send({ message: 'No fairy or account matches that.' })
  }

  const { rows, truncated } = await readChat({
    from,
    to,
    accountIds: targets && targets.accountIds,
    avatarIds: targets && targets.avatarIds,
    contains,
    limit: CHAT_LOG_MAX_ROWS
  })

  const label = `chat-logs ${who || 'everyone'} ${from}..${to}${contains ? ` containing "${contains}"` : ''}`
  await GmCommand.create({
    issuedBy: staff._id,
    issuedByName: staff.username,
    accountType: staff.accountType,
    command: label,
    scope: 'web',
    category: 'moderation',
    status: 'done',
    finishedAt: new Date(),
    response: `${rows.length} messages downloaded${truncated ? ' (stopped at the limit)' : ''}`
  })

  if (!rows.length) return res.status(404).send({ message: 'No chat found for that.' })

  const accountList = [...new Set(rows.map(row => row.accountId))].filter(Number.isFinite)
  const fairyList = [...new Set(rows.flatMap(row => [row.avatarId, row.toAvatarId]))].filter(Number.isFinite)
  const names = { accounts: new Map(), fairies: new Map() }
  const accounts = await Account.find({ _id: { $in: accountList } }, { username: 1 })
  accounts.forEach(account => names.accounts.set(account._id, account.username))
  const fairies = await Fairy.find({ _id: { $in: fairyList } }, { name: 1 })
  fairies.forEach(fairy => names.fairies.set(fairy._id, fairy.name))

  const heading = [
    `Chat log for ${who || 'everyone'}, ${from} to ${to}${contains ? `, containing "${contains}"` : ''}`,
    `${rows.length} messages${truncated ? ' (stopped at the limit, so this is not all of them)' : ''}`,
    `Downloaded by ${staff.username} on ${new Date().toISOString()}`
  ]

  const fileLabel = (who || 'everyone').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 30)
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="chat-${fileLabel}-${from}-to-${to}.txt"`)
  res.setHeader('X-Row-Count', String(rows.length))
  res.setHeader('X-Truncated', truncated ? '1' : '0')
  res.setHeader('Access-Control-Expose-Headers', 'X-Row-Count, X-Truncated, Content-Disposition')
  res.send(toText(rows, names, heading))
})

app.get('/fairies/api/gm/tickets', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const { page, pageSize, skip } = paginationParams(req)
  const term = searchRegex(req)
  const filter = req.query.status ? { status: req.query.status } : {}
  if (term) {
    filter.$or = [{ subject: term }, { playerName: term }, { reportedName: term }, { email: term }]
  }

  const [items, total] = await Promise.all([
    SupportTicket.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(pageSize),
    SupportTicket.countDocuments(filter)
  ])
  res.send({ items, total, page, pageSize })
})

app.get('/fairies/api/gm/tickets/:id', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const ticket = await SupportTicket.findById(req.params.id)
  if (!ticket) {
    return res.status(404).send({ message: 'No such ticket.' })
  }

  res.send(ticket)
})

app.post('/fairies/api/gm/tickets/:id/category', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const category = String(req.body.category || '')
  if (!ticketCategories[category]) {
    return res.status(400).send({ message: 'Unknown category.' })
  }

  const ticket = await SupportTicket.findById(req.params.id).catch(() => null)
  if (!ticket) {
    return res.status(404).send({ message: 'No such ticket.' })
  }

  ticket.category = category
  ticket.updatedAt = new Date()
  await ticket.save()

  res.send({ category: ticket.category })
})


// pixie pages
app.get('/fairies/api/mypage', async (req, res) => {
  const signer = await signingFairyFor(req)

  if (!signer) return res.status(401).send({ message: 'Not signed in.' })
  if (!signer.address) return res.status(404).send({ message: 'That fairy has no address yet.' })

  res.send({ address: signer.address })
})


// the game knows a fairy by her id, and its Print buttons open her page by address
app.get('/fairies/api/pixiepage-of/:fairyId', async (req, res) => {
  const fairyId = Number(req.params.fairyId)
  if (!Number.isInteger(fairyId)) return res.status(400).send({ message: 'Expected a numeric fairy id.' })

  const fairy = await db.retrieveFairyById(fairyId)
  if (!fairy || !fairy.address) return res.status(404).send({ message: 'No Pixie Page for that fairy.' })

  res.send({ address: fairy.address })
})


app.get('/fairies/api/pixiepage/:address', async (req, res) => {
  const fairy = await db.retrieveFairyByAddress(req.params.address)
  if (!fairy) return res.status(404).send({ message: 'No fairy lives at that address.' })

  const badges = (fairy.badgeData && fairy.badgeData.badges) || []
  const earned = badges.filter(badge => badge.dateEarned)

  const latest = earned.reduce((one, badge) => (!one || badge.dateEarned > one.dateEarned ? badge : one), null)
  const favoriteId = Number(fairy.badgeData && fairy.badgeData.favoriteBadgeId) || 0
  const favorite = earned.find(badge => badge.badgeId === favoriteId)

  // the art is rendered ahead of time by tools/render_badges.py, a badge with none just shows its name
  const badgeIcon = id => (fs.existsSync(path.join(WEB_ROOT, 'images', 'badges', `${Number(id)}.png`)) ? `/images/badges/${Number(id)}.png` : null)
  const badgeSummary = badge => (badge ? { id: badge.badgeId, name: contentCatalog.badgeName(badge.badgeId) || 'A badge', icon: badgeIcon(badge.badgeId) } : null)

  // the games she has played the most, as many as the panel has room for
  const games = (fairy.stats || [])
    .filter(stat => stat.type === 'game' && stat.count > 0 && contentCatalog.gameName(stat.statId))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(stat => ({ name: contentCatalog.gameName(stat.statId), played: stat.count, best: stat.best }))

  res.send({
    id: fairy._id,
    name: fairy.name,
    address: fairy.address,
    readableAddress: readableAddress(fairy.address),
    talent: fairy.talent,
    arrived: fairy.created,
    badgesEarned: earned.length,
    latestBadge: badgeSummary(latest),
    favoriteBadge: badgeSummary(favorite),
    games,
    theme: themeFor(fairy.game_prof_bg),
    bio: bioRows(fairy.bio)
  })
})


app.get('/fairies/api/pixiepage/:address/messages', async (req, res) => {
  const fairy = await db.retrieveFairyByAddress(req.params.address)
  if (!fairy) return res.status(404).send({ message: 'No fairy lives at that address.' })

  const account = req.session && req.session.username
    ? await db.retrieveAccountFromUser(req.session.username)
    : null
  const owned = account ? await fairiesForAccount(account) : []
  const isOwner = owned.some(one => one._id === fairy._id)

  if (!isOwner) return res.send({ yours: false, messages: [] })

  const rows = await Message.find({ recipient_id: fairy._id }).sort({ created: -1 }).limit(30)

  res.send({
    yours: true,
    messages: rows.map(row => {
      const design = postcardDesign(row.background)
      return {
        id: row._id,
        type: row.type,
        from: (row.sender && row.sender.name) || 'A fairy',
        fromAddress: readableAddress((row.sender && row.sender.address) || ''),
        image: design.image,
        words: design.message,
        sent: row.created
      }
    })
  })
})


// a fairy's poll and quiz

function voterKey (req) {
  if (req.session && req.session.userId) return String(req.session.userId)
  return 'ip:' + crypto.createHash('sha256').update(String(req.ip || '') + (process.env.SESSION_SECRET || '')).digest('hex').slice(0, 24)
}

async function pollForPage (fairy) {
  if (!fairy.pollId) return null
  return Poll.findById(fairy.pollId).catch(() => null)
}

app.get('/fairies/api/pixiepage/:address/poll', async (req, res) => {
  const fairy = await db.retrieveFairyByAddress(req.params.address)
  if (!fairy) return res.status(404).send({ message: 'No fairy lives at that address.' })

  const poll = await pollForPage(fairy)
  if (!poll || !poll.active) return res.send({ poll: null })

  const votes = await PollVote.find({ pollId: String(poll._id), pageFairyId: fairy._id })
  const counts = poll.options.map((_, index) => votes.filter(vote => vote.option === index).length)
  const mine = votes.find(vote => vote.voter === voterKey(req))

  res.send({
    poll: {
      id: String(poll._id),
      question: poll.question,
      options: poll.options,
      counts,
      total: votes.length,
      yourAnswer: mine ? mine.option : null
    }
  })
})

app.post('/fairies/api/pixiepage/:address/poll/vote', async (req, res) => {
  const fairy = await db.retrieveFairyByAddress(req.params.address)
  if (!fairy) return res.status(404).send({ message: 'No fairy lives at that address.' })

  const poll = await pollForPage(fairy)
  if (!poll || !poll.active) return res.status(404).send({ message: 'There is no poll here.' })

  const option = Number(req.body.option)
  if (!Number.isInteger(option) || option < 0 || option >= poll.options.length) {
    return res.status(400).send({ message: 'Pick one of the answers.' })
  }

  await PollVote.updateOne(
    { pollId: String(poll._id), pageFairyId: fairy._id, voter: voterKey(req) },
    { $set: { option, created: new Date() } },
    { upsert: true }
  )

  res.send({ success: true })
})

app.get('/fairies/api/pixiepage/:address/quiz', async (req, res) => {
  const fairy = await db.retrieveFairyByAddress(req.params.address)
  if (!fairy) return res.status(404).send({ message: 'No fairy lives at that address.' })

  if (!fairy.quizId) return res.send({ quiz: null })

  const quiz = await Quiz.findById(fairy.quizId).catch(() => null)
  if (!quiz || !quiz.active) return res.send({ quiz: null })

  res.send({
    quiz: {
      id: String(quiz._id),
      title: quiz.title,
      intro: quiz.intro,
      questions: quiz.questions.map(question => ({
        text: question.text,
        answers: question.answers.map(answer => ({ text: answer.text, resultId: answer.resultId }))
      })),
      results: quiz.results
    }
  })
})

async function ownedFairyAt (req, address) {
  const fairy = await db.retrieveFairyByAddress(address)
  if (!fairy) return { fairy: null, isOwner: false }

  const account = req.session && req.session.username
    ? await db.retrieveAccountFromUser(req.session.username)
    : null
  const owned = account ? await fairiesForAccount(account) : []

  return { fairy, isOwner: owned.some(one => one._id === fairy._id) }
}

app.get('/fairies/api/pixiepage/:address/choices', async (req, res) => {
  const { fairy, isOwner } = await ownedFairyAt(req, req.params.address)
  if (!fairy) return res.status(404).send({ message: 'No fairy lives at that address.' })
  if (!isOwner) return res.send({ yours: false, polls: [], quizzes: [] })

  const mine = { $in: [null, fairy._id] }
  const [polls, quizzes] = await Promise.all([
    Poll.find({ active: true, ownerFairyId: mine }, { question: 1 }).sort({ createdAt: 1 }),
    Quiz.find({ active: true, ownerFairyId: mine }, { title: 1, intro: 1 }).sort({ createdAt: 1 })
  ])

  res.send({
    yours: true,
    pollId: fairy.pollId || '',
    quizId: fairy.quizId || '',
    polls: polls.map(poll => ({ id: String(poll._id), question: poll.question })),
    quizzes: quizzes.map(quiz => ({ id: String(quiz._id), title: quiz.title, intro: quiz.intro }))
  })
})

app.post('/fairies/api/pixiepage/:address/choices', async (req, res) => {
  const { fairy, isOwner } = await ownedFairyAt(req, req.params.address)
  if (!fairy) return res.status(404).send({ message: 'No fairy lives at that address.' })
  if (!isOwner) return res.status(403).send({ message: 'That is not your page.' })

  const update = {}

  for (const [field, model] of [['pollId', Poll], ['quizId', Quiz]]) {
    if (!(field in req.body)) continue

    const wanted = String(req.body[field] || '')
    if (!wanted) { update[field] = ''; continue }

    const row = await model.findOne({
      _id: wanted, active: true, ownerFairyId: { $in: [null, fairy._id] }
    }).catch(() => null)
    if (!row) return res.status(400).send({ message: 'You cannot use that one.' })

    update[field] = wanted
  }

  if (Object.keys(update).length) await Fairy.updateOne({ _id: fairy._id }, { $set: update })

  res.send({ success: true })
})

// her guestbook

const GUESTBOOK_PAGE_SIZE = 30

// one signature per visitor per page per day
const GUESTBOOK_GAP_MS = 24 * 60 * 60 * 1000

app.get('/fairies/api/pixiepage/:address/guestbook', async (req, res) => {
  const { fairy, isOwner } = await ownedFairyAt(req, req.params.address)
  if (!fairy) return res.status(404).send({ message: 'No fairy lives at that address.' })

  const rows = await GuestbookEntry
    .find({ pageFairyId: fairy._id, removed: { $ne: true } })
    .sort({ created: -1 })
    .limit(GUESTBOOK_PAGE_SIZE)

  res.send({
    yours: isOwner,
    entries: rows
      .map(row => ({
        id: String(row._id),
        words: guestbookLine(row.phraseId, row.wordId),
        from: row.signerName || 'A fairy',
        fromAddress: readableAddress(row.signerAddress || ''),
        signed: row.created
      }))
      .filter(entry => entry.words)
  })
})

app.get('/fairies/api/pixiepage/:address/guestbook/choices', async (req, res) => {
  const fairy = await db.retrieveFairyByAddress(req.params.address)
  if (!fairy) return res.status(404).send({ message: 'No fairy lives at that address.' })

  const signer = await signingFairyFor(req)

  res.send({
    canSign: Boolean(signer) && signer._id !== fairy._id,
    signerName: signer ? signer.name : '',
    ownPage: Boolean(signer) && signer._id === fairy._id,
    phrases: guestbookChoices()
  })
})

async function signingFairyFor (req) {
  if (!req.session || !req.session.username) return null

  const account = await db.retrieveAccountFromUser(req.session.username)
  if (!account) return null

  const owned = await fairiesForAccount(account)
  if (!owned.length) return null

  const chosen = chosenIdOf(account)

  return owned.find(one => one._id === chosen) || owned[0]
}

app.post('/fairies/api/pixiepage/:address/guestbook', async (req, res) => {
  const fairy = await db.retrieveFairyByAddress(req.params.address)
  if (!fairy) return res.status(404).send({ message: 'No fairy lives at that address.' })

  const signer = await signingFairyFor(req)
  if (!signer) return res.status(401).send({ message: 'Sign in with a fairy to write in a guestbook.' })
  if (signer._id === fairy._id) return res.status(400).send({ message: 'This one is yours to read, not to sign.' })

  const phraseId = Number(req.body.phraseId)
  const wordId = Number(req.body.wordId)

  if (!isSayable(phraseId, wordId)) {
    return res.status(400).send({ message: 'Pick one of the things you can say.' })
  }

  const since = new Date(Date.now() - GUESTBOOK_GAP_MS)
  const already = await GuestbookEntry.findOne({
    pageFairyId: fairy._id,
    signerFairyId: signer._id,
    created: { $gt: since }
  })

  if (already) {
    return res.status(429).send({ message: 'You have already signed this page today.' })
  }

  await GuestbookEntry.create({
    pageFairyId: fairy._id,
    signerFairyId: signer._id,
    signerName: signer.name,
    signerAddress: signer.address,
    phraseId,
    wordId
  })

  res.send({ success: true })
})

app.post('/fairies/api/pixiepage/:address/guestbook/:id/remove', async (req, res) => {
  const { fairy, isOwner } = await ownedFairyAt(req, req.params.address)
  if (!fairy) return res.status(404).send({ message: 'No fairy lives at that address.' })

  let by = isOwner ? 'owner' : ''

  if (!isOwner) {
    const account = req.session && req.session.userId
      ? await db.retrieveAccountFromIdentifier(req.session.userId)
      : null

    if (!account || !['Moderator', 'Administrator'].includes(account.accountType)) {
      return res.status(403).send({ message: 'That is not your page.' })
    }

    by = account.username
  }

  const entry = await GuestbookEntry.findOne({ _id: req.params.id, pageFairyId: fairy._id }).catch(() => null)
  if (!entry) return res.status(404).send({ message: 'No such entry.' })

  entry.removed = true
  entry.removedAt = new Date()
  entry.removedBy = by
  await entry.save()

  res.send({ success: true })
})

// removed fairies

app.get('/fairies/api/gm/removed-fairies', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const rows = await Fairy.find(
    { deleted: true },
    { name: 1, accountId: 1, ownerAccount: 1, address: 1, talent: 1, deletedAt: 1, created: 1 }
  ).sort({ deletedAt: -1 }).limit(100)

  res.send(rows)
})

app.post('/fairies/api/gm/fairies/:id/restore', async (req, res) => {
  const staff = await requireStaff(req, res)
  if (!staff) return

  const fairy = await Fairy.findById(Number(req.params.id)).catch(() => null)
  if (!fairy || !fairy.deleted) {
    return res.status(404).send({ message: 'No removed fairy with that id.' })
  }

  const owner = fairy.accountId != null
    ? await Account.findById(fairy.accountId).catch(() => null)
    : await db.retrieveAccountFromUser(fairy.ownerAccount)

  if (owner) {
    const live = await fairiesForAccount(owner)
    if (live.length >= MAX_FAIRIES_PER_ACCOUNT) {
      return res.status(409).send({
        message: `${owner.username} already has ${live.length} fairies. One has to go before ${fairy.name} can come back.`
      })
    }
  }

  await Fairy.updateOne({ _id: fairy._id }, { $set: { deleted: false, deletedAt: null } })

  res.send({ success: true, name: fairy.name })
})

app.post('/fairies/api/gm/fairies/:id/purge', async (req, res) => {
  const staff = await requireStaff(req, res)
  if (!staff) return

  if (staff.accountType !== 'Administrator') {
    return res.status(403).send({ message: 'Purging a fairy needs Administrator.' })
  }

  const fairy = await Fairy.findById(Number(req.params.id)).catch(() => null)
  if (!fairy) return res.status(404).send({ message: 'No such fairy.' })

  if (!fairy.deleted) {
    return res.status(409).send({ message: `${fairy.name} has not been removed. Remove her first.` })
  }

  await Fairy.deleteOne({ _id: fairy._id })

  res.send({ success: true, name: fairy.name })
})

// deleted accounts

app.get('/fairies/api/gm/deleted-accounts', async (req, res) => {
  const staff = await requireStaff(req, res)
  if (!staff) return

  const rows = await Account.find({ deleted: true }, { username: 1, email: 1, deletedAt: 1 }).sort({ deletedAt: -1 }).limit(100)
  const graceMs = DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000

  res.send(await Promise.all(rows.map(async row => ({
    _id: row._id,
    username: row.username,
    email: row.email || '',
    deletedAt: row.deletedAt,
    daysLeft: Math.max(0, Math.ceil((row.deletedAt.getTime() + graceMs - Date.now()) / (24 * 60 * 60 * 1000))),
    fairies: await Fairy.countDocuments({ $or: [{ accountId: row._id }, { ownerAccount: row.username }], deleted: true, deletedAt: row.deletedAt })
  }))))
})

app.post('/fairies/api/gm/accounts/:id/restore', async (req, res) => {
  const staff = await requireStaff(req, res)
  if (!staff) return

  const account = await Account.findById(Number(req.params.id)).catch(() => null)
  if (!account || !account.deleted) return res.status(404).send({ message: 'No deleted account with that id.' })

  const restored = await restoreDeletedAccount(account)
  console.log(`[gm] ${staff.username} restored the account ${account.username}`)
  res.send({ success: true, username: account.username, fairies: restored })
})

app.post('/fairies/api/gm/accounts/:id/purge', async (req, res) => {
  const staff = await requireStaff(req, res)
  if (!staff) return

  if (staff.accountType !== 'Administrator') {
    return res.status(403).send({ message: 'Removing an account for good needs Administrator.' })
  }

  const account = await Account.findById(Number(req.params.id)).catch(() => null)
  if (!account) return res.status(404).send({ message: 'No such account.' })
  if (!account.deleted) return res.status(409).send({ message: `${account.username} has not been deleted. Delete it first.` })

  await purgeAccount(account)
  console.log(`[gm] ${staff.username} removed the account ${account.username} for good`)
  res.send({ success: true, username: account.username })
})

app.post('/fairies/api/gm/tickets/:id/merge', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const into = String(req.body.into || '')
  if (into === req.params.id) {
    return res.status(400).send({ message: 'That is the same ticket.' })
  }

  const [source, target] = await Promise.all([
    SupportTicket.findById(req.params.id).catch(() => null),
    SupportTicket.findById(into).catch(() => null)
  ])

  if (!source) return res.status(404).send({ message: 'No such ticket.' })
  if (!target) return res.status(404).send({ message: 'No ticket to merge into.' })

  const who = source.playerName || source.email || 'someone'
  const label = '#' + String(source._id).slice(-6).toUpperCase()

  target.messages.push({
    from: 'staff',
    authorName: account.username,
    body: `Merged in ${label} (filed by ${who}). Everything below came from that message.`
  })

  for (const message of source.messages) {
    target.messages.push({
      from: message.from,
      authorName: message.authorName,
      body: message.body,
      emailMessageId: message.emailMessageId,
      sentAt: message.sentAt
    })
  }

  addAttachments(target, (source.attachments || []).map(file => ({ url: file.url, name: file.name })))

  for (const [key, value] of (source.details || new Map())) {
    if (!target.details.get(key)) target.details.set(key, value)
  }
  if (!target.reportedName && source.reportedName) target.reportedName = source.reportedName

  target.status = 'open'
  target.updatedAt = new Date()
  await target.save()

  source.messages.push({
    from: 'staff',
    authorName: account.username,
    body: `Merged into #${String(target._id).slice(-6).toUpperCase()}.`
  })
  source.status = 'closed'
  source.updatedAt = new Date()
  await source.save()

  res.send({ success: true, into: target._id })
})

app.post('/fairies/api/gm/tickets/:id/delete', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  if (account.accountType !== 'Administrator') {
    return res.status(403).send({ message: 'Deleting tickets needs Administrator. You can close it instead.' })
  }

  const ticket = await SupportTicket.findById(req.params.id).catch(() => null)
  if (!ticket) return res.status(404).send({ message: 'No such ticket.' })

  for (const file of ticket.attachments || []) {
    const url = String(file.url || '')
    if (!/^\/site\/uploads\/tickets\/[A-Za-z0-9_-]+\.(png|jpg|gif)$/.test(url)) continue
    await fs.promises.unlink(path.join(WEB_ROOT, url.replace(/^\//, ''))).catch(() => null)
  }

  await SupportTicket.deleteOne({ _id: ticket._id })

  res.send({ success: true })
})

app.post('/fairies/api/gm/tickets/:id/reply', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const ticket = await SupportTicket.findById(req.params.id)
  if (!ticket) {
    return res.status(404).send({ message: 'No such ticket.' })
  }

  const { body, status } = req.body
  if (!body) {
    return res.status(400).send({ message: 'body is required.' })
  }

  ticket.messages.push({ from: 'staff', authorName: account.username, body })
  ticket.status = status && ['open', 'pending', 'resolved', 'closed'].includes(status) ? status : 'pending'
  ticket.updatedAt = new Date()
  await ticket.save()

  await EmailService.sendEmail({
    to: ticket.email,
    subject: `Re: [Ticket #${ticket._id}] ${ticket.subject}`,
    text: body
  })

  res.send({ status: ticket.status })
})

app.post('/dxd/flashAPI/getFamilyStructure', (req, res) => {
  // TODO: Implement parent accounts
  res.setHeader('content-type', 'text/xml')
  res.send(createXML({
    response: {
      success: 0
    }
  }))
})

app.post('/dxd/flashAPI/lookupAccount', async (req, res) => {
  const ses = req.session

  const success = (ses && ses.userId) ? true : false

  const responseData = {
    success
  }

  if (success) {
    const userId = ses.userId
    const account = await db.retrieveAccountFromIdentifier(userId)

    if (account) {
      responseData.acceptedTOU = true

      const accData = await db.retrieveAccountData(account.username)

      responseData.results = {
        firstName: accData.FirstName ?? '',
        lastName: accData.LastName ?? '',
        email: accData.Email ?? '',
        username: account.username,
        swid: accData.dislId ?? '',
        age: accData.Age ?? '',
        hoh: accData.Age >= 18,
        userId,
      }

      if (accData.SpeedChatPlus === 1) {
        responseData.results.canWhitelistChat = true
        responseData.results.canWhitelistChatValidationType = 0
      } else {
        responseData.results.canWhitelistChat = false
      }

      if (accData.OpenChat === 1) {
        responseData.results.chatLevel = 3 // TODO: Implement the chat types
        responseData.results.chatLevelValidationType = 0
      } else {
        responseData.results.chatLevel = 0
      }
    }
  }

  res.setHeader('content-type', 'text/xml')
  res.send(createXML({
    response: responseData
  }))
})

app.post('/commerce/flashapi/lookupOffers', async (req, res) => {
  // TODO: Implement me
  res.setHeader('content-type', 'text/xml')
  res.send(createXML({
    response: {
      success: 1,
      offers: {}
    }
  }))
})

app.post('/commerce/flashapi/lookupSubscriptions', async (req, res) => {
  // TODO: Same as above
  res.setHeader('content-type', 'text/xml')
  res.send(createXML({
    response: {
      success: 1
    }
  }))
})

app.get('/dxd/flashAPI/getTermsOfUseText', async (req, res) => {
  // TODO: Same as above
  res.setHeader('content-type', 'text/xml')
  res.send(createXML({
    response: {
      success: 1,
      results: {
        tou: ''
      }
    }
  }))
})

app.post('/fairies/api/SubmitDNameRequest', (req, res) => {
  res.send(createXML({
    SubmitDNameRequestResponse: {
      success: true
    }
  }))
})

app.post('/fairies/api/FairiesProfileRequest', async (req, res) => {
  const ses = req.session

  const loggedInFairy = false
  const includeAvatar = 'dna' in req.body
  const includeBio = 'bio' in req.body

  let fairyId = req.body.fairy_id ?? null
  const userId = req.body.user_id ?? null

  if (fairyId !== null) {
    fairyId = parseInt(fairyId)
  } else {
    fairyId = ses?.fairyId ?? null
  }

  let fairiesToSend = []

  if (userId !== null) {
    const account = await db.retrieveAccountFromIdentifier(userId)
    const owned = account ? await fairiesForAccount(account) : []
    const chosen = account ? chosenIdOf(account) : null

    for (const one of owned) {
      const profile = await db.retrieveFairyProfile(one._id, { includeAvatar, includeBio })
      if (!profile) continue
      profile.chosen = owned.length === 1 || one._id === chosen
      fairiesToSend.push(profile)
    }
  } else {
    const fairyData = await db.retrieveFairyProfile(fairyId, { includeAvatar, includeBio })
    fairiesToSend = fairyData ? [fairyData] : []
  }

  const success = ses.logged ? true : false
  const status = !success ? 'not_logged_in' : (fairyId != null ? 'logged_in_fairy' : 'logged_in')

  const responseData = {
    success,
    status,
    access: 'full'
  }

  if (!success) {
    return res.send(createXML({
      response: responseData
    }))
  }

  const firstFairy = fairiesToSend[0]
  if (firstFairy) {
    responseData.user_name = firstFairy.ownerAccount || await db.getUserNameFromAccountId(firstFairy.accountId)
  }

  responseData.fairies = []
  const memberDaysByOwner = new Map()
  const optionsByOwner = new Map()
  for (const fairy of fairiesToSend) {
    const ownerKey = fairy.accountId ?? fairy.ownerAccount
    if (!memberDaysByOwner.has(ownerKey)) {
      const owner = fairy.accountId
        ? await Account.findOne({ _id: fairy.accountId })
        : await Account.findOne({ username: fairy.ownerAccount })
      memberDaysByOwner.set(ownerKey, await memberDaysFor(owner))
      optionsByOwner.set(ownerKey, owner)
    }

    const fairyEl = {
      '@fairy_id': fairy._id,
      '#': {
        user_id: fairy.accountId,
        address: fairy.address,
        more_options: normalizeMoreOptions(fairy.moreOptions),
        home_privacy_state: isHomePrivate(fairy.moreOptions) ? 1 : 0,
        tutorial: fairy.tutorialBitmask[0],
        tutorial_hi: fairy.tutorialBitmask[1],
        created: fairy.created.toISOString().split('T')[0],
        name: fairy.name,
        talent: fairy.talent,
        chosen: fairy.chosen,
        icon: fairy.icon,
        game_prof_bg: fairy.game_prof_bg,
        member_days: memberDaysByOwner.get(ownerKey),
        options_mask: accountOptionsMask(optionsByOwner.get(ownerKey), fairy.optionsBitmask),
        level: fairy.level,
        home_type_id: fairy.homeType ?? fairy.talent,
        garden_type_id: fairy.gardenType ?? 1,
        badge_count: fairy.badge_count ?? 0,
        fav_badge: fairy.favoriteBadgeId ?? 0,
        newest_badge: fairy.newest_badge ?? 0
      }
    }

    if (loggedInFairy) {
      fairyEl.logged_in_fairy = true
    }

    if (includeBio) {
      const bio_questions = []

      for (const bio_question of fairy.bio) {
        bio_questions.push(bio_question)
      }

      fairyEl['#'].bio = [{
        question: bio_questions
      }]
    }

    if (includeAvatar && fairy.avatar) {
      const avatarEl = {}

      if (fairy.avatar.proportions) {
        const proportions = []

        for (const [type, value] of Object.entries(fairy.avatar.proportions)) {
          if (value != null) {
            proportions.push({
              '@type': type.toUpperCase(),
              '#': value
            })
          }
        }

        if (proportions.length) {
          avatarEl.proportion = proportions
        }
      }

      if (fairy.avatar.rotations) {
        const rotations = []

        for (const [type, value] of Object.entries(fairy.avatar.rotations)) {
          if (value != null) {
            rotations.push({
              '@type': type.toUpperCase(),
              '#': value
            })
          }
        }

        if (rotations.length) {
          avatarEl.rotation = rotations
        }
      }

      const simpleFields = [
        'hair_back', 'hair_front', 'face', 'eye', 'wing',
        'hair_color', 'eye_color', 'skin_color', 'wing_color'
      ]
      for (const field of simpleFields) {
        if (fairy.avatar[field] != null) {
          avatarEl[field] = fairy.avatar[field]
        }
      }

      avatarEl.gender = fairy.gender

      if (fairy.avatar.items) {
        avatarEl.inv_item = []

        for (const item of fairy.avatar.items) {
          if (item.location !== "Equipped") {
            continue;
          }

          const colors = []

          if (typeof item.color1 === 'number' && item.color1 !== 0) {
            colors.push({
              '@number': 1,
              '#': item.color1
            })
          }

          if (typeof item.color2 === 'number' && item.color2 !== 0) {
            colors.push({
              '@number': 2,
              '#': item.color2
            })
          }

          avatarEl.inv_item.push({
            '@type': item.type,
            '#': {
              item_id: item.item_id,
              color: colors
            }
          })
        }
      }

      fairyEl.avatar = avatarEl
    }

    responseData.fairies.push({ fairy: fairyEl })
  }

  res.send(createXML({
    response: responseData
  }))
})

app.post('/fairies/api/FairiesNewFairyRequest', async (req, res) => {
  const ses = req.session
  let success = true

  const fairyData = req.body.fairiesnewfairyrequest?.fairy[0]

  if (!ses.logged || !validateFairyName(fairyData.name[0])) {
    success = false
    return res.send(createXML({
      response: {
        success
      }
    }))
  }

  // TODO: Why is this happening
  if (ses.userId == -1) {
    success = false
    return res.send(createXML({
      response: {
        success
      }
    }))
  }

  const existing = await db.retrieveFairiesByOwnerAccount(ses.username)
  const owner = await db.retrieveAccountFromUser(ses.username)
  const limit = owner ? await fairyLimitFor(owner) : MAX_FAIRIES_PER_ACCOUNT

  if (existing.length >= limit) {
    success = false
    return res.send(createXML({
      response: {
        success
      }
    }))
  }

  const fairyId = ses ? await db.createFairy(ses.userId, fairyData) : -1
  if (fairyId !== -1) {
    ses.fairyId = fairyId
    db.retrieveFairyById(fairyId).then(warmFairy).catch(() => {})
  }

  res.send(createXML({
    response: {
      success,
      fairy_id: fairyId
    }
  }))
})

app.post('/fairies/api/ChooseFairyRequest', async (req, res) => {
  const chosenId = req.body.fairy_id || req.body.choosefairyrequest?.fairy_id?.[0] || req.query.fairy_id
  if (chosenId && req.session) {
    const fairyId = parseInt(chosenId, 10)

    const account = req.session.username ? await db.retrieveAccountFromUser(req.session.username) : null
    const owned = account ? await fairiesForAccount(account) : []

    if (!owned.some(fairy => fairy._id === fairyId)) {
      console.warn(`[ChooseFairyRequest] ${req.session.username || 'someone'} asked for fairy ${fairyId}, which is not theirs`)
      return res.send(createXML({ response: { success: false } }))
    }

    req.session.fairyId = fairyId
    console.log(`[ChooseFairyRequest] Selected fairy ID: ${fairyId} for user ${req.session.username}`)
    account.playerId = fairyId
    await account.save()
  }

  res.send(createXML({
    response: {
      success: true
    }
  }))
})

const INVENTORY_STAT_TYPES = {
  games: 'game',
  stats: 'recipe'
}

app.post('/fairies/api/FairiesInventoryRequest', async (req, res) => {
  const statType = INVENTORY_STAT_TYPES[req.body.type]

  if (statType) {
    const fairyId = req.body.fairy_id ?? req.session?.fairyId ?? null
    const fairy = fairyId !== null ? await db.retrieveFairy(parseInt(fairyId)) : false

    const stats = fairy ? fairy.stats.filter(s => s.type === statType) : []

    return res.send(createXML({
      response: {
        success: true,
        inventory: {
          stat: stats.map(s => ({
            stat_id: s.statId,
            count: s.count,
            best: s.best,
            total: s.total,
            bonus: s.bonus
          }))
        }
      }
    }))
  }

  const items = [
    { item_id: 2501, inv_id: 3612, slot: 0, created_by_id: 0, gifted_by_id: 0, quality: 3, color: { number: 1, value: 37 } },
    { item_id: 2503, inv_id: 3876, slot: 1, created_by_id: 0, gifted_by_id: 0, quality: 3, color: { number: 1, value: 39 } },
    { item_id: 2503, inv_id: 3877, slot: 2, created_by_id: 0, gifted_by_id: 0, quality: 3, color: { number: 1, value: 39 } }
  ]

  const item_list = items.map(i => ({
    item_id: i.item_id,
    inv_id: i.inv_id,
    slot: i.slot,
    created_by_id: i.created_by_id,
    gifted_by_id: i.gifted_by_id,
    quality: i.quality,
    color: {
      '@number': i.color.number,
      '#': i.color.value
    },
  }))

  return res.send(createXML({
    response: {
      success: true,
      inventory: {
        type: 'wardrobe',
        inv_item: item_list
      }
    }
  }))
})

function buildMessageEl (m) {
  const words = m.words || []
  const wordColors = m.word_colors || []

  const el = {
    '@message_id': m._id,
    background: m.background ?? 0,
    phrase: m.phrase ?? 0,
    word: 0,
    fairy: {
      '@fairy_id': m.sender?.fairy_id ?? 0,
      '#': {
        name: m.sender?.name ?? '',
        address: m.sender?.address ?? '',
        talent: m.sender?.talent ?? 0,
        icon: m.sender?.icon ?? 0
      }
    },
    created: m.created ? m.created.toISOString() : ''
  }

  for (let i = 1; i <= 8; i++) {
    const color = wordColors[i - 1] || []

    el['word' + i] = {
      '@color1': color[0] ?? 0,
      '@color2': color[1] ?? 0,
      '#': words[i - 1] ?? 0
    }
  }

  return el
}

app.post('/fairies/api/FairiesMessageArchiveRequest', async (req, res) => {
  const fairyId = req.body.fairy_id ?? req.session?.fairyId ?? null
  const type = parseInt(req.body.type ?? 1)

  if (fairyId === null) {
    return res.send(createXML({ response: { success: false } }))
  }

  const messages = await db.getMessagesForFairy(parseInt(fairyId), type)

  return res.send(createXML({
    response: {
      success: true,
      messages: {
        message: messages.map(buildMessageEl)
      }
    }
  }))
})

app.post('/fairies/api/FairiesDeleteMessageRequest', async (req, res) => {
  const messageId = req.body.message_id ?? null

  if (messageId === null) {
    return res.send(createXML({ response: { success: false } }))
  }

  await db.deleteMessage(parseInt(messageId))

  return res.send(createXML({ response: { success: true } }))
})

const codeMisses = makeLimiter(10, hourMs)
const codeMissesByIp = makeLimiter(30, hourMs)

async function redeemCodeFor (req, account, rawCode) {
  if (!codeMisses.hasRoom(account._id) || !codeMissesByIp.hasRoom(req.ip)) return { ok: false, error: 'TOO_MANY' }

  const result = await redeemCode({ Account, Fairy, RedeemableCode, GmCommand, db, md, getItemInfo }, account, rawCode)
  if (!result.ok) allowAll([[codeMisses, account._id], [codeMissesByIp, req.ip]])
  return result
}

app.post('/fairies/api/CouponRedemptionRequest', async (req, res) => {
  const code = req.body.couponredemptionrequest?.code?.[0]
  const ses = req.session
  res.setHeader('content-type', 'text/xml')

  function failed (error) {
    return res.send(createXML({ response: { success: false, error: { '@code': error } } }))
  }

  if (!ses.logged || !ses.userId) return failed('USER_NOT_LOGGED_IN')

  const account = await db.retrieveAccountFromIdentifier(ses.userId)
  if (!account) return failed('USER_NOT_LOGGED_IN')

  const result = await redeemCodeFor(req, account, code)
  if (!result.ok) return failed(result.error)

  const response = { success: true, item_id: result.rewardId, count: result.reward.count }
  if (result.owned.length) {
    response.fairy = result.owned.map(fairy => ({ '@fairy_id': fairy.id, name: fairy.name, error: { '@code': 'ALREADY_OWNED' } }))
  }

  res.send(createXML({ response }))
})

app.post('/account/redeem-code', requireSession, async (req, res) => {
  try {
    const account = await Account.findOne({ username: req.session.username })
    if (!account) return res.status(404).json({ success: false, error: 'ACCOUNT_NOT_FOUND' })

    const result = await redeemCodeFor(req, account, req.body?.code)
    if (!result.ok) return res.json({ success: false, error: result.error, retryAt: result.retryAt })

    res.json({ success: true, reward: result.reward, alreadyOwned: result.owned.map(fairy => fairy.name) })
  } catch (err) {
    console.error('[account/redeem-code] Error:', err)
    res.status(500).json({ success: false, error: 'SERVER_ERROR' })
  }
})

async function requireCodeAdmin (req, res) {
  const staff = await requireStaff(req, res)
  if (!staff) return null
  if (staff.accountType !== 'Administrator') {
    res.status(403).send({ message: 'Secret codes need Administrator.' })
    return null
  }
  return staff
}

function codeRow (code) {
  return {
    _id: code._id,
    code: showCode(code.codeName),
    rewardType: rewardTypeOf(code),
    rewardId: code.rewardId,
    gender: code.gender || 0,
    repeatHours: typeof code.repeatHours === 'number' ? code.repeatHours : -1,
    color1: code.color1,
    reward: describeReward(code, getItemInfo).name,
    quantity: code.quantity,
    expirationDate: code.expirationDate,
    maxUses: code.maxUses,
    uses: code.uses,
    note: code.note,
    createdBy: code.createdBy,
    createdAt: code.createdAt
  }
}

async function requireWaitlistAdmin (req, res) {
  const staff = await requireStaff(req, res)
  if (!staff) return null
  if (staff.accountType !== 'Administrator') {
    res.status(403).send({ message: 'The waitlist needs Administrator.' })
    return null
  }
  return staff
}

app.get('/fairies/api/gm/waitlist', async (req, res) => {
  const staff = await requireWaitlistAdmin(req, res)
  if (!staff) return

  res.send(await Waitlist.overview())
})

app.post('/fairies/api/gm/waitlist', async (req, res) => {
  const staff = await requireWaitlistAdmin(req, res)
  if (!staff) return

  const change = {}
  if (req.body.enabled !== undefined) change.enabled = req.body.enabled === true || req.body.enabled === 'true'
  if (req.body.dailyCap !== undefined) {
    const dailyCap = Number(String(req.body.dailyCap).trim())
    if (!Number.isInteger(dailyCap) || dailyCap < 0 || dailyCap > Waitlist.MAX_DAILY_CAP) {
      return res.status(400).send({ message: `The daily number needs to be a whole number from 0 to ${Waitlist.MAX_DAILY_CAP}.` })
    }
    change.dailyCap = dailyCap
  }

  await Waitlist.rememberBase(siteUrl(req))
  const settings = await Waitlist.setSettings(change)

  await GmCommand.create({
    issuedBy: staff._id,
    issuedByName: staff.username,
    accountType: staff.accountType,
    command: `waitlist ${settings.enabled ? 'on' : 'off'}, ${settings.dailyCap} invites a day`,
    scope: 'web',
    category: 'accounts',
    status: 'done',
    finishedAt: new Date(),
    response: 'waitlist settings saved'
  })

  if (settings.enabled) Waitlist.drain().catch(err => console.error('[Waitlist] Failed:', err.message))
  res.send(await Waitlist.overview())
})

app.get('/fairies/api/gm/waitlist/entries', async (req, res) => {
  const staff = await requireWaitlistAdmin(req, res)
  if (!staff) return

  res.send(await Waitlist.list({
    view: String(req.query.view || 'waiting'),
    search: String(req.query.search || ''),
    page: req.query.page,
    pageSize: req.query.pageSize
  }))
})

async function waitlistEntryAction (req, res, verb, action) {
  const staff = await requireWaitlistAdmin(req, res)
  if (!staff) return

  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send({ message: 'No such entry.' })

  try {
    await Waitlist.rememberBase(siteUrl(req))
    const email = await action(req.params.id)
    await GmCommand.create({
      issuedBy: staff._id,
      issuedByName: staff.username,
      accountType: staff.accountType,
      command: `waitlist ${verb} ${email}`,
      scope: 'web',
      category: 'accounts',
      status: 'done',
      finishedAt: new Date(),
      response: `${verb} done`
    })
    res.send({ success: true, email })
  } catch (err) {
    res.status(400).send({ message: err.message })
  }
}

app.post('/fairies/api/gm/waitlist/entries/:id/invite', (req, res) => waitlistEntryAction(req, res, 'invite-now', Waitlist.inviteNow))
app.post('/fairies/api/gm/waitlist/entries/:id/revoke', (req, res) => waitlistEntryAction(req, res, 'revoke', Waitlist.revoke))

app.get('/fairies/api/gm/codes', async (req, res) => {
  const staff = await requireCodeAdmin(req, res)
  if (!staff) return

  const codes = await RedeemableCode.find({}).sort({ createdAt: -1 }).limit(300)
  res.send(codes.map(codeRow))
})

app.post('/fairies/api/gm/codes', async (req, res) => {
  const staff = await requireCodeAdmin(req, res)
  if (!staff) return

  const rewardType = ['gold', 'badge'].includes(req.body.rewardType) ? req.body.rewardType : 'item'
  const gender = [1, 2].includes(parseInt(req.body.gender, 10)) ? parseInt(req.body.gender, 10) : 0

  const repeatRaw = String(req.body.repeatHours === undefined ? '' : req.body.repeatHours).trim()
  const repeatHours = repeatRaw === '' ? -1 : Math.max(-1, Math.min(24 * 365, parseInt(repeatRaw, 10)))
  if (Number.isNaN(repeatHours)) return res.status(400).send({ message: 'How often it can be reused needs to be a number of hours.' })

  const colorRaw = String(req.body.color1 === undefined ? '' : req.body.color1).trim()
  const color1 = colorRaw === '' ? 166 : parseInt(colorRaw, 10)
  if (!Number.isInteger(color1) || color1 < 1 || color1 > 9999) return res.status(400).send({ message: 'That color number is not right.' })

  const rewardId = rewardType === 'gold' ? 0 : parseInt(req.body.rewardId, 10)
  if (rewardType !== 'gold' && (!Number.isInteger(rewardId) || rewardId < 1 || rewardId > 99999999)) {
    return res.status(400).send({ message: rewardType === 'badge' ? 'Please give the badge\'s number.' : 'Please give the reward\'s item number.' })
  }
  if (rewardType === 'badge' && !badgeInfo(rewardId)) {
    return res.status(400).send({ message: 'That badge number is not in the badge list.' })
  }

  const custom = normalizeCode(req.body.code)
  const howMany = custom ? 1 : Math.max(1, Math.min(200, parseInt(req.body.howMany, 10) || 1))
  if (custom && !codePattern().test(custom)) {
    return res.status(400).send({ message: 'A code is 4 to 32 letters and numbers.' })
  }

  const { kind } = rewardKind(rewardId)
  let quantity = 1
  if (rewardType === 'gold') quantity = Math.max(1, Math.min(100000, parseInt(req.body.quantity, 10) || 0))
  else if (rewardType === 'item' && kind === 'pouch') quantity = Math.max(1, Math.min(999, parseInt(req.body.quantity, 10) || 1))
  if (rewardType === 'gold' && !(parseInt(req.body.quantity, 10) > 0)) {
    return res.status(400).send({ message: 'Please say how much gold.' })
  }
  const maxUses = Math.max(0, Math.min(1000000, parseInt(req.body.maxUses, 10) || 0))
  const note = String(req.body.note || '').trim().slice(0, 120)

  let expirationDate = null
  if (req.body.expires) {
    expirationDate = new Date(`${String(req.body.expires)}T23:59:59`)
    if (isNaN(expirationDate.getTime())) return res.status(400).send({ message: 'That expiry date is not a date.' })
  }

  const made = []
  for (let index = 0; index < howMany; index++) {
    let name = custom
    if (!name) {
      do { name = randomCode(crypto) } while (await RedeemableCode.exists({ codeName: name }))
    } else if (await RedeemableCode.exists({ codeName: name })) {
      return res.status(409).send({ message: 'That code already exists.' })
    }

    made.push(await RedeemableCode.create({
      _id: await db.getNextDoId(),
      codeName: name,
      rewardType,
      rewardId,
      gender,
      color1,
      color2: color1,
      repeatHours,
      quantity,
      expirationDate,
      maxUses,
      note,
      createdBy: staff.username
    }))
  }

  await GmCommand.create({
    issuedBy: staff._id,
    issuedByName: staff.username,
    accountType: staff.accountType,
    command: `make-codes ${rewardType === 'gold' ? `${quantity} gold` : `${rewardType} ${rewardId} x${quantity}`}${gender ? ` (${gender === 1 ? 'fairies' : 'Sparrow Men'} only)` : ''}${repeatHours >= 0 ? ` (repeat ${repeatHours ? `every ${repeatHours}h` : 'any time'})` : ''}, ${made.length} code${made.length === 1 ? '' : 's'}${note ? ` (${note})` : ''}`,
    scope: 'web',
    category: 'accounts',
    status: 'done',
    finishedAt: new Date(),
    response: `${made.length} code${made.length === 1 ? '' : 's'} made`
  })

  res.send({ success: true, codes: made.map(code => showCode(code.codeName)) })
})

app.post('/fairies/api/gm/codes/:id/delete', async (req, res) => {
  const staff = await requireCodeAdmin(req, res)
  if (!staff) return

  const code = await RedeemableCode.findById(Number(req.params.id)).catch(() => null)
  if (!code) return res.status(404).send({ message: 'No such code.' })

  await RedeemableCode.deleteOne({ _id: code._id })
  await GmCommand.create({
    issuedBy: staff._id,
    issuedByName: staff.username,
    accountType: staff.accountType,
    command: `delete-code ${showCode(code.codeName)}`,
    scope: 'web',
    category: 'accounts',
    status: 'done',
    finishedAt: new Date(),
    response: 'deleted'
  })

  res.send({ success: true })
})

app.post('/fairies/api/FairiesEditBioRequest', async (req, res) => {
    const questions = req.body.fairieseditbiorequest?.bio?.[0]?.question
    const ses = req.session
    const success = true

    if (!ses.logged || !questions || questions.length != 6) {
      return res.send(createXML({
        response: {
          success: !success
        }
      }))
    }

    const fairy = await db.retrieveFairy(ses.fairyId)
    for (const [i, question] of questions.entries()) {
      fairy.bio[i] = {
        id: i+1,
        answer: parseInt(question.answer[0]),
      }
    }

    await fairy.save()

    md.sendFairyBio(fairy._id, fairy.bio)

    res.send(createXML({
      response: {
        success
      }
    }))
})

app.post('/fairies/api/FairiesEditIconRequest', async (req, res) => {
    const iconId = req.body.icon_id
    const bgId = req.body.game_prof_bg
    const ses = req.session
    const success = true

    if (!ses.logged || !iconId) {
      return res.send(createXML({
        response: {
          success: !success
        }
      }))
    }

    const fairy = await db.retrieveFairy(ses.fairyId)
    fairy.icon = iconId

    if (bgId !== undefined && bgId !== null && bgId !== '') {
      const owner = fairy.accountId
        ? await Account.findOne({ _id: fairy.accountId })
        : await Account.findOne({ username: fairy.ownerAccount })
      const memberDays = await memberDaysFor(owner)
      const maxBgId = memberDays >= 0 ? 5 + Math.floor(memberDays / 90) * 3 : 5
      const requested = parseInt(bgId)

      if (Number.isNaN(requested) || requested < 0 || requested > maxBgId) {
        return res.send(createXML({
          response: {
            success: !success
          }
        }))
      }

      fairy.game_prof_bg = String(requested)
    }

    await fairy.save()

    res.send(createXML({
      response: {
        success
      }
    }))
})

app.post('/fairies/api/UpdateFavoriteBadgeRequest', async (req, res) => {
    const badgeId = parseInt(req.body.badge_id)
    const ses = req.session
    const success = true

    if (!ses.logged || !badgeId) {
      return res.send(createXML({
        response: {
          success: !success
        }
      }))
    }

    const fairy = await db.retrieveFairy(ses.fairyId)

    const isEarned = fairy.badgeData?.badges?.some(
      badge => badge.badgeId === badgeId && badge.status === 'Earned'
    )

    if (!isEarned) {
      return res.send(createXML({
        response: {
          success: !success
        }
      }))
    }

    fairy.badgeData.favoriteBadgeId = badgeId
    await fairy.save()

    res.send(createXML({
      response: {
        success
      }
    }))
})

// account portal routes

const bcrypt = require('bcrypt')
const { DIAMONDS_BY_TIER, TIER_LABELS, runMembershipDrip } = require('./MembershipType')

function requireSession(req, res, next) {
  if (req.session && req.session.logged) return next()
  return res.status(401).json({ success: false, error: 'NOT_LOGGED_IN' })
}

app.get(['/account', '/account/', '/accountmanagement', '/accountmanagement.html'], (req, res) => {
  res.sendFile(path.join(__dirname, '../public/account.html'))
})

app.get(['/gm', '/gm/', '/gm.html'], (req, res) => {
  res.redirect('/gm/commands')
})

app.get('/gm/commands', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/gmCommands.html'))
})

app.get('/gm/content', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/gmContent.html'))
})

app.get('/gm/tickets', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/gmTickets.html'))
})

app.get('/gm/accounts', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/gmAccounts.html'))
})

app.get('/gm/codes', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/gmCodes.html'))
})

app.get('/gm/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/gmAdmin.html'))
})

app.get('/gm/staff', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/gmStaff.html'))
})

// Meet the Staff (/staff.html)

const STAFF_LIMITS = { role: 80, didYouKnow: 240, factLabel: 30, factValue: 120, facts: 8, bio: 4000 }

// the pictures tools/build-staff-backgrounds.js made, as a set of ids; read again when the file changes
let staffBackgroundCache = { stamp: 0, ids: new Set() }

function staffBackgroundIds () {
  const file = path.join(__dirname, '../../web/site/img/staffbg/index.json')

  try {
    const stamp = fs.statSync(file).mtimeMs

    if (stamp !== staffBackgroundCache.stamp) {
      const list = JSON.parse(fs.readFileSync(file, 'utf8'))
      const ids = new Set()
      for (const group of list.groups || []) for (const zone of group.zones || []) for (const variant of zone.variants || []) ids.add(variant.id)
      staffBackgroundCache = { stamp, ids }
    }
  } catch (e) {
    return staffBackgroundCache.ids
  }

  return staffBackgroundCache.ids
}

function staffText (value, max) {
  return String(value === undefined || value === null ? '' : value).replace(/\r\n/g, '\n').trim().slice(0, max)
}

function staffSlug (value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

// a fairy by id, or by name when it is not a number
async function staffFairyFor (input) {
  const text = String(input === undefined || input === null ? '' : input).trim()
  if (!text) return null

  if (/^\d+$/.test(text)) {
    const fairy = await Fairy.findById(Number(text)).select('name talent deleted').catch(() => null)
    return fairy && !fairy.deleted ? fairy : null
  }

  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return Fairy.findOne({ name: new RegExp('^' + escaped + '$', 'i'), deleted: { $ne: true } }).select('name talent deleted').catch(() => null)
}

async function staffFairiesById (rows) {
  const fairies = await Fairy.find({ _id: { $in: rows.map(row => row.fairyId) } }).select('name talent deleted').lean()
  return new Map(fairies.map(fairy => [fairy._id, fairy]))
}

function staffListRow (row, fairy) {
  return {
    slug: row.slug,
    fairyId: row.fairyId,
    name: fairy.name,
    talent: fairy.talent,
    role: row.role,
    background: row.background || ''
  }
}

app.get('/fairies/api/staff', async (req, res) => {
  const rows = await StaffFairy.find({ status: 'published' }).sort({ order: 1, createdAt: 1 }).lean()
  const fairies = await staffFairiesById(rows)

  // a staff fairy whose fairy was removed drops off the page rather than showing a broken picture
  res.set('Cache-Control', 'no-cache')
  res.send(rows.filter(row => fairies.has(row.fairyId) && !fairies.get(row.fairyId).deleted).map(row => staffListRow(row, fairies.get(row.fairyId))))
})

app.get('/fairies/api/staff/:slug', async (req, res) => {
  const row = await StaffFairy.findOne({ slug: String(req.params.slug), status: 'published' }).lean()
  const fairy = row && await Fairy.findById(row.fairyId).select('name talent deleted').lean()

  if (!row || !fairy || fairy.deleted) {
    return res.status(404).send({ message: 'There is no one by that name on the team.' })
  }

  res.set('Cache-Control', 'no-cache')
  res.send({ ...staffListRow(row, fairy), didYouKnow: row.didYouKnow, facts: row.facts, bio: row.bio })
})

function staffRow (row, fairy) {
  return {
    _id: row._id,
    slug: row.slug,
    fairyId: row.fairyId,
    name: fairy ? fairy.name : '(fairy removed)',
    talent: fairy ? fairy.talent : null,
    role: row.role,
    didYouKnow: row.didYouKnow,
    facts: row.facts,
    bio: row.bio,
    background: row.background || '',
    order: row.order,
    status: row.status,
    updatedAt: row.updatedAt,
    updatedByName: row.updatedByName
  }
}

app.get('/fairies/api/gm/staff', async (req, res) => {
  const staff = await requireStaff(req, res)
  if (!staff) return

  const rows = await StaffFairy.find({}).sort({ order: 1, createdAt: 1 }).lean()
  const fairies = await staffFairiesById(rows)

  res.send(rows.map(row => staffRow(row, fairies.get(row.fairyId))))
})

// the fields a staff member can set, from a request body, or the reason one is not acceptable
function staffFields (body) {
  const facts = (Array.isArray(body.facts) ? body.facts : [])
    .map(fact => ({ label: staffText(fact && fact.label, STAFF_LIMITS.factLabel), value: staffText(fact && fact.value, STAFF_LIMITS.factValue) }))
    .filter(fact => fact.label || fact.value)

  if (facts.length > STAFF_LIMITS.facts) {
    return { error: 'A page can have up to ' + STAFF_LIMITS.facts + ' lines on its card.' }
  }

  const order = Number.parseInt(body.order, 10)

  const background = staffText(body.background, 80)
  if (background && !staffBackgroundIds().has(background)) {
    return { error: 'That meadow picture is not in the list.' }
  }

  return {
    fields: {
      background,
      role: staffText(body.role, STAFF_LIMITS.role),
      didYouKnow: staffText(body.didYouKnow, STAFF_LIMITS.didYouKnow),
      facts,
      bio: staffText(body.bio, STAFF_LIMITS.bio),
      order: Number.isInteger(order) ? Math.max(0, Math.min(9999, order)) : 0,
      status: body.status === 'published' ? 'published' : 'draft'
    }
  }
}

app.post('/fairies/api/gm/staff', async (req, res) => {
  const staff = await requireStaff(req, res)
  if (!staff) return

  const fairy = await staffFairyFor(req.body.fairy)
  if (!fairy) return res.status(404).send({ message: 'No fairy with that name or id.' })

  const { fields, error } = staffFields(req.body)
  if (error) return res.status(400).send({ message: error })

  const slug = staffSlug(req.body.slug) || staffSlug(fairy.name)
  if (!slug) return res.status(400).send({ message: 'That name has no letters or numbers to make a web address from. Type one in the address box.' })

  if (await StaffFairy.exists({ slug })) {
    return res.status(409).send({ message: 'There is already a page at "' + slug + '". Pick a different address.' })
  }

  if (await StaffFairy.exists({ fairyId: fairy._id })) {
    return res.status(409).send({ message: fairy.name + ' already has a page.' })
  }

  const row = await StaffFairy.create({
    slug,
    fairyId: fairy._id,
    ...fields,
    createdBy: staff._id,
    createdByName: staff.username,
    updatedByName: staff.username
  })

  res.send(staffRow(row.toObject(), fairy))
})

app.post('/fairies/api/gm/staff/:id', async (req, res) => {
  const staff = await requireStaff(req, res)
  if (!staff) return

  const row = await StaffFairy.findById(String(req.params.id)).catch(() => null)
  if (!row) return res.status(404).send({ message: 'No such page.' })

  const { fields, error } = staffFields(req.body)
  if (error) return res.status(400).send({ message: error })

  // the fairy can be swapped, and the address changed, but not onto someone else's
  let fairy = await Fairy.findById(row.fairyId).select('name talent deleted').lean()
  const wanted = req.body.fairy === undefined ? '' : String(req.body.fairy).trim()

  if (wanted && wanted !== String(row.fairyId)) {
    const next = await staffFairyFor(wanted)
    if (!next) return res.status(404).send({ message: 'No fairy with that name or id.' })

    if (next._id !== row.fairyId && await StaffFairy.exists({ fairyId: next._id })) {
      return res.status(409).send({ message: next.name + ' already has a page.' })
    }

    row.fairyId = next._id
    fairy = next
  }

  const slug = staffSlug(req.body.slug)
  if (slug && slug !== row.slug) {
    if (await StaffFairy.exists({ slug })) {
      return res.status(409).send({ message: 'There is already a page at "' + slug + '". Pick a different address.' })
    }

    row.slug = slug
  }

  Object.assign(row, fields, { updatedAt: new Date(), updatedByName: staff.username })
  await row.save()

  res.send(staffRow(row.toObject(), fairy))
})

app.post('/fairies/api/gm/staff/:id/delete', async (req, res) => {
  const staff = await requireStaff(req, res)
  if (!staff) return

  const gone = await StaffFairy.findByIdAndDelete(String(req.params.id)).catch(() => null)
  if (!gone) return res.status(404).send({ message: 'No such page.' })

  res.send({ success: true })
})

// player submissions and their staff queue (uploads.html)
require('./SubmissionService')({ app, requireStaff, db, fairiesForAccount })
const contests = require('./ContestService')({ app, requireStaff, db, fairiesForAccount })
const polls = require('./PixiePollService')({ app, requireStaff, db })
require('./AdminService')({ app, requireStaff })

const accountIdPattern = /^[a-z0-9]{3,20}$/
const firstNamePattern = /^[a-z][a-z' -]{0,29}$/i
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

app.get('/account/username-available', async (req, res) => {
  const username = String(req.query.username || '').toLowerCase().trim()
  if (!accountIdPattern.test(username)) return res.json({ available: false, error: 'INVALID_USERNAME' })
  res.json({ available: await db.isUsernameAvailable(username) })
})

const waitlistJoinsByIp = makeLimiter(5, hourMs)
const waitlistJoinsByEmail = makeLimiter(3, hourMs)
const inviteChecksByIp = makeLimiter(60, hourMs)

app.get('/account/registration-mode', async (req, res) => {
  const gated = await Waitlist.isOn()
  if (!gated) return res.json({ gated: false })

  if (!req.query.invite) return res.json({ gated: true, valid: false })
  if (!allowAll([[inviteChecksByIp, req.ip]])) return res.json({ gated: true, valid: false, error: 'TOO_MANY' })

  const invite = await Waitlist.checkToken(req.query.invite)
  res.json(invite ? { gated: true, valid: true, email: invite.email } : { gated: true, valid: false })
})

app.post('/account/waitlist', async (req, res) => {
  try {
    if (!await Waitlist.isOn()) return res.json({ success: false, error: 'NOT_NEEDED' })

    const email = Waitlist.normalizeEmail(req.body?.email)
    if (!emailPattern.test(email) || email.length > 254) return res.json({ success: false, error: 'INVALID_EMAIL' })
    if (!allowAll([[waitlistJoinsByIp, req.ip], [waitlistJoinsByEmail, email]])) return res.json({ success: false, error: 'TOO_MANY' })

    await Waitlist.rememberBase(siteUrl(req))
    await Waitlist.join(email)
    res.json({ success: true })
  } catch (err) {
    console.error('[account/waitlist] Error:', err)
    res.status(500).json({ success: false, error: 'SERVER_ERROR' })
  }
})

app.post('/account/register', async (req, res) => {
  let invite = null
  try {
    if (AdminSettings.isOn('lockRegistrations')) return res.json({ success: false, error: 'REGISTRATIONS_LOCKED' })
    const gated = await Waitlist.isOn()
    const username = String(req.body?.username || '').toLowerCase().trim()
    const password = String(req.body?.password || '')
    const firstName = String(req.body?.firstName || '').trim()
    const email = String(req.body?.email || '').trim()
    const age = parseInt(req.body?.age, 10)

    const inviteToken = String(req.body?.inviteToken || '')

    if (!allowAll([[registrationsByIp, req.ip]])) return res.json({ success: false, error: 'TOO_MANY' })
    if (gated && !await Waitlist.checkToken(inviteToken)) return res.json({ success: false, error: 'INVITE_REQUIRED' })
    if (!accountIdPattern.test(username)) return res.json({ success: false, error: 'INVALID_USERNAME' })
    if (password.length < 6 || password.toLowerCase() === username) return res.json({ success: false, error: 'INVALID_PASSWORD' })
    if (!firstNamePattern.test(firstName)) return res.json({ success: false, error: 'INVALID_NAME' })
    if (!emailPattern.test(email)) return res.json({ success: false, error: 'INVALID_EMAIL' })
    if (isNaN(age) || age < 1 || age > 120) return res.json({ success: false, error: 'INVALID_AGE' })
    if (!await db.isUsernameAvailable(username)) return res.json({ success: false, error: 'USERNAME_TAKEN' })

    if (gated) {
      invite = await Waitlist.claimToken(inviteToken)
      if (!invite) return res.json({ success: false, error: 'INVITE_REQUIRED' })
    }

    const created = await db.createAccount(username, password)
    if (!created) {
      await Waitlist.releaseToken(invite)
      return res.json({ success: false, error: 'USERNAME_TAKEN' })
    }
    await Waitlist.markUsedBy(invite, username)
    invite = null

    await Account.updateOne({ _id: created._id }, { $set: { email, firstName, age, ageGivenAt: new Date() } })
    await db.createSession(req, username, created._id, true)

    const registered = await Account.findById(created._id)
    await sendEmailConfirmation(registered, req).catch(err => console.error('[email confirmation] send failed:', err.message))

    res.json({ success: true, username })
  } catch (err) {
    await Waitlist.releaseToken(invite).catch(() => {})
    console.error('[account/register] Error during registration:', err)
    res.status(500).json({ success: false, error: 'SERVER_ERROR' })
  }
})

const confirmationsByAccount = makeLimiter(3, hourMs)
const confirmationsByEmail = makeLimiter(3, hourMs)
const confirmationsByIp = makeLimiter(20, hourMs)
const confirmAttemptsByIp = makeLimiter(30, hourMs)
const registrationsByIp = makeLimiter(10, hourMs)
const loginFailuresByIp = makeLimiter(30, 15 * 60 * 1000)
const forgotByIp = makeLimiter(5, hourMs)
const forgotByEmail = makeLimiter(3, hourMs)

const EMAIL_CONFIRM_HOURS = 72

function hashToken (token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

async function sendEmailConfirmation (account, req) {
  if (!account.email) return 'none'

  const allowed = allowAll([
    [confirmationsByAccount, account._id],
    [confirmationsByEmail, account.email.toLowerCase()],
    [confirmationsByIp, req.ip]
  ])
  if (!allowed) return 'limited'

  const token = crypto.randomBytes(24).toString('hex')
  await Account.updateOne({ _id: account._id }, {
    $set: {
      emailConfirmToken: hashToken(token),
      emailConfirmExpires: new Date(Date.now() + EMAIL_CONFIRM_HOURS * hourMs)
    }
  })

  const link = `${siteUrl(req)}/confirmemail.html?token=${token}`
  const text = isUnderThirteen(account)
    ? `Someone signed up for Pixie Hollow Rewritten with the Account ID "${account.username}" and gave this address as their parent or guardian's.\n\n` +
      `Opening this link confirms that this address is yours and that you are their parent or guardian:\n${link}\n\n` +
      `Confirming does not turn on typed chat by itself. You can choose that afterwards.\n\n` +
      `The link works for ${EMAIL_CONFIRM_HOURS} hours. If you were not expecting this message, you can ignore it.`
    : `Please confirm this e-mail address for your Pixie Hollow Rewritten account "${account.username}" by opening this link:\n${link}\n\n` +
      `The link works for ${EMAIL_CONFIRM_HOURS} hours. If you did not make this account, you can ignore this message.`

  const delivered = await EmailService.sendEmail({ to: account.email, subject: 'Please confirm your e-mail address', text })
  return delivered ? 'sent' : 'failed'
}

async function changeAccountEmail (account, email, req) {
  await Account.updateOne({ _id: account._id }, {
    $set: {
      email,
      emailConfirmedAt: null,
      emailConfirmToken: '',
      emailConfirmExpires: null,
      chatApproved: false,
      chatApprovedAt: null,
      parentPortalToken: '',
      parentPortalExpires: null
    }
  })
  account.email = email
  account.emailConfirmedAt = null
  await sendEmailConfirmation(account, req).catch(err => console.error('[email confirmation] send failed:', err.message))
}

app.post('/account/confirm-email', async (req, res) => {
  if (!allowAll([[confirmAttemptsByIp, req.ip]])) return res.json({ success: false, error: 'TOO_MANY' })

  const token = String(req.body?.token || '')
  if (!/^[a-f0-9]{48}$/.test(token)) return res.json({ success: false, error: 'INVALID_LINK' })

  const account = await Account.findOne({ emailConfirmToken: hashToken(token) })
  if (!account || !account.emailConfirmExpires || new Date() > account.emailConfirmExpires) {
    return res.json({ success: false, error: 'INVALID_LINK' })
  }

  await Account.updateOne({ _id: account._id }, { $set: { emailConfirmedAt: new Date(), emailConfirmToken: '', emailConfirmExpires: null } })

  const child = isUnderThirteen(account)
  if (child) await openParentSession(req, account)

  res.json({ success: true, underThirteen: child, portal: child })
})

app.post('/account/resend-confirmation', requireSession, async (req, res) => {
  const account = await Account.findOne({ username: req.session.username })
  if (!account) return res.status(404).json({ success: false, error: 'ACCOUNT_NOT_FOUND' })
  if (!account.email) return res.json({ success: false, error: 'NO_EMAIL' })
  if (account.emailConfirmedAt) return res.json({ success: true, alreadyConfirmed: true })

  const result = await sendEmailConfirmation(account, req).catch(err => {
    console.error('[email confirmation] send failed:', err.message)
    return 'failed'
  })
  res.json(result === 'sent' ? { success: true } : { success: false, error: result === 'limited' ? 'TOO_MANY' : 'SEND_FAILED' })
})

// the parent portal

const PORTAL_MINUTES = 60
const PORTAL_LINK_HOURS = 72
const portalLinksByAccount = makeLimiter(3, hourMs)
const portalLinksByEmail = makeLimiter(3, hourMs)
const portalLinksByIp = makeLimiter(20, hourMs)
const portalRequestsByIp = makeLimiter(10, hourMs)
const deleteRequestsByAccount = makeLimiter(2, dayMs)

async function openParentSession (req, account) {
  req.session.parentAccountId = account._id
  req.session.parentUntil = Date.now() + PORTAL_MINUTES * 60 * 1000
  await new Promise((resolve, reject) => req.session.save(err => (err ? reject(err) : resolve())))
}

async function sendParentPortalLink (account, req) {
  if (!account.email) return 'none'

  const allowed = allowAll([
    [portalLinksByAccount, account._id],
    [portalLinksByEmail, account.email.toLowerCase()],
    [portalLinksByIp, req.ip]
  ])
  if (!allowed) return 'limited'

  const token = crypto.randomBytes(24).toString('hex')
  await Account.updateOne({ _id: account._id }, {
    $set: {
      parentPortalToken: hashToken(token),
      parentPortalExpires: new Date(Date.now() + PORTAL_LINK_HOURS * hourMs)
    }
  })

  const link = `${siteUrl(req)}/parentalcontrols.html?token=${token}`
  const delivered = await EmailService.sendEmail({
    to: account.email,
    subject: 'Parental Controls for a Pixie Hollow account',
    text: `This is the parent or guardian's page for the Pixie Hollow Rewritten account "${account.username}".\n\n` +
          `Open this link to choose whether they can use typed chat (SpeedChat Plus), and to look after the account:\n${link}\n\n` +
          `The link can be used once and works for ${PORTAL_LINK_HOURS} hours. You can ask for a new one at any time.\n\n` +
          `If you were not expecting this message, you can ignore it.`
  })
  return delivered ? 'sent' : 'failed'
}

async function requireParent (req, res, next) {
  try {
    const ses = req.session
    if (!ses || !ses.parentAccountId || !ses.parentUntil || Date.now() > ses.parentUntil) {
      return res.status(401).json({ success: false, error: 'NO_PORTAL_SESSION' })
    }

    const account = await Account.findById(ses.parentAccountId)
    if (!account) return res.status(401).json({ success: false, error: 'NO_PORTAL_SESSION' })
    if (!isUnderThirteen(account)) return res.status(403).json({ success: false, error: 'NOT_UNDER_THIRTEEN' })

    req.parentAccount = account
    next()
  } catch (err) {
    console.error('[parent portal] Error:', err)
    res.status(500).json({ success: false, error: 'SERVER_ERROR' })
  }
}

app.post('/account/parent/enter', async (req, res) => {
  try {
    if (!allowAll([[confirmAttemptsByIp, req.ip]])) return res.json({ success: false, error: 'TOO_MANY' })

    const token = String(req.body?.token || '')
    if (!/^[a-f0-9]{48}$/.test(token)) return res.json({ success: false, error: 'INVALID_LINK' })

    const account = await Account.findOne({ parentPortalToken: hashToken(token) })
    if (!account || !account.parentPortalExpires || new Date() > account.parentPortalExpires) {
      return res.json({ success: false, error: 'INVALID_LINK' })
    }
    if (!isUnderThirteen(account)) return res.json({ success: false, error: 'NOT_UNDER_THIRTEEN' })

    const changes = { parentPortalToken: '', parentPortalExpires: null }
    if (!account.emailConfirmedAt) changes.emailConfirmedAt = new Date()
    await Account.updateOne({ _id: account._id }, { $set: changes })

    await openParentSession(req, account)
    res.json({ success: true })
  } catch (err) {
    console.error('[parent/enter] Error:', err)
    res.status(500).json({ success: false, error: 'SERVER_ERROR' })
  }
})

app.post('/account/parent/request-link', async (req, res) => {
  try {
    let account = null

    if (req.session && req.session.logged && req.session.username) {
      account = await Account.findOne({ username: req.session.username })
    } else {
      const username = String(req.body?.username || '').toLowerCase().trim()
      const email = String(req.body?.email || '').trim().toLowerCase()
      if (!username || !emailPattern.test(email)) return res.json({ success: false, error: 'MISSING_FIELDS' })
      if (!allowAll([[portalRequestsByIp, req.ip]])) return res.json({ success: false, error: 'TOO_MANY' })

      account = await Account.findOne({ username })
      if (account && (!account.email || account.email.toLowerCase() !== email)) account = null
    }

    if (!account) return res.json({ success: false, error: 'NO_MATCH' })
    if (!isUnderThirteen(account)) return res.json({ success: false, error: 'NOT_UNDER_THIRTEEN' })
    if (!account.email) return res.json({ success: false, error: 'NO_EMAIL' })

    const result = await sendParentPortalLink(account, req).catch(err => {
      console.error('[parent/request-link] send failed:', err.message)
      return 'failed'
    })
    res.json(result === 'sent' ? { success: true } : { success: false, error: result === 'limited' ? 'TOO_MANY' : 'SEND_FAILED' })
  } catch (err) {
    console.error('[parent/request-link] Error:', err)
    res.status(500).json({ success: false, error: 'SERVER_ERROR' })
  }
})

app.get('/account/parent/overview', requireParent, async (req, res) => {
  const account = req.parentAccount

  const names = {}
  const ignoredIds = (account.ignored || []).map(Number).filter(Number.isFinite)
  if (ignoredIds.length) {
    const fairies = await Fairy.find({ accountId: { $in: ignoredIds }, deleted: { $ne: true } }, { accountId: 1, name: 1, created: 1 }).sort({ created: 1 })
    fairies.forEach(fairy => { if (!names[fairy.accountId]) names[fairy.accountId] = fairy.name })
  }

  res.json({
    success: true,
    username: account.username,
    age: currentAge(account),
    email: account.email || '',
    emailConfirmed: Boolean(account.emailConfirmedAt),
    chatApproved: Boolean(account.chatApproved),
    chatPlusActive: AdminSettings.chatPlusFor(account),
    ignored: ignoredIds.map(id => ({ id, name: names[id] || 'Another player' })),
    minutesLeft: Math.max(0, Math.round((req.session.parentUntil - Date.now()) / 60000))
  })
})

app.post('/account/parent/chat', requireParent, async (req, res) => {
  const account = req.parentAccount
  const enabled = req.body?.enabled === true

  if (enabled && !account.emailConfirmedAt) return res.json({ success: false, error: 'EMAIL_NOT_CONFIRMED' })

  await Account.updateOne({ _id: account._id }, { $set: { chatApproved: enabled, chatApprovedAt: enabled ? new Date() : null } })
  console.log(`[parent/chat] SpeedChat Plus ${enabled ? 'approved' : 'switched off'} for ${account.username}`)

  res.json({ success: true, chatApproved: enabled, chatPlusActive: enabled })
})

app.post('/account/parent/update-login', requireParent, async (req, res) => {
  const account = req.parentAccount
  const newUsername = String(req.body?.newUsername || '').toLowerCase().trim()
  const newEmail = String(req.body?.newEmail || '').trim()

  const renaming = newUsername && newUsername !== account.username
  const changingEmail = newEmail && newEmail !== account.email
  if (!renaming && !changingEmail) return res.json({ success: false, error: 'NOTHING_TO_CHANGE' })

  if (renaming) {
    if (!accountIdPattern.test(newUsername)) return res.json({ success: false, error: 'INVALID_USERNAME' })
    if (!await db.isUsernameAvailable(newUsername)) return res.json({ success: false, error: 'USERNAME_TAKEN' })
  }
  if (changingEmail && !emailPattern.test(newEmail)) return res.json({ success: false, error: 'INVALID_EMAIL' })

  const oldUsername = account.username
  if (renaming) {
    await Account.updateOne({ _id: account._id }, { $set: { username: newUsername } })
    await Fairy.updateMany({ ownerAccount: oldUsername }, { $set: { ownerAccount: newUsername } })
    account.username = newUsername
    console.log(`[parent/update-login] ${oldUsername} renamed to ${newUsername}`)
  }

  if (changingEmail) await changeAccountEmail(account, newEmail, req)

  res.json({ success: true, username: account.username, email: account.email })
})

app.post('/account/parent/unignore', requireParent, async (req, res) => {
  const id = Number(req.body?.id)
  if (!Number.isFinite(id)) return res.json({ success: false, error: 'INVALID_ID' })

  await Account.updateOne({ _id: req.parentAccount._id }, { $pull: { ignored: id } })
  // a child who is playing right now still has the old list in memory
  queueAccountSync(req.parentAccount).catch(err => console.error('[parent/unignore] sync failed:', err.message))
  res.json({ success: true })
})

app.post('/account/parent/delete-request', requireParent, async (req, res) => {
  const account = req.parentAccount
  if (!allowAll([[deleteRequestsByAccount, account._id]])) return res.json({ success: false, error: 'TOO_MANY' })

  const ticket = await SupportTicket.create({
    accountId: account._id,
    email: account.email,
    category: 'account',
    subject: 'Account deletion request',
    playerName: account.username,
    source: 'site',
    details: { requestedBy: 'Parent portal', accountId: account.username },
    messages: [{ from: 'player', body: `A parent or guardian asked from the parent portal for the account "${account.username}" and all of its fairies to be deleted.` }]
  })

  await DiscordService.notifyTicket({
    ticketId: ticket._id,
    subject: ticket.subject,
    category: ticketCategories.account,
    fromEmail: account.email,
    playerName: account.username,
    reportedName: ''
  }).catch(() => null)

  res.json({ success: true })
})

app.post('/fairies/api/SendChatPermissionEmailsRequest', async (req, res) => {
  function answer (sent) {
    res.setHeader('content-type', 'text/xml')
    res.send(createXML({ response: { success: sent ? 1 : 0 } }))
  }

  try {
    let account = null

    if (req.session && req.session.logged && req.session.userId) {
      account = await db.retrieveAccountFromIdentifier(req.session.userId)
    }
    if (!account) {
      const id = Number(req.body?.userId ?? req.query?.userId)
      if (Number.isFinite(id)) account = await Account.findById(id)
    }

    if (!account || !isUnderThirteen(account) || !account.email) return answer(false)

    answer(await sendParentPortalLink(account, req).catch(() => 'failed') === 'sent')
  } catch (err) {
    console.error('[SendChatPermissionEmailsRequest] Error:', err)
    answer(false)
  }
})

app.post('/account/parent/leave', (req, res) => {
  if (req.session) {
    delete req.session.parentAccountId
    delete req.session.parentUntil
  }
  res.json({ success: true })
})

app.post('/account/complete-profile', requireSession, async (req, res) => {
  try {
    const account = await Account.findOne({ username: req.session.username })
    if (!account) return res.status(404).json({ success: false, error: 'ACCOUNT_NOT_FOUND' })

    const givingAge = !account.age
    let age = account.age

    if (givingAge) {
      age = parseInt(req.body?.age, 10)
      if (isNaN(age) || age < 1 || age > 120) return res.json({ success: false, error: 'INVALID_AGE' })
    }

    const underThirteen = givingAge ? age < 13 : isUnderThirteen(account)
    const givingEmail = !account.email || (givingAge && underThirteen)

    if (!givingAge && !givingEmail) return res.json({ success: false, error: 'NOTHING_NEEDED' })

    let email = ''
    if (givingEmail) {
      email = String(req.body?.email || '').trim()
      if (!emailPattern.test(email)) return res.json({ success: false, error: underThirteen ? 'PARENT_EMAIL_NEEDED' : 'EMAIL_NEEDED' })
    }

    if (givingAge) await Account.updateOne({ _id: account._id }, { $set: { age, ageGivenAt: new Date() } })
    if (givingEmail) await changeAccountEmail(await Account.findById(account._id), email, req)

    res.json({ success: true, underThirteen })
  } catch (err) {
    console.error('[account/complete-profile] Error:', err)
    res.status(500).json({ success: false, error: 'SERVER_ERROR' })
  }
})

app.post('/account/set-age', requireSession, async (req, res) => {
  try {
    const account = await Account.findOne({ username: req.session.username })
    if (!account) return res.status(404).json({ success: false, error: 'ACCOUNT_NOT_FOUND' })

    if (account.age) return res.json({ success: false, error: 'AGE_ALREADY_SET' })

    const age = parseInt(req.body?.age, 10)
    if (isNaN(age) || age < 1 || age > 120) return res.json({ success: false, error: 'INVALID_AGE' })

    let parentEmail = ''

    if (age < 13) {
      parentEmail = String(req.body?.email || '').trim()
      if (!emailPattern.test(parentEmail)) return res.json({ success: false, error: 'PARENT_EMAIL_NEEDED' })
    }

    await Account.updateOne({ _id: account._id }, { $set: { age, ageGivenAt: new Date() } })

    if (parentEmail) await changeAccountEmail(await Account.findById(account._id), parentEmail, req)

    res.json({ success: true, age, underThirteen: age < 13 })
  } catch (err) {
    console.error('[account/set-age] Error:', err)
    res.status(500).json({ success: false, error: 'SERVER_ERROR' })
  }
})

app.post('/account/login', async (req, res) => {
  try {
    const username = req.body?.username || req.query?.username
    const password = req.body?.password || req.query?.password

    if (!username || !password)
      return res.json({ success: false, error: 'MISSING_FIELDS' })

    const uname = String(username).toLowerCase().trim()
    console.log(`[account/login] Attempting login for user: "${uname}"`)

    if (db.isLoginLocked(uname) || !loginFailuresByIp.hasRoom(req.ip)) {
      return res.json({ success: false, error: 'TOO_MANY_ATTEMPTS' })
    }

    const valid = await db.verifyCredentials(uname, password)
    if (!valid) {
      loginFailuresByIp.record(req.ip)
      console.warn(`[account/login] Invalid credentials for user: "${uname}"`)
      return res.json({ success: false, error: 'INVALID_CREDENTIALS' })
    }

    const account = await db.retrieveAccountFromUser(uname)
    if (!account)
      return res.json({ success: false, error: 'ACCOUNT_NOT_FOUND' })

    if (AdminSettings.isLockedOut('lockLogins', account))
      return res.json({ success: false, error: 'LOGINS_LOCKED' })

    await db.createSession(req, uname, account._id, false)
    console.log(`[account/login] Login successful for user: "${uname}"`)
    return res.json({ success: true })
  } catch (err) {
    console.error('[account/login] Error during login:', err)
    return res.status(500).json({ success: false, error: 'SERVER_ERROR' })
  }
})

app.post('/account/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(() => {
      res.json({ success: true })
    })
  } else {
    res.json({ success: true })
  }
})

app.post('/account/forgot', async (req, res) => {
  try {
    const username = String(req.body?.username || '').toLowerCase().trim()
    const email = String(req.body?.email || '').trim().toLowerCase()

    if (!username || !emailPattern.test(email)) {
      return res.json({ success: false, error: 'MISSING_FIELDS' })
    }

    if (!allowAll([[forgotByIp, req.ip], [forgotByEmail, email]])) return res.json({ success: false, error: 'TOO_MANY' })

    const account = await Account.findOne({ username })
    if (!account || !account.email || account.email.toLowerCase() !== email) return res.json({ success: false, error: 'NO_MATCH' })

    const token = crypto.randomBytes(24).toString('hex')
    const expires = new Date(Date.now() + 30 * 60 * 1000)

    account.passwordResetToken = token
    account.passwordResetTokenExpires = expires
    await account.save()
    console.log('[/account/forgot] Token saved for account:', account.username)

    try {
      const resetUrl = `${siteUrl(req)}/passwordReset.html?token=${token}`
      await EmailService.sendEmail({
        to: account.email,
        subject: 'Reset Your Pixie Hollow Password',
        text: `Your Account ID is: ${account.username}\n\n` +
              `Click this link to reset your password:\n${resetUrl}\n\n` +
              `This link expires in 30 minutes and can only be used once.\n\n` +
              `If you did not request this, ignore this email.`
      })
      console.log('[/account/forgot] Email sent to:', account.email)
    } catch (err) {
      console.error('[/account/forgot] Email send error:', err.message)
    }

    res.json({ success: true })
  } catch (err) {
    console.error('[/account/forgot] Route error:', err)
    res.status(500).json({ success: false, error: 'SERVER_ERROR' })
  }
})

const usernameMailByIp = makeLimiter(5, hourMs)
const usernameMailByEmail = makeLimiter(3, hourMs)

app.post('/account/forgot-username', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase()
    if (!emailPattern.test(email)) return res.json({ success: false, error: 'MISSING_FIELDS' })

    if (!allowAll([[usernameMailByIp, req.ip], [usernameMailByEmail, email]])) return res.json({ success: false, error: 'TOO_MANY' })

    const accounts = await Account.find({ email }).collation({ locale: 'en', strength: 2 })
    if (!accounts.length) return res.json({ success: false, error: 'NO_ACCOUNT' })

    const names = accounts.map(account => account.username).sort()
    await EmailService.sendEmail({
      to: email,
      subject: 'Your Pixie Hollow Account ID',
      text: `Someone asked us to send the Account ID${names.length > 1 ? 's' : ''} for this e-mail address.\n\n` +
            names.map(name => `  ${name}`).join('\n') + '\n\n' +
            `If you also need to reset a password, use "Forgot your password?" on the log-in box.\n\n` +
            `If you did not ask for this, you can ignore this message.`
    }).catch(err => console.error('[/account/forgot-username] Email send error:', err.message))

    res.json({ success: true })
  } catch (err) {
    console.error('[/account/forgot-username] Route error:', err)
    res.status(500).json({ success: false, error: 'SERVER_ERROR' })
  }
})

app.get('/account/reset/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim()
    if (!/^[a-f0-9]{48}$/.test(token)) {
      console.log('[GET /account/reset/:token] Invalid token format')
      return res.json({ success: false, invalid: true })
    }

    const account = await Account.findOne({ passwordResetToken: token })
    console.log('[GET /account/reset/:token] Account found:', !!account)

    if (!account || !account.passwordResetTokenExpires || new Date() > account.passwordResetTokenExpires) {
      console.log('[GET /account/reset/:token] Token expired or not found')
      return res.json({ success: false, expired: true })
    }

    res.json({ success: true, username: account.username })
  } catch (err) {
    console.error('[GET /account/reset/:token] Error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

app.post('/account/reset/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim()
    const password = String(req.body.newPassword || '')
    console.log('[POST /account/reset/:token] Token length:', token.length)

    if (!/^[a-f0-9]{48}$/.test(token)) {
      console.log('[POST /account/reset/:token] Invalid token format')
      return res.json({ success: false, error: 'Invalid token' })
    }

    const account = await Account.findOne({ passwordResetToken: token })
    console.log('[POST /account/reset/:token] Account found:', !!account)

    if (!account || !account.passwordResetTokenExpires || new Date() > account.passwordResetTokenExpires) {
      console.log('[POST /account/reset/:token] Token expired or not found')
      return res.json({ success: false, error: 'Token expired or invalid' })
    }

    if (password.length < 6) {
      console.log('[POST /account/reset/:token] Password too short')
      return res.json({ success: false, error: 'Password must be at least 6 characters' })
    }

    if (password.toLowerCase() === account.username.toLowerCase()) {
      console.log('[POST /account/reset/:token] Password same as username')
      return res.json({ success: false, error: 'Password cannot be your Account ID' })
    }

    account.password = await bcrypt.hash(password, 12)
    account.passwordResetToken = ''
    account.passwordResetTokenExpires = null
    await account.save()
    console.log('[POST /account/reset/:token] Password updated for account:', account.username)

    res.json({ success: true })
  } catch (err) {
    console.error('[POST /account/reset/:token] Error:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

app.get('/account/me', requireSession, async (req, res) => {
  const ses = req.session
  const account = await Account.findOne({ username: ses.username })
  if (!account) return res.status(404).json({ success: false, error: 'ACCOUNT_NOT_FOUND' })

  if (account.deleted) {
    return req.session.destroy(() => res.status(401).json({ success: false, error: 'ACCOUNT_DELETED' }))
  }

  await expireModeration(account)

  const fairies = await db.retrieveFairiesByOwnerAccount(ses.username)
  let activeFairy = ses.fairyId ? fairies.find(f => f._id === ses.fairyId) : null
  if (!activeFairy && fairies.length > 0) {
    activeFairy = fairies[0]
  }

  fairies.forEach(warmFairy)

  res.json({
    success: true,
    username: ses.username,
    isStaff: ['Moderator', 'Administrator'].includes(account.accountType),
    accountType: ['Moderator', 'Administrator'].includes(account.accountType) ? account.accountType : 'Player',
    email: account.email || '',
    firstName: account.firstName || '',
    age: currentAge(account),
    underThirteen: isUnderThirteen(account),
    needsOwnEmail: needsOwnEmail(account),
    emailConfirmed: Boolean(account.emailConfirmedAt),
    chatPlusActive: AdminSettings.chatPlusFor(account),
    fairyName: activeFairy ? activeFairy.name : (account.username || ''),
    fairyTalent: activeFairy ? activeFairy.talent : 0,
    gold: activeFairy ? (activeFairy.gold || 0) : 0,
    // slots the site shows, see fairyLimitFor
    maxFairies: await fairyLimitFor(account),
    fairies: fairies.map(f => ({
      id: f._id,
      name: f.name,
      talent: f.talent,
      gender: f.gender,
      gold: f.gold || 0,
      address: f.address || '',
      created: f.created
    })),
    // terminated is read alongside banned like the game does
    hold: (account.banned || account.terminated)
      ? { reason: account.banReason || '', until: account.banUntil || null }
      : null,
    membershipTier: account.membershipTier ?? 4,
    tierLabel: TIER_LABELS[account.membershipTier ?? 4],
    diamondsPerMonth: DIAMONDS_BY_TIER[account.membershipTier ?? 4],
    tierInfo: TIER_LABELS,
    diamondsByTier: DIAMONDS_BY_TIER,
  })
})

// a fairy to keep: looks, items, gold, level, badges and completed quests, as a file the player holds
app.get('/account/fairies/:id/export', requireSession, async (req, res) => {
  const account = await Account.findOne({ username: req.session.username })
  if (!account) return res.status(404).json({ success: false, error: 'ACCOUNT_NOT_FOUND' })

  const owned = await fairiesForAccount(account)
  const fairyId = Number(req.params.id)
  if (!owned.some(one => one._id === fairyId)) return res.status(404).json({ success: false, error: 'NOT_YOURS' })

  // lean, because xp has no field in the model and a hydrated document drops it
  const fairy = await Fairy.findById(fairyId).lean()
  const fileName = `${String(fairy.name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fairy'}.fairy.json`

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
  res.send(JSON.stringify(exportFairy(fairy), null, 2))
})

const fairyImports = makeLimiter(5, hourMs)

// the file arrives as raw bytes: express.json() stops at 100kb and a full wardrobe is bigger than that
app.post('/account/fairies/import', requireSession, express.raw({ type: 'application/octet-stream', limit: '2mb' }), async (req, res) => {
  const account = await Account.findOne({ username: req.session.username })
  if (!account) return res.status(404).json({ success: false, error: 'ACCOUNT_NOT_FOUND' })

  if (!fairyImports.hasRoom(account.username)) return res.status(429).json({ success: false, error: 'TOO_MANY_IMPORTS' })

  const owned = await fairiesForAccount(account)
  if (owned.length >= await fairyLimitFor(account)) return res.status(409).json({ success: false, error: 'NO_OPEN_SLOT' })

  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ success: false, error: 'NOT_A_FAIRY_FILE', message: 'That file is empty.' })

  let file
  try {
    file = JSON.parse(req.body.toString('utf8'))
  } catch {
    return res.status(400).json({ success: false, error: 'NOT_A_FAIRY_FILE', message: 'That is not a fairy file.' })
  }

  fairyImports.record(account.username)

  let doc
  let renamedFrom
  let skipped
  let swapped
  try {
    ({ doc, renamedFrom, skipped, swapped } = await buildFairyDocument(file, {
      account,
      nextId: () => db.getNextDoId(),
      address: await allocateAddress(taken => db.isAddressTaken(taken)),
      normalizeName: normalizeFairyName,
      validateName: validateFairyName,
      fallbackName: async () => randomFairyName(),
      catalog: contentCatalog
    }))
  } catch (error) {
    return res.status(400).json({ success: false, error: 'NOT_A_FAIRY_FILE', message: error.message })
  }

  doc._id = await db.getNextDoId()

  // the collection directly, so xp is kept and the model's defaults don't overwrite the fresh timers
  await Fairy.collection.insertOne(doc)

  account.playerId = doc._id
  await account.save()

  db.retrieveFairyById(doc._id).then(warmFairy).catch(() => {})

  res.json({ success: true, id: doc._id, name: doc.name, renamedFrom: renamedFrom || null, skipped, swapped })
})

// removing your own fairy hides her instead of deleting, so staff can restore her
app.post('/account/fairies/:id/delete', requireSession, async (req, res) => {
  const account = await Account.findOne({ username: req.session.username })
  if (!account) return res.json({ success: false, error: 'ACCOUNT_NOT_FOUND' })

  const fairyId = Number(req.params.id)
  const owned = await fairiesForAccount(account)
  const fairy = owned.find(one => one._id === fairyId)

  if (!fairy) return res.status(404).json({ success: false, error: 'NOT_YOURS' })

  await Fairy.updateOne({ _id: fairy._id }, { $set: { deleted: true, deletedAt: new Date() } })

  if (chosenIdOf(account) === fairy._id) {
    const left = owned.filter(one => one._id !== fairy._id)
    account.playerId = left.length ? left[0]._id : null
    await account.save()
    if (req.session.fairyId === fairy._id) req.session.fairyId = left.length ? left[0]._id : null
  }

  res.json({ success: true, name: fairy.name })
})

app.post('/account/change-password', requireSession, async (req, res) => {
  const { currentPassword, newPassword } = req.body

  if (!currentPassword || !newPassword)
    return res.json({ success: false, error: 'MISSING_FIELDS' })

  if (newPassword.length < 6)
    return res.json({ success: false, error: 'PASSWORD_TOO_SHORT' })

  const account = await Account.findOne({ username: req.session.username })
  if (!account) return res.json({ success: false, error: 'ACCOUNT_NOT_FOUND' })

  const valid = await bcrypt.compare(currentPassword, account.password)
  if (!valid) return res.json({ success: false, error: 'WRONG_PASSWORD' })

  account.password = await bcrypt.hash(newPassword, 12)
  await account.save()

  res.json({ success: true })
})

async function queueAccountSync (account) {
  await GmCommand.create({
    command: `sync-account ${account._id}`,
    scope: 'global',
    category: 'moderation',
    issuedBy: account._id,
    issuedByName: account.username,
    accountType: 'Player'
  })
}

const deleteAttempts = makeLimiter(5, hourMs)

async function restoreDeletedAccount (account) {
  await Account.updateOne({ _id: account._id }, { $set: { deleted: false, deletedAt: null } })
  const restored = await Fairy.updateMany(
    { $or: [{ accountId: account._id }, { ownerAccount: account.username }], deleted: true, deletedAt: account.deletedAt },
    { $set: { deleted: false, deletedAt: null } }
  )
  return restored.modifiedCount
}

async function softDeleteAccount (account) {
  const now = new Date()
  await Account.updateOne({ _id: account._id }, { $set: { deleted: true, deletedAt: now } })
  await Fairy.updateMany(
    { $or: [{ accountId: account._id }, { ownerAccount: account.username }], deleted: { $ne: true } },
    { $set: { deleted: true, deletedAt: now } }
  )
}

app.post('/account/delete', requireSession, async (req, res) => {
  try {
    const account = await Account.findOne({ username: req.session.username })
    if (!account) return res.json({ success: false, error: 'ACCOUNT_NOT_FOUND' })

    if (!allowAll([[deleteAttempts, account._id]])) return res.json({ success: false, error: 'TOO_MANY' })
    if (isUnderThirteen(account)) return res.json({ success: false, error: 'PARENT_ONLY' })
    if (account.accountType && account.accountType !== 'Player') return res.json({ success: false, error: 'STAFF_ACCOUNT' })
    if (account.banned || account.terminated) return res.json({ success: false, error: 'ON_HOLD' })

    const password = String(req.body?.password || '')
    if (!password || !await bcrypt.compare(password, account.password)) return res.json({ success: false, error: 'WRONG_PASSWORD' })

    const typed = String(req.body?.confirm || '').trim().toLowerCase()
    if (typed !== (account.email || account.username).toLowerCase()) return res.json({ success: false, error: 'WRONG_CONFIRM' })

    await softDeleteAccount(account)
    console.log(`[account/delete] ${account.username} deleted their account`)

    req.session.destroy(() => res.json({ success: true, graceDays: DELETE_GRACE_DAYS }))
  } catch (err) {
    console.error('[account/delete] Error:', err)
    res.status(500).json({ success: false, error: 'SERVER_ERROR' })
  }
})

app.post('/account/update-login', requireSession, async (req, res) => {
  const password = String(req.body?.password || '')
  const newUsername = String(req.body?.newUsername || '').toLowerCase().trim()
  const newEmail = String(req.body?.newEmail || '').trim()

  const account = await Account.findOne({ username: req.session.username })
  if (!account) return res.json({ success: false, error: 'ACCOUNT_NOT_FOUND' })
  if (!account.age) return res.json({ success: false, error: 'AGE_NEEDED' })
  if (isUnderThirteen(account)) return res.json({ success: false, error: 'PARENT_ONLY' })
  if (!password || !await bcrypt.compare(password, account.password)) return res.json({ success: false, error: 'WRONG_PASSWORD' })

  const renaming = newUsername && newUsername !== account.username
  const changingEmail = newEmail && newEmail !== account.email
  if (!renaming && !changingEmail) return res.json({ success: false, error: 'NOTHING_TO_CHANGE' })

  if (renaming) {
    if (!accountIdPattern.test(newUsername)) return res.json({ success: false, error: 'INVALID_USERNAME' })
    if (!await db.isUsernameAvailable(newUsername)) return res.json({ success: false, error: 'USERNAME_TAKEN' })
  }
  if (changingEmail && !emailPattern.test(newEmail)) return res.json({ success: false, error: 'INVALID_EMAIL' })

  const oldUsername = account.username
  if (renaming) account.username = newUsername
  await account.save()

  if (changingEmail) {
    await changeAccountEmail(account, newEmail, req)
    await Account.updateOne({ _id: account._id }, { $set: { ownEmailAt: new Date() } })
  }

  if (renaming) {
    await Fairy.updateMany({ ownerAccount: oldUsername }, { $set: { ownerAccount: newUsername } })
    req.session.username = newUsername
    await new Promise((resolve, reject) => req.session.save(err => (err ? reject(err) : resolve())))
    console.log(`[account/update-login] ${oldUsername} renamed to ${newUsername}`)
  }

  res.json({ success: true, username: account.username, email: account.email })
})

app.post('/account/membership', requireSession, async (req, res) => {
  const tier = parseInt(req.body.tier, 10)

  if (isNaN(tier) || !(tier in TIER_LABELS))
    return res.json({ success: false, error: 'INVALID_TIER' })

  const account = await Account.findOne({ username: req.session.username })
  if (!account) return res.json({ success: false, error: 'ACCOUNT_NOT_FOUND' })

  if (tier === 0) {
    account.membershipSince = null
    account.membershipDripsPaid = null
  } else if (!(account.membershipTier >= 1)) {
    account.membershipSince = new Date()
    account.membershipDripsPaid = null
  }

  account.membershipTier = tier
  await account.save()

  res.json({
    success: true,
    membershipTier: tier,
    tierLabel: TIER_LABELS[tier],
    diamondsPerMonth: DIAMONDS_BY_TIER[tier],
  })
})

app.post('/account/admin/trigger-drip', async (req, res) => {
  if (!verifyAuthorization(req.headers.authorization))
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED' })

  try {
    await runMembershipDrip()
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// never news and known issues, one blog engine and two feeds

const newsFeeds = {
  nevernews: 'Never News',
  knownissues: 'Known Issues',
  events: 'Events',
  contests: 'Contests',
  polls: 'Pixie Polls'
}

// caddy's file_server root, a path under here is also the url an entry stores
const WEB_ROOT = path.join(__dirname, '../../web')

const newsImageSources = [
  { dir: 'publish/images/nevernews', label: 'Never News' },
  { dir: 'franchise/fairies/pixie-hollow/img/publishing/pixie-postings', label: 'Pixie Postings' },
  { dir: 'site/uploads/news', label: 'Uploaded' }
]

const signatureSources = [
  { dir: 'franchise/fairies/pixie-hollow/img/publishing/signatures', label: 'Original', prefix: 'sig.' },
  { dir: 'site/uploads/signatures', label: 'Uploaded' }
]

const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif']

const THUMB_SUFFIX = /_th\d*_?$/i

function prettyAssetName (base) {
  return base
    .replace(/^sig\./i, '')
    .replace(/_\d{13}$/, '')
    .replace(/[-_.]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

function listImageFiles (source) {
  let names = []
  try {
    names = fs.readdirSync(path.join(WEB_ROOT, source.dir))
  } catch (err) {
    return []
  }

  return names.filter(name => {
    if (!imageExtensions.includes(path.extname(name).toLowerCase())) return false
    if (source.prefix && !name.toLowerCase().startsWith(source.prefix)) return false
    return true
  })
}

function collectNewsImages () {
  const groups = []

  newsImageSources.forEach(source => {
    const files = listImageFiles(source)
    const bases = new Set(files.map(name => name.slice(0, -path.extname(name).length)))
    const items = []

    files.forEach(name => {
      const base = name.slice(0, -path.extname(name).length)
      if (THUMB_SUFFIX.test(base)) return

      // any sibling whose name is this one plus a _th suffix is its thumbnail
      const thumbBase = Array.from(bases).find(other => other !== base &&
        other.startsWith(base) && THUMB_SUFFIX.test(other.slice(base.length)))
      const thumbName = thumbBase && files.find(file => file.startsWith(thumbBase + '.'))

      items.push({
        url: `/${source.dir}/${name}`,
        thumbUrl: thumbName ? `/${source.dir}/${thumbName}` : `/${source.dir}/${name}`,
        label: prettyAssetName(base)
      })
    })

    items.sort((a, b) => a.label.localeCompare(b.label))
    if (items.length) groups.push({ label: source.label, items })
  })

  return groups
}

function collectSignatures () {
  const groups = []

  signatureSources.forEach(source => {
    const items = listImageFiles(source).map(name => ({
      url: `/${source.dir}/${name}`,
      label: prettyAssetName(name.slice(0, -path.extname(name).length))
    }))

    items.sort((a, b) => a.label.localeCompare(b.label))
    if (items.length) groups.push({ label: source.label, items })
  })

  return groups
}

// the body is html so it goes through an allowlist before it is stored
const allowedBodyTags = {
  p: [], br: [], b: [], strong: [], i: [], em: [], u: [], s: [],
  ul: [], ol: [], li: [], h3: [], h4: [], blockquote: [], span: [], div: [],
  a: ['href', 'target'],
  img: ['src', 'alt', 'width', 'height']
}

function safeAssetUrl (value) {
  const url = String(value || '').trim()
  if (!url || /[\r\n\t<>"]/.test(url)) return ''
  if (url.startsWith('/') && !url.startsWith('//')) return url
  if (/^https?:\/\//i.test(url)) return url
  return ''
}

function sanitizeHtmlBody (html) {
  const stripped = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?(<\/\1\s*>|$)/gi, '')

  const cleaned = stripped.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match, slash, rawName, attrs) => {
    const name = rawName.toLowerCase()
    const allowed = allowedBodyTags[name]
    if (!allowed) return ''
    if (slash) return `</${name}>`

    const kept = []
    const attrPattern = /([a-zA-Z-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g
    let attr
    while ((attr = attrPattern.exec(attrs)) !== null) {
      const key = attr[1].toLowerCase()
      if (!allowed.includes(key)) continue

      let value = attr[2].replace(/^["']|["']$/g, '')
      if (key === 'href' || key === 'src') {
        value = safeAssetUrl(value)
        if (!value) continue
      }
      if (key === 'target') value = '_blank'
      if (key === 'width' || key === 'height') {
        value = String(parseInt(value, 10) || '')
        if (!value) continue
      }
      kept.push(`${key}="${value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
    }

    const selfClosing = name === 'br' || name === 'img' ? ' /' : ''
    return `<${name}${kept.length ? ' ' + kept.join(' ') : ''}${selfClosing}>`
  })

  return cleaned.slice(0, 40000)
}

function bodyExcerpt (html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^([\s\S]{0,220})([\s\S]?)[\s\S]*$/, (match, head, next) =>
      next ? head.replace(/\s+\S*$/, '') + '…' : head)
}

function contestInfo (entry) {
  if (entry.feed !== 'contests') return null
  return { open: entry.contestOpen, accepts: entry.contestAccepts, perPlayer: entry.contestEntriesPerPlayer }
}

function publicEntrySummary (entry) {
  return {
    _id: entry._id,
    feed: entry.feed,
    title: entry.title,
    authorName: entry.authorName,
    thumbImage: entry.thumbImage || entry.heroImage,
    postedAt: entry.postedAt,
    excerpt: bodyExcerpt(entry.body),
    commentsEnabled: entry.commentsEnabled,
    commentCount: entry.comments.filter(comment => comment.status === 'approved').length,
    contest: contestInfo(entry)
  }
}

function publicEntry (entry) {
  return {
    _id: entry._id,
    feed: entry.feed,
    title: entry.title,
    body: entry.body,
    authorName: entry.authorName,
    signature: entry.signature,
    heroImage: entry.heroImage,
    postedAt: entry.postedAt,
    commentsEnabled: entry.commentsEnabled,
    contest: contestInfo(entry),
    comments: entry.comments
      .filter(comment => comment.status === 'approved')
      .map(comment => ({ fairyName: comment.fairyName, body: comment.body, postedAt: comment.postedAt }))
  }
}

app.get('/fairies/api/news/feeds', (req, res) => {
  res.send(newsFeeds)
})

app.get('/fairies/api/news/:feed', async (req, res) => {
  const feed = String(req.params.feed || '')
  if (!newsFeeds[feed]) return res.status(404).send({ message: 'No such feed.' })

  const perPage = Math.min(Math.max(parseInt(req.query.perPage, 10) || 10, 1), 50)
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1)

  const filter = { feed, status: 'published' }
  const total = await BlogEntry.countDocuments(filter)
  const docs = await BlogEntry.find(filter)
    .sort({ postedAt: -1 })
    .skip((page - 1) * perPage)
    .limit(perPage)

  res.send({
    feed,
    feedTitle: newsFeeds[feed],
    page,
    perPage,
    total,
    pages: Math.max(Math.ceil(total / perPage), 1),
    entries: docs.map(publicEntrySummary)
  })
})

app.get('/fairies/api/news/:feed/:id', async (req, res) => {
  const feed = String(req.params.feed || '')
  if (!newsFeeds[feed]) return res.status(404).send({ message: 'No such feed.' })

  const entry = await BlogEntry.findById(req.params.id).catch(() => null)
  if (!entry || entry.feed !== feed || entry.status !== 'published') {
    return res.status(404).send({ message: 'No such entry.' })
  }

  const [older, newer] = await Promise.all([
    BlogEntry.findOne({ feed, status: 'published', postedAt: { $lt: entry.postedAt } }).sort({ postedAt: -1 }),
    BlogEntry.findOne({ feed, status: 'published', postedAt: { $gt: entry.postedAt } }).sort({ postedAt: 1 })
  ])

  res.send({
    feedTitle: newsFeeds[feed],
    entry: publicEntry(entry),
    olderId: older ? older._id : null,
    newerId: newer ? newer._id : null
  })
})

// guests could comment on the original blog by typing a nickname, kept behind a per ip cap
const guestCommentTimes = new Map()

function guestCommentAllowed (ip) {
  const hourAgo = Date.now() - 60 * 60 * 1000
  const recent = (guestCommentTimes.get(ip) || []).filter(time => time > hourAgo)
  if (recent.length >= 5) return false
  recent.push(Date.now())
  guestCommentTimes.set(ip, recent)
  return true
}

app.post('/fairies/api/news/:feed/:id/comments', async (req, res) => {
  const feed = String(req.params.feed || '')
  if (!newsFeeds[feed]) return res.status(404).send({ message: 'No such feed.' })

  const entry = await BlogEntry.findById(req.params.id).catch(() => null)
  if (!entry || entry.feed !== feed || entry.status !== 'published') {
    return res.status(404).send({ message: 'No such entry.' })
  }
  if (!entry.commentsEnabled) {
    return res.status(403).send({ error: 'COMMENTS_CLOSED', message: 'Comments are closed on this post.' })
  }

  const ses = req.session
  const account = ses && ses.logged && ses.userId ? await db.retrieveAccountFromIdentifier(ses.userId) : null

  const body = String(req.body.body || '').trim().slice(0, 1000)
  let fairyName = String(req.body.fairyName || '').trim().slice(0, 40)

  if (account && !fairyName) fairyName = account.username
  if (!fairyName) {
    return res.status(400).send({ error: 'MISSING_NAME', message: 'Please add your name before submitting' })
  }
  if (!body) {
    return res.status(400).send({ error: 'MISSING_COMMENT', message: 'Please add a comment before submitting' })
  }
  if (!account && !guestCommentAllowed(req.ip)) {
    return res.status(429).send({ error: 'TOO_MANY', message: 'You have sent a lot of comments. Please try again in an hour.' })
  }

  entry.comments.push({
    fairyName,
    accountId: account ? account._id : null,
    body,
    status: 'pending'
  })
  entry.updatedAt = new Date()
  await entry.save()

  res.send({ success: true, held: true })
})

// staff side

app.get('/fairies/api/gm/news-assets', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  res.send({ images: collectNewsImages(), signatures: collectSignatures() })
})

// uploads arrive as raw bytes, express.json() has a 100kb cap and base64 would inflate the file
const uploadKinds = {
  newsImage: 'site/uploads/news',
  signature: 'site/uploads/signatures'
}


app.post('/fairies/api/gm/news-uploads',
  express.raw({ type: 'application/octet-stream', limit: '4mb' }),
  async (req, res) => {
    const account = await requireStaff(req, res)
    if (!account) return

    const kind = String(req.query.kind || '')
    if (!uploadKinds[kind]) return res.status(400).send({ message: 'Unknown upload kind.' })
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).send({ message: 'No file was sent.' })
    }

    const type = sniffImageType(req.body)
    if (!type) return res.status(400).send({ message: `Please upload a ${ACCEPTED_IMAGE_TYPES} image.` })

    const dir = path.join(WEB_ROOT, uploadKinds[kind])
    await fs.promises.mkdir(dir, { recursive: true })

    const name = uploadFileName(req.query.name, type.ext)
    await fs.promises.writeFile(path.join(dir, name), req.body)

    res.send({ success: true, url: `/${uploadKinds[kind]}/${name}`, label: prettyAssetName(name) })
  })

app.get('/fairies/api/gm/news', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const filter = {}
  if (newsFeeds[req.query.feed]) filter.feed = req.query.feed
  if (['draft', 'published'].includes(req.query.status)) filter.status = req.query.status

  const docs = await BlogEntry.find(filter).sort({ postedAt: -1 }).limit(200)

  res.send(docs.map(entry => ({
    _id: entry._id,
    feed: entry.feed,
    title: entry.title,
    authorName: entry.authorName,
    status: entry.status,
    postedAt: entry.postedAt,
    thumbImage: entry.thumbImage || entry.heroImage,
    commentsEnabled: entry.commentsEnabled,
    contestOpen: entry.feed === 'contests' ? entry.contestOpen : undefined,
    pollOpen: entry.feed === 'polls' ? entry.pollOpen : undefined,
    pendingComments: entry.comments.filter(comment => comment.status === 'pending').length
  })))
})

app.get('/fairies/api/gm/news/:id', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const entry = await BlogEntry.findById(req.params.id).catch(() => null)
  if (!entry) return res.status(404).send({ message: 'No such entry.' })

  const linked = entry.calendarEventId ? await Event.findById(entry.calendarEventId).catch(() => null) : null
  const data = entry.toObject()
  data.calendar = linked
    ? { enabled: true, timeType: linked.timeType, date: linked.date, endDate: linked.endDate, type: linked.type, shortTitle: linked.shortTitle, when: linked.when, where: linked.where }
    : null

  if (entry.feed === 'polls') {
    if (!entry.pollQuestions.length) data.pollQuestions = [{ text: '', options: entry.pollOptions }]
    data.pollResults = await polls.resultsFor(entry)
  }

  res.send(data)
})

function readEntryFields (body) {
  const fields = {
    title: String(body.title || '').trim().slice(0, 200),
    body: sanitizeHtmlBody(body.body),
    authorName: String(body.authorName || '').trim().slice(0, 60),
    signature: safeAssetUrl(body.signature),
    heroImage: safeAssetUrl(body.heroImage),
    thumbImage: safeAssetUrl(body.thumbImage),
    commentsEnabled: Boolean(body.commentsEnabled),
    status: body.status === 'published' ? 'published' : 'draft'
  }

  if (body.contest && typeof body.contest === 'object') {
    fields.contestOpen = Boolean(body.contest.open)
    fields.contestAccepts = ['writing', 'art', 'either'].includes(body.contest.accepts) ? body.contest.accepts : 'either'
    fields.contestEntriesPerPlayer = Math.min(Math.max(parseInt(body.contest.perPlayer, 10) || 1, 1), 20)
  }

  if (body.poll && typeof body.poll === 'object') {
    const asked = Array.isArray(body.poll.questions) ? body.poll.questions : [{ text: '', options: body.poll.options }]

    fields.pollQuestions = asked.slice(0, polls.MAX_QUESTIONS).map(question => ({
      text: String((question && question.text) || '').trim().slice(0, polls.QUESTION_MAX),
      options: (Array.isArray(question && question.options) ? question.options : [])
        .map(option => String(option || '').trim().slice(0, polls.OPTION_MAX)).filter(Boolean).slice(0, polls.MAX_OPTIONS)
    })).filter(question => question.text || question.options.length)
    fields.pollOptions = []
    fields.pollOpen = Boolean(body.poll.open)
    fields.pollShowResults = Boolean(body.poll.showResults)
  }

  const posted = body.postedAt ? new Date(body.postedAt) : null
  if (posted && !isNaN(posted.getTime())) fields.postedAt = posted

  return fields
}

// a poll needs its questions and answers before it goes out
async function pollProblem (feed, fields, existing) {
  if (feed !== 'polls') return ''

  const questions = fields.pollQuestions || (existing ? polls.questionsOf(existing) : [])

  if (fields.status === 'published') {
    if (!questions.length) return 'A published poll needs a question.'

    if (questions.some(question => question.options.length < polls.MIN_OPTIONS)) {
      return `Every question needs at least ${polls.MIN_OPTIONS} answers.`
    }
    if (questions.length > 1 && questions.some(question => !question.text)) {
      return 'When a poll has more than one question, each one needs its question written out.'
    }
  }

  if (existing && fields.pollQuestions && await polls.hasVotes(existing._id)) {
    const before = polls.questionsOf(existing)

    const keeps = (kept, now) => kept.every((option, index) => now[index] === option)

    if (questions.length < before.length || before.some((question, index) => !keeps(question.options, questions[index].options))) {
      return 'This poll already has votes, so its existing questions and answers cannot be changed or removed. You can add more answers to a question, and more questions at the end.'
    }
  }

  return ''
}

const eventTimeTypes = ['once', 'hourly', 'thisweek', 'contest']

function readCalendarFields (calendar, title) {
  const timeType = eventTimeTypes.includes(calendar.timeType) ? calendar.timeType : 'once'
  const spansDays = timeType === 'thisweek' || timeType === 'contest'

  return {
    timeType,
    date: calendar.date ? new Date(calendar.date) : null,
    endDate: spansDays && calendar.endDate ? new Date(calendar.endDate) : undefined,
    type: String(calendar.type || '').trim().slice(0, 40),
    title,
    shortTitle: String(calendar.shortTitle || '').trim().slice(0, 40),
    when: String(calendar.when || '').trim().slice(0, 200),
    where: String(calendar.where || '').trim().slice(0, 200)
  }
}

function calendarProblem (calendar, title) {
  if (!calendar || calendar.enabled !== true) return ''

  const fields = readCalendarFields(calendar, title)
  if (!fields.date || isNaN(fields.date.getTime())) return 'Please give the calendar event a date.'
  if (fields.endDate && isNaN(fields.endDate.getTime())) return 'The calendar end date is not a date.'
  if (!fields.type) return 'Please pick an icon for the calendar event.'
  if (missingEventFields(fields.timeType, fields)) return 'A single event needs a short title, a time and a place for the calendar.'

  return ''
}

async function syncCalendarEvent (entry, calendar, account) {
  const existing = entry.calendarEventId ? await Event.findById(entry.calendarEventId).catch(() => null) : null

  if (!calendar || calendar.enabled !== true) {
    if (existing) await Event.deleteOne({ _id: existing._id })
    entry.calendarEventId = ''
    return
  }

  const values = Object.assign(readCalendarFields(calendar, entry.title), {
    link: '/events.html',
    published: entry.status === 'published',
    updatedAt: new Date()
  })

  if (existing) {
    Object.assign(existing, values)
    await existing.save()
    return
  }

  const made = await Event.create(Object.assign(values, { createdBy: account._id, createdByName: account.username }))
  entry.calendarEventId = String(made._id)
}

app.post('/fairies/api/gm/news', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const feed = String(req.body.feed || '')
  if (!newsFeeds[feed]) return res.status(400).send({ message: 'Pick a feed.' })

  const fields = readEntryFields(req.body)
  if (!fields.title) return res.status(400).send({ error: 'MISSING_TITLE', message: 'Please give the post a title.' })

  const problem = calendarProblem(req.body.calendar, fields.title)
  if (problem) return res.status(400).send({ error: 'BAD_CALENDAR', message: problem })

  const pollIssue = await pollProblem(feed, fields, null)
  if (pollIssue) return res.status(400).send({ error: 'BAD_POLL', message: pollIssue })

  const entry = await BlogEntry.create(Object.assign({
    feed,
    createdBy: account._id,
    createdByName: account.username
  }, fields))

  if (req.body.calendar) {
    await syncCalendarEvent(entry, req.body.calendar, account)
    await entry.save()
  }

  res.send({ success: true, _id: entry._id, status: entry.status })
})

app.post('/fairies/api/gm/news/:id', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const entry = await BlogEntry.findById(req.params.id).catch(() => null)
  if (!entry) return res.status(404).send({ message: 'No such entry.' })

  const fields = readEntryFields(req.body)
  if (!fields.title) return res.status(400).send({ error: 'MISSING_TITLE', message: 'Please give the post a title.' })

  if (entry.status === 'draft' && fields.status === 'published' && !req.body.postedAt) {
    fields.postedAt = new Date()
  }

  const problem = calendarProblem(req.body.calendar, fields.title)
  if (problem) return res.status(400).send({ error: 'BAD_CALENDAR', message: problem })

  const pollIssue = await pollProblem(entry.feed, fields, entry)
  if (pollIssue) return res.status(400).send({ error: 'BAD_POLL', message: pollIssue })

  Object.assign(entry, fields)
  entry.updatedAt = new Date()
  if (req.body.calendar !== undefined) await syncCalendarEvent(entry, req.body.calendar, account)
  await entry.save()

  res.send({ success: true, status: entry.status })
})

app.post('/fairies/api/gm/news/:id/delete', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const entry = await BlogEntry.findById(req.params.id).catch(() => null)
  if (!entry) return res.status(404).send({ message: 'No such entry.' })

  if (entry.calendarEventId) await Event.deleteOne({ _id: entry.calendarEventId }).catch(() => null)
  if (entry.feed === 'contests') {
    const removed = await contests.deleteEntriesFor(entry._id)
    console.log(`[contests] ${account.username} deleted "${entry.title}" and its ${removed} entries`)
  }
  if (entry.feed === 'polls') {
    const removed = await polls.deleteVotesFor(entry._id)
    console.log(`[polls] ${account.username} deleted "${entry.title}" and its ${removed} votes`)
  }
  await BlogEntry.deleteOne({ _id: entry._id })
  res.send({ success: true })
})

app.get('/fairies/api/gm/news-comments', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending'
  const docs = await BlogEntry.find({ 'comments.status': status }).sort({ postedAt: -1 }).limit(200)

  const waiting = []
  docs.forEach(entry => {
    entry.comments.forEach(comment => {
      if (comment.status !== status) return
      waiting.push({
        entryId: entry._id,
        commentId: comment._id,
        feed: entry.feed,
        entryTitle: entry.title,
        fairyName: comment.fairyName,
        accountId: comment.accountId,
        body: comment.body,
        postedAt: comment.postedAt,
        status: comment.status
      })
    })
  })

  waiting.sort((a, b) => new Date(a.postedAt) - new Date(b.postedAt))
  res.send(waiting)
})

app.post('/fairies/api/gm/news-comments/:entryId/:commentId', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const status = String(req.body.status || '')
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).send({ message: 'Unknown comment status.' })
  }

  const entry = await BlogEntry.findById(req.params.entryId).catch(() => null)
  const comment = entry && entry.comments.id(req.params.commentId)
  if (!comment) return res.status(404).send({ message: 'No such comment.' })

  comment.status = status
  comment.reviewedBy = account.username
  entry.updatedAt = new Date()
  await entry.save()

  res.send({ success: true, status })
})

app.get('/fairies/api/gm/events', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const filter = {}
  if (req.query.published !== undefined) filter.published = req.query.published === 'true'
  const sort = { date: 1 }
  const docs = await Event.find(filter).sort(sort).limit(200)
  res.send(docs)
})

app.get('/fairies/api/gm/events/:id', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const doc = await Event.findById(req.params.id).catch(() => null)
  if (!doc) return res.status(404).send({ message: 'No such event.' })
  res.send(doc)
})

// thisweek and contest span a range of days so only 'once' needs the full when/where set
function missingEventFields (timeType, { title, shortTitle, when, where }) {
  if (!title) return true
  if (timeType === 'once' && (!shortTitle || !when || !where)) return true
  return false
}

app.post('/fairies/api/gm/events', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const { date, endDate, type, timeType, title, shortTitle, when, where, color, link, imagePath, published } = req.body
  const resolvedTimeType = ['once', 'hourly', 'thisweek', 'contest'].includes(timeType) ? timeType : 'once'
  if (!date || !type || missingEventFields(resolvedTimeType, req.body)) {
    return res.status(400).send({ message: 'Missing required fields.' })
  }

  const doc = await Event.create({
    date: new Date(date),
    endDate: endDate ? new Date(endDate) : undefined,
    type,
    timeType: resolvedTimeType,
    title,
    shortTitle: shortTitle || '',
    when: when || '',
    where: where || '',
    color: color || '',
    link: link || '',
    imagePath: imagePath || '',
    published: published === true,
    createdBy: account._id,
    createdByName: account.username,
    updatedAt: new Date()
  })

  res.send(doc)
})

app.post('/fairies/api/gm/events/:id', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const doc = await Event.findById(req.params.id).catch(() => null)
  if (!doc) return res.status(404).send({ message: 'No such event.' })

  const { date, endDate, type, timeType, title, shortTitle, when, where, color, link, imagePath, published } = req.body
  if (date) doc.date = new Date(date)
  if (endDate !== undefined) doc.endDate = endDate ? new Date(endDate) : undefined
  if (type !== undefined) doc.type = type
  if (timeType !== undefined && ['once', 'hourly', 'thisweek', 'contest'].includes(timeType)) doc.timeType = timeType
  if (title !== undefined) doc.title = title
  if (shortTitle !== undefined) doc.shortTitle = shortTitle
  if (when !== undefined) doc.when = when
  if (where !== undefined) doc.where = where
  if (color !== undefined) doc.color = color
  if (link !== undefined) doc.link = link
  if (imagePath !== undefined) doc.imagePath = imagePath
  if (published !== undefined) doc.published = published === true

  if (missingEventFields(doc.timeType, doc)) {
    return res.status(400).send({ message: 'Missing required fields.' })
  }
  doc.updatedAt = new Date()

  await doc.save()
  res.send(doc)
})

app.post('/fairies/api/gm/events/:id/delete', async (req, res) => {
  const account = await requireStaff(req, res)
  if (!account) return

  const doc = await Event.findById(req.params.id).catch(() => null)
  if (!doc) return res.status(404).send({ message: 'No such event.' })

  await Event.deleteOne({ _id: doc._id })
  res.send({ success: true })
})

app.get('/fairies/api/calendar/events', async (req, res) => {
  const now = new Date()
  const month = Math.min(12, Math.max(1, parseInt(req.query.month) || now.getUTCMonth() + 1))
  const year = parseInt(req.query.year) || now.getUTCFullYear()

  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 1))

  // match on overlap, a span can start before the month and end inside it
  const events = await Event.find({
    date: { $lt: monthEnd },
    $or: [{ endDate: { $gte: monthStart } }, { endDate: null, date: { $gte: monthStart } }],
    published: true
  }).sort({ date: 1, createdAt: 1 })
    .select('date endDate type timeType title shortTitle when where color link imagePath')
    .lean()

  res.send({ month, year, events })
})

const calendarTypeRegistry = {
  pixie: { label: 'Famous Fairies', colorhex: '7ec7e6' },
  wings: { label: 'Pixie Pals', colorhex: 'a6d785' },
  gift: { label: 'Minister of the Season', colorhex: 'e0b64f' },
  scroll: { label: 'Fairy Tale Theater', colorhex: '9e62b7' },
  balloon: { label: 'General', colorhex: 'f86800' },
  fashion: { label: 'Fashion', colorhex: 'e893c4' },
  secret: { label: 'Secret of the Wings', colorhex: '3d6b8c' },
  nature: { label: 'Fairy Art for Nature', colorhex: 'eba812' },
  diamonds: { label: 'Diamonds Sweepstakes', colorhex: 'c9a7e0' }
}

const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const calendarMonthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// the in-client flash calendar panel still reads this file, names are the swf's own
async function buildMonthConfig (year, month) {
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 1))

  const events = await Event.find({
    date: { $lt: monthEnd },
    $or: [{ endDate: { $gte: monthStart } }, { endDate: null, date: { $gte: monthStart } }],
    published: true
  }).sort({ date: 1, createdAt: 1 }).lean()

  return {
    '@month': month,
    '@monthstart': weekdayNames[new Date(Date.UTC(year, month - 1, 1)).getUTCDay()],
    events: {
      event: events.map(e => ({
        date: new Date(e.date).getUTCDate(),
        type: e.type,
        title: e.title,
        shorttitle: e.shortTitle,
        when: e.when,
        where: e.where,
        color: e.color || '',
        imageloc: e.imagePath ? e.imagePath.replace(/^.*\/img\//, '') : ''
      }))
    }
  }
}

app.get('/fairies/api/calendar/eventcalendar_config.xml', async (req, res) => {
  const now = new Date()
  let year = now.getUTCFullYear()
  let month = now.getUTCMonth() + 1
  let nextYear = year
  let nextMonth = month + 1
  if (nextMonth > 12) { nextMonth = 1; nextYear += 1 }

  const [currentMonthConfig, nextMonthConfig] = await Promise.all([
    buildMonthConfig(year, month),
    buildMonthConfig(nextYear, nextMonth)
  ])

  res.setHeader('content-type', 'text/xml')
  res.send(createXML({
    calendar: {
      imagepath: '/site/img/calendar/',
      months: {
        currentMonthName: calendarMonthNames[month - 1],
        nextMonthName: calendarMonthNames[nextMonth - 1],
        currentMonthConfig,
        nextMonthConfig
      },
      meetthelink: '/calendarmeetlist.html',
      meetthecopy: 'Meet the Coaches',
      tabcongifs: {
        tab: Object.entries(calendarTypeRegistry).map(([id, cfg]) => ({
          '@id': id,
          '@colorhex': cfg.colorhex,
          '@label': cfg.label
        }))
      }
    }
  }))
})
