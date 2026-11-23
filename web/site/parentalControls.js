(function () {
  const byId = id => document.getElementById(id)

  const emailWording = {
    MISSING_FIELDS: 'Please fill in both the Account ID and the e-mail address.',
    NO_MATCH: 'We couldn\'t find an account with that Account ID and e-mail address. Please check for typos and try again.',
    NOT_UNDER_THIRTEEN: 'That account belongs to a player 13 or over, so it doesn\'t use Parental Controls.',
    NO_EMAIL: 'That account has no e-mail address on it yet.',
    TOO_MANY: 'That was a lot of tries. Please wait a little and try again.',
    SEND_FAILED: 'We could not send the e-mail just now. Please try again in a little while.'
  }

  const portalWording = {
    EMAIL_NOT_CONFIRMED: 'Please open the confirmation link we e-mailed to the new address first.',
    NOTHING_TO_CHANGE: 'Type a new Account ID or e-mail address first.',
    INVALID_USERNAME: 'Account IDs are 3 to 20 letters or numbers.',
    USERNAME_TAKEN: 'Sorry, that Account ID is taken. Please try another.',
    INVALID_EMAIL: 'Please enter a valid e-mail address.',
    TOO_MANY: 'You have already asked. Please wait a little.'
  }

  function setMessage (id, text, good) {
    const message = byId(id)
    message.textContent = text || ''
    message.classList.toggle('ok', Boolean(good))
  }

  async function request (method, url, body) {
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }

  function show (section) {
    byId('needLink').hidden = section !== 'needLink'
    byId('portal').hidden = section !== 'portal'
  }

  async function showNeedLink (notice) {
    byId('portalStatus').textContent = notice || 'Parents and guardians, welcome.'
    show('needLink')

    const me = await window.site.loadMe()
    byId('childLinkRow').hidden = !(me && me.underThirteen)
  }

  function renderIgnored (ignored) {
    const list = byId('ignoreList')
    list.replaceChildren()

    if (!ignored.length) {
      const empty = document.createElement('li')
      empty.className = 'ignoreEmpty'
      empty.textContent = 'Nobody is ignored.'
      list.appendChild(empty)
      return
    }

    for (const entry of ignored) {
      const item = document.createElement('li')
      const name = document.createElement('span')
      name.textContent = entry.name
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'btnGray ignoreRemove'
      button.textContent = 'Unignore'
      button.setAttribute('aria-label', 'Unignore ' + entry.name)
      button.addEventListener('click', async () => {
        button.disabled = true
        await request('POST', '/account/parent/unignore', { id: entry.id })
        loadOverview()
      })
      item.append(name, button)
      list.appendChild(item)
    }
  }

  function renderChat (overview) {
    const explain = byId('chatExplain')
    const button = byId('chatButton')

    if (overview.chatApproved && overview.emailConfirmed) {
      explain.textContent = 'SpeedChat Plus is ON. This player can type their own messages, and they are filtered like everyone else\'s. You can switch it off at any time.'
      button.textContent = 'Turn Off SpeedChat Plus'
      button.dataset.enable = 'false'
    } else {
      explain.textContent = overview.emailConfirmed
        ? 'SpeedChat Plus is OFF. This player can only chat with the ready-made SpeedChat phrases. Turning it on lets them type their own messages.'
        : 'SpeedChat Plus is OFF. First open the confirmation link we e-mailed to ' + overview.email + '. Then you can turn it on.'
      button.textContent = 'Turn On SpeedChat Plus'
      button.dataset.enable = 'true'
    }
    button.disabled = !overview.emailConfirmed
  }

  async function loadOverview () {
    const { status, body } = await request('GET', '/account/parent/overview')

    if (status === 401) return showNeedLink('Your time here has ended. Please ask for a new link.')
    if (body.error === 'NOT_UNDER_THIRTEEN') return showNeedLink('This account is 13 or over now, so it no longer uses Parental Controls.')
    if (!body.success) return showNeedLink('Something went wrong. Please try again in a little while.')

    byId('portalStatus').textContent = 'Looking after the account ' + body.username
    byId('portalUsername').textContent = body.username
    byId('portalEmail').textContent = body.email + (body.emailConfirmed ? '' : ' (not confirmed yet)')
    byId('portalAge').textContent = body.age
    byId('minutesLeft').textContent = 'This page closes in about ' + body.minutesLeft + ' minutes.'
    renderChat(body)
    renderIgnored(body.ignored)
    show('portal')
  }

  byId('chatButton').addEventListener('click', async () => {
    const button = byId('chatButton')
    button.disabled = true
    const { body } = await request('POST', '/account/parent/chat', { enabled: button.dataset.enable === 'true' })
    setMessage('chatMessage', body.success ? 'Saved. It takes effect the next time this player logs in.' : (portalWording[body.error] || 'Sorry, something\'s not right. Try back later!'), body.success)
    await loadOverview()
  })

  byId('loginForm').addEventListener('submit', async event => {
    event.preventDefault()
    const button = byId('loginButton')
    button.disabled = true
    try {
      const { body } = await request('POST', '/account/parent/update-login', {
        newUsername: byId('newUsername').value.trim(),
        newEmail: byId('newEmail').value.trim()
      })
      if (!body.success) {
        setMessage('loginMessage', portalWording[body.error] || 'Sorry, something\'s not right. Try back later!')
        return
      }
      byId('loginForm').reset()
      setMessage('loginMessage', 'Saved. If you changed the e-mail, we sent a confirmation link to the new address.', true)
      await loadOverview()
    } finally {
      button.disabled = false
    }
  })

  byId('deleteButton').addEventListener('click', async () => {
    if (!confirm('Ask us to delete this account and all of its fairies?')) return
    const button = byId('deleteButton')
    button.disabled = true
    const { body } = await request('POST', '/account/parent/delete-request', {})
    setMessage('deleteMessage', body.success ? 'Thank you. Our team will be in touch by e-mail.' : (portalWording[body.error] || 'Sorry, something\'s not right. Try back later!'), body.success)
    button.disabled = false
  })

  byId('leaveButton').addEventListener('click', async () => {
    await request('POST', '/account/parent/leave', {})
    showNeedLink('You have left Parental Controls.')
  })

  byId('linkForm').addEventListener('submit', async event => {
    event.preventDefault()
    const button = byId('linkButton')
    button.disabled = true
    try {
      const { body } = await request('POST', '/account/parent/request-link', {
        username: byId('linkUsername').value.trim(),
        email: byId('linkEmail').value.trim()
      })
      setMessage('linkMessage', body.success ? 'Done! Check your e-mail for the link.' : (emailWording[body.error] || 'Sorry, something\'s not right. Try back later!'), body.success)
    } finally {
      button.disabled = false
    }
  })

  byId('childLinkButton').addEventListener('click', async () => {
    const button = byId('childLinkButton')
    button.disabled = true
    const { body } = await request('POST', '/account/parent/request-link', {})
    setMessage('linkMessage', body.success ? 'Done! We e-mailed your parent a link.' : (emailWording[body.error] || 'Sorry, something\'s not right. Try back later!'), body.success)
    button.disabled = false
  })

  async function start () {
    const params = new URLSearchParams(location.search)
    const token = params.get('token')

    if (token) {
      const { body } = await request('POST', '/account/parent/enter', { token })
      history.replaceState(null, '', location.pathname)

      if (!body.success) {
        const wording = {
          INVALID_LINK: 'That link has expired or was already used. Please ask for a new one.',
          NOT_UNDER_THIRTEEN: 'This account is 13 or over, so it doesn\'t use Parental Controls.',
          TOO_MANY: 'That was a lot of tries. Please wait a little and try again.'
        }
        return showNeedLink(wording[body.error] || 'Something went wrong. Please try again in a little while.')
      }
    }

    await loadOverview()
  }

  start()
})()
