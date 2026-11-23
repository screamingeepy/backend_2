(function () {
  const byId = id => document.getElementById(id)
  const { element, statusBadge } = window.tickets
  const { getJson, postJson } = window.gmPortal

  const registryUrl = '/fairies/api/gm/registry'
  const commandsUrl = '/fairies/api/gm/commands'
  const pollMs = 1200
  const logRefreshMs = 5000
  const pageSize = 10

  let registry = []
  let viewerTier = 'Moderator'

  const categoryNames = {
    moderation: 'Moderation',
    accounts: 'Accounts',
    debug: 'Debug',
    puppets: 'Puppets'
  }
  let currentCategory = 'moderation'
  let currentParts = []

  function parseUsage (usage) {
    const body = usage.split(/\s+/).slice(1).join(' ')
    const tokens = body.match(/\[[^\]]*\]|<[^>]*>|\S+/g) || []
    return tokens.map(token => {
      if (token.startsWith('[')) {
        const inner = token.slice(1, -1).trim()
        const prefixed = inner.match(/^(\w+)\s+<([^>]+)>$/)
        if (prefixed) return { kind: 'field', label: prefixed[2], optional: true, prefix: prefixed[1] }
        return { kind: 'field', label: inner.replace(/[<>]/g, ''), optional: true }
      }
      if (token.startsWith('<')) return { kind: 'field', label: token.slice(1, -1), optional: false }
      return { kind: 'literal', text: token }
    })
  }

  function looksNumeric (label) {
    return /^(amount|days|minutes|level|points|score|count|value|size|rate|plot|mask|\w*id)/i.test(label)
  }

  function buildCommand (name) {
    const words = [name]
    for (const part of currentParts) {
      if (part.kind === 'literal') {
        words.push(part.text)
        continue
      }
      const value = part.input.value.trim()
      if (!value) {
        if (!part.optional) return { error: 'Fill in ' + part.label + '.' }
        continue
      }
      if (part.prefix) words.push(part.prefix)
      words.push(value)
    }
    return { text: words.join(' ') }
  }

  function selectedCommand () {
    return registry.find(c => c.name === byId('commandPick').value)
  }

  function updatePreview () {
    const command = selectedCommand()
    const preview = byId('commandPreview')
    if (!command || byId('rawBox').open) {
      preview.textContent = ''
      return
    }
    const built = buildCommand(command.name)
    preview.textContent = built.text ? 'Will run: ' + built.text : ''
  }

  function showFields () {
    const command = selectedCommand()
    const holder = byId('commandFields')
    holder.replaceChildren()
    currentParts = []
    const hint = byId('commandHint')
    if (!command) {
      hint.textContent = ''
      updatePreview()
      return
    }
    hint.textContent = (command.description ? command.description + ' ' : '') + '(' + command.tier + ')'
    currentParts = parseUsage(command.usage)
    currentParts.forEach((part, index) => {
      if (part.kind !== 'field') return
      const row = element('div', 'gmCommandRow')
      const id = 'field' + index
      const choices = part.label.includes('|') ? part.label.split('|') : null
      const label = element('label', 'modalLabel', choices ? 'Setting' : part.label.charAt(0).toUpperCase() + part.label.slice(1) + (part.optional ? ' (optional)' : ''))
      label.htmlFor = id
      let input
      if (choices) {
        input = element('select', 'selectInput')
        if (part.optional) input.appendChild(new Option('-', ''))
        for (const choice of choices) input.appendChild(new Option(choice, choice))
        input.addEventListener('change', updatePreview)
      } else {
        input = element('input', 'textInput')
        input.autocomplete = 'off'
        if (looksNumeric(part.label)) input.inputMode = 'numeric'
        if (/password/i.test(part.label)) input.type = 'password'
        input.addEventListener('input', updatePreview)
      }
      input.id = id
      part.input = input
      row.append(label, input)
      holder.appendChild(row)
    })
    updatePreview()
  }

  function fillCommands () {
    const select = byId('commandPick')
    const inCategory = registry.filter(c => (c.category || 'debug') === currentCategory)
    select.replaceChildren(new Option(inCategory.length ? 'Choose a command' : 'Nothing here yet', ''))
    for (const command of inCategory) {
      const option = new Option(command.name + (command.tier === 'Administrator' && viewerTier !== 'Administrator' ? ' (Administrator only)' : ''), command.name)
      option.disabled = command.tier === 'Administrator' && viewerTier !== 'Administrator'
      select.appendChild(option)
    }
    showFields()
  }

  function fillRegistry () {
    const tabs = byId('categoryTabs')
    tabs.replaceChildren()
    for (const [key, label] of Object.entries(categoryNames)) {
      const count = registry.filter(c => (c.category || 'debug') === key).length
      const tab = element('button', 'gmTab', label + ' (' + count + ')')
      tab.type = 'button'
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-selected', key === currentCategory)
      tab.addEventListener('click', () => {
        currentCategory = key
        tabs.querySelectorAll('.gmTab').forEach(other => other.setAttribute('aria-selected', other === tab))
        fillCommands()
      })
      tabs.appendChild(tab)
    }
    fillCommands()
  }

  byId('commandPick').addEventListener('change', showFields)
  byId('rawBox').addEventListener('toggle', updatePreview)

  function showResult (status, text) {
    const result = byId('commandResult')
    result.hidden = false
    result.className = 'gmResult ' + status
    result.textContent = text
  }

  async function pollResult (id, report = showResult) {
    for (let i = 0; i < 30; i++) {
      const { res, body } = await getJson(commandsUrl + '/' + id)
      if (!res.ok) {
        report('failed', 'Could not check on this command (' + res.status + ').')
        return
      }
      const waiting = body.status === 'pending' || body.status === 'running'
      const text = body.response || (waiting ? 'waiting…' : '')
      report(body.status, '[' + body.status + ']' + (text.includes('\n') ? '\n' : ' ') + text)
      if (!waiting) return
      await new Promise(resolve => setTimeout(resolve, pollMs))
    }
    report('unclaimed', 'Gave up waiting. Check Recent Commands below.')
  }

  byId('commandForm').addEventListener('submit', async event => {
    event.preventDefault()
    let text = ''
    if (byId('rawBox').open) {
      text = byId('commandInput').value.trim()
    } else {
      const command = selectedCommand()
      if (!command) {
        showResult('failed', 'Pick a command first.')
        return
      }
      const built = buildCommand(command.name)
      if (built.error) {
        showResult('failed', built.error)
        return
      }
      text = built.text
    }
    if (!text) return
    const name = text.split(/\s+/)[0].toLowerCase()
    if (!registry.find(c => c.name === name)) {
      showResult('failed', 'Unknown command "' + name + '". Pick one from the list.')
      return
    }
    const button = byId('runButton')
    button.disabled = true
    showResult('pending', 'Sending…')
    try {
      const { res, body } = await postJson(commandsUrl, { command: text })
      if (!res.ok) {
        showResult('failed', body.message || 'Could not send (' + res.status + ').')
        return
      }
      await pollResult(body._id)
      loadLog()
    } finally {
      button.disabled = false
    }
  })

  // gm mode, its own switch because it changes what the game gives you

  const gmModeUrl = '/fairies/api/gm/gm-mode'
  let gmModeOn = null

  function showGmMode (on) {
    gmModeOn = on
    byId('gmModeRow').hidden = false
    byId('gmModeState').textContent = on ? 'is on' : 'is off'
    byId('gmModeSwitch').setAttribute('aria-checked', String(on))
    byId('gmModeHint').textContent = on
      ? 'Your fairies log in wearing the GM avatar, which carries the in-game command console. Takes effect at your next log-in.'
      : 'Your fairies log in as ordinary players, without the in-game command console. The commands below still work either way. Takes effect at your next log-in.'
  }

  async function loadGmMode () {
    const { res, body } = await getJson(gmModeUrl)
    if (!res.ok) return
    showGmMode(Boolean(body.on))
  }

  function showGmModeResult (kind, text) {
    const box = byId('gmModeResult')
    box.hidden = false
    box.className = 'gmResult ' + kind
    box.textContent = text
  }

  byId('gmModeSwitch').addEventListener('click', async () => {
    if (gmModeOn === null) return
    const wanted = !gmModeOn
    const button = byId('gmModeSwitch')
    button.disabled = true
    showGmModeResult('pending', 'Sending…')
    try {
      const { res, body } = await postJson(commandsUrl, { command: 'gm-mode ' + (wanted ? 'on' : 'off') })
      if (!res.ok) {
        showGmModeResult('failed', body.message || 'Could not send (' + res.status + ').')
        return
      }
      await pollResult(body._id, showGmModeResult)
      await loadGmMode()
      loadLog()
    } finally {
      button.disabled = false
    }
  })

  // fairy / account lookup, reads mongo directly with no message director round trip

  const lookupUrl = '/fairies/api/gm/lookup'

  function lookupRow (row) {
    const item = element('li', 'gmLookupRow')

    const fairy = element('span', 'gmLookupFairy', row.fairyName || 'No fairy yet')
    const username = element('span', 'gmLookupUsername', row.username)
    item.append(fairy, element('span', 'gmLookupArrow', '↔'), username)

    if (row.level != null) item.appendChild(element('span', 'gmLookupMeta', 'level ' + row.level))
    if (row.accountType && row.accountType !== 'Player') item.appendChild(element('span', 'statusBadge', row.accountType))
    if (row.banned) item.appendChild(element('span', 'statusBadge failed', 'Banned'))
    if (row.muted) item.appendChild(element('span', 'statusBadge pending', 'Muted'))

    const raw = byId('commandInput')
    const useIt = element('button', 'btnGray', 'whois')
    useIt.type = 'button'
    useIt.title = 'Fill in the raw command box with whois for this fairy'
    useIt.addEventListener('click', () => {
      byId('rawBox').open = true
      raw.value = 'whois ' + (row.fairyName || row.username)
      raw.focus()
      updatePreview()
    })
    item.appendChild(useIt)

    return item
  }

  async function runLookup () {
    const q = byId('lookupSearch').value.trim()
    const list = byId('lookupResults')
    if (!q) {
      list.replaceChildren()
      return
    }
    if (q.length < 2) {
      list.replaceChildren(element('li', 'logEmpty', 'Type at least 2 characters.'))
      return
    }
    const { res, body } = await getJson(lookupUrl + '?q=' + encodeURIComponent(q))
    list.replaceChildren()
    if (!res.ok || !body) {
      list.appendChild(element('li', 'logEmpty', 'Could not search.'))
      return
    }
    if (!body.items.length) {
      list.appendChild(element('li', 'logEmpty', 'No fairy or Account ID matches that.'))
      return
    }
    body.items.forEach(row => list.appendChild(lookupRow(row)))
  }

  // enter only, not as you type, a regex scan of two collections with no index is heavy
  byId('lookupSearch').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault()
      runLookup()
    }
  })

  // recent commands, searchable, 10 at a time

  let logPage = 1
  let logSearch = ''
  let logTimer = null

  async function loadLog () {
    const query = '?page=' + logPage + '&pageSize=' + pageSize + (logSearch ? '&search=' + encodeURIComponent(logSearch) : '')
    const { res, body } = await getJson(commandsUrl + query)
    const list = byId('commandLog')
    list.replaceChildren()

    if (!res.ok || !body) {
      list.appendChild(element('li', 'logEmpty', 'Could not load the log.'))
      return
    }
    if (!body.items.length) {
      list.appendChild(element('li', 'logEmpty', logSearch ? 'No commands match that search.' : 'Nothing run yet.'))
    }
    for (const doc of body.items) {
      const item = element('li')
      item.append(
        element('span', 'logWhen', new Date(doc.issuedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })),
        element('span', 'logWho', doc.issuedByName || String(doc.issuedBy)),
        element('span', 'logCommand', doc.command),
        statusBadge(doc.status)
      )
      if (doc.response) item.appendChild(element('span', 'logResponse', doc.response))
      list.appendChild(item)
    }

    renderPager(byId('commandLogPager'), body.total, () => { loadLog() })
  }

  function renderPager (holder, total, onChange) {
    holder.replaceChildren()
    const pages = Math.max(1, Math.ceil(total / pageSize))
    if (logPage > pages) logPage = pages

    const prev = element('button', 'gmPagerArrow prev', '')
    prev.type = 'button'
    prev.setAttribute('aria-label', 'Previous page')
    prev.disabled = logPage <= 1
    prev.addEventListener('click', () => { logPage -= 1; onChange() })

    const next = element('button', 'gmPagerArrow', '')
    next.type = 'button'
    next.setAttribute('aria-label', 'Next page')
    next.disabled = logPage >= pages
    next.addEventListener('click', () => { logPage += 1; onChange() })

    const from = total ? (logPage - 1) * pageSize + 1 : 0
    const to = Math.min(total, logPage * pageSize)
    const range = element('span', 'gmPagerRange', total ? (from + '-' + to + ' of ' + total) : '')

    holder.append(prev, range, next)
  }

  let logSearchInput
  function wireLogSearch () {
    logSearchInput = byId('commandLogSearch')
    logSearchInput.addEventListener('input', () => {
      clearTimeout(logTimer)
      logTimer = setTimeout(() => {
        logSearch = logSearchInput.value.trim()
        logPage = 1
        loadLog()
      }, 300)
    })
  }

  const chatLogUrl = '/fairies/api/gm/chat-logs'

  function localDate (date) {
    const pad = number => String(number).padStart(2, '0')
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
  }

  function wireChatLogs () {
    const today = new Date()
    byId('chatLogTo').value = localDate(today)
    byId('chatLogFrom').value = localDate(new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000))

    byId('chatLogForm').addEventListener('submit', async event => {
      event.preventDefault()
      const message = byId('chatLogMessage')
      const button = byId('chatLogButton')
      message.classList.remove('ok')
      message.textContent = ''
      button.disabled = true

      const query = new URLSearchParams({
        who: byId('chatLogWho').value.trim(),
        from: byId('chatLogFrom').value,
        to: byId('chatLogTo').value,
        contains: byId('chatLogContains').value.trim()
      })

      try {
        const res = await fetch(chatLogUrl + '?' + query, { credentials: 'include' })

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          message.textContent = body.message || 'The chat log could not be downloaded (' + res.status + ').'
          return
        }

        const file = await res.blob()
        const named = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')
        const link = document.createElement('a')
        link.href = URL.createObjectURL(file)
        link.download = named ? named[1] : 'chat-log.txt'
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(link.href), 1000)

        const count = res.headers.get('X-Row-Count')
        const stopped = res.headers.get('X-Truncated') === '1'
        message.classList.add('ok')
        message.textContent = count + ' messages downloaded.' + (stopped ? ' That is the limit, so pick fewer days or a name to see the rest.' : '')
        loadLog()
      } finally {
        button.disabled = false
      }
    })
  }

  document.addEventListener('gmSignedIn', async event => {
    viewerTier = event.detail.accountType || 'Moderator'
    wireLogSearch()
    wireChatLogs()

    const { res, body } = await getJson(registryUrl)
    if (res.ok) {
      registry = body.sort((a, b) => a.name.localeCompare(b.name))
      fillRegistry()
    }

    loadGmMode()
    loadLog()
    setInterval(() => { if (!logSearch) loadLog() }, logRefreshMs)
  })
})()
