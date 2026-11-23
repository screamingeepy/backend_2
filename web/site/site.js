(function () {
  const seasons = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'fall', 'fall', 'fall', 'winter']
  document.documentElement.classList.add(seasons[new Date().getMonth()])

  // the page is laid out for 1000px, so a narrower window shrinks it whole rather than restacking it
  // phones (the 520px breakpoint in the stylesheets) get the stacked layout at full size instead
  const PAGE_WIDTH = 1000
  const PHONE_WIDTH = 520

  function fitPage () {
    const room = document.documentElement.clientWidth
    const zoom = room > PHONE_WIDTH && room < PAGE_WIDTH ? room / PAGE_WIDTH : 1
    for (const wrap of document.querySelectorAll('.siteWrap, .classicWrap')) {
      wrap.style.zoom = zoom === 1 ? '' : zoom
    }
  }

  fitPage()
  window.addEventListener('resize', fitPage)
  document.addEventListener('DOMContentLoaded', fitPage)

  let mePromise = null

  // everything that needs to know who is viewing waits on this one request
  const ME_TIMEOUT_MS = 8000

  function loadMe (force) {
    if (!mePromise || force) {
      mePromise = fetch('/account/me', { credentials: 'include', signal: AbortSignal.timeout(ME_TIMEOUT_MS) })
        .then(res => (res.ok ? res.json() : null))
        .then(me => (me && me.success ? me : null))
        .catch(() => null)
    }
    return mePromise
  }

  async function logOut () {
    await fetch('/account/logout', { method: 'POST', credentials: 'include' }).catch(() => null)
    location.reload()
  }

  function makeLink (href, text) {
    const link = document.createElement('a')
    link.href = href
    link.textContent = text
    return link
  }

  function separator () {
    const bar = document.createElement('span')
    bar.className = 'memberBarSeparator'
    bar.textContent = '|'
    return bar
  }

  async function fillMemberBar () {
    const holder = document.querySelector('[data-member-bar]')
    if (!holder) return

    const me = await loadMe()
    const parts = []

    if (me) {
      // the account, not the fairy: the fairy is chosen in the modal this opens.
      const name = makeLink('#', me.username)
      name.className = 'memberName'
      name.dataset.login = ''
      const out = makeLink('#', 'Log Out')
      out.addEventListener('click', event => {
        event.preventDefault()
        logOut()
      })
      parts.push(name, out, makeLink('/account', 'Account Manager'))
    } else {
      const login = makeLink('#', 'Log In')
      login.dataset.login = ''
      parts.push(login, makeLink('/register.html', 'Create a Fairy and Fly'))
    }

    holder.replaceChildren()
    parts.forEach((part, index) => {
      if (index) holder.appendChild(separator())
      holder.appendChild(part)
    })
    holder.hidden = false
  }

  function openLogin () {
    if (window.loginModal) window.loginModal.open()
    else location.href = '/index.html'
  }

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-login]')
    if (!trigger) return
    event.preventDefault()
    openLogin()
  })

  async function refresh () {
    const me = await loadMe()
    document.body.classList.toggle('isStaff', Boolean(me && me.isStaff))
    document.body.classList.toggle('isLoggedIn', Boolean(me))
    await fillMemberBar()
  }

  window.site = { loadMe, logOut, openLogin, refresh }

  const termsScript = document.createElement('script')
  termsScript.src = '/site/termsModal.js'
  document.head.appendChild(termsScript)

  const dustStyle = document.createElement('link')
  dustStyle.rel = 'stylesheet'
  dustStyle.href = '/site/pixieDust.css?v=20260929b'
  document.head.appendChild(dustStyle)

  const dustScript = document.createElement('script')
  dustScript.src = '/site/pixieDust.js?v=20260929b'
  document.head.appendChild(dustScript)

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh)
  else refresh()
})()
