
const express = require('express')

const BlogEntry = require('../db/models/BlogEntry')
const SitePollVote = require('../db/models/SitePollVote')
const { makeLimiter, hourMs } = require('../utils/rateLimit')

const MIN_OPTIONS = 2
const MAX_OPTIONS = 10
const OPTION_MAX = 80
const MAX_QUESTIONS = 10
const QUESTION_MAX = 200
const PAST_PER_PAGE = 10

const votesPerHour = makeLimiter(30, hourMs)

function questionsOf (poll) {
  if (poll.pollQuestions && poll.pollQuestions.length) {
    return poll.pollQuestions.map(q => ({ text: q.text || poll.title, options: q.options }))
  }
  return [{ text: poll.title, options: poll.pollOptions || [] }]
}

module.exports = function installPixiePollRoutes ({ app, requireStaff, db }) {
  SitePollVote.updateMany({ question: { $exists: false } }, { $set: { question: 0 } })
    .then(() => SitePollVote.syncIndexes())
    .catch(e => console.error(`[polls] could not update the votes index: ${e.message}`))

  async function viewer (req) {
    const ses = req.session
    if (!ses || !ses.logged || !ses.userId) return null

    const account = await db.retrieveAccountFromIdentifier(ses.userId)
    return account && !account.deleted ? account : null
  }

  // poll id -> question -> option -> votes
  async function tallies (ids) {
    const rows = await SitePollVote.aggregate([
      { $match: { pollId: { $in: ids } } },
      { $group: { _id: { poll: '$pollId', question: { $ifNull: ['$question', 0] }, option: '$option' }, n: { $sum: 1 } } }
    ])

    const byPoll = new Map(ids.map(id => [id, []]))
    for (const row of rows) {
      const questions = byPoll.get(row._id.poll)
      const counts = questions[row._id.question] || (questions[row._id.question] = [])
      counts[row._id.option] = row.n
    }
    return byPoll
  }

  function resultsOf (question, counts) {
    const votes = question.options.map((text, index) => ({ text, votes: (counts && counts[index]) || 0 }))
    const total = votes.reduce((sum, option) => sum + option.votes, 0)
    return {
      total,
      options: votes.map(option => ({ ...option, percent: total ? Math.round(option.votes / total * 100) : 0 }))
    }
  }

  // what staff see in the editor: always the real numbers, question by question.
  async function resultsFor (poll) {
    const id = String(poll._id)
    const counts = (await tallies([id])).get(id)
    return questionsOf(poll).map((question, index) => ({ text: question.text, ...resultsOf(question, counts[index]) }))
  }

  async function hasVotes (pollId) {
    return (await SitePollVote.countDocuments({ pollId: String(pollId) })) > 0
  }

  async function deleteVotesFor (pollId) {
    const result = await SitePollVote.deleteMany({ pollId: String(pollId) })
    return result.deletedCount
  }

  function viewOf (poll, { counts, mine, withComments }) {
    const questions = questionsOf(poll).map((question, index) => {
      const myVote = mine && mine.has(index) ? mine.get(index) : null
      const showResults = !poll.pollOpen || (poll.pollShowResults && myVote !== null)

      return {
        text: question.text,
        options: question.options,
        myVote,
        results: showResults ? resultsOf(question, counts && counts[index]) : null
      }
    })

    const view = {
      id: String(poll._id),
      question: poll.title,
      details: poll.body,
      image: poll.heroImage,
      signature: poll.signature,
      authorName: poll.authorName,
      questions,
      // everything answered; false means there is still something to vote on.
      voted: questions.every(question => question.myVote !== null),
      open: poll.pollOpen,
      postedAt: poll.postedAt,
      commentsEnabled: poll.commentsEnabled,
      commentCount: poll.comments.filter(comment => comment.status === 'approved').length
    }

    if (withComments) {
      view.comments = poll.comments
        .filter(comment => comment.status === 'approved')
        .map(comment => ({ fairyName: comment.fairyName, body: comment.body, postedAt: comment.postedAt }))
    }

    return view
  }

  // poll id -> (question -> the option this account picked)
  async function myVotes (account, ids) {
    const byPoll = new Map(ids.map(id => [id, new Map()]))
    if (!account) return byPoll

    const votes = await SitePollVote.find({ accountId: account._id, pollId: { $in: ids } })
    for (const vote of votes) byPoll.get(vote.pollId).set(vote.question || 0, vote.option)
    return byPoll
  }

  // players

  // the page: every open poll, and the closed ones, newest first, a page at a time.
  app.get('/fairies/api/pixie-polls', async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)

    const [open, closedTotal] = await Promise.all([
      BlogEntry.find({ feed: 'polls', status: 'published', pollOpen: true }).sort({ postedAt: -1 }).limit(20),
      BlogEntry.countDocuments({ feed: 'polls', status: 'published', pollOpen: false })
    ])
    const closed = await BlogEntry.find({ feed: 'polls', status: 'published', pollOpen: false })
      .sort({ postedAt: -1 }).skip((page - 1) * PAST_PER_PAGE).limit(PAST_PER_PAGE)

    const shown = [...open, ...closed]
    const ids = shown.map(poll => String(poll._id))
    const [counts, mine] = await Promise.all([tallies(ids), myVotes(await viewer(req), ids)])

    const view = poll => viewOf(poll, { counts: counts.get(String(poll._id)), mine: mine.get(String(poll._id)) })

    res.send({
      current: open.map(view),
      past: closed.map(view),
      page,
      perPage: PAST_PER_PAGE,
      pages: Math.max(1, Math.ceil(closedTotal / PAST_PER_PAGE)),
      total: closedTotal
    })
  })

  app.get('/fairies/api/pixie-polls/:id', async (req, res) => {
    const poll = await BlogEntry.findById(req.params.id).catch(() => null)
    if (!poll || poll.feed !== 'polls' || poll.status !== 'published') {
      return res.status(404).send({ message: 'No such poll.' })
    }

    const id = String(poll._id)
    const [counts, mine] = await Promise.all([tallies([id]), myVotes(await viewer(req), [id])])

    res.send(viewOf(poll, { counts: counts.get(id), mine: mine.get(id), withComments: true }))
  })

  app.post('/fairies/api/pixie-polls/:id/vote', express.json(), async (req, res) => {
    const account = await viewer(req)
    if (!account) return res.status(401).send({ error: 'NOT_LOGGED_IN', message: 'Please log in to vote.' })

    if (account.banned) {
      return res.status(403).send({ error: 'ON_HOLD', message: 'This account is on hold, so it cannot vote right now.' })
    }

    const poll = await BlogEntry.findById(req.params.id).catch(() => null)
    if (!poll || poll.feed !== 'polls' || poll.status !== 'published') {
      return res.status(404).send({ error: 'NO_POLL', message: 'That poll could not be found.' })
    }
    if (!poll.pollOpen) {
      return res.status(403).send({ error: 'CLOSED', message: 'This poll is closed, so it is not taking any more votes.' })
    }

    const questions = questionsOf(poll)
    const id = String(poll._id)
    const answers = Array.isArray(req.body.answers) ? req.body.answers : [req.body.option]

    const already = (await myVotes(account, [id])).get(id)
    const missing = questions.map((_, index) => index).filter(index => !already.has(index))

    if (!missing.length) {
      return res.status(409).send({ error: 'ALREADY_VOTED', message: 'You have already voted in this poll.' })
    }

    const chosen = []
    for (const index of missing) {
      const given = answers[index]
      const option = given === null || given === undefined || given === '' ? NaN : Number(given)

      if (!Number.isInteger(option) || option < 0 || option >= questions[index].options.length) {
        const message = questions.length === 1 ? 'Please pick one of the answers.' : 'Please answer every question.'
        return res.status(400).send({ error: 'BAD_OPTION', message })
      }
      chosen.push({ pollId: id, accountId: account._id, question: index, option })
    }

    const key = `account:${account._id}`
    if (!votesPerHour.hasRoom(key)) {
      return res.status(429).send({ error: 'TOO_MANY', message: 'That is a lot of votes. Please try again a little later.' })
    }
    votesPerHour.record(key)

    try {
      await SitePollVote.insertMany(chosen)
    } catch (e) {
      if (e && (e.code === 11000 || (e.writeErrors && e.writeErrors.some(w => w.code === 11000)))) {
        return res.status(409).send({ error: 'ALREADY_VOTED', message: 'You have already voted in this poll.' })
      }
      throw e
    }

    const [counts, mine] = await Promise.all([tallies([id]), myVotes(account, [id])])
    const fresh = viewOf(poll, { counts: counts.get(id), mine: mine.get(id) })

    res.send({ success: true, voted: fresh.voted, questions: fresh.questions })
  })

  // staff

  app.post('/fairies/api/gm/polls/:id/open', express.json(), async (req, res) => {
    const account = await requireStaff(req, res)
    if (!account) return

    const poll = await BlogEntry.findById(req.params.id).catch(() => null)
    if (!poll || poll.feed !== 'polls') return res.status(404).send({ message: 'No such poll.' })

    poll.pollOpen = Boolean(req.body.open)
    poll.updatedAt = new Date()
    await poll.save()

    console.log(`[polls] ${account.username} ${poll.pollOpen ? 'opened' : 'closed'} "${poll.title}"`)
    res.send({ success: true, open: poll.pollOpen })
  })

  return { resultsFor, hasVotes, deleteVotesFor, questionsOf, MIN_OPTIONS, MAX_OPTIONS, OPTION_MAX, MAX_QUESTIONS, QUESTION_MAX }
}
