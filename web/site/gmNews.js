(function () {
  const byId = id => document.getElementById(id)
  const { element, formatWhen } = window.tickets

  const newsUrl = '/fairies/api/gm/news'
  const assetsUrl = '/fairies/api/gm/news-assets'
  const uploadsUrl = '/fairies/api/gm/news-uploads'
  const commentsUrl = '/fairies/api/gm/news-comments'

  const feedNames = { nevernews: 'Never News', knownissues: 'Known Issues', events: 'Events', contests: 'Contests', polls: 'Pixie Polls' }

  let currentFeed = 'nevernews'
  let assets = { images: [], signatures: [] }
  let editingId = null

  async function getJson (url) {
    const res = await fetch(url, { credentials: 'include' })
    return { res, body: res.ok ? await res.json().catch(() => null) : null }
  }

  async function postJson (url, data) {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    return { res, body: await res.json().catch(() => ({})) }
  }

  // asset pickers

  const thumbForUrl = new Map()

  function fillImageSelect (select, firstLabel) {
    select.replaceChildren()
    select.appendChild(new Option(firstLabel, ''))

    assets.images.forEach(group => {
      const optgroup = document.createElement('optgroup')
      optgroup.label = group.label
      group.items.forEach(item => {
        thumbForUrl.set(item.url, item.thumbUrl)
        optgroup.appendChild(new Option(item.label, item.url))
      })
      select.appendChild(optgroup)
    })
  }

  function fillSignatureSelect (select) {
    select.replaceChildren()
    select.appendChild(new Option('No signature', ''))

    assets.signatures.forEach(group => {
      const optgroup = document.createElement('optgroup')
      optgroup.label = group.label
      group.items.forEach(item => optgroup.appendChild(new Option(item.label, item.url)))
      select.appendChild(optgroup)
    })
  }

  function showPreview (img, url) {
    img.hidden = !url
    if (url) img.src = url
  }

  function selectValue (select, url) {
    if (!url) {
      select.value = ''
      return
    }
    if (!Array.from(select.options).some(option => option.value === url)) {
      const custom = document.createElement('optgroup')
      custom.label = 'This post'
      custom.appendChild(new Option(url.split('/').pop(), url))
      select.appendChild(custom)
    }
    select.value = url
  }

  async function loadAssets () {
    const { body } = await getJson(assetsUrl)
    if (!body) return

    assets = body
    fillImageSelect(byId('newsHeroPick'), 'No image')
    fillImageSelect(byId('newsThumbPick'), 'Same as top image')
    fillSignatureSelect(byId('newsSigPick'))
  }

  async function uploadFile (kind, file, note) {
    note.textContent = 'Uploading…'

    const res = await fetch(`${uploadsUrl}?kind=${kind}&name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file
    })
    const body = await res.json().catch(() => ({}))

    if (!res.ok || !body.success) {
      note.textContent = body.message || 'That file could not be uploaded.'
      return null
    }

    note.textContent = `Uploaded ${file.name}.`
    await loadAssets() // so the new file is a normal library choice from now on
    return body.url
  }

  byId('newsHeroUpload').addEventListener('change', async event => {
    const file = event.target.files[0]
    if (!file) return

    const url = await uploadFile('newsImage', file, byId('newsHeroUploadNote'))
    event.target.value = ''
    if (!url) return

    selectValue(byId('newsHeroPick'), url)
    byId('newsHeroPick').dispatchEvent(new Event('change'))
  })

  byId('newsSigUpload').addEventListener('change', async event => {
    const file = event.target.files[0]
    if (!file) return

    const url = await uploadFile('signature', file, byId('newsSigUploadNote'))
    event.target.value = ''
    if (!url) return

    selectValue(byId('newsSigPick'), url)
    byId('newsSigPick').dispatchEvent(new Event('change'))
  })

  byId('newsHeroPick').addEventListener('change', event => {
    const url = event.target.value
    showPreview(byId('newsHeroPreview'), url)

    // an untouched thumbnail follows the hero's own paired thumb.
    const thumbPick = byId('newsThumbPick')
    if (!thumbPick.value) showPreview(byId('newsThumbPreview'), thumbForUrl.get(url) || url)
  })

  byId('newsThumbPick').addEventListener('change', event => {
    const hero = byId('newsHeroPick').value
    const url = event.target.value || thumbForUrl.get(hero) || hero
    showPreview(byId('newsThumbPreview'), url)
  })

  byId('newsSigPick').addEventListener('change', event => {
    showPreview(byId('newsSigPreview'), event.target.value)
  })

  // body toolbar

  const toolbarButtons = [
    { label: 'Bold', open: '<b>', close: '</b>' },
    { label: 'Italic', open: '<i>', close: '</i>' },
    { label: 'Paragraph', open: '<p>', close: '</p>' },
    { label: 'List', open: '<ul>\n  <li>', close: '</li>\n</ul>' },
    { label: 'Link', link: true },
    { label: 'Image', image: true }
  ]

  function wrapSelection (open, close) {
    const input = byId('newsEditorBody')
    const { selectionStart: start, selectionEnd: end, value } = input

    input.value = value.slice(0, start) + open + value.slice(start, end) + close + value.slice(end)
    input.focus()
    input.selectionStart = start + open.length
    input.selectionEnd = end + open.length
  }

  function buildToolbar () {
    const bar = byId('newsToolbar')
    bar.replaceChildren()

    toolbarButtons.forEach(spec => {
      const button = element('button', 'newsToolButton', spec.label)
      button.type = 'button'
      button.addEventListener('click', () => {
        if (spec.link) {
          const href = prompt('Link to where?', 'https://')
          if (href) wrapSelection(`<a href="${href.replace(/"/g, '')}">`, '</a>')
          return
        }
        if (spec.image) {
          const src = byId('newsHeroPick').value || prompt('Image address?', '/publish/images/nevernews/')
          if (src) wrapSelection(`<img src="${src.replace(/"/g, '')}" alt="" />`, '')
          return
        }
        wrapSelection(spec.open, spec.close)
      })
      bar.appendChild(button)
    })
  }

  // editor

  function toLocalInput (date) {
    const when = new Date(date)
    if (isNaN(when.getTime())) return ''
    return new Date(when.getTime() - when.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  }

  function fillFeedSelect () {
    const select = byId('newsEditorFeed')
    select.replaceChildren()
    Object.entries(feedNames).forEach(([value, label]) => select.appendChild(new Option(label, value)))
  }

  function toDateInput (date) {
    const when = new Date(date)
    return isNaN(when.getTime()) ? '' : when.toISOString().slice(0, 10)
  }

  function fillCalendarIcons (timeType, picked) {
    const select = byId('newsCalIcon')
    const icons = window.calendarIcons ? (timeType === 'contest' ? window.calendarIcons.contest : window.calendarIcons.normal) : []
    select.replaceChildren()
    icons.forEach(([value, label]) => select.appendChild(new Option(label, value)))
    if (picked && icons.some(([value]) => value === picked)) select.value = picked
  }

  function updateCalendarShape () {
    const onEvents = byId('newsEditorFeed').value === 'events'
    const timeType = byId('newsCalTimeType').value

    byId('newsContestFields').hidden = byId('newsEditorFeed').value !== 'contests'
    byId('newsPollFields').hidden = byId('newsEditorFeed').value !== 'polls'
    // polls are not listed with thumbnails, so there is nothing to pick.
    byId('newsThumbRow').hidden = byId('newsEditorFeed').value === 'polls'
    byId('newsCalRow').hidden = !onEvents
    byId('newsCalFields').hidden = !onEvents || !byId('newsCalEnabled').checked
    byId('newsCalEndDateRow').hidden = timeType !== 'thisweek' && timeType !== 'contest'
    fillCalendarIcons(timeType, byId('newsCalIcon').value)
  }

  byId('newsEditorFeed').addEventListener('change', updateCalendarShape)
  byId('newsCalEnabled').addEventListener('change', updateCalendarShape)
  byId('newsCalTimeType').addEventListener('change', updateCalendarShape)

  function calendarFields () {
    if (byId('newsEditorFeed').value !== 'events' || !byId('newsCalEnabled').checked) return { enabled: false }

    const timeType = byId('newsCalTimeType').value

    return {
      enabled: true,
      timeType,
      date: byId('newsCalDate').value,
      endDate: (timeType === 'thisweek' || timeType === 'contest') ? (byId('newsCalEndDate').value || undefined) : undefined,
      type: byId('newsCalIcon').value,
      shortTitle: byId('newsCalShortTitle').value.trim(),
      when: byId('newsCalWhen').value.trim(),
      where: byId('newsCalWhere').value.trim()
    }
  }

  function setEditorMessage (text, ok) {
    const message = byId('newsEditorMessage')
    message.className = 'formMessage' + (ok ? ' ok' : '')
    message.textContent = text || ''
  }

  const MAX_POLL_QUESTIONS = 10

  // one question box in the poll editor: its text and four answer boxes.
  function addPollQuestion (question) {
    const holder = byId('newsPollQuestions')
    if (holder.children.length >= MAX_POLL_QUESTIONS) return

    const box = document.createElement('div')
    box.className = 'pollQuestionBox'

    const head = document.createElement('div')
    head.className = 'pollQuestionHead'
    const label = document.createElement('strong')
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'btnGray'
    remove.textContent = 'Remove'
    remove.addEventListener('click', () => {
      if (holder.children.length > 1) box.remove()
      renumberPollQuestions()
    })
    head.append(label, remove)
    box.appendChild(head)

    const text = document.createElement('input')
    text.className = 'textInput pollQuestionText'
    text.maxLength = 200
    text.autocomplete = 'off'
    text.placeholder = 'The question (blank = the headline, if this is the only one)'
    text.value = question && question.text ? question.text : ''
    box.appendChild(text)

    const answers = document.createElement('div')
    answers.className = 'pollAnswers'
    box.appendChild(answers)

    const add = document.createElement('button')
    add.type = 'button'
    add.className = 'btnGray'
    add.textContent = 'Add an answer'
    add.addEventListener('click', () => addPollAnswer(answers, add, ''))
    box.appendChild(add)

    const have = question && question.options ? question.options : []
    for (let i = 0; i < Math.max(4, have.length); i++) addPollAnswer(answers, add, have[i] || '')

    holder.appendChild(box)
    renumberPollQuestions()
  }

  const MAX_POLL_ANSWERS = 10

  function addPollAnswer (answers, addButton, value) {
    if (answers.children.length >= MAX_POLL_ANSWERS) return

    const input = document.createElement('input')
    input.className = 'textInput pollAnswerText'
    input.maxLength = 80
    input.autocomplete = 'off'
    input.placeholder = ['First answer', 'Second answer'][answers.children.length] || `Answer ${answers.children.length + 1}${answers.children.length < 2 ? '' : ' (optional)'}`
    input.value = value
    answers.appendChild(input)
    addButton.hidden = answers.children.length >= MAX_POLL_ANSWERS
  }

  function renumberPollQuestions () {
    const boxes = [...byId('newsPollQuestions').children]
    boxes.forEach((box, i) => {
      box.querySelector('strong').textContent = `Question ${i + 1}`
      box.querySelector('button').hidden = boxes.length < 2
    })
    byId('newsPollAddQuestion').hidden = boxes.length >= MAX_POLL_QUESTIONS
  }

  function showPollResults (results) {
    const holder = byId('newsPollResults')
    holder.replaceChildren()
    if (!results) return

    results.forEach((question, i) => {
      const line = document.createElement('div')
      const votes = `${question.total} ${question.total === 1 ? 'vote' : 'votes'}`
      line.textContent = `${results.length > 1 ? `${i + 1}. ${question.text}: ` : ''}${votes}: ` +
        question.options.map(option => `${option.text} ${option.votes} (${option.percent}%)`).join(' · ')
      holder.appendChild(line)
    })
  }

  function openEditor (entry) {
    editingId = entry ? entry._id : null

    byId('newsEditorTitle').textContent = entry ? 'Edit Post' : 'Write a Post'
    byId('newsEditorFeed').value = entry ? entry.feed : currentFeed
    byId('newsEditorHeadline').value = entry ? entry.title : ''
    byId('newsEditorAuthor').value = entry ? entry.authorName : ''
    byId('newsEditorBody').value = entry ? entry.body : ''
    byId('newsEditorDate').value = toLocalInput(entry ? entry.postedAt : new Date())
    byId('newsEditorComments').checked = entry ? entry.commentsEnabled : false
    byId('newsEditorPublished').checked = entry ? entry.status === 'published' : false
    byId('newsPollOpen').checked = entry ? Boolean(entry.pollOpen) : false
    byId('newsPollShowResults').checked = entry ? Boolean(entry.pollShowResults) : false
    byId('newsPollQuestions').replaceChildren()
    const questions = entry && entry.pollQuestions && entry.pollQuestions.length ? entry.pollQuestions : [{ text: '', options: [] }]
    questions.forEach(question => addPollQuestion(question))
    byId('newsPollResultsRow').hidden = !(entry && entry.pollResults)
    showPollResults(entry && entry.pollResults)
    byId('newsContestOpen').checked = entry ? Boolean(entry.contestOpen) : false
    byId('newsContestAccepts').value = entry && entry.contestAccepts ? entry.contestAccepts : 'either'
    byId('newsContestPerPlayer').value = entry && entry.contestEntriesPerPlayer ? entry.contestEntriesPerPlayer : 1

    const linked = entry && entry.calendar
    byId('newsCalEnabled').checked = Boolean(linked)
    byId('newsCalTimeType').value = linked ? linked.timeType : 'once'
    byId('newsCalDate').value = toDateInput(linked ? linked.date : new Date())
    byId('newsCalEndDate').value = linked && linked.endDate ? toDateInput(linked.endDate) : ''
    fillCalendarIcons(byId('newsCalTimeType').value, linked ? linked.type : 'balloon')
    byId('newsCalShortTitle').value = linked ? linked.shortTitle : ''
    byId('newsCalWhen').value = linked ? linked.when : ''
    byId('newsCalWhere').value = linked ? linked.where : ''
    updateCalendarShape()

    selectValue(byId('newsHeroPick'), entry ? entry.heroImage : '')
    selectValue(byId('newsThumbPick'), entry ? entry.thumbImage : '')
    selectValue(byId('newsSigPick'), entry ? entry.signature : '')
    byId('newsHeroPick').dispatchEvent(new Event('change'))
    byId('newsThumbPick').dispatchEvent(new Event('change'))
    byId('newsSigPick').dispatchEvent(new Event('change'))

    byId('newsDeleteButton').hidden = !entry
    byId('newsLivePreview').hidden = true
    setEditorMessage('')

    byId('newsEditor').hidden = false
    byId('newsEditor').scrollIntoView({ behavior: 'smooth', block: 'start' })
    byId('newsEditorHeadline').focus()
  }

  function closeEditor () {
    editingId = null
    byId('newsEditor').hidden = true
  }

  // someone typing plain paragraphs should not have to write tags for them.
  function asHtml (text) {
    if (/<(p|div|ul|ol|h3|h4|blockquote)\b/i.test(text)) return text

    return text
      .split(/\n{2,}/)
      .map(block => block.trim())
      .filter(Boolean)
      .map(block => `<p>${block.replace(/\n/g, '<br />')}</p>`)
      .join('\n')
  }

  function editorFields () {
    const date = byId('newsEditorDate').value

    return {
      feed: byId('newsEditorFeed').value,
      title: byId('newsEditorHeadline').value.trim(),
      authorName: byId('newsEditorAuthor').value.trim(),
      body: asHtml(byId('newsEditorBody').value),
      heroImage: byId('newsHeroPick').value,
      thumbImage: byId('newsThumbPick').value,
      signature: byId('newsSigPick').value,
      commentsEnabled: byId('newsEditorComments').checked,
      status: byId('newsEditorPublished').checked ? 'published' : 'draft',
      postedAt: date ? new Date(date).toISOString() : undefined,
      calendar: calendarFields(),
      contest: byId('newsEditorFeed').value === 'contests'
        ? {
            open: byId('newsContestOpen').checked,
            accepts: byId('newsContestAccepts').value,
            perPlayer: Number(byId('newsContestPerPlayer').value) || 1
          }
        : undefined,
      poll: byId('newsEditorFeed').value === 'polls'
        ? {
            open: byId('newsPollOpen').checked,
            showResults: byId('newsPollShowResults').checked,
            questions: [...byId('newsPollQuestions').children].map(box => ({
              text: box.querySelector('.pollQuestionText').value.trim(),
              options: [...box.querySelectorAll('.pollAnswerText')].map(input => input.value.trim()).filter(Boolean)
            }))
          }
        : undefined
    }
  }

  byId('newsPollAddQuestion').addEventListener('click', () => addPollQuestion())
  byId('newsNewButton').addEventListener('click', () => openEditor(null))
  byId('newsCancelButton').addEventListener('click', closeEditor)

  byId('newsPreviewButton').addEventListener('click', () => {
    const fields = editorFields()
    const preview = byId('newsLivePreview')
    const article = element('article', 'newsEntry')

    if (fields.heroImage) {
      const hero = element('img', 'newsHero')
      hero.src = fields.heroImage
      hero.alt = ''
      article.appendChild(hero)
    }

    article.appendChild(element('h2', '', fields.title || 'Untitled'))

    const byline = element('p', 'newsByline')
    byline.append(
      element('span', '', `Posted by ${fields.authorName || 'the Pixie Hollow Team'}`),
      element('span', 'newsDate', formatWhen(fields.postedAt || new Date()))
    )
    article.appendChild(byline)

    const body = element('div', 'newsBody')
    body.innerHTML = fields.body
    article.appendChild(body)

    if (fields.signature) {
      const sig = element('img', 'newsSignature')
      sig.src = fields.signature
      sig.alt = ''
      article.appendChild(sig)
    }

    preview.replaceChildren(article)
    preview.hidden = false
    preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })

  byId('newsEditor').addEventListener('submit', async event => {
    event.preventDefault()

    const fields = editorFields()
    if (!fields.title) return setEditorMessage('Please give the post a title.')

    const button = byId('newsSaveButton')
    button.disabled = true
    try {
      const url = editingId ? `${newsUrl}/${editingId}` : newsUrl
      const { res, body } = await postJson(url, fields)

      if (!res.ok || !body.success) {
        setEditorMessage(body.message || `The post could not be saved (${res.status}).`)
        return
      }

      const wasNew = !editingId
      currentFeed = fields.feed
      fillFeedTabs()
      await loadEntries()

      // it's saved now, so the next Post starts another one instead of rewriting this
      if (wasNew) openEditor(null)

      setEditorMessage(fields.status === 'published' ? 'Posted.' : 'Saved as a draft.', true)
    } finally {
      button.disabled = false
    }
  })

  byId('newsDeleteButton').addEventListener('click', async () => {
    if (!editingId) return
    if (!confirm('Delete this post for good? Its comments go with it.')) return

    const { res } = await postJson(`${newsUrl}/${editingId}/delete`, {})
    if (!res.ok) return setEditorMessage('That post could not be deleted.')

    closeEditor()
    await loadEntries()
  })

  // entry list

  function fillFeedTabs () {
    const tabs = byId('newsFeedTabs')
    tabs.replaceChildren()

    Object.entries(feedNames).forEach(([feed, label]) => {
      const tab = element('button', 'gmTab', label)
      tab.type = 'button'
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-selected', String(feed === currentFeed))
      tab.addEventListener('click', () => {
        currentFeed = feed
        fillFeedTabs()
        loadEntries()
      })
      tabs.appendChild(tab)
    })
  }

  function entryRow (entry) {
    const row = element('button', 'newsAdminRow')
    row.type = 'button'

    const thumb = element('img', 'newsAdminThumb')
    if (entry.thumbImage) {
      thumb.src = entry.thumbImage
      thumb.alt = ''
    } else {
      thumb.hidden = true
    }

    const text = element('span', 'newsAdminText')
    text.append(
      element('span', 'newsAdminTitle', entry.title || '(untitled)'),
      element('span', 'newsAdminMeta', `${entry.authorName || 'Pixie Hollow Team'} · ${formatWhen(entry.postedAt)}`)
    )

    const badges = element('span', 'newsAdminBadges')
    badges.appendChild(element('span', 'statusBadge ' + (entry.status === 'published' ? 'done' : 'pending'),
      entry.status === 'published' ? 'Published' : 'Draft'))
    if (entry.feed === 'polls') {
      badges.appendChild(element('span', 'statusBadge ' + (entry.pollOpen ? 'open' : 'done'),
        entry.pollOpen ? 'Open' : 'Closed'))
    }
    if (entry.feed === 'contests') {
      badges.appendChild(element('span', 'statusBadge ' + (entry.contestOpen ? 'open' : 'done'),
        entry.contestOpen ? 'Open' : 'Closed'))
    }
    if (entry.pendingComments) {
      badges.appendChild(element('span', 'statusBadge open',
        `${entry.pendingComments} waiting`))
    }

    row.append(thumb, text, badges)
    row.addEventListener('click', async () => {
      const { body } = await getJson(`${newsUrl}/${entry._id}`)
      if (body) openEditor(body)
    })

    return row
  }

  async function loadEntries () {
    const status = byId('newsStatusPick').value
    const query = `?feed=${currentFeed}${status ? `&status=${status}` : ''}`
    const { body } = await getJson(newsUrl + query)

    const list = byId('newsAdminList')
    if (!body) {
      list.replaceChildren(element('li', 'ticketEmpty', 'The posts could not be loaded.'))
      return
    }
    if (!body.length) {
      list.replaceChildren(element('li', 'ticketEmpty', 'Nothing here yet.'))
      return
    }

    list.replaceChildren()
    body.forEach(entry => {
      const item = document.createElement('li')
      item.appendChild(entryRow(entry))
      list.appendChild(item)
    })
  }

  byId('newsStatusPick').addEventListener('change', loadEntries)

  // comment moderation

  function moderationRow (comment, status) {
    const item = element('li', 'newsModItem')

    const head = element('p', 'newsModHead')
    head.append(
      element('strong', '', comment.fairyName),
      ` · ${feedNames[comment.feed] || comment.feed}: ${comment.entryTitle} · ${formatWhen(comment.postedAt)}`
    )

    const actions = element('p', 'newsModActions')

    function decide (next, label) {
      const button = element('button', 'btnGray', label)
      button.type = 'button'
      button.addEventListener('click', async () => {
        button.disabled = true
        const { res } = await postJson(`${commentsUrl}/${comment.entryId}/${comment.commentId}`, { status: next })
        if (!res.ok) {
          button.disabled = false
          return
        }
        await loadComments()
        await loadEntries()
      })
      return button
    }

    if (status !== 'approved') actions.appendChild(decide('approved', 'Show it'))
    if (status !== 'rejected') actions.appendChild(decide('rejected', 'Hide it'))
    if (status !== 'pending') actions.appendChild(decide('pending', 'Back to waiting'))

    item.append(head, element('p', 'newsModBody', comment.body), actions)
    return item
  }

  async function loadComments () {
    const status = byId('newsCommentStatusPick').value
    const { body } = await getJson(`${commentsUrl}?status=${status}`)

    const list = byId('newsModList')
    const count = byId('newsCommentCount')

    if (!body) {
      list.replaceChildren(element('li', 'ticketEmpty', 'The comments could not be loaded.'))
      count.textContent = ''
      return
    }

    count.textContent = status === 'pending' && body.length ? String(body.length) : ''

    if (!body.length) {
      list.replaceChildren(element('li', 'ticketEmpty', 'Nothing to read.'))
      return
    }

    list.replaceChildren()
    body.forEach(comment => list.appendChild(moderationRow(comment, status)))
  }

  byId('newsCommentStatusPick').addEventListener('change', loadComments)

  // boot

  document.addEventListener('gmSignedIn', async () => {
    fillFeedSelect()
    fillFeedTabs()
    buildToolbar()
    await loadAssets()
    await loadEntries()
    await loadComments()
  })
})()
