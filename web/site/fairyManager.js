(function () {
  const byId = id => document.getElementById(id)

  const copy = {
    title: 'Which Fairy would you like to play with today?',
    playlabel: 'Play!',
    deletelabel: 'Remove',
    pagelabel: 'Pixie Page',
    exportlabel: 'Export',
    exporttip: 'Download this Fairy to keep',
    importlabel: 'Import',
    importtip: 'Bring back a Fairy you saved',
    importing: 'Bringing your Fairy back...',
    imported: ' is back!',
    renamed: ' was not one of the allowed names, so this Fairy is now called ',
    importtoobig: 'That file is too big to be a Fairy.',
    importfull: 'You have no open slot for another Fairy.',
    importbusy: 'Too many imports for now, try again in a little while.',
    createafairy: 'Create A Fairy',
    starthere: 'Start here to create a new Fairy!',
    tink: 'Choose the Fairy you want to be today, or create a new Fairy!',
    confirmremove: 'Are you sure you want to remove this Fairy?',
    removing: 'Removing Fairy...',
    deletesuccess: 'Fairy removed.',
    dbfail: "Sorry, something's not right.  Try back later!",
    login: 'Just a minute...'
  }

  const MAX_FAIRIES = 3

  function element (tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  // the original spaced the address with /([A-Z])/ -> ' $1' so 1234CatepillerCorral
  function readableAddress (address) {
    return String(address || '').replace(/([A-Z])/g, ' $1').trim()
  }

  function note (text) {
    byId('managerNote').textContent = text || ''
  }

  function optionRow (fairy) {
    const row = element('li', 'managerOption')

    const bust = element('span', 'optionBust')
    const img = document.createElement('img')
    // A cold render takes a few seconds; the row draws around it.
    img.src = '/fairies-render/render/' + fairy.id
    img.alt = fairy.name
    img.addEventListener('error', () => {
      bust.classList.add('noBust')
      if (fairy.gender === 2) bust.classList.add('maleOption')
    })
    bust.appendChild(img)

    const text = element('span', 'optionText')
    text.append(
      element('span', 'optionName', fairy.name),
      element('span', 'optionAddress', readableAddress(fairy.address))
    )

    const page = element('a', 'optionPage', copy.pagelabel)
    // her own page, addressed the way the game addressed it.
    page.href = fairy.address ? '/pixiepages/' + encodeURIComponent(fairy.address) : '/pixiepage.html'

    const play = element('button', 'optionPlay', copy.playlabel)
    play.type = 'button'
    play.addEventListener('click', () => playAs(fairy.id, play))

    const remove = element('button', 'optionRemove', copy.deletelabel)
    remove.type = 'button'
    remove.addEventListener('click', () => removeFairy(fairy, remove))

    const keep = element('a', 'optionPage optionSmall', copy.exportlabel)
    keep.href = '/account/fairies/' + fairy.id + '/export'
    keep.download = ''
    keep.title = copy.exporttip

    const buttons = element('span', 'optionButtons')
    buttons.append(play, page, keep)

    row.append(bust, text, remove, buttons)
    return row
  }

  function emptyRow () {
    const row = element('li', 'managerOption emptyOption')

    row.append(
      element('span', 'optionBust noBust'),
      (() => {
        const text = element('span', 'optionText')
        text.append(
          element('span', 'optionName', copy.createafairy),
          element('span', 'optionAddress', copy.starthere)
        )
        return text
      })()
    )

    const create = element('a', 'optionPlay', 'Create')
    create.href = '/create.html'

    const bringBack = element('button', 'optionPage optionSmall', copy.importlabel)
    bringBack.type = 'button'
    bringBack.title = copy.importtip

    const chooser = document.createElement('input')
    chooser.type = 'file'
    chooser.accept = '.json,application/json'
    chooser.hidden = true
    bringBack.addEventListener('click', () => chooser.click())
    chooser.addEventListener('change', () => importFairy(chooser, bringBack))

    const buttons = element('span', 'optionButtons')
    buttons.append(create, bringBack, chooser)
    row.appendChild(buttons)

    return row
  }

  async function importFairy (chooser, button) {
    const file = chooser.files && chooser.files[0]
    chooser.value = ''
    if (!file) return

    if (file.size > 2 * 1024 * 1024) {
      note(copy.importtoobig)
      return
    }

    button.disabled = true
    note(copy.importing)

    // raw bytes: the site's JSON body is capped well below a full wardrobe
    const res = await fetch('/account/fairies/import', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file
    }).catch(() => null)
    const body = res ? await res.json().catch(() => ({})) : {}

    button.disabled = false

    if (res && res.ok && body.success) {
      const done = body.renamedFrom ? '"' + body.renamedFrom + '"' + copy.renamed + body.name + '.' : body.name + copy.imported
      const things = count => count + ' thing' + (count === 1 ? '' : 's')
      const left = body.skipped ? ' ' + things(body.skipped) + " in the file isn't on this server and was left out." : ''
      const swapped = body.swapped ? ' ' + things(body.swapped) + ' ' + (body.swapped === 1 ? 'was' : 'were') + ' swapped for defaults.' : ''
      note(done + left + swapped)
      load()
      return
    }

    if (body.error === 'NO_OPEN_SLOT') note(copy.importfull)
    else if (body.error === 'TOO_MANY_IMPORTS') note(copy.importbusy)
    else note(body.message || copy.dbfail)
  }

  async function playAs (fairyId, button) {
    button.disabled = true
    note(copy.login)
    const res = await fetch('/fairies/api/ChooseFairyRequest', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ fairy_id: fairyId })
    }).catch(() => null)

    if (res && res.ok) {
      window.location.href = '/live.html'
      return
    }

    button.disabled = false
    note(copy.dbfail)
  }

  async function removeFairy (fairy, button) {
    if (!window.confirm(copy.confirmremove)) return

    button.disabled = true
    note(copy.removing)

    const res = await fetch('/account/fairies/' + fairy.id + '/delete', {
      method: 'POST',
      credentials: 'include'
    }).catch(() => null)
    const body = res ? await res.json().catch(() => ({})) : {}

    if (!res || !res.ok || !body.success) {
      button.disabled = false
      note(copy.dbfail)
      return
    }

    note(copy.deletesuccess)
    load()
  }

  async function load () {
    const me = await window.site.loadMe(true)
    const list = byId('managerOptions')
    list.replaceChildren()

    if (!me) {
      byId('managerTitle').textContent = 'Log in to see your Fairies.'
      byId('managerTip').textContent = ''
      return
    }

    byId('managerTitle').textContent = copy.title
    byId('managerTip').textContent = copy.tink
    // slots come from the server, see fairyLimitFor
    const limit = me.maxFairies || MAX_FAIRIES
    const fairies = (me.fairies || []).slice(0, limit)

    for (const fairy of fairies) list.appendChild(optionRow(fairy))
    for (let slot = fairies.length; slot < limit; slot++) list.appendChild(emptyRow())
  }

  load()
})()
