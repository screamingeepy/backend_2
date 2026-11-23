(function () {
  const byId = id => document.getElementById(id)
  const { element, formatWhen } = window.tickets

  const eventsUrl = '/fairies/api/gm/events'

  const normalIcons = [
    ['pixie', 'Famous Fairies'],
    ['wings', 'Pixie Pals'],
    ['gift', 'Minister of the Season'],
    ['scroll', 'Fairy Tale Theater'],
    ['balloon', 'General'],
    ['fashion', 'Fashion']
  ]
  const contestIcons = [
    ['secret', 'Secret of the Wings'],
    ['nature', 'Fairy Art for Nature'],
    ['diamonds', 'Diamonds Sweepstakes']
  ]

  window.calendarIcons = { normal: normalIcons, contest: contestIcons }

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

  // editor

  function fillIconSelect (timeType, picked) {
    const select = byId('calEditorIcon')
    select.replaceChildren()
    const icons = timeType === 'contest' ? contestIcons : normalIcons
    icons.forEach(([value, label]) => select.appendChild(new Option(label, value)))
    if (picked && icons.some(([value]) => value === picked)) select.value = picked
  }

  function updateEditorShape () {
    const timeType = byId('calEditorTimeType').value
    byId('calEditorEndDateRow').hidden = timeType !== 'thisweek' && timeType !== 'contest'
    fillIconSelect(timeType, byId('calEditorIcon').value)
  }

  byId('calEditorTimeType').addEventListener('change', updateEditorShape)

  function toDateInput (date) {
    if (!date) return ''
    const d = new Date(date)
    if (isNaN(d.getTime())) return ''
    return d.toISOString().slice(0, 10)
  }

  function setEditorMessage (text, ok) {
    const message = byId('calEditorMessage')
    message.className = 'formMessage' + (ok ? ' ok' : '')
    message.textContent = text || ''
  }

  function openEditor (entry) {
    editingId = entry ? entry._id : null

    byId('calEditorTitle').textContent = entry ? 'Edit Event' : 'Add an Event'
    byId('calEditorTimeType').value = entry ? entry.timeType : 'once'
    byId('calEditorDate').value = toDateInput(entry ? entry.date : new Date())
    byId('calEditorEndDate').value = toDateInput(entry ? entry.endDate : '')
    fillIconSelect(byId('calEditorTimeType').value, entry ? entry.type : 'balloon')
    byId('calEditorTitleInput').value = entry ? entry.title : ''
    byId('calEditorShortTitle').value = entry ? entry.shortTitle : ''
    byId('calEditorWhen').value = entry ? entry.when : ''
    byId('calEditorWhere').value = entry ? entry.where : ''
    byId('calEditorColor').value = entry ? entry.color : ''
    byId('calEditorLink').value = entry ? entry.link : ''
    byId('calEditorImage').value = entry ? entry.imagePath : ''
    byId('calEditorPublished').checked = entry ? entry.published : false

    updateEditorShape()

    byId('calDeleteButton').hidden = !entry
    setEditorMessage('')

    byId('calEditor').hidden = false
    byId('calEditor').scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function closeEditor () {
    editingId = null
    byId('calEditor').hidden = true
  }

  function editorFields () {
    const timeType = byId('calEditorTimeType').value
    return {
      timeType,
      date: byId('calEditorDate').value,
      endDate: (timeType === 'thisweek' || timeType === 'contest') ? (byId('calEditorEndDate').value || undefined) : undefined,
      type: byId('calEditorIcon').value,
      title: byId('calEditorTitleInput').value.trim(),
      shortTitle: byId('calEditorShortTitle').value.trim(),
      when: byId('calEditorWhen').value.trim(),
      where: byId('calEditorWhere').value.trim(),
      color: byId('calEditorColor').value.trim(),
      link: byId('calEditorLink').value.trim(),
      imagePath: byId('calEditorImage').value.trim(),
      published: byId('calEditorPublished').checked
    }
  }

  byId('calNewButton').addEventListener('click', () => openEditor(null))
  byId('calCancelButton').addEventListener('click', closeEditor)

  byId('calEditor').addEventListener('submit', async event => {
    event.preventDefault()

    const fields = editorFields()
    if (!fields.date) return setEditorMessage('Please give the event a date.')
    if (!fields.title) return setEditorMessage('Please give the event a title.')

    const button = byId('calSaveButton')
    button.disabled = true
    try {
      const url = editingId ? `${eventsUrl}/${editingId}` : eventsUrl
      const { res, body } = await postJson(url, fields)

      if (!res.ok) {
        setEditorMessage(body.message || `The event could not be saved (${res.status}).`)
        return
      }

      const wasNew = !editingId
      await loadEntries()

      // it's saved now, so the next one starts another instead of rewriting this
      if (wasNew) openEditor(null)

      setEditorMessage(fields.published ? 'Published.' : 'Saved as a draft.', true)
    } finally {
      button.disabled = false
    }
  })

  byId('calDeleteButton').addEventListener('click', async () => {
    if (!editingId) return
    if (!confirm('Delete this event for good?')) return

    const { res } = await postJson(`${eventsUrl}/${editingId}/delete`, {})
    if (!res.ok) return setEditorMessage('That event could not be deleted.')

    closeEditor()
    await loadEntries()
  })

  // list

  function entryRow (entry) {
    const row = element('button', 'newsAdminRow')
    row.type = 'button'

    const text = element('span', 'newsAdminText')
    text.append(
      element('span', 'newsAdminTitle', entry.title || '(untitled)'),
      element('span', 'newsAdminMeta', `${formatWhen(entry.date)} · ${entry.timeType}`)
    )

    const badges = element('span', 'newsAdminBadges')
    badges.appendChild(element('span', 'statusBadge ' + (entry.published ? 'done' : 'pending'),
      entry.published ? 'Published' : 'Draft'))

    row.append(text, badges)
    row.addEventListener('click', async () => {
      const { body } = await getJson(`${eventsUrl}/${entry._id}`)
      if (body) openEditor(body)
    })

    return row
  }

  async function loadEntries () {
    const published = byId('calStatusPick').value
    const query = published ? `?published=${published}` : ''
    const { body } = await getJson(eventsUrl + query)

    const list = byId('calAdminList')
    if (!body) {
      list.replaceChildren(element('li', 'ticketEmpty', 'The events could not be loaded.'))
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

  byId('calStatusPick').addEventListener('change', loadEntries)

  document.addEventListener('gmSignedIn', async () => {
    updateEditorShape()
    await loadEntries()
  })
})()
