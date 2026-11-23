;(function () {
  const byId = id => document.getElementById(id)
  const { getJson, postJson } = window.gmPortal
  const entriesUrl = '/fairies/api/gm/contest-entries'
  const pageSize = 10
  let page = 1
  let contests = []

  const statusWords = { pending: 'Waiting', finalist: 'Finalist', picked: 'Picked', rejected: 'Not this time' }

  function element (tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  const when = iso => iso ? new Date(iso).toLocaleString() : ''
  const say = text => { byId('subMessage').textContent = text || '' }

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

  async function review (entry, status, note) {
    say('')
    const { res, body } = await postJson(`${entriesUrl}/${entry.id}/review`, { status, note })

    if (!res.ok) return say((body && body.message) || 'That did not save. Please try again.')

    load()
  }

  async function remove (entry) {
    if (!window.confirm('Delete this entry for good? This cannot be undone.')) return

    const res = await fetch(`${entriesUrl}/${entry.id}`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) return say('That could not be deleted.')

    load()
  }

  function card (entry) {
    const box = element('div', 'subCard')

    const head = element('div', 'subHead')
    head.append(
      element('span', 'subKind', entry.contestTitle || 'Contest'),
      element('span', 'subTitle', entry.title),
      element('span', 'subStatus ' + entry.status, statusWords[entry.status]),
      element('span', 'subMeta', `${entry.fairyName} (account ${entry.username}) · ${when(entry.createdAt)}`)
    )
    box.appendChild(head)

    const attachments = element('div', 'subFiles')
    for (const file of entry.files) {
      const link = element('a')
      link.href = file.url
      link.target = '_blank'
      link.rel = 'noopener'

      if (file.kind === 'image') {
        const img = element('img', 'subImage')
        img.src = file.url
        img.alt = file.label
        link.appendChild(img)
      } else {
        link.className = 'subDoc'
        link.textContent = `${file.text ? 'Read' : 'Download'} ${file.label}`
      }
      attachments.appendChild(link)
    }
    if (entry.files.length) box.appendChild(attachments)

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
      const { res, body } = await postJson(`${entriesUrl}/${entry.id}/note`, { note: note.value })
      saveNote.disabled = false
      noteState.textContent = res.ok ? (body.staffNote ? 'Note saved.' : 'Note cleared.') : ((body && body.message) || 'That did not save. Please try again.')
      if (res.ok) entry.staffNote = body.staffNote
    })
    noteRow.append(saveNote, noteState)
    noteBox.appendChild(noteRow)
    box.appendChild(noteBox)

    const actions = element('div', 'subActions')

    const choices = [
      ['picked', 'Pick it'],
      ['finalist', 'Finalist'],
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

  // the open/close switch for whichever contest is picked.
  function showOpenRow () {
    const contest = contests.find(c => c.id === byId('conContestPick').value)
    byId('conOpenRow').hidden = !contest

    if (!contest) return

    const state = byId('conOpenState')
    state.className = 'subStatus ' + (contest.open ? 'picked' : 'rejected')
    state.textContent = contest.open ? 'Open for entries' : 'Closed'
    byId('conOpenButton').textContent = contest.open ? 'Close the contest' : 'Open the contest'
    byId('conOpenHint').textContent = contest.status === 'published' ? '' : 'This contest is still a draft, so players cannot see it yet.'
  }

  async function loadContests () {
    const { res, body } = await getJson('/fairies/api/gm/contest-list')
    if (!res.ok) return say('Could not load the contests.')

    contests = body
    const pick = byId('conContestPick')
    const chosen = pick.value
    pick.replaceChildren(new Option('All contests', ''))
    contests.forEach(c => pick.appendChild(new Option(`${c.title} (${c.entries}${c.waiting ? `, ${c.waiting} waiting` : ''})`, c.id)))
    pick.value = contests.some(c => c.id === chosen) ? chosen : ''
    showOpenRow()
  }

  async function toggleOpen () {
    const contest = contests.find(c => c.id === byId('conContestPick').value)
    if (!contest) return

    const { res } = await postJson(`/fairies/api/gm/contests/${contest.id}/open`, { open: !contest.open })
    if (!res.ok) return say('That could not be changed.')

    await loadContests()
  }

  async function load () {
    const query = new URLSearchParams({ page, pageSize })
    if (byId('conStatusPick').value) query.set('status', byId('conStatusPick').value)
    if (byId('conContestPick').value) query.set('contest', byId('conContestPick').value)

    const { res, body } = await getJson(`${entriesUrl}?${query}`)
    const list = byId('subList')
    list.textContent = ''

    if (!res.ok) return say('Could not load the entries.')

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

  document.addEventListener('gmSignedIn', async () => {
    await loadContests()
    byId('conStatusPick').addEventListener('change', () => { page = 1; load() })
    byId('conContestPick').addEventListener('change', () => { page = 1; showOpenRow(); load() })
    byId('conOpenButton').addEventListener('click', toggleOpen)
    load()
  })
})()
