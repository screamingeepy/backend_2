;(function () {
  const { element, formatWhen } = window.tickets

  const root = document.getElementById('pollPage')
  if (!root) return

  const pageUrl = location.pathname
  const art = name => `/publish/images/polls/${name}`

  function currentView () {
    const params = new URLSearchParams(location.search)
    return { id: params.get('poll'), page: Math.max(Number(params.get('page')) || 1, 1) }
  }

  function goTo (params) {
    const query = new URLSearchParams()
    if (params.id) query.set('poll', params.id)
    if (params.page && params.page > 1) query.set('page', params.page)

    history.pushState(null, '', query.toString() ? `${pageUrl}?${query}` : pageUrl)
    render()
  }

  async function getJson (url) {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) return null
    return res.json().catch(() => null)
  }

  function say (text) {
    root.replaceChildren(element('p', 'newsEmpty', text))
  }

  function picture (name, className) {
    const img = element('img', className)
    img.src = art(name)
    img.alt = ''
    img.addEventListener('error', () => img.remove())
    return img
  }

  // the top image a poll's author picked, if any.
  function hero (poll, className) {
    if (!poll.image) return null

    const img = element('img', className)
    img.src = poll.image
    img.alt = ''
    img.addEventListener('error', () => img.remove())
    return img
  }

  function signature (poll) {
    if (!poll.signature) return null

    const img = element('img', 'pollSignature')
    img.src = poll.signature
    img.alt = poll.authorName ? `${poll.authorName}'s signature` : ''
    img.addEventListener('error', () => img.remove())
    return img
  }

  // results

  const isMulti = poll => poll.questions.length > 1

  // one row per answer: the answer, a bar as wide as its share, and the percent.
  function resultRows (question, small) {
    const list = element('ul', 'pollResults' + (small ? ' small' : ''))
    const top = Math.max(1, ...question.results.options.map(option => option.percent))

    question.results.options.forEach((option, index) => {
      const row = element('li', index === question.myVote ? 'mine' : '')
      row.appendChild(element('span', 'pollAnswer', option.text))

      const track = element('span', 'pollTrack')
      const bar = element('span', 'pollBar')
      bar.style.width = `${Math.max(option.votes ? 2 : 0, option.percent / top * 100)}%`
      track.appendChild(bar)
      row.appendChild(track)
      row.appendChild(element('span', 'pollPercent', `${option.percent}%`))
      list.appendChild(row)
    })

    return list
  }

  function totalLine (question) {
    const total = question.results.total
    return element('p', 'pollTotal', total === 1 ? '1 vote' : `${total} votes`)
  }

  // A question with its results, for a poll that is closed or already voted on.
  function resultsBlock (poll, question, small) {
    const block = element('div', 'pollQuestion')
    if (isMulti(poll)) block.appendChild(element('h4', 'pollQuestionText', question.text))
    block.appendChild(resultRows(question, small))
    block.appendChild(totalLine(question))
    return block
  }

  // voting

  function thanks (poll) {
    const box = element('div', 'pollThanks')
    box.appendChild(element('p', 'pollThanksBig', 'Thanks for voting!'))

    const shown = poll.questions.filter(question => question.results)
    if (shown.length) {
      shown.forEach(question => box.appendChild(resultsBlock(poll, question)))
    } else {
      box.appendChild(element('p', 'pollThanksSmall', 'Check back soon for results!'))
    }
    return box
  }

  function voteForm (poll, me, onVoted) {
    const form = element('form', 'pollForm')
    form.noValidate = true

    // questions already answered (when staff added more since) are not asked again.
    const waiting = poll.questions.map((question, index) => ({ question, index })).filter(item => item.question.myVote === null)

    if (waiting.length < poll.questions.length) {
      form.appendChild(element('p', 'pollNewQuestions', 'There are new questions since you last voted!'))
    }

    waiting.forEach(({ question, index }) => {
      const group = element('fieldset', 'pollQuestion')
      if (isMulti(poll)) group.appendChild(element('legend', 'pollQuestionText', question.text))

      const list = element('ul', 'pollChoices')
      question.options.forEach((text, option) => {
        const item = element('li')
        const label = element('label')
        const input = element('input')
        input.type = 'radio'
        input.name = `poll-${poll.id}-${index}`
        input.value = String(option)
        label.append(input, element('span', '', text))
        item.appendChild(label)
        list.appendChild(item)
      })
      group.appendChild(list)
      form.appendChild(group)
    })

    const message = element('p', 'formMessage')
    message.setAttribute('role', 'alert')
    form.appendChild(message)

    const actions = element('p', 'pollActions')

    if (!me) {
      const login = element('a', 'btnGold', 'Log in to vote')
      login.href = '#'
      login.dataset.login = ''
      actions.appendChild(login)
      form.appendChild(actions)
      return form
    }

    const vote = element('button', 'btnGold', 'Vote')
    vote.type = 'submit'
    actions.appendChild(vote)
    form.appendChild(actions)

    form.addEventListener('submit', async event => {
      event.preventDefault()

      const answers = poll.questions.map(() => null)
      for (const { index } of waiting) {
        const chosen = form.querySelector(`input[name="poll-${poll.id}-${index}"]:checked`)
        if (!chosen) {
          message.textContent = waiting.length > 1 ? 'Please answer every question first.' : 'Please pick an answer first.'
          return
        }
        answers[index] = Number(chosen.value)
      }

      vote.disabled = true
      message.textContent = ''

      const res = await fetch(`/fairies/api/pixie-polls/${encodeURIComponent(poll.id)}/vote`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers })
      })
      const body = await res.json().catch(() => ({}))

      if (res.ok && body.success) {
        poll.questions = body.questions
        poll.voted = body.voted
        onVoted()
      } else {
        message.textContent = body.message || 'Your vote could not be sent. Please try again later.'
        vote.disabled = false
        if (body.error === 'ALREADY_VOTED') onVoted(true)
      }
    })

    return form
  }

  // the open poll

  function currentCard (poll, me) {
    const card = element('section', 'pollCard')

    const head = element('div', 'pollHead')
    head.appendChild(picture('feather_ink.png', 'pollFeather'))
    head.appendChild(element('h2', '', poll.question))
    card.appendChild(head)

    const heroImage = hero(poll, 'pollHero')
    if (heroImage) card.appendChild(heroImage)

    if (poll.details) {
      const details = element('div', 'pollDetails')
      details.innerHTML = poll.details
      card.appendChild(details)
    }

    const sig = signature(poll)
    if (sig) card.appendChild(sig)

    const body = element('div', 'pollBody')
    card.appendChild(body)

    const draw = async refetch => {
      if (refetch) {
        const fresh = await getJson(`/fairies/api/pixie-polls/${encodeURIComponent(poll.id)}`)
        if (fresh) Object.assign(poll, fresh)
      }
      body.replaceChildren(poll.voted ? thanks(poll) : voteForm(poll, me, draw))
    }
    draw()

    card.appendChild(commentsLink(poll))
    return card
  }

  function commentsLink (poll) {
    const link = element('a', 'pollCommentsLink')
    link.href = `${pageUrl}?poll=${encodeURIComponent(poll.id)}`
    link.textContent = poll.commentsEnabled
      ? (poll.commentCount === 1 ? '1 comment' : `${poll.commentCount} comments`)
      : 'comments'
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
      event.preventDefault()
      goTo({ id: poll.id })
    })
    return link
  }

  // past polls

  function pastCard (poll) {
    const card = element('section', 'pastPoll')

    const head = element('div', 'pollHead')
    head.appendChild(picture('feather_ink.png', 'pollFeather small'))
    head.appendChild(element('h3', '', poll.question))
    card.appendChild(head)

    const heroImage = hero(poll, 'pollHero small')
    if (heroImage) card.appendChild(heroImage)

    // A closed poll always carries its results.
    poll.questions.forEach(question => card.appendChild(resultsBlock(poll, question, true)))

    const foot = element('div', 'pollFoot')
    foot.appendChild(commentsLink(poll))
    card.appendChild(foot)
    return card
  }

  function pager (data) {
    if (data.pages <= 1) return null

    const box = element('div', 'newsPager')
    const first = (data.page - 1) * data.perPage + 1
    const last = Math.min(data.page * data.perPage, data.total)

    const prev = element('button', 'newsArrow prev')
    prev.type = 'button'
    prev.setAttribute('aria-label', 'Newer polls')
    prev.disabled = data.page <= 1
    prev.addEventListener('click', () => goTo({ page: data.page - 1 }))

    const next = element('button', 'newsArrow next')
    next.type = 'button'
    next.setAttribute('aria-label', 'Older polls')
    next.disabled = data.page >= data.pages
    next.addEventListener('click', () => goTo({ page: data.page + 1 }))

    box.append(prev, element('span', 'newsRange', `${first}-${last} of ${data.total}`), next)
    return box
  }

  async function renderIndex (page) {
    say('Fetching the polls…')

    const data = await getJson(`/fairies/api/pixie-polls?page=${page}`)
    if (!data) return say('This page is currently unavailable. Please try again later.')

    const me = window.site ? await window.site.loadMe() : null
    const parts = [picture('pixie_dust.png', 'pollDust')]

    if (data.current.length) {
      data.current.forEach(poll => parts.push(currentCard(poll, me)))
    } else {
      parts.push(element('p', 'newsEmpty', 'There is no poll open right now. Check back soon!'))
    }

    if (data.past.length) {
      parts.push(picture('vine_long.png', 'pollVine'))
      parts.push(element('h2', 'pollPastTitle', 'Past Polls'))
      data.past.forEach(poll => parts.push(pastCard(poll)))
      const paging = pager(data)
      if (paging) parts.push(paging)
    }

    root.replaceChildren(...parts)
  }

  // one poll, with its comments

  async function renderPoll (id) {
    say('Fetching the poll…')

    const poll = await getJson(`/fairies/api/pixie-polls/${encodeURIComponent(id)}`)
    if (!poll) {
      say('That poll could not be found.')
      return
    }

    const me = window.site ? await window.site.loadMe() : null

    const back = element('p', 'newsThreadNav')
    const link = element('a', '', '‹ Back to Pixie Polls')
    link.href = pageUrl
    link.addEventListener('click', event => {
      event.preventDefault()
      goTo({})
    })
    back.appendChild(link)

    const card = poll.open ? currentCard(poll, me) : pastCard(poll)
    card.querySelectorAll('.pollCommentsLink').forEach(node => node.remove())

    const posted = element('p', 'pollPosted', `Posted ${formatWhen(poll.postedAt)}`)
    const comments = await window.newsComments.section('polls', poll.id, poll)

    root.replaceChildren(back, card, posted, element('div', 'newsVine'), comments)
  }

  function render () {
    const view = currentView()
    if (view.id) renderPoll(view.id)
    else renderIndex(view.page)
  }

  window.addEventListener('popstate', render)
  render()
})()
