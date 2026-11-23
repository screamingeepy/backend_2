/* global mongoose: writeable */
/* global db: writeable */

mongoose = global.mongoose

const createXML = require('../utils/xml')

const Account = require('./models/Account')
const Fairy = require('./models/Fairy')
const { allocateAddress } = require('../utils/addresses')
const Message = require('./models/Message')
const RenderJob = require('./models/RenderJob')

const bcrypt = require('bcrypt')

const crypto = require('crypto')

const axios = require('axios').default

const { normalizeFairyName } = require('../utils/name')
const { makeLimiter } = require('../utils/rateLimit')
const { pickleFromAvatar } = require('../utils/pickle')
const { housePickle } = require('../utils/housePickle')
const { memberDaysFor } = require('../utils/memberDays')
const { chatPlusAllowed } = require('../utils/accountAge')

const saltRounds = 12

const loginFailures = makeLimiter(10, 15 * 60 * 1000)

const RENDER_CLAIM_TIMEOUT_MS = 2 * 60 * 1000

const RENDER_MAX_ATTEMPTS = 3

const RENDER_RETRY_FAILED_MS = Number(process.env.RENDER_RETRY_FAILED_MS || 6 * 60 * 60 * 1000)

const userAgent = 'Sunrise Games - Pixie Hollow API'

const STARTER_FURNITURE = {
  1: [ // animal talent starter furniture
    { item_id: 6507, color1: 114, color2: 0 }, // Toadstool Tableset
    { item_id: 7005, color1: 115, color2: 0 }, // Glowing Gourd Lamp
    { item_id: 7512, color1: 142, color2: 0 }  // Woven Basket
  ],
  2: [ // garden talent starter furniture
    { item_id: 6513, color1: 254, color2: 0 }, // Sunflower Loveseat
    { item_id: 7007, color1: 157, color2: 0 }, // Rose of Sharon Lamp
    { item_id: 7507, color1: 121, color2: 0 }  // Watering Tin
  ],
  3: [ // light talent starter furniture
    { item_id: 6502, color1: 127, color2: 0 }, // Swirled Toadstool Chairs
    { item_id: 7003, color1: 128, color2: 0 }, // Daisy Table Lamp
    { item_id: 7523, color1: 116, color2: 0 }  // Firefly Fetcher
  ],
  4: [ // water talent starter furniture
    { item_id: 6535, color1: 135, color2: 0 }, // Eggshell Tea Table
    { item_id: 7001, color1: 131, color2: 0 }, // Tulip Floor Lamp
    { item_id: 7509, color1: 132, color2: 0 }  // River Stone Pitcher
  ],
  5: [ // tinker talent starter furniture
    { item_id: 6512, color1: 2, color2: 0 }, // Tulip Leaf Table
    { item_id: 7004, color1: 12, color2: 0 }, // Petal Candle
    { item_id: 7511, color1: 102, color2: 0 }  // Clay Pot
  ]
}

// how long to wait before trying mongod again after a failed connection.
const RECONNECT_DELAY = 5000

class Database {
  constructor() {
    this.connectWithRetry()
  }

  async connectWithRetry() {
    try {
      await this.connect()
    } catch (err) {
      console.error(`MongoDB is not reachable (${err.message}); retrying in ${RECONNECT_DELAY / 1000}s.`)
      setTimeout(() => this.connectWithRetry(), RECONNECT_DELAY)
    }
  }

  async connect() {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/PixieHollow', {
      serverSelectionTimeoutMS: 5000
    })

    console.log('Connected to MongoDB!')

    this.db = mongoose.connection

    // create id sequence
    const doIdSequence = await this.db.collection('globals').findOne({ _id: 'doid' })
    if (!doIdSequence) {
      console.log('Creating doid sequence...')
      this.db.collection('globals').insertOne({
        _id: 'doid',
        seq: 1000000000
      })
    }

    this.db.on('error', console.error.bind(console, 'MongoDB connection error:'))
  }

  async getNextDoId() {
    const ret = await this.db.collection('globals').findOneAndUpdate(
      { _id: 'doid' }, // filter
      { $inc: { seq: 1 } }, // update
      { returnOriginal: true } // options
    )
    console.log(ret)
    return ret.seq
  }

  async handleFlashLogin(req, res) {
    let username = req.body.username
    let password = req.body.password
    let loginType = req.body.loginType

    if (username === undefined && password === undefined) {
      username = req.query.username
      password = req.query.password
    }

    if (username !== undefined) {
      username = username.toLowerCase()
    }

    if (loginType === undefined) {
      loginType = req.query.loginType
    }

    let validCredentials
    let accountId
    if (loginType === 'swid') {
      const ses = req.session
      if (ses.logged && ses.username && ses.userId) {
        validCredentials = true
        accountId = ses.userId
        username = ses.username
      }
    } else {
      validCredentials = await this.verifyCredentials(username, password)
      accountId = await this.getAccountIdFromUser(username)
    }

    const responseData = {
      success: validCredentials,
      error: ''
    }

    if (!validCredentials) {
      responseData.error = {
        '@code': 'PARAM_ERROR'
      }

      return res.send(createXML({
        result: responseData
      }))
    }

    responseData.input = {
      'cookieValue': '',
      'loginType': 'hard'
    }
    responseData.token = ''
    responseData.type = 'hard'
    responseData.banURL = ''
    responseData.results = {
      username,
      userId: accountId
    }

    res.setHeader('content-type', 'text/xml')
    res.send(createXML({
      result: responseData
    }))
  }

  async handleAccountLogin(req, res) {
    let username = req.body.username
    let password = req.body.password

    if (username === undefined && password === undefined) {
      username = req.query.username
      password = req.query.password
    }

    if (username !== undefined) {
      username = username.toLowerCase()
    }

    const validCredentials = await this.verifyCredentials(username, password)
    const accountId = await this.getAccountIdFromUser(username)

    let errorCode = '' // LOGIN_FAILED or BANNED
    let memberDays = -1

    if (validCredentials) {
      await db.createSession(req, username, accountId, false)
      memberDays = await memberDaysFor(await Account.findOne({ username }))
    } else {
      errorCode = 'LOGIN_FAILED'
    }

    res.setHeader('content-type', 'text/xml')
    res.send(createXML({
      AccountLoginResponse: {
        success: validCredentials,
        status: 'logged_in',
        error: {
          '@code': errorCode
        },
        account: {
          '@account_id': accountId,
          '#': {
            member_days: memberDays
          }
        },
        dname_submitted: true,
        dname_approved: true
      }
    }))
  }

  async createSession(req, username, accountId, justRegistered) {
    const ses = req.session

    ses.username = username
    ses.success = '1'
    ses.status = 'logged_in_player'
    ses.logged = true
    ses.userId = accountId

    if (!justRegistered && accountId) {
      const account = await this.retrieveAccountFromIdentifier(accountId)
      const storedFairyId = Array.isArray(account?.playerId)
        ? account.playerId[0]
        : account?.playerId
      const selectedFairyId = Number(storedFairyId)
      let fairy = Number.isSafeInteger(selectedFairyId) && selectedFairyId > 0
        ? await Fairy.findOne({
          _id: selectedFairyId,
          $or: [{ accountId }, { ownerAccount: username }]
        })
        : null

      if (!fairy) {
        fairy = await this.retrieveFairy(accountId)
      }

      if (fairy) {
        ses.fairyId = fairy._id
      }
    }

    await new Promise((resolve, reject) =>
      ses.save(err => (err ? reject(err) : resolve()))
    )
  }

  async isUsernameAvailable(username) {
    const account = await Account.exists({ username })

    if (account) {
      return false
    }

    return true
  }

  async doesFairyExist(identifier) {
    const fairy = await Fairy.findOne({ $or: [{ _id: identifier }, { accountId: identifier }] })

    if (fairy) {
      return true
    }

    return false
  }

  async retrieveFairy(identifier) {
    const fairy = await Fairy.findOne({ $or: [{ _id: identifier }, { accountId: identifier }] })

    if (fairy) {
      return fairy
    }

    return false
  }

  // no accountId fallback, so it stays unambiguous. Use it for writes.
  async retrieveFairyById(id) {
    const fairy = await Fairy.findById(id)

    if (fairy) {
      return fairy
    }

    return false
  }

  async isAddressTaken(address) {
    return Boolean(await Fairy.exists({ address }))
  }

  // pixie Pages are addressed by street address, so this is how one is found.
  async retrieveFairyByAddress(address) {
    return await Fairy.findOne({ address: String(address || ''), deleted: { $ne: true } })
  }

  async retrieveFairyByOwnerAccount(owner) {
    const fairy = await Fairy.findOne({ ownerAccount: owner, deleted: { $ne: true } }).sort({ created: 1 })

    if (fairy) {
      return fairy
    }

    return false
  }

  async retrieveFairiesByOwnerAccount(owner) {
    return await Fairy.find({ ownerAccount: owner, deleted: { $ne: true } }).sort({ created: 1 })
  }

  // discord bot helpers -------------------------------------------------------

  async getFairyByDiscordId(discordId) {
    const account = await Account.findOne({ discordId })
    if (!account) return null
    return Fairy.findOne({ accountId: account._id })
  }

  async getFairyByName(name) {
    // names in Mongo may be stored as entered; do a case-insensitive search
    return Fairy.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } })
  }

  // projected on purpose: a 300-friend login would pull 300 whole fairies.
  // fairy ids only, account ids go through the web service so they land on the chosen fairy
  async retrieveFairySummaries(identifiers) {
    return await Fairy.find(
      { _id: { $in: identifiers } },
      { _id: 1, accountId: 1, name: 1, ownerAccount: 1 }
    )
  }

  // A fairy projected down to exactly what FairiesProfileRequest emits.
  async retrieveFairyProfile(identifier, { includeAvatar = false, includeBio = false } = {}) {
    const id = Number(identifier)

    if (!Number.isFinite(id)) {
      return false
    }

    // matched on _id or accountId, so both branches hit an index.
    const earned = {
      $filter: {
        input: { $ifNull: ['$badgeData.badges', []] },
        as: 'b',
        cond: { $eq: ['$$b.status', 'Earned'] }
      }
    }

    const projection = {
      _id: 1,
      accountId: 1,
      ownerAccount: 1,
      address: 1,
      moreOptions: 1,
      created: 1,
      name: 1,
      talent: 1,
      gender: 1,
      chosen: 1,
      icon: 1,
      game_prof_bg: 1,
      optionsBitmask: 1,
      level: 1,
      homeType: 1,
      gardenType: 1,
      tutorialBitmask: { $ifNull: ['$tutorialBitmask', [0, 0]] },

      badge_count: { $size: earned },
      favoriteBadgeId: { $ifNull: ['$badgeData.favoriteBadgeId', 0] },

      // $gt keeps the first on a tie, the way the array reduce it replaced did.
      newest_badge: {
        $let: {
          vars: {
            best: {
              $reduce: {
                input: {
                  $filter: { input: earned, as: 'b', cond: { $ne: ['$$b.dateEarned', null] } }
                },
                initialValue: null,
                in: {
                  $cond: [
                    {
                      $or: [
                        { $eq: ['$$value', null] },
                        { $gt: ['$$this.dateEarned', '$$value.dateEarned'] }
                      ]
                    },
                    '$$this',
                    '$$value'
                  ]
                }
              }
            }
          },
          in: { $ifNull: ['$$best.badgeId', 0] }
        }
      }
    }

    if (includeBio) {
      projection.bio = { $ifNull: ['$bio', []] }
    }

    if (includeAvatar) {
      // items is the expensive part, so it is cut down to what renders.
      projection.avatar = {
        proportions: { $ifNull: ['$avatar.proportions', {}] },
        rotations: { $ifNull: ['$avatar.rotations', {}] },
        hair_back: '$avatar.hair_back',
        hair_front: '$avatar.hair_front',
        face: '$avatar.face',
        eye: '$avatar.eye',
        wing: '$avatar.wing',
        hair_color: '$avatar.hair_color',
        eye_color: '$avatar.eye_color',
        skin_color: '$avatar.skin_color',
        wing_color: '$avatar.wing_color',
        items: {
          $map: {
            input: {
              $filter: {
                input: { $ifNull: ['$avatar.items', []] },
                as: 'i',
                cond: { $eq: ['$$i.location', 'Equipped'] }
              }
            },
            as: 'i',
            in: {
              type: '$$i.type',
              item_id: '$$i.item_id',
              color1: '$$i.color1',
              color2: '$$i.color2',
              location: '$$i.location'
            }
          }
        }
      }
    }

    const [fairy] = await Fairy.aggregate([
      { $match: { $or: [{ _id: id }, { accountId: id }] } },
      { $limit: 1 },
      { $project: projection }
    ])

    if (fairy) {
      return fairy
    }

    return false
  }

  async getAccountIdFromUser(username) {
    const account = await this.retrieveAccountFromUser(username)

    if (account) {
      return account._id
    }

    return -1
  }

  async getUserNameFromAccountId(accountId) {
    const account = await this.retrieveAccountFromIdentifier(accountId)

    if (account) {
      return account.username
    }

    return ''
  }

  async retrieveAccountData(username) {
    const data = new URLSearchParams()

    data.append('username', username)
    data.append('secretKey', process.env.API_TOKEN)

    const request = await axios.post('https://sunrise.games/api/internal/Account.php', data, {
      headers: {
        'Accept-Encoding': 'application/json',
        'User-Agent': userAgent
      }
    })
    const accData = request.data

    if (accData && typeof accData === 'object') {
      const account = await Account.findOne({ username })
      if (!chatPlusAllowed(account)) {
        accData.SpeedChatPlus = 0
        accData.OpenChat = 0
      }
    }

    return accData
  }

  async checkLogin(username, password) {
    const data = new URLSearchParams()

    data.append('username', username)
    data.append('password', password)
    data.append('serverType', 'Pixie Hollow')

    return await axios.post('https://sunrise.games/api/login/alt/', data, {
      headers: {
        'Accept-Encoding': 'application/json',
        'User-Agent': userAgent
      }
    })
  }

  async retrieveAccountFromIdentifier(identifier) {
    return await Account.findById(identifier)
  }

  async retrieveAccountFromUser(username) {
    return await Account.findOne({ username })
  }

  async retrieveAccountFromFairyId(fairyId) {
    return await Account.findOne({ $or: [{ playerId: fairyId }] })
  }

  isLoginLocked(username) {
    return !loginFailures.hasRoom(String(username || '').toLowerCase().trim())
  }

  async verifyCredentials(username, password) {
    if (!username || !password) return false
    const uname = username.toLowerCase().trim()
    if (this.isLoginLocked(uname)) return false
    let account = await this.retrieveAccountFromUser(uname)

    if (account && account.deleted) {
      loginFailures.record(uname)
      return false
    }

    if (account && account.password) {
      try {
        const match = bcrypt.compareSync(password, account.password)
        if (match) return true
      } catch (e) {
        console.error('[verifyCredentials] bcrypt error:', e)
      }
    }

    // fallback: check Sunrise Games API if local match failed or account brand new
    try {
      const res = await this.checkLogin(uname, password)
      const errorCode = res?.data?.errorCode

      if (errorCode === 0) {
        if (!account) {
          account = await this.createAccount(uname, password)
        } else {
          // the Sunrise Games password changed; rehash ours to match.
          account.password = bcrypt.hashSync(password, saltRounds)
          await account.save()
        }
        return true
      }
    } catch (err) {
      console.warn('[verifyCredentials] Sunrise Games API login check failed/unreachable:', err.message)
    }

    loginFailures.record(uname)
    return false
  }

  async createFairy(accountId, fairyData) {
    const avatar = fairyData.avatar[0]

    const proportions = {}
    avatar.proportion.forEach(p => {
      proportions[p.$.type.toLowerCase()] = parseInt(p._)
    })

    const rotations = {}
    avatar.rotation.forEach(r => {
      rotations[r.$.type.toLowerCase()] = parseInt(r._)
    })

    const items = []

    for (const i of avatar.item) {
      let color1 = 0
      let color2 = 0

      for (const c of i.color || []) {
        const num = parseInt(c.$.number)
        const val = parseInt(c._)

        if (num === 1) {
          color1 = val
        } else if (num === 2) {
          color2 = val
        }
      }

      items.push({
        inv_id: await this.getNextDoId(),
        type: i.$.type,
        item_id: parseInt(i.item_id[0]),
        color1,
        color2,
        location: "Equipped"
      })
    }

    const bio = () => {
      const questions = []
      for (let i = 1; i <= 6; i++) {
        questions.push({ id: i, answer: 0 })
      }
      return questions
    }

    const talentNum = parseInt(fairyData.talent[0])
    const starterFurniture = STARTER_FURNITURE[talentNum] || []

    for (const f of starterFurniture) {
      items.push({
        inv_id: await this.getNextDoId(),
        type: "Furniture",
        item_id: f.item_id,
        color1: f.color1,
        color2: f.color2,
        location: "Storage"
      })
    }

    const account = await this.retrieveAccountFromIdentifier(accountId)

    // store our fairy.
    const fairy = new Fairy({
      _id: await this.getNextDoId(),
      ownerAccount: await this.getUserNameFromAccountId(accountId),
      accountId,
      address: await allocateAddress(taken => this.isAddressTaken(taken)),
      name: normalizeFairyName(fairyData.name[0]),
      talent: parseInt(fairyData.talent[0]),
      gender: parseInt(fairyData.gender[0]),
      bio: bio(),
      avatar: {
        proportions,
        rotations,
        hair_back: parseInt(avatar.hair_back[0]),
        hair_front: parseInt(avatar.hair_front[0]),
        face: parseInt(avatar.face[0]),
        eye: parseInt(avatar.eye[0]),
        wing: parseInt(avatar.wing[0]),
        hair_color: parseInt(avatar.hair_color[0]),
        eye_color: parseInt(avatar.eye_color[0]),
        skin_color: parseInt(avatar.skin_color[0]),
        wing_color: parseInt(avatar.wing_color[0]),
        items
      }
    })

    const saved = await fairy.save()

    // save the information into the account.
    account.playerId = fairy._id
    await account.save()

    return saved._id
  }

  async createAccount(username, password) {
    if (!await this.isUsernameAvailable(username)) {
      // sanity check
      return false
    }

    // store the account object.
    const account = new Account({
      _id: await this.getNextDoId(),
      username,
      password: bcrypt.hashSync(password, saltRounds)
    })

    return await account.save()
  }

  // post Office messages (postcards/gift sets waiting in a fairy's home).
  async getMessagesForFairy(fairyId, type) {
    return await Message.find({ recipient_id: fairyId, type }).sort({ created: 1 })
  }

  async deleteMessage(messageId) {
    return await Message.deleteOne({ _id: messageId })
  }


  // avatar renders

  renderHash(pickle, mode, scale) {
    return crypto.createHash('sha1')
      .update(`${pickle}|${mode}|${scale}`)
      .digest('hex')
  }

  async renderSubject(fairy, mode) {
    if (mode !== 'home' && mode !== 'homefull') {
      return pickleFromAvatar(fairy.avatar, fairy.gender)
    }

    const account = fairy.ownerAccount
      ? await this.retrieveAccountFromUser(fairy.ownerAccount)
      : null

    return housePickle(fairy, Number(account && account.membershipTier) >= 1)
  }

  async enqueueRender(fairyId, mode = 'bust', scale = 0, { requeueIfDone = false, warm = false, fairy = null } = {}) {
    fairy = fairy || await this.retrieveFairyById(fairyId)

    if (!fairy) {
      throw new Error(`no fairy ${fairyId}`)
    }

    const pickle = await this.renderSubject(fairy, mode)
    const hash = this.renderHash(pickle, mode, scale)

    const existing = await RenderJob.findOne({
      hash,
      status: { $in: ['queued', 'rendering', 'done', 'failed'] }
    }).sort({ requestedAt: -1 })

    if (existing) {
      // somebody is now actually waiting on a job that was only a pre-render.
      if (!warm && existing.warm && existing.status === 'queued') {
        existing.warm = false
        await existing.save()
      }

      if (existing.status === 'failed') {
        const retryable = this.isRenderGivenUp(existing) &&
          Date.now() - new Date(existing.finishedAt || existing.requestedAt).getTime() >= RENDER_RETRY_FAILED_MS

        if (!retryable) return existing

        existing.status = 'queued'
        existing.attempts = 0
        existing.error = ''
        existing.claimedAt = null
        existing.finishedAt = null
        existing.warm = warm

        return existing.save()
      }

      if (existing.status !== 'done' || !requeueIfDone) {
        return existing
      }

      existing.status = 'queued'
      existing.attempts = 0
      existing.error = ''
      existing.claimedAt = null
      existing.finishedAt = null
      existing.warm = warm

      return existing.save()
    }

    return RenderJob.create({ fairyId, pickle, mode, scale, hash, warm })
  }

  // true once a job has failed as many times as it is allowed to.
  isRenderGivenUp(job) {
    return Boolean(job) && job.status === 'failed' && job.attempts >= RENDER_MAX_ATTEMPTS
  }

  async claimNextRender() {
    const stale = new Date(Date.now() - RENDER_CLAIM_TIMEOUT_MS)

    return RenderJob.findOneAndUpdate(
      {
        attempts: { $lt: RENDER_MAX_ATTEMPTS },
        $or: [
          { status: 'queued' },
          { status: 'failed' },
          { status: 'rendering', claimedAt: { $lt: stale } }
        ]
      },
      {
        $set: { status: 'rendering', claimedAt: new Date() },
        $inc: { attempts: 1 }
      },
      // real requests before pre-renders (warm false sorts ahead of true), oldest first.
      { sort: { warm: 1, requestedAt: 1 }, new: true }
    )
  }

  async finishRender(id, { error = '' } = {}) {
    return RenderJob.findByIdAndUpdate(
      id,
      {
        $set: {
          status: error ? 'failed' : 'done',
          error,
          finishedAt: new Date()
        }
      },
      { new: true }
    )
  }

  async pruneRenderJobs(before) {
    const result = await RenderJob.deleteMany({
      status: { $in: ['done', 'failed'] },
      $or: [{ finishedAt: { $lt: before } }, { finishedAt: null, requestedAt: { $lt: before } }]
    })

    return result.deletedCount || 0
  }

  async renderQueueDepth() {
    const [queued, rendering, failed] = await Promise.all([
      RenderJob.countDocuments({ status: 'queued' }),
      RenderJob.countDocuments({ status: 'rendering' }),
      RenderJob.countDocuments({ status: 'failed' })
    ])

    return { queued, rendering, failed }
  }
}

module.exports = Database
