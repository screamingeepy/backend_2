;(function () {
  const byId = id => document.getElementById(id)
  const { getJson, postJson } = window.gmPortal
  const listUrl = '/fairies/api/gm/submissions'
  const pageSize = 10
  let page = 1

  // the same arrows-and-range pager the ticket list uses (gm.css).
  function renderPager (total) {
    const holder = byId('subPager')
    holder.replaceChildren()
    const pages = Math.max(1, Math.ceil(total / pageSize))

    const prev = element('button', 'gmPagerArrow prev', '')
    prev.type = 'button'
    prev.setAttribute('aria-label', 'Previous page')
    prev.disabled = page <= 1
    prev.addEventListener('click', () => { page -= 1; load() })

    const next = element('button', 'gmPagerArrow', '')
    next.type = 'button'
    next.setAttribute('aria-label', 'Next page')
    next.disabled = page >= pages
    next.addEventListener('click', () => { page += 1; load() })

    const from = total ? (page - 1) * pageSize + 1 : 0
    const to = Math.min(total, page * pageSize)
    holder.append(prev, element('span', 'gmPagerRange', total ? from + '-' + to + ' of ' + total : ''), next)
  }

  const statusWords = { pending: 'Waiting', approved: 'Picked', rejected: 'Not picked' }

  function element (tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function when (iso) {
    return iso ? new Date(iso).toLocaleString() : ''
  }

  function say (text) {
    byId('subMessage').textContent = text || ''
  }

  async function review (entry, status, note) {
    say('')
    const { res, body } = await postJson(`${listUrl}/${entry.id}/review`, { status, note })

    if (!res.ok) {
      say((body && body.message) || 'That did not save. Please try again.')
      return
    }

    load()
  }

  async function remove (entry) {
    if (!window.confirm('Delete this for good? This cannot be undone.')) return

    const res = await fetch(`${listUrl}/${entry.id}`, { method: 'DELETE', credentials: 'include' })

    if (!res.ok) {
      say('That could not be deleted.')
      return
    }

    load()
  }

  function card (entry) {
    const box = element('div', 'subCard')

    const head = element('div', 'subHead')
    head.append(
      element('span', 'subKind', entry.typeLabel),
      element('span', 'subTitle', entry.title),
      element('span', 'subStatus ' + entry.status, statusWords[entry.status]),
      element('span', 'subMeta', `${entry.fairyName} (account ${entry.username}) · ${when(entry.createdAt)}`)
    )
    box.appendChild(head)

    if (entry.image) {
      const link = element('a')
      link.href = entry.image
      link.target = '_blank'
      link.rel = 'noopener'
      const img = element('img', 'subImage')
      img.src = entry.image
      img.alt = entry.title
      link.appendChild(img)
      box.appendChild(link)
    }

    if (entry.body) box.appendChild(element('p', 'subBody', entry.body))

    if (entry.reviewedBy) {
      box.appendChild(element('p', 'subMeta', `Reviewed by ${entry.reviewedBy} · ${when(entry.reviewedAt)}`))
    }

    const noteBox = element('div', 'subNote')
    const note = element('textarea', 'textInput subNoteInput')
    note.rows = 3
    note.placeholder = 'Private note (only staff see this)'
    note.maxLength = 500
    note.value = entry.staffNote || ''
    noteBox.appendChild(note)

    const noteRow = element('div', 'subNoteRow')
    const saveNote = element('button', 'btnGray', 'Save note')
    saveNote.type = 'button'
    const noteState = element('span', 'subMeta', entry.staffNote ? 'Note saved.' : '')
    saveNote.addEventListener('click', async () => {
      saveNote.disabled = true
      noteState.textContent = 'Saving...'
      const { res, body } = await postJson(`${listUrl}/${entry.id}/note`, { note: note.value })
      saveNote.disabled = false
      noteState.textContent = res.ok ? (body.staffNote ? 'Note saved.' : 'Note cleared.') : ((body && body.message) || 'That did not save. Please try again.')
      if (res.ok) entry.staffNote = body.staffNote
    })
    noteRow.append(saveNote, noteState)
    noteBox.appendChild(noteRow)
    box.appendChild(noteBox)

    const actions = element('div', 'subActions')

    const choices = [
      ['approved', 'Pick it'],
      ['rejected', 'Not this time'],
      ['pending', 'Back to waiting']
    ]

    for (const [status, label] of choices) {
      if (status === entry.status) continue

      const button = element('button', 'btnGray', label)
      button.type = 'button'
      button.addEventListener('click', () => review(entry, status, note.value))
      actions.appendChild(button)
    }

    const del = element('button', 'btnGray', 'Delete')
    del.type = 'button'
    del.addEventListener('click', () => remove(entry))
    actions.appendChild(del)

    box.appendChild(actions)
    return box
  }

  async function load () {
    const query = new URLSearchParams({ page, pageSize })
    if (byId('subStatusPick').value) query.set('status', byId('subStatusPick').value)
    if (byId('subTypePick').value) query.set('type', byId('subTypePick').value)

    const { res, body } = await getJson(`${listUrl}?${query}`)
    const list = byId('subList')
    list.textContent = ''

    if (!res.ok) {
      say('Could not load the submissions.')
      return
    }

    // A page that emptied itself (the last entry on it was just handled) steps back.
    if (!body.entries.length && page > 1) {
      page -= 1
      return load()
    }

    byId('pendingCount').textContent = body.pending ? `(${body.pending} waiting)` : ''
    renderPager(body.total)

    if (!body.entries.length) {
      list.appendChild(element('p', 'gmHint', 'Nothing here.'))
      return
    }

    for (const entry of body.entries) list.appendChild(card(entry))
  }

  document.addEventListener('gmSignedIn', () => {
    // A new filter starts again from the first page.
    byId('subStatusPick').addEventListener('change', () => { page = 1; load() })
    byId('subTypePick').addEventListener('change', () => { page = 1; load() })
    load()
  })
})()
