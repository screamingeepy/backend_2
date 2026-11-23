(function () {
  const byId = id => document.getElementById(id)
  const { element, shortId, formatWhen, statusBadge, categoryLabel, renderThread, detailRows, attachmentList } = window.tickets
  let knownEmail = ''

  function setError (fieldId, errorId, message) {
    byId(errorId).textContent = message || ''
    const field = byId(fieldId)
    field.classList.toggle('invalid', Boolean(message))
    if (message) field.setAttribute('aria-describedby', errorId)
    else field.removeAttribute('aria-describedby')
    return !message
  }

  // what each kind of message asks for
  const shapes = {
    bugSite: {
      rows: ['stepsRow', 'expectedRow'],
      details: ['stepsToReproduce', 'expectedBehavior'],
      message: 'Describe the Bug:',
      tip: 'What went wrong, in your own words.'
    },
    bugGame: {
      rows: ['stepsRow', 'expectedRow'],
      details: ['stepsToReproduce', 'expectedBehavior'],
      message: 'Describe the Bug:',
      tip: 'What went wrong, in your own words.'
    },
    memberReport: {
      rows: ['reportedRow', 'incidentWhenRow'],
      details: ['incidentWhen'],
      message: 'What Happened:',
      tip: 'Tell us what they said or did, and where you were.'
    },
    // banReason isn't required, plenty of people appealing don't know it and demanding it
    banAppeal: {
      rows: ['banWhenRow', 'banReasonRow'],
      details: ['banWhen', 'banReason'],
      required: ['banWhen'],
      message: 'Why It Should Be Reviewed:',
      tip: 'Tell us your side in your own words.'
    },
    forgotCredentials: {
      rows: ['usernameRow', 'fairyNameRow', 'accountInfoRow'],
      details: ['username', 'fairyName', 'accountInfo'],
      message: 'Help us identify your account:',
      tip: 'Tell us anything you remember about it.'
    }
  }

  const everyRow = ['reportedRow', 'incidentWhenRow', 'stepsRow', 'expectedRow', 'banWhenRow', 'banReasonRow', 'usernameRow', 'fairyNameRow', 'accountInfoRow']

  const detailPrompts = {
    stepsToReproduce: 'Please tell us how to make it happen.',
    expectedBehavior: 'Please tell us what should have happened instead.',
    incidentWhen: 'Please tell us roughly when this happened.',
    banWhen: 'Please tell us roughly when you lost access.'
  }

  function shapeOf (category) {
    return shapes[category] || { rows: [], details: [], message: 'Message:', tip: '' }
  }

  function applyShape () {
    const shape = shapeOf(byId('category').value)

    for (const row of everyRow) byId(row).hidden = !shape.rows.includes(row)

    byId('messageLabel').textContent = shape.message
    const tip = byId('messageTip')
    tip.textContent = shape.tip
    tip.hidden = !shape.tip
  }

  byId('category').addEventListener('change', applyShape)

  // pictures upload as they are picked
  const MAX_FILES = 10
  const chosenFiles = []

  function renderChosen () {
    const list = byId('ticketFileList')
    list.replaceChildren()

    chosenFiles.forEach((file, index) => {
      const item = element('li')
      const thumb = element('span', 'ticketFile')
      const img = document.createElement('img')
      img.src = file.url
      img.alt = file.name
      thumb.appendChild(img)

      const remove = element('button', 'ticketFileRemove', '×')
      remove.type = 'button'
      remove.title = 'Remove ' + file.name
      remove.setAttribute('aria-label', 'Remove ' + file.name)
      remove.addEventListener('click', () => {
        chosenFiles.splice(index, 1)
        renderChosen()
      })

      item.append(thumb, remove)
      list.appendChild(item)
    })
  }

  function collectDetails () {
    const details = {}
    for (const field of shapeOf(byId('category').value).details) {
      const value = byId(field).value.trim()
      if (value) details[field] = value
    }
    return details
  }

  async function uploadOne (file) {
    const res = await fetch('/fairies/api/support/uploads?name=' + encodeURIComponent(file.name), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || !body.url) throw new Error(body.message || 'That picture would not upload.')
    return { url: body.url, name: body.name || file.name }
  }

  byId('ticketFiles').addEventListener('change', async event => {
    const picker = event.target
    const picked = Array.from(picker.files || [])
    const error = byId('ticketFilesError')
    error.textContent = ''

    for (const file of picked) {
      if (chosenFiles.length >= MAX_FILES) {
        error.textContent = 'That is the most pictures we can take. Remove one to add another.'
        break
      }
      try {
        chosenFiles.push(await uploadOne(file))
        renderChosen()
      } catch (err) {
        error.textContent = err.message
      }
    }

    // clear the picker so choosing the same file twice still fires a change.
    picker.value = ''
  })

  function checkForm () {
    let ok = setError('playerName', 'playerNameError', byId('playerName').value.trim() ? '' : 'Please tell us your Account ID or Fairy name.')
    if (!knownEmail) {
      ok = setError('ticketEmail', 'ticketEmailError', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(byId('ticketEmail').value.trim()) ? '' : 'Please enter a valid e-mail address so we can reply.') && ok
    }
    ok = setError('category', 'categoryError', byId('category').value ? '' : 'Please pick what your message is about.') && ok
    ok = setError('subject', 'subjectError', byId('subject').value.trim() ? '' : 'Please add a subject.') && ok
    ok = setError('message', 'messageError', byId('message').value.trim() ? '' : 'Please write your message.') && ok

    const shape = shapeOf(byId('category').value)
    if (shape.rows.includes('reportedRow')) {
      ok = setError('reportedName', 'reportedNameError', byId('reportedName').value.trim() ? '' : 'Please tell us which Fairy you\'re reporting.') && ok
    }
    for (const field of (shape.required || shape.details)) {
      ok = setError(field, field + 'Error', byId(field).value.trim() ? '' : detailPrompts[field]) && ok
    }

    if (!ok) {
      const bad = byId('ticketForm').querySelector('.invalid')
      if (bad) bad.focus()
    }
    return ok
  }

  byId('ticketForm').addEventListener('submit', async event => {
    event.preventDefault()
    if (!checkForm()) return
    const button = byId('sendButton')
    const message = byId('sendMessage')
    button.disabled = true
    message.textContent = ''
    try {
      const res = await fetch('/fairies/api/support/tickets', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerName: byId('playerName').value.trim(),
          email: knownEmail || byId('ticketEmail').value.trim(),
          category: byId('category').value,
          reportedName: byId('reportedName').value.trim(),
          subject: byId('subject').value.trim(),
          body: byId('message').value.trim(),
          details: collectDetails(),
          attachments: chosenFiles,
          website: byId('website').value
        })
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        message.textContent = body.message || 'Sorry, something\'s not right. Try back later!'
        return
      }
      byId('ticketNumber').textContent = shortId(body._id)
      byId('ticketBox').hidden = true
      byId('sentBox').hidden = false
      byId('anotherButton').focus()
      loadMyTickets()
    } catch (err) {
      message.textContent = 'Sorry, something\'s not right. Try back later!'
    } finally {
      button.disabled = false
    }
  })

  byId('anotherButton').addEventListener('click', () => {
    byId('ticketForm').reset()
    chosenFiles.length = 0
    renderChosen()
    byId('ticketFilesError').textContent = ''
    applyShape()
    fillFromAccount()
    byId('sentBox').hidden = true
    byId('ticketBox').hidden = false
    byId('category').focus()
  })

  function replyPicker () {
    const files = []

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp'
    input.multiple = true
    input.setAttribute('aria-label', 'Add pictures to this message')

    const strip = element('ul', 'ticketFileStrip')
    const error = element('p', 'fieldError')

    function draw () {
      strip.replaceChildren()
      files.forEach((file, index) => {
        const item = element('li')
        const thumb = element('span', 'ticketFile')
        const img = document.createElement('img')
        img.src = file.url
        img.alt = file.name
        thumb.appendChild(img)
        const remove = element('button', 'ticketFileRemove', '×')
        remove.type = 'button'
        remove.setAttribute('aria-label', 'Remove ' + file.name)
        remove.addEventListener('click', () => {
          files.splice(index, 1)
          draw()
        })
        item.append(thumb, remove)
        strip.appendChild(item)
      })
    }

    input.addEventListener('change', async event => {
      error.textContent = ''
      for (const file of Array.from(event.target.files || [])) {
        if (files.length >= MAX_FILES) {
          error.textContent = 'That is the most pictures we can take on one message.'
          break
        }
        try {
          files.push(await uploadOne(file))
          draw()
        } catch (err) {
          error.textContent = err.message
        }
      }
      event.target.value = ''
    })

    const wrap = element('div', 'threadAttach')
    wrap.append(input, strip, error)

    return { node: wrap, files, clear () { files.length = 0; draw() } }
  }

  // reads a thread and draws it
  async function openThread (base, andThen) {
    const thread = byId('ticketThread')
    const res = await fetch(base, { credentials: 'include' })
    if (!res.ok) {
      thread.replaceChildren(element('p', 'formMessage', 'We could not find that message.'))
      thread.hidden = false
      return
    }
    const ticket = await res.json()

    const title = element('h4', 'threadTitle')
    title.append(shortId(ticket._id) + ' ' + ticket.subject + ' ', statusBadge(ticket.status))

    const reply = element('form', 'threadReply')
    const label = element('label', 'modalLabel', 'Add to this message')
    label.htmlFor = 'threadReplyText'
    const text = element('textarea', 'textInput textArea')
    text.id = 'threadReplyText'
    text.rows = 3
    const send = element('button', 'btnGold', 'Send')
    send.type = 'submit'
    const actions = element('p', 'center')
    actions.appendChild(send)
    const picker = replyPicker()
    reply.append(label, text, picker.node, actions)
    reply.addEventListener('submit', async event => {
      event.preventDefault()
      if (!text.value.trim()) return
      send.disabled = true
      await fetch(base + '/reply', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text.value.trim(), attachments: picker.files })
      }).catch(() => null)
      await openThread(base, andThen)
      if (andThen) andThen()
    })

    const parts = [title]

    const rows = detailRows(ticket)
    if (rows.length) {
      const list = element('dl', 'ticketDetails')
      for (const [label, value] of rows) list.append(element('dt', '', label), element('dd', '', value))
      parts.push(list)
    }

    const files = attachmentList(ticket)
    if (files) parts.push(files)

    parts.push(renderThread(ticket.messages), reply)

    thread.replaceChildren(...parts)
    thread.hidden = false
  }

  async function loadMyTickets () {
    const res = await fetch('/fairies/api/support/tickets', { credentials: 'include' }).catch(() => null)
    if (!res || !res.ok) return
    const docs = await res.json()
    const list = byId('ticketList')
    list.replaceChildren()
    if (!docs.length) {
      list.appendChild(element('li', 'ticketEmpty', 'You haven\'t sent any messages yet.'))
    }
    for (const ticket of docs) {
      const item = element('li')
      const button = element('button', 'ticketRow')
      button.type = 'button'
      button.append(
        element('span', 'ticketId', shortId(ticket._id)),
        element('span', 'ticketSubject', ticket.subject),
        element('span', 'ticketMeta', categoryLabel(ticket.category) + ' · ' + formatWhen(ticket.updatedAt)),
        statusBadge(ticket.status)
      )
      button.addEventListener('click', () => openThread('/fairies/api/support/tickets/' + ticket._id, loadMyTickets))
      item.appendChild(button)
      list.appendChild(item)
    }
    byId('myTicketsBox').hidden = false
  }

  async function fillFromAccount () {
    const me = await window.site.loadMe()
    if (!me) return
    if (!byId('playerName').value) byId('playerName').value = me.fairyName || me.username
    knownEmail = me.email || ''
    byId('emailRow').hidden = Boolean(knownEmail)
  }

  applyShape()

  // someone who filed without an account only gets their own thread from the link in
  const query = new URLSearchParams(window.location.search)
  const viewToken = query.get('ticket')

  const wantedIssue = query.get('issue')
  if (wantedIssue && byId('category').querySelector('option[value="' + CSS.escape(wantedIssue) + '"]')) {
    byId('category').value = wantedIssue
    applyShape()
  }

  if (viewToken) {
    byId('ticketBox').hidden = true
    byId('myTicketsBox').hidden = false
    byId('myTicketsBox').querySelector('h3').textContent = 'Your Message'
    byId('ticketList').hidden = true
    openThread('/fairies/api/support/tickets/by-token/' + encodeURIComponent(viewToken))
  } else {
    fillFromAccount().then(() => window.site.loadMe()).then(me => {
      if (me) loadMyTickets()
    })
  }
})()
