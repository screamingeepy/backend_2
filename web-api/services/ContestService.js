
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const express = require('express')
const AdminSettings = require('./AdminSettings')

const BlogEntry = require('../db/models/BlogEntry')
const ContestEntry = require('../db/models/ContestEntry')
const { ACCEPTED_IMAGE_TYPES } = require('../utils/images')
const {
  DOCUMENT_TYPES, ACCEPTED_DOCUMENT_TYPES, DOCUMENT_ACCEPT_ATTRIBUTE, SHOWN_AS_TEXT,
  extensionOf, kindOfExtension, sniffUpload
} = require('../utils/documents')
const { makeLimiter, allowAll, makeRepeatGuard, hourMs, dayMs } = require('../utils/rateLimit')

const PRIVATE_DIR = path.join(__dirname, '..', '..', 'private', 'contests')

const STATUSES = ['pending', 'finalist', 'picked', 'rejected']
const STATUS_FOR_PLAYER = {
  pending: 'Waiting to be read',
  finalist: 'A finalist!',
  picked: 'Picked!',
  rejected: 'Not picked this time'
}

const TITLE_MAX = 80
const WRITING_MAX = 2000
const ART_NOTE_MAX = 300
const WRITING_MIN = 20
const EITHER_MIN = 10
const MAX_WAITING_PER_ACCOUNT = 10
const MAX_FILES = 6
const IMAGE_MAX_BYTES = 4 * 1024 * 1024
const DOCUMENT_MAX_BYTES = 8 * 1024 * 1024

const FILE_NAME = new RegExp(`^(u\\d+-)?[A-Za-z0-9_-]+(${['png', 'jpg', 'gif', 'webp', 'bmp', ...Object.keys(DOCUMENT_TYPES).map(ext => ext.slice(1))].map(ext => `\\.${ext}`).join('|')})$`)
const ORPHAN_AFTER_MS = dayMs

const entriesPerHour = makeLimiter(5, hourMs)
const entriesPerDay = makeLimiter(20, dayMs)
const uploadsPerHour = makeLimiter(40, hourMs)
const isRepeat = makeRepeatGuard(dayMs)

// what an entry to a contest takes, from what the contest accepts.
function rulesFor (accepts) {
  return {
    bodyMax: accepts === 'art' ? ART_NOTE_MAX : WRITING_MAX,
    bodyMin: accepts === 'writing' ? WRITING_MIN : accepts === 'either' ? EITHER_MIN : 0,
    images: accepts !== 'writing',
    documents: accepts !== 'art',
    needsPicture: accepts === 'art',
    maxFiles: MAX_FILES,
    imageMaxBytes: IMAGE_MAX_BYTES,
    documentMaxBytes: DOCUMENT_MAX_BYTES,
    imageTypes: ACCEPTED_IMAGE_TYPES,
    documentTypes: ACCEPTED_DOCUMENT_TYPES,
    documentAccept: DOCUMENT_ACCEPT_ATTRIBUTE
  }
}

// an entry's files
function filesOf (entry) {
  if (entry.files && entry.files.length) return entry.files
  return entry.image ? [{ name: entry.image, kind: 'image', size: 0 }] : []
}

// what a player would call the file
function labelOf (name) {
  const ext = extensionOf(name)
  const base = name.slice(0, name.length - ext.length).replace(/^u\d+-/, '').replace(/_\d{10,}[0-9a-f]{0,8}$/, '')
  return `${base || 'file'}${ext}`
}

module.exports = function installContestRoutes ({ app, requireStaff, db, fairiesForAccount }) {
  async function playerAccount (req, res) {
    const ses = req.session

    if (!ses || !ses.logged || !ses.userId) {
      res.status(401).send({ error: 'NOT_LOGGED_IN', message: 'Please log in to enter a contest.' })
      return null
    }

    const account = await db.retrieveAccountFromIdentifier(ses.userId)

    if (!account || account.deleted) {
      res.status(401).send({ error: 'NOT_LOGGED_IN', message: 'Please log in to enter a contest.' })
      return null
    }

    if (account.banned) {
      res.status(403).send({ error: 'ON_HOLD', message: 'This account is on hold, so it cannot enter contests right now.' })
      return null
    }

    return account
  }

  async function activeFairy (req, account) {
    const fairies = await fairiesForAccount(account)
    const chosen = req.session.fairyId ? fairies.find(f => f._id === req.session.fairyId) : null
    return chosen || fairies[0] || null
  }

  async function publishedContest (id) {
    const contest = await BlogEntry.findById(id).catch(() => null)
    return contest && contest.feed === 'contests' && contest.status === 'published' ? contest : null
  }

  const fileUrl = name => `/fairies/api/contests/file/${name}`

  function fileInfo (file) {
    return {
      name: file.name,
      label: labelOf(file.name),
      kind: file.kind,
      size: file.size,
      url: fileUrl(file.name),
      // A document that is shown as text can be read right in the browser.
      text: SHOWN_AS_TEXT.includes(extensionOf(file.name))
    }
  }

  function forPlayer (entry) {
    return {
      id: String(entry._id),
      title: entry.title,
      status: STATUS_FOR_PLAYER[entry.status],
      state: entry.status,
      files: filesOf(entry).map(fileInfo),
      createdAt: entry.createdAt
    }
  }

  function forShowcase (entry) {
    return { fairyName: entry.fairyName, title: entry.title, body: entry.body, files: filesOf(entry).map(fileInfo) }
  }

  function forStaff (entry, titles) {
    return {
      id: String(entry._id),
      contestId: entry.contestId,
      contestTitle: titles ? titles.get(entry.contestId) || '' : '',
      title: entry.title,
      body: entry.body,
      files: filesOf(entry).map(fileInfo),
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

  app.get('/fairies/api/contests/:id', async (req, res) => {
    const contest = await publishedContest(req.params.id)
    if (!contest) return res.status(404).send({ message: 'No such contest.' })

    res.send({
      id: String(contest._id),
      title: contest.title,
      open: contest.contestOpen,
      accepts: contest.contestAccepts,
      perPlayer: contest.contestEntriesPerPlayer,
      rules: rulesFor(contest.contestAccepts),
      titleMax: TITLE_MAX
    })
  })

  app.post('/fairies/api/contests/upload',
    express.raw({ type: 'application/octet-stream', limit: '9mb' }),
    async (req, res) => {
      const account = await playerAccount(req, res)
      if (!account) return

      if (AdminSettings.isOn('lockContests')) return res.status(403).send({ error: 'LOCKED', message: 'Contest entries are closed right now. Please try again later.' })

      if (!uploadsPerHour.hasRoom(`account:${account._id}`)) {
        return res.status(429).send({ error: 'TOO_MANY', message: 'That is a lot of files. Please try again in an hour.' })
      }
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).send({ error: 'NO_FILE', message: 'No file was sent.' })
      }

      const type = sniffUpload(req.body, req.query.name)
      if (!type) {
        return res.status(400).send({
          error: 'NOT_ALLOWED',
          message: `That file type is not accepted. Please choose a ${ACCEPTED_IMAGE_TYPES} picture or a ${ACCEPTED_DOCUMENT_TYPES} file.`
        })
      }

      const limit = type.kind === 'image' ? IMAGE_MAX_BYTES : DOCUMENT_MAX_BYTES
      if (req.body.length > limit) {
        return res.status(413).send({ error: 'TOO_BIG', message: `That file is too big. It needs to be under ${limit / 1024 / 1024} MB.` })
      }

      uploadsPerHour.record(`account:${account._id}`)

      const base = String(req.query.name || '')
        .replace(/\.[^.]*$/, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 50)
      const file = `u${account._id}-${base || 'file'}_${Date.now()}${crypto.randomBytes(2).toString('hex')}${type.ext}`

      await fs.promises.mkdir(PRIVATE_DIR, { recursive: true })
      await fs.promises.writeFile(path.join(PRIVATE_DIR, file), req.body)

      res.send({ success: true, file, kind: type.kind, label: labelOf(file), size: req.body.length })
    })

  app.post('/fairies/api/contests/:id/entries', express.json(), async (req, res) => {
    const account = await playerAccount(req, res)
    if (!account) return

    if (AdminSettings.isOn('lockContests')) return res.status(403).send({ error: 'LOCKED', message: 'Contest entries are closed right now. Please try again later.' })

    const contest = await publishedContest(req.params.id)
    if (!contest) return res.status(404).send({ error: 'NO_CONTEST', message: 'That contest could not be found.' })

    if (!contest.contestOpen) {
      return res.status(403).send({ error: 'CLOSED', message: 'This contest is closed, so it is not taking any more entries.' })
    }

    // A bot fills every box; a person never sees this one.
    if (String(req.body.website || '').trim()) return res.send({ success: true })

    const rules = rulesFor(contest.contestAccepts)
    const title = String(req.body.title || '').trim().slice(0, TITLE_MAX)
    const body = String(req.body.body || '').trim().slice(0, rules.bodyMax)

    if (!title) return res.status(400).send({ error: 'NEEDS_TITLE', message: 'Please give your entry a title.' })

    // the files, each one this account uploaded and has not yet attached.
    const names = [...new Set((Array.isArray(req.body.files) ? req.body.files : []).map(String))]

    if (names.length > MAX_FILES) {
      return res.status(400).send({ error: 'TOO_MANY_FILES', message: `Please send at most ${MAX_FILES} files with one entry.` })
    }

    const files = []
    for (const name of names) {
      const stat = FILE_NAME.test(name) && name.startsWith(`u${account._id}-`)
        ? await fs.promises.stat(path.join(PRIVATE_DIR, name)).catch(() => null)
        : null

      if (!stat || await ContestEntry.exists({ 'files.name': name })) {
        return res.status(400).send({ error: 'NEEDS_FILE', message: 'One of your files was not sent properly. Please add it again.' })
      }

      files.push({ name, kind: kindOfExtension(extensionOf(name)), size: stat.size })
    }

    const pictures = files.filter(file => file.kind === 'image')
    const documents = files.filter(file => file.kind === 'document')

    if (!rules.images && pictures.length) {
      return res.status(400).send({ error: 'WRONG_FILE', message: `This contest takes writing, not pictures. Please send ${ACCEPTED_DOCUMENT_TYPES}, or type it in.` })
    }
    if (!rules.documents && documents.length) {
      return res.status(400).send({ error: 'WRONG_FILE', message: 'This contest takes pictures only. Please send a picture.' })
    }

    if (rules.needsPicture) {
      if (!pictures.length) return res.status(400).send({ error: 'NEEDS_IMAGE', message: 'Please add your picture.' })
    } else if (body.length < rules.bodyMin && !(contest.contestAccepts === 'writing' ? documents.length : files.length)) {
      const message = contest.contestAccepts === 'writing'
        ? `Please write a little more (at least ${rules.bodyMin} letters), or send your writing as a file.`
        : 'Please write something or add a file.'
      return res.status(400).send({ error: 'TOO_SHORT', message })
    }

    const fairy = await activeFairy(req, account)
    if (!fairy) {
      return res.status(400).send({ error: 'NO_FAIRY', message: 'Create a Fairy first, then you can enter.' })
    }

    const already = await ContestEntry.countDocuments({ contestId: String(contest._id), accountId: account._id })
    if (already >= contest.contestEntriesPerPlayer) {
      const word = contest.contestEntriesPerPlayer === 1 ? 'one entry' : `${contest.contestEntriesPerPlayer} entries`
      return res.status(429).send({ error: 'LIMIT', message: `You can send in ${word} to this contest, and you already have.` })
    }

    const waiting = await ContestEntry.countDocuments({ accountId: account._id, status: 'pending' })
    if (waiting >= MAX_WAITING_PER_ACCOUNT) {
      return res.status(429).send({ error: 'TOO_MANY_WAITING', message: 'You already have a lot waiting to be read. Please wait for some to be looked at first.' })
    }

    const key = `account:${account._id}`

    if (isRepeat(key, String(contest._id) + title + body + names.join(','))) {
      return res.status(429).send({ error: 'REPEAT', message: 'You already sent that one in.' })
    }
    if (!allowAll([[entriesPerHour, key], [entriesPerDay, key]])) {
      return res.status(429).send({ error: 'TOO_MANY', message: 'That is a lot of entries. Please try again a little later.' })
    }

    await ContestEntry.create({
      contestId: String(contest._id),
      accountId: account._id,
      username: account.username,
      fairyId: fairy._id,
      fairyName: fairy.name,
      title,
      body,
      files
    })

    res.send({ success: true })
  })

  app.get('/fairies/api/contests/:id/mine', async (req, res) => {
    const account = await playerAccount(req, res)
    if (!account) return

    const entries = await ContestEntry.find({ contestId: req.params.id, accountId: account._id }).sort({ createdAt: -1 }).limit(50)
    res.send(entries.map(forPlayer))
  })

  // winners and finalists, for the contest's page. Only what staff have chosen.
  app.get('/fairies/api/contests/:id/showcase', async (req, res) => {
    const contest = await publishedContest(req.params.id)
    if (!contest) return res.status(404).send({ message: 'No such contest.' })

    const entries = await ContestEntry.find({
      contestId: String(contest._id), status: { $in: ['finalist', 'picked'] }
    }).sort({ reviewedAt: 1 })

    res.send({
      winners: entries.filter(entry => entry.status === 'picked').map(forShowcase),
      finalists: entries.filter(entry => entry.status === 'finalist').map(forShowcase)
    })
  })

  // /image/ is the old address of the same thing.
  app.get(['/fairies/api/contests/file/:file', '/fairies/api/contests/image/:file'], async (req, res) => {
    const file = String(req.params.file || '')
    if (!FILE_NAME.test(file)) return res.status(404).end()

    const entry = await ContestEntry.findOne({ $or: [{ 'files.name': file }, { image: file }] })
    if (!entry) return res.status(404).end()

    let allowed = entry.status === 'picked' || entry.status === 'finalist'

    if (!allowed && req.session && req.session.logged && req.session.userId) {
      const account = await db.retrieveAccountFromIdentifier(req.session.userId)
      allowed = Boolean(account) &&
        (account._id === entry.accountId || ['Moderator', 'Administrator'].includes(account.accountType))
    }

    if (!allowed) return res.status(404).end()

    const ext = extensionOf(file)

    res.set({
      'Cache-Control': 'private, no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox"
    })

    if (DOCUMENT_TYPES[ext]) {
      if (SHOWN_AS_TEXT.includes(ext)) {
        // text for a reader, never HTML, even though it is named .md.
        res.type('text/plain; charset=utf-8')
      } else {
        res.attachment(labelOf(file))
        res.type(DOCUMENT_TYPES[ext])
      }
    }

    res.sendFile(path.join(PRIVATE_DIR, file))
  })

  // staff

  app.get('/fairies/api/gm/contest-list', async (req, res) => {
    const account = await requireStaff(req, res)
    if (!account) return

    const contests = await BlogEntry.find({ feed: 'contests' }).sort({ postedAt: -1 }).limit(200)
    const counts = await ContestEntry.aggregate([
      { $group: { _id: { contest: '$contestId', status: '$status' }, n: { $sum: 1 } } }
    ])

    const tally = id => counts.filter(row => row._id.contest === id)
    const sum = rows => rows.reduce((total, row) => total + row.n, 0)

    res.send(contests.map(contest => {
      const rows = tally(String(contest._id))
      return {
        id: String(contest._id),
        title: contest.title,
        status: contest.status,
        open: contest.contestOpen,
        entries: sum(rows),
        waiting: sum(rows.filter(row => row._id.status === 'pending'))
      }
    }))
  })

  app.post('/fairies/api/gm/contests/:id/open', express.json(), async (req, res) => {
    const account = await requireStaff(req, res)
    if (!account) return

    const contest = await BlogEntry.findById(req.params.id).catch(() => null)
    if (!contest || contest.feed !== 'contests') return res.status(404).send({ message: 'No such contest.' })

    contest.contestOpen = Boolean(req.body.open)
    contest.updatedAt = new Date()
    await contest.save()

    console.log(`[contests] ${account.username} ${contest.contestOpen ? 'opened' : 'closed'} "${contest.title}"`)
    res.send({ success: true, open: contest.contestOpen })
  })

  app.get('/fairies/api/gm/contest-entries', async (req, res) => {
    const account = await requireStaff(req, res)
    if (!account) return

    const filter = {}
    if (STATUSES.includes(req.query.status)) filter.status = req.query.status
    if (req.query.contest) filter.contestId = String(req.query.contest)

    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 10))
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)

    const [entries, total, waiting] = await Promise.all([
      ContestEntry.find(filter).sort({ createdAt: 1 }).skip((page - 1) * pageSize).limit(pageSize),
      ContestEntry.countDocuments(filter),
      ContestEntry.countDocuments({ status: 'pending' })
    ])

    const ids = [...new Set(entries.map(entry => entry.contestId))]
    const contests = await BlogEntry.find({ _id: { $in: ids } }, { title: 1 })
    const titles = new Map(contests.map(contest => [String(contest._id), contest.title]))

    res.send({ pending: waiting, total, page, pageSize, entries: entries.map(entry => forStaff(entry, titles)) })
  })

  app.post('/fairies/api/gm/contest-entries/:id/review', express.json(), async (req, res) => {
    const account = await requireStaff(req, res)
    if (!account) return

    const status = String(req.body.status || '')
    if (!STATUSES.includes(status)) {
      return res.status(400).send({ message: 'Status must be pending, finalist, picked or rejected.' })
    }

    const entry = await ContestEntry.findById(req.params.id).catch(() => null)
    if (!entry) return res.status(404).send({ message: 'No such entry.' })

    entry.status = status
    entry.staffNote = String(req.body.note || '').trim().slice(0, 500)
    entry.reviewedBy = status === 'pending' ? '' : account.username
    entry.reviewedAt = status === 'pending' ? null : new Date()
    await entry.save()

    console.log(`[contests] ${account.username} marked ${entry._id} (contest ${entry.contestId}) ${status}`)
    res.send(forStaff(entry))
  })

  // the private note on its own: it does not change the status or who reviewed it.
  app.post('/fairies/api/gm/contest-entries/:id/note', express.json(), async (req, res) => {
    const account = await requireStaff(req, res)
    if (!account) return

    const entry = await ContestEntry.findById(req.params.id).catch(() => null)
    if (!entry) return res.status(404).send({ message: 'No such entry.' })

    entry.staffNote = String(req.body.note || '').trim().slice(0, 500)
    await entry.save()

    res.send({ success: true, staffNote: entry.staffNote })
  })

  async function removeFilesOf (entry) {
    for (const file of filesOf(entry)) await fs.promises.rm(path.join(PRIVATE_DIR, file.name), { force: true })
  }

  app.delete('/fairies/api/gm/contest-entries/:id', async (req, res) => {
    const account = await requireStaff(req, res)
    if (!account) return

    const entry = await ContestEntry.findByIdAndDelete(req.params.id).catch(() => null)
    if (!entry) return res.status(404).send({ message: 'No such entry.' })

    await removeFilesOf(entry)

    console.log(`[contests] ${account.username} deleted ${entry._id} (contest ${entry.contestId})`)
    res.send({ success: true })
  })

  app.get('/gm/contestEntries', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/gmContestEntries.html'))
  })

  // deleting a contest takes its entries and their files with it.
  async function deleteEntriesFor (contestId) {
    const entries = await ContestEntry.find({ contestId: String(contestId) })

    for (const entry of entries) await removeFilesOf(entry)

    await ContestEntry.deleteMany({ contestId: String(contestId) })
    return entries.length
  }

  // A file uploaded and then never sent in has nothing pointing at it.
  async function sweepOrphans () {
    try {
      const names = await fs.promises.readdir(PRIVATE_DIR).catch(() => [])
      const cutoff = Date.now() - ORPHAN_AFTER_MS
      let removed = 0

      for (const name of names) {
        if (!FILE_NAME.test(name)) continue

        const file = path.join(PRIVATE_DIR, name)
        const stat = await fs.promises.stat(file).catch(() => null)
        if (!stat || stat.mtimeMs >= cutoff) continue

        if (!(await ContestEntry.exists({ $or: [{ 'files.name': name }, { image: name }] }))) {
          await fs.promises.rm(file, { force: true })
          removed++
        }
      }

      if (removed) console.log(`[contests] sweep: removed ${removed} unused upload(s)`)
    } catch (e) {
      console.error(`[contests] sweep failed: ${e.message}`)
    }
  }

  setTimeout(sweepOrphans, 100 * 1000).unref()
  setInterval(sweepOrphans, 6 * hourMs).unref()

  return { deleteEntriesFor }
}
