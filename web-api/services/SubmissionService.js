
const fs = require('fs')
const path = require('path')
const express = require('express')
const AdminSettings = require('./AdminSettings')

const Submission = require('../db/models/Submission')
const { sniffImageType, uploadFileName, ACCEPTED_IMAGE_TYPES } = require('../utils/images')
const { makeLimiter, allowAll, makeRepeatGuard, hourMs, dayMs } = require('../utils/rateLimit')

const PRIVATE_DIR = path.join(__dirname, '..', '..', 'private', 'submissions')

const TYPES = {
  fairytale: { label: 'Fairy Tale', title: 'required', bodyMax: 5000, bodyMin: 50, image: false },
  poem: { label: 'Poem', title: 'required', bodyMax: 2000, bodyMin: 10, image: false },
  question: { label: 'Question for Tabby', title: 'none', bodyMax: 300, bodyMin: 10, image: false },
  art: { label: 'Art', title: 'required', bodyMax: 300, bodyMin: 0, image: true }
}

const TITLE_MAX = 80
const MAX_PENDING_PER_ACCOUNT = 10
const IMAGE_FILE = /^[A-Za-z0-9_-]+\.(png|jpg|gif|webp|bmp)$/
const ORPHAN_AFTER_MS = dayMs

const submissionsPerHour = makeLimiter(5, hourMs)
const submissionsPerDay = makeLimiter(20, dayMs)
const questionsPerWeek = makeLimiter(3, 7 * dayMs)
const uploadsPerHour = makeLimiter(20, hourMs)
const isRepeat = makeRepeatGuard(dayMs)

const STATUS_FOR_PLAYER = { pending: 'Waiting to be read', approved: 'Picked!', rejected: 'Not picked this time' }

module.exports = function installSubmissionRoutes ({ app, requireStaff, db, fairiesForAccount }) {
  async function playerAccount (req, res) {
    const ses = req.session

    if (!ses || !ses.logged || !ses.userId) {
      res.status(401).send({ error: 'NOT_LOGGED_IN', message: 'Please log in to send something in.' })
      return null
    }

    const account = await db.retrieveAccountFromIdentifier(ses.userId)

    if (!account || account.deleted) {
      res.status(401).send({ error: 'NOT_LOGGED_IN', message: 'Please log in to send something in.' })
      return null
    }

    if (account.banned) {
      res.status(403).send({ error: 'ON_HOLD', message: 'This account is on hold, so it cannot send anything in right now.' })
      return null
    }

    return account
  }

  // the fairy she is playing as, the way /account/me picks one.
  async function activeFairy (req, account) {
    const fairies = await fairiesForAccount(account)
    const chosen = req.session.fairyId ? fairies.find(f => f._id === req.session.fairyId) : null
    return chosen || fairies[0] || null
  }

  const imageUrl = entry => entry.image ? `/fairies/api/submissions/image/${entry.image}` : ''

  function forPlayer (entry) {
    return {
      id: String(entry._id),
      type: entry.type,
      typeLabel: TYPES[entry.type].label,
      title: entry.title,
      status: STATUS_FOR_PLAYER[entry.status],
      picked: entry.status === 'approved',
      image: imageUrl(entry),
      createdAt: entry.createdAt
    }
  }

  function forStaff (entry) {
    return {
      id: String(entry._id),
      type: entry.type,
      typeLabel: TYPES[entry.type].label,
      title: entry.title,
      body: entry.body,
      image: imageUrl(entry),
      status: entry.status,
      staffNote: entry.staffNote,
      reviewedBy: entry.reviewedBy,
      reviewedAt: entry.reviewedAt,
      fairyName: entry.fairyName,
      username: entry.username,
      createdAt: entry.createdAt
    }
  }

  // players

  app.get('/fairies/api/submissions/types', (req, res) => {
    res.send(Object.entries(TYPES).map(([key, t]) => ({ key, ...t, titleMax: TITLE_MAX, imageTypes: ACCEPTED_IMAGE_TYPES })))
  })

  app.post('/fairies/api/submissions/upload',
    express.raw({ type: 'application/octet-stream', limit: '4mb' }),
    async (req, res) => {
      const account = await playerAccount(req, res)
      if (!account) return

      if (AdminSettings.isOn('lockSubmissions')) return res.status(403).send({ error: 'LOCKED', message: 'Submissions are closed right now. Please try again later.' })

      if (!uploadsPerHour.hasRoom(`account:${account._id}`)) {
        return res.status(429).send({ error: 'TOO_MANY', message: 'That is a lot of pictures. Please try again in an hour.' })
      }
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).send({ error: 'NO_FILE', message: 'No file was sent.' })
      }

      const type = sniffImageType(req.body)
      if (!type) {
        return res.status(400).send({ error: 'NOT_IMAGE', message: `Please choose a ${ACCEPTED_IMAGE_TYPES} picture.` })
      }

      uploadsPerHour.record(`account:${account._id}`)

      await fs.promises.mkdir(PRIVATE_DIR, { recursive: true })
      const file = uploadFileName(req.query.name, type.ext)
      await fs.promises.writeFile(path.join(PRIVATE_DIR, file), req.body)

      res.send({ success: true, file })
    })

  app.post('/fairies/api/submissions', express.json(), async (req, res) => {
    const account = await playerAccount(req, res)
    if (!account) return

    if (AdminSettings.isOn('lockSubmissions')) return res.status(403).send({ error: 'LOCKED', message: 'Submissions are closed right now. Please try again later.' })

    const kind = String(req.body.type || '')
    const rules = TYPES[kind]

    if (!rules) return res.status(400).send({ error: 'BAD_TYPE', message: 'Please choose what you are sending in.' })

    // A bot fills every box; a person never sees this one.
    if (String(req.body.website || '').trim()) return res.send({ success: true })

    const title = rules.title === 'none' ? '' : String(req.body.title || '').trim().slice(0, TITLE_MAX)
    const body = String(req.body.body || '').trim().slice(0, rules.bodyMax)
    const image = String(req.body.image || '')

    if (rules.title === 'required' && !title) {
      return res.status(400).send({ error: 'NEEDS_TITLE', message: 'Please give it a title.' })
    }
    if (body.length < rules.bodyMin) {
      return res.status(400).send({ error: 'TOO_SHORT', message: `Please write a little more (at least ${rules.bodyMin} letters).` })
    }
    if (rules.image && (!IMAGE_FILE.test(image) || !fs.existsSync(path.join(PRIVATE_DIR, image)))) {
      return res.status(400).send({ error: 'NEEDS_IMAGE', message: 'Please add your picture.' })
    }

    const fairy = await activeFairy(req, account)
    if (!fairy) {
      return res.status(400).send({ error: 'NO_FAIRY', message: 'Create a Fairy first, then you can send things in.' })
    }

    const pending = await Submission.countDocuments({ accountId: account._id, status: 'pending' })
    if (pending >= MAX_PENDING_PER_ACCOUNT) {
      return res.status(429).send({ error: 'TOO_MANY_WAITING', message: 'You already have a lot waiting to be read. Please wait for some to be looked at first.' })
    }

    const key = `account:${account._id}`

    if (isRepeat(key, kind + title + body + image)) {
      return res.status(429).send({ error: 'REPEAT', message: 'You already sent that one in.' })
    }
    if (kind === 'question' && !questionsPerWeek.hasRoom(key)) {
      return res.status(429).send({ error: 'TOO_MANY', message: 'Tabby can only answer a few questions each week. Please try again later.' })
    }
    if (!allowAll([[submissionsPerHour, key], [submissionsPerDay, key]])) {
      return res.status(429).send({ error: 'TOO_MANY', message: 'That is a lot of things. Please try again a little later.' })
    }
    if (kind === 'question') questionsPerWeek.record(key)

    await Submission.create({
      type: kind,
      accountId: account._id,
      username: account.username,
      fairyId: fairy._id,
      fairyName: fairy.name,
      title,
      body,
      image: rules.image ? image : ''
    })

    res.send({ success: true })
  })

  app.get('/fairies/api/submissions/mine', async (req, res) => {
    const account = await playerAccount(req, res)
    if (!account) return

    const entries = await Submission.find({ accountId: account._id }).sort({ createdAt: -1 }).limit(50)
    res.send(entries.map(forPlayer))
  })

  app.get('/fairies/api/submissions/image/:file', async (req, res) => {
    const file = String(req.params.file || '')
    if (!IMAGE_FILE.test(file)) return res.status(404).end()

    const entry = await Submission.findOne({ image: file })
    if (!entry) return res.status(404).end()

    let allowed = entry.status === 'approved'

    if (!allowed && req.session && req.session.logged && req.session.userId) {
      const account = await db.retrieveAccountFromIdentifier(req.session.userId)
      allowed = Boolean(account) &&
        (account._id === entry.accountId || ['Moderator', 'Administrator'].includes(account.accountType))
    }

    if (!allowed) return res.status(404).end()

    // never cached publicly: a picture that is later un-picked must stop showing.
    res.set('Cache-Control', 'private, no-cache')
    res.sendFile(path.join(PRIVATE_DIR, file))
  })

  // staff

  app.get('/fairies/api/gm/submissions', async (req, res) => {
    const account = await requireStaff(req, res)
    if (!account) return

    const filter = {}
    if (['pending', 'approved', 'rejected'].includes(req.query.status)) filter.status = req.query.status
    if (TYPES[req.query.type]) filter.type = req.query.type

    // paged the way the ticket list is: page and pageSize, 10 to a page by default.
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 10))
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)

    // oldest first, so the queue is worked in the order things arrived.
    const [entries, total, pending] = await Promise.all([
      Submission.find(filter).sort({ createdAt: 1 }).skip((page - 1) * pageSize).limit(pageSize),
      Submission.countDocuments(filter),
      Submission.countDocuments({ status: 'pending' })
    ])

    res.send({ pending, total, page, pageSize, entries: entries.map(forStaff) })
  })

  app.post('/fairies/api/gm/submissions/:id/review', express.json(), async (req, res) => {
    const account = await requireStaff(req, res)
    if (!account) return

    const status = String(req.body.status || '')
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).send({ message: 'Status must be pending, approved or rejected.' })
    }

    const entry = await Submission.findById(req.params.id).catch(() => null)
    if (!entry) return res.status(404).send({ message: 'No such submission.' })

    entry.status = status
    entry.staffNote = String(req.body.note || '').trim().slice(0, 500)
    entry.reviewedBy = status === 'pending' ? '' : account.username
    entry.reviewedAt = status === 'pending' ? null : new Date()
    await entry.save()

    console.log(`[submissions] ${account.username} marked ${entry._id} (${entry.type}) ${status}`)
    res.send(forStaff(entry))
  })

  // the private note on its own: it does not change the status or who reviewed it.
  app.post('/fairies/api/gm/submissions/:id/note', express.json(), async (req, res) => {
    const account = await requireStaff(req, res)
    if (!account) return

    const entry = await Submission.findById(req.params.id).catch(() => null)
    if (!entry) return res.status(404).send({ message: 'No such submission.' })

    entry.staffNote = String(req.body.note || '').trim().slice(0, 500)
    await entry.save()

    res.send({ success: true, staffNote: entry.staffNote })
  })

  app.delete('/fairies/api/gm/submissions/:id', async (req, res) => {
    const account = await requireStaff(req, res)
    if (!account) return

    const entry = await Submission.findByIdAndDelete(req.params.id).catch(() => null)
    if (!entry) return res.status(404).send({ message: 'No such submission.' })

    if (entry.image) await fs.promises.rm(path.join(PRIVATE_DIR, entry.image), { force: true })

    console.log(`[submissions] ${account.username} deleted ${entry._id} (${entry.type})`)
    res.send({ success: true })
  })

  async function sweepOrphans () {
    try {
      const names = await fs.promises.readdir(PRIVATE_DIR).catch(() => [])
      const cutoff = Date.now() - ORPHAN_AFTER_MS
      let removed = 0

      for (const name of names) {
        if (!IMAGE_FILE.test(name)) continue

        const file = path.join(PRIVATE_DIR, name)
        const stat = await fs.promises.stat(file).catch(() => null)
        if (!stat || stat.mtimeMs >= cutoff) continue

        if (!(await Submission.exists({ image: name }))) {
          await fs.promises.rm(file, { force: true })
          removed++
        }
      }

      if (removed) console.log(`[submissions] sweep: removed ${removed} unused upload(s)`)
    } catch (e) {
      console.error(`[submissions] sweep failed: ${e.message}`)
    }
  }

  setTimeout(sweepOrphans, 90 * 1000).unref()
  setInterval(sweepOrphans, 6 * hourMs).unref()

  app.get('/gm/submissions', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/gmSubmissions.html'))
  })
}
