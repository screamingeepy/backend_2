(function () {
  const termsAddress = '/termsofuse.html'

  let overlay = null
  let body = null
  let closeButton = null
  let lastFocus = null

  function element (tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function makeLink (href, text) {
    const link = element('a', '', text)
    link.href = href
    return link
  }

  function buildModal () {
    overlay = element('div', 'termsModal')
    overlay.hidden = true
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-labelledby', 'termsModalTitle')

    const panel = element('div', 'termsPanel')
    closeButton = element('button', 'termsClose')
    closeButton.type = 'button'
    closeButton.setAttribute('aria-label', 'Close')
    closeButton.addEventListener('click', closeTerms)

    const title = element('h2', 'termsTitle', 'Terms of Use')
    title.id = 'termsModalTitle'
    body = element('div', 'termsBody')

    panel.append(closeButton, title, body)
    overlay.appendChild(panel)
    document.body.appendChild(overlay)

    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeTerms()
    })
    document.addEventListener('keydown', event => {
      if (!overlay.hidden && event.key === 'Escape') closeTerms()
    })
  }

  async function fillTerms () {
    body.replaceChildren(element('p', 'proseBlock', 'Loading...'))

    try {
      const res = await fetch(termsAddress, { credentials: 'same-origin' })
      if (!res.ok) throw new Error('not found')
      const page = new DOMParser().parseFromString(await res.text(), 'text/html')
      const text = page.querySelector('.proseBlock')
      if (!text) throw new Error('no text')
      body.replaceChildren(document.importNode(text, true))
    } catch (err) {
      const fallback = element('p', 'proseBlock')
      fallback.append('The terms could not be loaded here. ', makeLink(termsAddress, 'Open them on their own page.'))
      body.replaceChildren(fallback)
    }
  }

  function openTerms () {
    if (!overlay) buildModal()
    lastFocus = document.activeElement
    overlay.hidden = false
    document.body.classList.add('modalOpen')
    closeButton.focus()
    fillTerms()
  }

  function closeTerms () {
    overlay.hidden = true
    document.body.classList.remove('modalOpen')
    if (lastFocus && lastFocus.focus) lastFocus.focus()
  }

  document.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (location.pathname === termsAddress) return
    const link = event.target.closest('a[href="' + termsAddress + '"]')
    if (!link) return
    event.preventDefault()
    openTerms()
  })

  window.termsModal = { open: openTerms, close: closeTerms }
})()
