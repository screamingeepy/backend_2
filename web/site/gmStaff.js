(function () {
  const byId = id => document.getElementById(id)
  const { element } = window.tickets
  const { getJson, postJson } = window.gmPortal

  const staffUrl = '/fairies/api/gm/staff'
  const maxFacts = 8

  // id -> picture file, from the list tools/build-staff-backgrounds.js wrote
  const backgrounds = new Map()

  async function loadBackgrounds () {
    const res = await fetch('/site/img/staffbg/index.json').catch(() => null)
    if (!res || !res.ok) return

    const list = await res.json().catch(() => null)
    if (!list) return

    const select = byId('staffBackground')
    const names = new Map()
    for (const group of list.groups) for (const zone of group.zones) names.set(zone.id, zone.name)

    for (const group of list.groups) {
      const holder = element('optgroup')
      holder.label = group.name

      // a meadow, then the places inside it, indented under it
      const roots = group.zones.filter(zone => !zone.parent || !names.has(zone.parent))
      const ordered = []
      for (const root of roots) ordered.push(root, ...group.zones.filter(zone => zone.parent === root.id))

      for (const zone of ordered) {
        const inside = zone.parent && names.has(zone.parent)

        for (const variant of zone.variants) {
          backgrounds.set(variant.id, variant.file)

          const option = element('option')
          option.value = variant.id
          option.textContent = (inside ? '   ↳ ' : '') + zone.name + (variant.label === 'Usual' ? '' : ' - ' + variant.label)
          holder.appendChild(option)
        }
      }

      select.appendChild(holder)
    }

    showBackground()
  }

  function showBackground () {
    const preview = byId('staffBackgroundPreview')
    const file = backgrounds.get(byId('staffBackground').value)

    preview.hidden = !file
    if (file) preview.src = '/site/img/staffbg/' + file
  }

  byId('staffBackground').addEventListener('change', showBackground)

  let pages = []
  // the page being edited, or null when the form is adding a new one
  let editing = null

  function setMessage (text, good) {
    const message = byId('staffMessage')
    message.textContent = text || ''
    message.classList.toggle('ok', Boolean(good))
  }

  // one line of the card, a label and its value
  function addFactRow (label, value) {
    const holder = byId('staffFacts')
    if (holder.children.length >= maxFacts) return

    const row = element('div', 'staffFactRow')
    row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px'

    const labelInput = element('input', 'textInput')
    labelInput.maxLength = 30
    labelInput.placeholder = 'Hobby'
    labelInput.value = label || ''
    labelInput.setAttribute('aria-label', 'Line label')
    labelInput.style.flex = '0 0 30%'

    const valueInput = element('input', 'textInput')
    valueInput.maxLength = 120
    valueInput.placeholder = 'Singing'
    valueInput.value = value || ''
    valueInput.setAttribute('aria-label', 'Line text')
    valueInput.style.flex = '1'

    const remove = element('button', 'btnGray', 'Remove')
    remove.type = 'button'
    remove.addEventListener('click', () => row.remove())

    row.append(labelInput, valueInput, remove)
    holder.appendChild(row)
  }

  function readFacts () {
    return Array.from(byId('staffFacts').children).map(row => {
      const [label, value] = row.querySelectorAll('input')
      return { label: label.value.trim(), value: value.value.trim() }
    }).filter(fact => fact.label || fact.value)
  }

  function resetForm () {
    editing = null
    byId('staffForm').reset()
    showBackground()
    byId('staffFacts').replaceChildren()
    byId('staffOrder').value = String(pages.length ? Math.max(...pages.map(page => page.order)) + 1 : 0)
    byId('staffFormTitle').textContent = 'Add a page'
    byId('staffSave').textContent = 'Add Page'
    byId('staffCancel').hidden = true
    byId('staffSlugPreview').textContent = 'address'
    setMessage('')
  }

  function edit (page) {
    editing = page
    byId('staffFairy').value = String(page.fairyId)
    byId('staffSlug').value = page.slug
    byId('staffRole').value = page.role
    byId('staffKnow').value = page.didYouKnow
    byId('staffBio').value = page.bio
    byId('staffOrder').value = String(page.order)
    byId('staffStatus').value = page.status
    byId('staffBackground').value = backgrounds.has(page.background) ? page.background : ''
    showBackground()

    byId('staffFacts').replaceChildren()
    for (const fact of page.facts || []) addFactRow(fact.label, fact.value)

    byId('staffFormTitle').textContent = 'Edit ' + page.name
    byId('staffSave').textContent = 'Save Changes'
    byId('staffCancel').hidden = false
    byId('staffSlugPreview').textContent = page.slug
    setMessage('')
    byId('staffForm').scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function showPages () {
    const list = byId('staffList')
    list.replaceChildren()
    byId('staffCount').textContent = pages.length ? String(pages.length) : ''

    if (!pages.length) {
      list.appendChild(element('li', 'ticketEmpty', 'No pages yet. Add one below.'))
      return
    }

    for (const page of pages) {
      const item = element('li', 'removedFairy')

      const who = element('span', 'removedWho')
      const name = element('span', 'removedName', page.name)

      const meta = [
        page.status === 'published' ? 'published' : 'DRAFT',
        'fairy ' + page.fairyId,
        '/staff.html?f=' + page.slug,
        page.role
      ].filter(Boolean).join(' · ')

      who.append(name, element('span', 'removedMeta', meta))

      const actions = element('span', 'removedActions')

      const open = element('a', 'gmRemove', 'View')
      open.href = '/staff.html?f=' + encodeURIComponent(page.slug)
      open.target = '_blank'
      open.rel = 'noopener'
      open.title = page.status === 'published' ? 'Open the page' : 'Drafts are not on the public page yet'
      if (page.status !== 'published') open.hidden = true

      const change = element('button', 'gmRemove', 'Edit')
      change.type = 'button'
      change.addEventListener('click', () => edit(page))

      const remove = element('button', 'gmRemove', 'Delete')
      remove.type = 'button'
      remove.addEventListener('click', async () => {
        if (!window.confirm('Delete the page for ' + page.name + '? The fairy herself is not touched.')) return
        remove.disabled = true

        const { res, body } = await postJson(staffUrl + '/' + page._id + '/delete', {})
        if (!res.ok) {
          remove.disabled = false
          item.appendChild(element('span', 'removedNote', body.message || 'Could not delete it.'))
          return
        }

        if (editing && editing._id === page._id) resetForm()
        loadPages()
      })

      actions.append(open, change, remove)
      item.append(who, actions)
      list.appendChild(item)
    }
  }

  async function loadPages () {
    const { res, body } = await getJson(staffUrl)
    if (!res.ok) return

    pages = body
    showPages()
    if (!editing) byId('staffOrder').value = String(pages.length ? Math.max(...pages.map(page => page.order)) + 1 : 0)
  }

  byId('staffSlug').addEventListener('input', event => {
    byId('staffSlugPreview').textContent = event.target.value.trim() || 'address'
  })

  byId('staffAddFact').addEventListener('click', () => addFactRow('', ''))
  byId('staffCancel').addEventListener('click', resetForm)

  byId('staffForm').addEventListener('submit', async event => {
    event.preventDefault()

    const fairy = byId('staffFairy').value.trim()
    if (!fairy) return setMessage('Which fairy is this page about?')

    const button = byId('staffSave')
    button.disabled = true

    try {
      const data = {
        fairy,
        slug: byId('staffSlug').value.trim(),
        role: byId('staffRole').value.trim(),
        didYouKnow: byId('staffKnow').value.trim(),
        facts: readFacts(),
        bio: byId('staffBio').value,
        order: byId('staffOrder').value,
        status: byId('staffStatus').value,
        background: byId('staffBackground').value
      }

      const { res, body } = await postJson(editing ? staffUrl + '/' + editing._id : staffUrl, data)

      if (!res.ok) {
        setMessage(body.message || 'That could not be saved (' + res.status + ').')
        return
      }

      const name = body.name
      resetForm()
      setMessage('Saved ' + name + '.', true)
      loadPages()
    } finally {
      button.disabled = false
    }
  })

  document.addEventListener('gmSignedIn', async () => {
    await loadBackgrounds()
    resetForm()
    loadPages()
  })
})()
