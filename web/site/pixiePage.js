(function () {
  const byId = id => document.getElementById(id)

  // talent names as the profile showed them. Ids are Fairy.talent.
  const talents = { 1: 'Animal', 2: 'Garden', 3: 'Light', 4: 'Water', 5: 'Tinker' }

  // pixiepages/<address> is the shape the game itself linked to
  function wantedAddress () {
    const query = new URLSearchParams(window.location.search).get('at')
    if (query) return query
    const last = window.location.pathname.split('/').filter(Boolean).pop() || ''
    return last.endsWith('.html') ? '' : last
  }

  // the art when the badge has some, and its name under it either way
  function showBadge (slot, badge) {
    slot.replaceChildren()
    if (!badge) {
      slot.textContent = 'None yet'
      return
    }

    if (badge.icon) {
      const art = document.createElement('img')
      art.src = badge.icon
      art.alt = badge.name
      slot.append(art)
    }

    const caption = document.createElement('span')
    caption.className = 'badgeCaption'
    caption.textContent = badge.name
    slot.append(caption)
  }

  async function load () {
    let address = wantedAddress()
    if (!address) return byId('pageMissing').removeAttribute('hidden')

    // 'My Fairy' in the navigation points here without an address
    if (address === 'me') {
      const mine = await fetch('/fairies/api/mypage', { credentials: 'include' }).catch(() => null)

      if (!mine || !mine.ok) {
        const missing = byId('pageMissing')
        missing.querySelector('h1').textContent = 'Which fairy?'
        missing.querySelector('p').textContent = 'Log in and this will take you to your own Pixie Page.'
        return missing.removeAttribute('hidden')
      }

      address = (await mine.json()).address
      return window.location.replace('/pixiepages/' + encodeURIComponent(address) + window.location.search)
    }

    const res = await fetch('/fairies/api/pixiepage/' + encodeURIComponent(address)).catch(() => null)
    if (!res || !res.ok) return byId('pageMissing').removeAttribute('hidden')

    const fairy = await res.json()

    // her theme decides both panel colors and which of the seven leaves the tabs wear
    const theme = fairy.theme || {}
    const root = document.documentElement
    if (theme.primary) root.style.setProperty('--panelPrimary', theme.primary)
    if (theme.secondary) root.style.setProperty('--panelSecondary', theme.secondary)
    root.style.setProperty('--leafPrimary', `url("/site/img/pixiepage/leafPrimary${theme.id || 1}.svg")`)
    root.style.setProperty('--leafSecondary', `url("/site/img/pixiepage/leafSecondary${theme.id || 1}.svg")`)

    document.title = fairy.name + "'s Pixie Page"
    byId('pixieName').textContent = fairy.name
    byId('pixieAddress').textContent = fairy.readableAddress

    // both renders are asked for at twice their display size
    const full = byId('pixieFairy')
    full.src = '/fairies-render/render/' + fairy.id + '/full?scale=2'
    full.alt = fairy.name

    byId('pixieHome').src = '/fairies-render/render/' + fairy.id + '/home?scale=2'

    // the bust on the print panel's corner, also at twice its display size.
    const bust = byId('printBust')
    bust.src = '/fairies-render/render/' + fairy.id + '?scale=1.4'
    bust.alt = fairy.name

    byId('pixieArrived').textContent = new Date(fairy.arrived)
      .toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
    byId('pixieTalent').textContent = talents[fairy.talent] || 'Unknown'
    byId('pixieBadges').textContent = fairy.badgesEarned
    showBadge(byId('pixieFavoriteBadge'), fairy.favoriteBadge)
    showBadge(byId('pixieLatestBadge'), fairy.latestBadge)

    const games = byId('pixieGames')
    games.replaceChildren()
    for (const game of fairy.games) {
      const item = document.createElement('li')
      item.textContent = game.name + ' - played ' + game.played + (game.played === 1 ? ' time' : ' times') +
        (game.best ? ', best score ' + game.best : '')
      games.appendChild(item)
    }
    if (!fairy.games.length) {
      const none = document.createElement('li')
      none.textContent = 'No games played yet.'
      games.appendChild(none)
    }

    const bio = byId('pixieBio')
    bio.replaceChildren()
    for (const row of fairy.bio) {
      const pair = document.createElement('div')
      const term = document.createElement('dt')
      term.textContent = row.question
      const value = document.createElement('dd')
      value.textContent = row.answer
      pair.append(term, value)
      bio.appendChild(pair)
    }

    // A fairy who has answered nothing gets no inset rather than an empty box.
    bio.closest('.panelInset').hidden = !fairy.bio.length

    byId('pageBody').removeAttribute('hidden')

    setUpPrinting(fairy)

    loadPoll(address)
    loadQuiz(address)
    loadPickers(address)
    loadGuestbook(address)
  }


  // her guestbook

  let guestbookPhrases = []

  async function loadGuestbook (address) {
    const list = byId('guestbook')
    const note = byId('signNote')

    const res = await fetch('/fairies/api/pixiepage/' + encodeURIComponent(address) + '/guestbook', {
      credentials: 'include'
    }).catch(() => null)
    if (!res || !res.ok) return

    const { yours, entries } = await res.json()

    list.replaceChildren()

    for (const entry of entries) {
      const item = document.createElement('li')
      item.className = 'messageCard signed'

      const text = document.createElement('span')
      text.className = 'messageText'

      const words = document.createElement('span')
      words.className = 'messageWords'
      words.textContent = entry.words

      const from = document.createElement('span')
      from.className = 'messageFrom'
      from.textContent = '- ' + entry.from + (entry.fromAddress ? ' · ' + entry.fromAddress : '')

      const when = document.createElement('span')
      when.className = 'messageWhen'
      when.textContent = new Date(entry.signed)
        .toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })

      text.append(words, from, when)
      item.appendChild(text)

      if (yours) {
        const remove = document.createElement('button')
        remove.type = 'button'
        remove.className = 'signRemove'
        remove.title = 'Remove this message'
        remove.textContent = '×'
        remove.addEventListener('click', async () => {
          await fetch('/fairies/api/pixiepage/' + encodeURIComponent(address) +
            '/guestbook/' + encodeURIComponent(entry.id) + '/remove', {
            method: 'POST',
            credentials: 'include'
          }).catch(() => null)
          loadGuestbook(address)
        })
        item.appendChild(remove)
      }

      list.appendChild(item)
    }

    if (!entries.length) {
      note.hidden = false
      note.textContent = yours ? 'No one has signed your guestbook yet.' : 'No messages yet - be the first.'
    } else {
      note.hidden = true
    }

    setUpSigning(address)
  }

  async function setUpSigning (address) {
    const form = byId('signForm')
    if (form.dataset.ready) return

    const res = await fetch('/fairies/api/pixiepage/' + encodeURIComponent(address) + '/guestbook/choices', {
      credentials: 'include'
    }).catch(() => null)
    if (!res || !res.ok) return

    const choices = await res.json()
    guestbookPhrases = choices.phrases

    if (!choices.canSign) {
      // silent on your own page: the panel is already yours to read.
      if (!choices.ownPage) {
        const note = byId('signNote')
        note.hidden = false
        note.textContent = 'Sign in with a fairy to leave a message.'
      }
      return
    }

    form.dataset.ready = '1'
    form.hidden = false

    const phraseSelect = byId('signPhrase')
    phraseSelect.replaceChildren()

    for (const phrase of guestbookPhrases) {
      const option = document.createElement('option')
      option.value = String(phrase.id)
      // the blank shown as a blank, so the sentence reads as a sentence.
      option.textContent = (phrase.before + '…' + phrase.after).trim()
      phraseSelect.appendChild(option)
    }

    phraseSelect.addEventListener('change', fillWords)
    byId('signWord').addEventListener('change', showPreview)
    fillWords()

    form.addEventListener('submit', async event => {
      event.preventDefault()

      const body = JSON.stringify({
        phraseId: Number(phraseSelect.value),
        wordId: Number(byId('signWord').value)
      })

      const sent = await fetch('/fairies/api/pixiepage/' + encodeURIComponent(address) + '/guestbook', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body
      }).catch(() => null)

      if (sent && sent.ok) return loadGuestbook(address)

      const note = byId('signNote')
      note.hidden = false
      note.textContent = sent && sent.status === 429
        ? 'You have already signed this page today.'
        : 'That message could not be left.'
    })
  }

  function currentPhrase () {
    return guestbookPhrases.find(phrase => phrase.id === Number(byId('signPhrase').value))
  }

  function fillWords () {
    const phrase = currentPhrase()
    const select = byId('signWord')
    select.replaceChildren()

    for (const word of (phrase ? phrase.words : [])) {
      const option = document.createElement('option')
      option.value = String(word.id)
      option.textContent = word.text
      select.appendChild(option)
    }

    showPreview()
  }

  function showPreview () {
    const phrase = currentPhrase()
    const word = phrase && phrase.words.find(one => one.id === Number(byId('signWord').value))

    byId('signPreview').textContent = phrase && word
      ? phrase.before + word.text + phrase.after
      : ''
  }


  // print this fairy and her whole home, or save them as pictures. The game's own Print buttons open this page
  // with ?print=1 and it prints as soon as it has loaded (see printSheet.js)

  function setUpPrinting (fairy) {
    const printButton = byId('printFairy')
    const saveButton = byId('savePng')
    const status = byId('printStatus')
    if (!window.phPrint) return

    const options = {
      fairyId: fairy.id,
      name: fairy.name,
      address: fairy.readableAddress,
      onStatus: (text, bad) => {
        status.textContent = text || ''
        status.hidden = !text
        status.classList.toggle('bad', Boolean(bad))
      }
    }

    const run = (button, job) => async () => {
      printButton.disabled = saveButton.disabled = true
      try { await job(options) } finally { printButton.disabled = saveButton.disabled = false }
    }

    printButton.addEventListener('click', run(printButton, window.phPrint.print))
    saveButton.addEventListener('click', run(saveButton, window.phPrint.save))

    if (new URLSearchParams(window.location.search).get('print') === '1') {
      window.history.replaceState(null, '', window.location.pathname)
      window.phPrint.print(options)
    }
  }


  // editing her own page

  async function loadPickers (address) {
    const res = await fetch('/fairies/api/pixiepage/' + encodeURIComponent(address) + '/choices', {
      credentials: 'include'
    }).catch(() => null)
    if (!res || !res.ok) return

    const choices = await res.json()
    if (!choices.yours) return

    fillPicker(byId('pollChoice'), choices.polls, choices.pollId, poll => poll.question)
    fillPicker(byId('quizChoice'), choices.quizzes, choices.quizId, quiz => quiz.title)

    bindPicker(address, 'pollPicker', 'pollChoice', 'pollId')
    bindPicker(address, 'quizPicker', 'quizChoice', 'quizId')

    const edit = byId('editPage')
    edit.hidden = false
    edit.addEventListener('click', () => {
      const open = byId('pollPicker').hidden
      byId('pollPicker').hidden = !open
      byId('quizPicker').hidden = !open
      edit.textContent = open ? 'Done' : 'Edit Page'
    })
  }

  function fillPicker (select, rows, chosen, label) {
    select.replaceChildren()

    const none = document.createElement('option')
    none.value = ''
    none.textContent = 'None'
    select.appendChild(none)

    for (const row of rows) {
      const option = document.createElement('option')
      option.value = row.id
      option.textContent = label(row)
      if (row.id === chosen) option.selected = true
      select.appendChild(option)
    }
  }

  function bindPicker (address, formId, selectId, field) {
    byId(formId).addEventListener('submit', async event => {
      event.preventDefault()

      const res = await fetch('/fairies/api/pixiepage/' + encodeURIComponent(address) + '/choices', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: byId(selectId).value })
      }).catch(() => null)

      if (res && res.ok) window.location.reload()
    })
  }


  // her poll

  async function loadPoll (address) {
    const res = await fetch('/fairies/api/pixiepage/' + encodeURIComponent(address) + '/poll', {
      credentials: 'include'
    }).catch(() => null)
    if (!res || !res.ok) return

    const { poll } = await res.json()
    if (!poll) return

    byId('pollQuestion').textContent = poll.question

    if (poll.yourAnswer !== null) return showPollResults(poll)

    const list = byId('pollOptions')
    list.replaceChildren()

    poll.options.forEach((option, index) => {
      const item = document.createElement('li')
      const label = document.createElement('label')
      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = 'pollOption'
      radio.value = String(index)
      label.append(radio, document.createTextNode(' ' + option))
      item.appendChild(label)
      list.appendChild(item)
    })

    const form = byId('pollForm')
    form.hidden = false
    form.addEventListener('submit', async event => {
      event.preventDefault()
      const picked = form.querySelector('input[name="pollOption"]:checked')
      if (!picked) return

      await fetch('/fairies/api/pixiepage/' + encodeURIComponent(address) + '/poll/vote', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option: Number(picked.value) })
      }).catch(() => null)

      form.hidden = true
      loadPoll(address)
    })
  }

  function showPollResults (poll) {
    byId('pollForm').hidden = true
    const list = byId('pollResults')
    list.replaceChildren()

    poll.options.forEach((option, index) => {
      const count = poll.counts[index] || 0
      const share = poll.total ? Math.round((count / poll.total) * 100) : 0

      const item = document.createElement('li')
      if (index === poll.yourAnswer) item.className = 'yourAnswer'

      const label = document.createElement('span')
      label.className = 'pollOptionName'
      label.textContent = option

      const bar = document.createElement('span')
      bar.className = 'pollBar'
      const fill = document.createElement('span')
      fill.style.width = share + '%'
      bar.appendChild(fill)

      const tally = document.createElement('span')
      tally.className = 'pollTally'
      tally.textContent = share + '%'

      item.append(label, bar, tally)
      list.appendChild(item)
    })

    list.hidden = false
  }

  // her quiz

  async function loadQuiz (address) {
    const res = await fetch('/fairies/api/pixiepage/' + encodeURIComponent(address) + '/quiz').catch(() => null)
    if (!res || !res.ok) return

    const { quiz } = await res.json()
    if (!quiz || !quiz.questions.length) return

    byId('quizIntro').textContent = quiz.intro || quiz.title
    byId('quizStartRow').hidden = false
    byId('quizStart').addEventListener('click', () => runQuiz(quiz))
  }

  function runQuiz (quiz) {
    const body = byId('quizBody')
    const picks = []
    let at = 0

    byId('quizStartRow').hidden = true
    body.hidden = false

    function askNext () {
      body.replaceChildren()

      if (at >= quiz.questions.length) return showQuizResult()

      const question = quiz.questions[at]
      const heading = document.createElement('p')
      heading.className = 'quizQuestion'
      heading.textContent = question.text
      body.appendChild(heading)

      const list = document.createElement('ul')
      list.className = 'quizAnswers'

      for (const answer of question.answers) {
        const item = document.createElement('li')
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'quizAnswer'
        button.textContent = answer.text
        button.addEventListener('click', () => {
          picks.push(answer.resultId)
          at++
          askNext()
        })
        item.appendChild(button)
        list.appendChild(item)
      }

      body.appendChild(list)
    }

    function showQuizResult () {
      const counts = new Map()
      for (const id of picks) counts.set(id, (counts.get(id) || 0) + 1)

      let winner = quiz.results[0]
      let best = -1
      for (const result of quiz.results) {
        const score = counts.get(result.id) || 0
        if (score > best) { best = score; winner = result }
      }

      body.replaceChildren()

      const title = document.createElement('p')
      title.className = 'quizResultTitle'
      title.textContent = winner.title

      const text = document.createElement('p')
      text.className = 'quizResultText'
      text.textContent = winner.text

      const again = document.createElement('button')
      again.type = 'button'
      again.className = 'pixieButton'
      again.textContent = 'Take it again'
      again.addEventListener('click', () => runQuiz(quiz))

      const row = document.createElement('p')
      row.className = 'center'
      row.appendChild(again)

      body.append(title, text, row)
    }

    askNext()
  }

  // Unused for now. My Messages is meant to be a guestbook, not the post
  // office -- see the plan. Kept because the postcard reader works and the
  // mail has to surface somewhere eventually.
  // eslint-disable-next-line no-unused-vars
  async function loadMessages (address) {
    const list = byId('messageList')
    const note = byId('messagesNote')

    const res = await fetch('/fairies/api/pixiepage/' + encodeURIComponent(address) + '/messages', {
      credentials: 'include'
    }).catch(() => null)
    if (!res || !res.ok) return

    const body = await res.json()

    if (!body.yours) {
      note.textContent = 'Postcards are just for the fairy they were sent to.'
      return
    }

    if (!body.messages.length) {
      note.textContent = 'No postcards yet.'
      return
    }

    note.textContent = body.messages.length === 1 ? '1 postcard' : body.messages.length + ' postcards'

    for (const message of body.messages) {
      const item = document.createElement('li')
      item.className = 'messageCard'

      if (message.image) {
        const picture = document.createElement('img')
        picture.className = 'messagePicture'
        picture.src = message.image
        picture.alt = ''
        item.appendChild(picture)
      }

      const text = document.createElement('span')
      text.className = 'messageText'

      const words = document.createElement('span')
      words.className = 'messageWords'
      words.textContent = message.words || (message.type === 5 ? 'A gift set' : 'A postcard')

      const from = document.createElement('span')
      from.className = 'messageFrom'
      from.textContent = 'From ' + message.from + (message.fromAddress ? ' · ' + message.fromAddress : '')

      const when = document.createElement('span')
      when.className = 'messageWhen'
      when.textContent = new Date(message.sent).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })

      text.append(words, from, when)
      item.appendChild(text)
      list.appendChild(item)
    }
  }

  load()
})()
