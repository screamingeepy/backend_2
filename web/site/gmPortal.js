(function () {
  const byId = id => document.getElementById(id)

  function show (section) {
    for (const id of ['gmLogin', 'gmDenied', 'gmTools']) byId(id).hidden = id !== section
  }

  async function getJson (url) {
    const res = await fetch(url, { credentials: 'include' })
    return { res, body: res.ok ? await res.json() : null }
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

  // every gm page loads this first and waits on 'gmSignedIn' before touching its tools
  function renderPager (holder, total, page, pageSize, onChange) {
    holder.replaceChildren()
    const pages = Math.max(1, Math.ceil(total / pageSize))
    if (page > pages) page = pages

    const arrow = (label, className, disabled, target) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = className
      button.setAttribute('aria-label', label)
      button.disabled = disabled
      button.addEventListener('click', () => onChange(target))
      return button
    }

    const range = document.createElement('span')
    range.className = 'gmPagerRange'
    if (total) range.textContent = ((page - 1) * pageSize + 1) + '-' + Math.min(total, page * pageSize) + ' of ' + total

    holder.append(
      arrow('Previous page', 'gmPagerArrow prev', page <= 1, page - 1),
      range,
      arrow('Next page', 'gmPagerArrow', page >= pages, page + 1)
    )
    return page
  }

  window.gmPortal = { getJson, postJson, renderPager }

  async function start () {
    const me = await window.site.loadMe(true)

    if (!me) {
      byId('gmLead').textContent = 'Please Log In to the GM Portal.'
      show('gmLogin')
      byId('gmLoginName').focus()
      return
    }
    if (!me.isStaff) {
      byId('gmLead').textContent = 'This page is for Pixie Hollow staff.'
      show('gmDenied')
      return
    }

    byId('gmLead').textContent = 'Signed in as ' + me.username + '.'
    show('gmTools')

    document.dispatchEvent(new CustomEvent('gmSignedIn', { detail: me }))
  }

  byId('gmLoginForm').addEventListener('submit', async event => {
    event.preventDefault()
    const name = byId('gmLoginName').value.trim()
    const password = byId('gmLoginPassword').value
    const message = byId('gmLoginMessage')
    if (!name || !password) {
      message.textContent = !name ? 'Please enter your Account ID' : 'Please enter your Password'
      return
    }
    const button = byId('gmLoginButton')
    button.disabled = true
    try {
      const { body } = await postJson('/account/login', { username: name, password })
      if (!body.success) {
        message.textContent = 'Login attempt failed, please try again.'
        return
      }
      message.textContent = ''
      await window.site.loadMe(true)
      await window.site.refresh()
      await start()
    } finally {
      button.disabled = false
    }
  })

  byId('gmSwitchAccount').addEventListener('click', event => {
    event.preventDefault()
    window.site.logOut()
  })

  start()
})()
