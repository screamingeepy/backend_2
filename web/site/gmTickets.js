(function () {
  const byId = id => document.getElementById(id)
  const { element, shortId, formatWhen, formatDate, statusBadge, categoryLabel, categoryLabels, renderThread, statusLabels, detailRows, attachmentList } = window.tickets
  const { getJson, postJson } = window.gmPortal

  const sourceLabels = { game: 'In-game report', email: 'E-mail' }
  const ticketsUrl = '/fairies/api/gm/tickets'
  const ticketRefreshMs = 15000
  const pageSize = 10

  let loadedTickets = []
  let viewerTier = 'Moderator'
  let ticketPage = 1
  let ticketSearch = ''
  let searchTimer = null

  function renderPager (holder, total, page, onChange) {
    holder.replaceChildren()
    const pages = Math.max(1, Math.ceil(total / pageSize))
    if (page > pages) page = pages

    const prev = element('button', 'gmPagerArrow prev', '')
    prev.type = 'button'
    prev.setAttribute('aria-label', 'Previous page')
    prev.disabled = page <= 1
    prev.addEventListener('click', () => onChange(page - 1))

    const next = element('button', 'gmPagerArrow', '')
    next.type = 'button'
    next.setAttribute('aria-label', 'Next page')
    next.disabled = page >= pages
    next.addEventListener('click', () => onChange(page + 1))

    const from = total ? (page - 1) * pageSize + 1 : 0
    const to = Math.min(total, page * pageSize)
    const range = element('span', 'gmPagerRange', total ? (from + '-' + to + ' of ' + total) : '')

    holder.append(prev, range, next)
  }

  async function loadOpenCount () {
    const { res, body } = await getJson(ticketsUrl + '?status=open&page=1&pageSize=1')
    if (res.ok) byId('openCount').textContent = body.total ? String(body.total) : ''
  }

  async function loadTickets () {
    const status = byId('ticketStatusPick').value
    const query = '?page=' + ticketPage + '&pageSize=' + pageSize +
      (status ? '&status=' + status : '') +
      (ticketSearch ? '&search=' + encodeURIComponent(ticketSearch) : '')
    const { res, body } = await getJson(ticketsUrl + query)
    const list = byId('gmTicketList')
    list.replaceChildren()
    if (!res.ok || !body) {
      list.appendChild(element('li', 'ticketEmpty', 'Could not load tickets (' + res.status + ').'))
      return
    }
    if (!body.items.length) {
      list.appendChild(element('li', 'ticketEmpty', ticketSearch ? 'No tickets match that search.' : 'No tickets here.'))
    }
    loadedTickets = body.items
    for (const ticket of body.items) {
      const item = element('li')
      const button = element('button', 'ticketRow')
      button.type = 'button'
      button.append(
        element('span', 'ticketId', shortId(ticket._id)),
        element('span', 'ticketSubject', formatDate(ticket.createdAt) + ' - ' + ticket.subject),
        element('span', 'ticketMeta', (ticket.playerName || ticket.email) + ' · ' + categoryLabel(ticket.category) + ' · updated ' + formatWhen(ticket.updatedAt)),
        statusBadge(ticket.status)
      )
      button.addEventListener('click', () => openTicket(ticket._id))
      item.appendChild(button)
      list.appendChild(item)
    }

    renderPager(byId('ticketPager'), body.total, ticketPage, page => { ticketPage = page; loadTickets() })
    loadOpenCount()
  }

  byId('ticketSearch').addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      ticketSearch = byId('ticketSearch').value.trim()
      ticketPage = 1
      loadTickets()
    }, 300)
  })

  function categoryPicker (ticket) {
    const pick = element('select', 'selectInput gmCategoryPick')
    pick.setAttribute('aria-label', 'Issue')
    for (const [value, label] of Object.entries(categoryLabels)) {
      pick.appendChild(new Option(label, value))
    }
    pick.value = ticket.category

    const note = element('span', 'gmCategoryNote')

    pick.addEventListener('change', async () => {
      const wanted = pick.value
      pick.disabled = true
      note.textContent = 'Saving…'
      const { res } = await postJson(ticketsUrl + '/' + ticket._id + '/category', { category: wanted })
      pick.disabled = false
      if (!res.ok) {
        pick.value = ticket.category
        note.textContent = 'Could not change it.'
        return
      }
      ticket.category = wanted
      note.textContent = 'Saved.'
      loadTickets()
      setTimeout(() => { note.textContent = '' }, 2500)
    })

    const wrap = element('span', 'gmCategoryRow')
    wrap.append(pick, note)
    return wrap
  }

  function metaList (ticket) {
    const list = element('dl', 'gmTicketMeta')
    const rows = [
      ['Filed', formatWhen(ticket.createdAt)],
      ['Player', ticket.playerName || '-'],
      ['E-mail', ticket.email || '-'],
      ['Issue', categoryPicker(ticket)],
      ['Account', ticket.accountId ? String(ticket.accountId) : 'Not logged in']
    ]
    if (ticket.reportedName) rows.splice(4, 0, ['Reporting', ticket.reportedName])
    if (ticket.source && ticket.source !== 'site') rows.push(['Came from', sourceLabels[ticket.source] || ticket.source])
    for (const [label, value] of rows.concat(detailRows(ticket))) {
      const cell = element('dd')
      if (value instanceof Node) cell.appendChild(value)
      else cell.textContent = value
      list.append(element('dt', '', label), cell)
    }
    return list
  }

  async function openTicket (id) {
    const thread = byId('gmTicketThread')
    const { res, body: ticket } = await getJson(ticketsUrl + '/' + id)
    if (!res.ok) return

    const title = element('h4', 'threadTitle')
    title.append(shortId(ticket._id) + ' ' + formatDate(ticket.createdAt) + ' - ' + ticket.subject + ' ', statusBadge(ticket.status))

    const form = element('form', 'threadReply')
    const label = element('label', 'modalLabel', 'Reply (sent to ' + ticket.email + ' by e-mail)')
    label.htmlFor = 'gmReplyText'
    const text = element('textarea', 'textInput textArea')
    text.id = 'gmReplyText'
    text.rows = 4
    const statusPick = element('select', 'selectInput')
    statusPick.setAttribute('aria-label', 'Set status')
    for (const [value, name] of Object.entries(statusLabels)) statusPick.appendChild(new Option(name, value))
    statusPick.value = 'pending'
    const send = element('button', 'btnGold', 'Send Reply')
    send.type = 'submit'
    const row = element('div', 'gmReplyRow')
    row.append(statusPick, send)

    const message = element('p', 'formMessage')
    message.setAttribute('role', 'status')

    const actions = element('div', 'gmTicketActions')
    const actionNote = element('span', 'gmActionNote')

    const others = loadedTickets.filter(other => other._id !== id)
    if (others.length) {
      const mergePick = element('select', 'selectInput gmMergePick')
      mergePick.setAttribute('aria-label', 'Merge this ticket into')
      mergePick.appendChild(new Option('Merge into…', ''))
      for (const other of others) {
        mergePick.appendChild(new Option(shortId(other._id) + ' ' + other.subject, other._id))
      }
      mergePick.addEventListener('change', async () => {
        const into = mergePick.value
        if (!into) return
        const chosen = others.find(other => other._id === into)
        if (!window.confirm('Move this ticket\'s messages and pictures into ' + shortId(into) + ' "' + chosen.subject + '"? This one is closed with a note pointing there.')) {
          mergePick.value = ''
          return
        }
        mergePick.disabled = true
        const { res: merged, body: why } = await postJson(ticketsUrl + '/' + id + '/merge', { into })
        if (!merged.ok) {
          mergePick.disabled = false
          mergePick.value = ''
          actionNote.textContent = why.message || 'Could not merge them.'
          return
        }
        await openTicket(into)
        loadTickets()
      })
      actions.appendChild(mergePick)
    }

    if (viewerTier === 'Administrator') {
      const remove = element('button', 'btnGray gmDelete', 'Delete')
      remove.type = 'button'
      remove.addEventListener('click', async () => {
        const warning = ticket.attachments && ticket.attachments.length
          ? 'Delete this ticket for good? Its ' + ticket.attachments.length + ' picture(s) go with it.'
          : 'Delete this ticket for good? Closing it hides it without losing the record.'
        if (!window.confirm(warning)) return
        remove.disabled = true
        const { res: gone, body: why } = await postJson(ticketsUrl + '/' + id + '/delete', {})
        if (!gone.ok) {
          remove.disabled = false
          actionNote.textContent = why.message || 'Could not delete it.'
          return
        }
        byId('gmTicketThread').hidden = true
        loadTickets()
      })
      actions.appendChild(remove)
    }

    form.append(label, text, row, message)

    if (actions.childElementCount) {
      actions.appendChild(actionNote)
      form.appendChild(actions)
    }

    form.addEventListener('submit', async event => {
      event.preventDefault()
      if (!text.value.trim()) {
        message.textContent = 'Type a reply first.'
        return
      }
      send.disabled = true
      const { res: replyRes, body } = await postJson(ticketsUrl + '/' + id + '/reply', { body: text.value.trim(), status: statusPick.value })
      send.disabled = false
      if (!replyRes.ok) {
        message.textContent = body.message || 'Could not send the reply.'
        return
      }
      await openTicket(id)
      loadTickets()
    })

    const parts = [title, metaList(ticket)]
    const files = attachmentList(ticket)
    if (files) parts.push(files)
    parts.push(renderThread(ticket.messages), form)

    thread.replaceChildren(...parts)
    thread.hidden = false
    thread.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  byId('ticketStatusPick').addEventListener('change', () => { ticketPage = 1; loadTickets() })

  document.addEventListener('gmSignedIn', event => {
    viewerTier = event.detail.accountType || 'Moderator'
    loadTickets()
    setInterval(() => { if (!ticketSearch) loadTickets() }, ticketRefreshMs)
  })
})()
