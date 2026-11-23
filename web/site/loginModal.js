(function () {
  const promoImages = {
    login: '/franchise/fairies/pixie-hollow/img/publishing/mini-manager/promo.login.jpg',
    choose: '/franchise/fairies/pixie-hollow/img/publishing/mini-manager/promo.choose-fairy.jpg'
  }

  let modal = null
  let board = null
  let info = null
  let promo = null
  let lastFocus = null

  function element (tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function spriteButton (text, kind, type) {
    const button = element('button', kind)
    button.type = type || 'button'
    button.appendChild(element('span', '', text))
    return button
  }

  function build () {
    modal = element('div', 'loginModal')
    modal.hidden = true
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    modal.setAttribute('aria-labelledby', 'loginModalTitle')

    board = element('div', 'modalBoard')
    const close = element('button', 'modalClose')
    close.type = 'button'
    close.setAttribute('aria-label', 'Close')
    close.addEventListener('click', closeModal)

    promo = element('img', 'modalPromo')
    promo.alt = ''
    promo.width = 363
    promo.height = 361

    info = element('div', 'modalInfo')

    board.append(element('div', 'modalLogo'), close, promo, info)
    modal.appendChild(board)
    document.body.appendChild(modal)

    modal.addEventListener('click', event => {
      if (event.target === modal) closeModal()
    })
    document.addEventListener('keydown', event => {
      if (modal.hidden) return
      if (event.key === 'Escape') closeModal()
      if (event.key === 'Tab') keepFocusInside(event)
    })
    window.addEventListener('resize', fitBoard)
  }

  function keepFocusInside (event) {
    const focusable = board.querySelectorAll('a[href], button, input, select')
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function fitBoard () {
    const scale = Math.min(1, (window.innerWidth - 16) / 788, (window.innerHeight - 16) / 559)
    board.style.transform = 'scale(' + scale + ')'
  }

  function showLogin () {
    promo.src = promoImages.login
    const title = element('h2', '', 'Log In')
    title.id = 'loginModalTitle'

    const form = element('form', 'modalForm')
    form.noValidate = true
    const userLabel = element('label', 'modalLabel', 'Account ID')
    userLabel.htmlFor = 'modalUser'
    const user = element('input', 'textInput')
    user.id = 'modalUser'
    user.name = 'username'
    user.autocomplete = 'username'
    const passLabel = element('label', 'modalLabel', 'Password')
    passLabel.htmlFor = 'modalPassword'
    const pass = element('input', 'textInput')
    pass.id = 'modalPassword'
    pass.type = 'password'
    pass.name = 'password'
    pass.autocomplete = 'current-password'
    const message = element('p', 'modalMessage')
    message.setAttribute('role', 'alert')
    const submitRow = element('p', 'modalButtons')
    const submit = spriteButton('Log In', 'buttonOrange', 'submit')
    submitRow.appendChild(submit)
    form.append(userLabel, user, passLabel, pass, message, submitRow)

    form.addEventListener('submit', async event => {
      event.preventDefault()
      message.textContent = ''
      if (!user.value.trim()) {
        message.textContent = 'Please enter your Account ID'
        user.focus()
        return
      }
      if (!pass.value) {
        message.textContent = 'Please enter your Password'
        pass.focus()
        return
      }

      submit.disabled = true
      submit.firstChild.textContent = 'Loading'
      try {
        const res = await fetch('/account/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: user.value.trim(), password: pass.value })
        })
        const body = await res.json().catch(() => ({}))
        if (!body.success) {
          const wording = {
            INVALID_CREDENTIALS: 'Login attempt failed, please try again.',
            TOO_MANY_ATTEMPTS: 'Too many tries. Please wait a little and try again.',
            LOGINS_LOCKED: 'Logging in is closed for now. Please try again later.'
          }
          message.textContent = wording[body.error] || 'Sorry, something\'s not right. Try back later!'
          return
        }
        const me = await window.site.loadMe(true)
        showNext(me)
        window.site.refresh()
      } finally {
        submit.disabled = false
        submit.firstChild.textContent = 'Log In'
      }
    })

    const intro = element('p', 'modalText', 'Log in below with your Account ID and Password.')
    const signUp = element('p', 'modalSignUp')
    signUp.append('Need an Account ID? ')
    const signUpLink = element('a', '', 'Sign Up')
    signUpLink.href = '/register.html'
    signUp.appendChild(signUpLink)

    const forgot = element('p', 'modalForgot')
    forgot.append('Forgot your ')
    const forgotNameLink = element('a', '', 'Account ID')
    forgotNameLink.href = '/forgotusername.html'
    const forgotLink = element('a', '', 'Password')
    forgotLink.href = '/forgot.html'
    forgot.append(forgotNameLink, ' or ', forgotLink, '?')

    info.replaceChildren(title, intro, form, signUp, forgot)
    user.focus()
  }

  function holdText (hold) {
    if (hold.until) {
      const when = new Date(hold.until).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
      return 'This account is on hold until ' + when + ' and can\'t fly into Pixie Hollow until then.'
    }
    return 'This account is on hold and can\'t fly into Pixie Hollow right now.'
  }



  const MAX_FAIRIES = 3

  // returns the list, and wires the shared buttons to whatever is selected.
  function chooseList (me, buttons) {
    const list = element('div', 'chooseFairies')
    let selected = me.fairies[0] || null

    const page = element('a', 'buttonBlue')
    page.href = '/pixiepage.html'
    page.appendChild(element('span', '', 'Pixie Page'))

    const play = spriteButton('Play', 'buttonOrange')
    play.addEventListener('click', () => { if (selected) playAs(selected.id, play) })

    const create = element('a', 'buttonOrange')
    create.href = '/create.html'
    create.appendChild(element('span', '', 'Create'))

    function showButtonsFor (fairy) {
      selected = fairy
      page.hidden = !fairy
      play.hidden = !fairy
      create.hidden = Boolean(fairy)
      // follows the selection, since a page belongs to a fairy, not an account.
      if (fairy) page.href = fairy.address ? '/pixiepages/' + encodeURIComponent(fairy.address) : '/pixiepage.html'
    }

    function row (fairy) {
      const item = element('button', fairy ? 'chooseFairy' : 'chooseFairy chooseCreate')
      item.type = 'button'

      // A Sparrow Man whose portrait has not rendered gets his own silhouette.
      const bust = element('span', fairy ? 'chooseBust' : 'chooseBust chooseDefault')
      if (fairy && fairy.gender === 2) bust.classList.add('chooseMale')
      if (fairy) {
        const img = document.createElement('img')
        img.src = '/fairies-render/render/' + fairy.id
        img.alt = ''
        img.addEventListener('error', () => bust.classList.add('chooseDefault'))
        bust.appendChild(img)
      }

      item.append(bust, element('span', 'chooseName', fairy ? fairy.name : 'Create a Fairy'))
      item.addEventListener('click', () => {
        for (const other of list.querySelectorAll('.chooseFairy')) other.classList.remove('selectedFairy')
        item.classList.add('selectedFairy')
        showButtonsFor(fairy)
      })
      return item
    }

    const rows = []
    // slots come from the server, see fairyLimitFor
    const limit = me.maxFairies || MAX_FAIRIES
    for (const one of me.fairies.slice(0, limit)) rows.push(row(one))
    for (let i = me.fairies.length; i < limit; i++) rows.push(row(null))
    for (const item of rows) list.appendChild(item)

    if (rows.length) rows[0].classList.add('selectedFairy')
    showButtonsFor(selected)
    buttons.append(page, play, create)

    return list
  }

  function showChoose (me) {
    promo.src = promoImages.choose
    const fairy = me && me.fairies && me.fairies.length ? me.fairies.find(f => f.name === me.fairyName) || me.fairies[0] : null

    const several = Boolean(me && me.fairies && me.fairies.length > 1)
    const title = element('h2', '', (me && me.hold)
      ? 'Account On Hold'
      : several ? 'Which Fairy Today?' : fairy ? 'Welcome Back!' : 'Create Your Fairy')
    title.id = 'loginModalTitle'

    const card = element('div', (me && me.hold) ? 'oneFairy' : fairy ? 'chooseCard' : 'noFairy')
    const buttons = element('p', 'modalButtons')

    if (me && me.hold) {
      card.appendChild(element('p', 'fairyName', fairy ? fairy.name : (me.username || 'Your account')))
      card.appendChild(element('p', 'holdNotice', holdText(me.hold)))
      if (me.hold.reason) card.appendChild(element('p', 'holdReason', 'Reason given: ' + me.hold.reason))
      const appeal = element('a', 'buttonOrange')
      appeal.href = '/contactUs.html?issue=banAppeal'
      appeal.appendChild(element('span', '', 'Appeal This'))
      const page = element('a', 'buttonBlue')
      page.href = fairy && fairy.address ? '/pixiepages/' + encodeURIComponent(fairy.address) : '/pixiepage.html'
      page.appendChild(element('span', '', 'Pixie Page'))
      buttons.append(appeal, page)
    } else if (fairy) {
      // the mini-manager, rebuilt from the original markup in plugin.js
      card.appendChild(chooseList(me, buttons))
    } else {
      card.appendChild(element('p', 'fairyName', 'You haven\'t made a Fairy yet!'))
      const create = element('a', 'buttonOrange')
      create.href = '/create.html'
      create.appendChild(element('span', '', 'Create a Fairy'))
      buttons.appendChild(create)
    }
    card.appendChild(buttons)

    const notYou = element('p', 'modalSignUp')
    notYou.append('Not ' + (me ? me.username : 'you') + '? ')
    const out = element('a', '', 'Log Out')
    out.href = '#'
    out.addEventListener('click', event => {
      event.preventDefault()
      window.site.logOut()
    })
    notYou.appendChild(out)

    info.replaceChildren(title, card, notYou)
    const firstButton = buttons.querySelector('button, a')
    if (firstButton) firstButton.focus()
  }

  function needsProfile (me) {
    return Boolean(me) && !me.hold && (me.age === null || !me.email)
  }

  function showNext (me) {
    if (needsProfile(me)) showProfile(me)
    else showChoose(me)
  }

  const profileErrors = {
    INVALID_AGE: 'Please tell us how old you are.',
    PARENT_EMAIL_NEEDED: 'Please enter a parent or guardian\'s e-mail address.',
    EMAIL_NEEDED: 'Please enter a valid e-mail address.'
  }

  function showProfile (me) {
    promo.src = promoImages.choose
    const needAge = me.age === null
    const needEmail = !me.email

    const title = element('h2', '', 'One More Thing')
    title.id = 'loginModalTitle'

    const what = needAge && needEmail ? 'how old you are and an e-mail address' : needAge ? 'how old you are' : 'an e-mail address'
    const intro = element('p', 'modalText', 'Please tell us ' + what + ' to keep going.')

    const form = element('form', 'modalForm')
    form.noValidate = true

    const ageLabel = element('label', 'modalLabel', 'How old are you?')
    ageLabel.htmlFor = 'modalAge'
    const age = element('select', 'textInput')
    age.id = 'modalAge'
    age.appendChild(new Option('Age', ''))
    for (let years = 1; years <= 99; years++) age.appendChild(new Option(String(years), String(years)))

    const emailLabel = element('label', 'modalLabel', 'E-mail address')
    emailLabel.htmlFor = 'modalEmail'
    const email = element('input', 'textInput')
    email.id = 'modalEmail'
    email.type = 'email'
    email.autocomplete = 'email'
    const note = element('p', 'modalText', 'SpeedChat Plus stays off until a parent or guardian confirms this address and turns it on.')

    const message = element('p', 'modalMessage')
    message.setAttribute('role', 'alert')
    const submitRow = element('p', 'modalButtons')
    submitRow.appendChild(spriteButton('Continue', 'buttonOrange', 'submit'))

    function isChild () {
      return needAge ? (age.value !== '' && Number(age.value) < 13) : Boolean(me.underThirteen)
    }

    function updateFields () {
      const showEmail = needEmail || (needAge && isChild())
      emailLabel.hidden = !showEmail
      email.hidden = !showEmail
      note.hidden = !(showEmail && isChild())
      emailLabel.textContent = isChild() ? 'Parent/Guardian\'s e-mail address' : 'E-mail address'
    }

    if (needAge) form.append(ageLabel, age)
    form.append(emailLabel, email, note, message, submitRow)
    age.addEventListener('change', updateFields)
    updateFields()

    form.addEventListener('submit', async event => {
      event.preventDefault()
      message.textContent = ''

      if (needAge && !age.value) {
        message.textContent = profileErrors.INVALID_AGE
        age.focus()
        return
      }

      const submit = submitRow.querySelector('button')
      submit.disabled = true
      try {
        const res = await fetch('/account/complete-profile', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ age: age.value, email: email.value.trim() })
        })
        const body = await res.json().catch(() => ({}))
        if (!body.success) {
          message.textContent = profileErrors[body.error] || 'Sorry, something\'s not right. Try back later!'
          return
        }
        const fresh = await window.site.loadMe(true)
        window.site.refresh()
        showNext(fresh)
      } finally {
        submit.disabled = false
      }
    })

    const notYou = element('p', 'modalSignUp')
    notYou.append('Not ' + me.username + '? ')
    const out = element('a', '', 'Log Out')
    out.href = '#'
    out.addEventListener('click', event => {
      event.preventDefault()
      window.site.logOut()
    })
    notYou.appendChild(out)

    info.replaceChildren(title, intro, form, notYou)
    ;(needAge ? age : email).focus()
  }

  async function playAs (fairyId, button) {
    button.disabled = true
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
  }

  async function open () {
    if (!modal) build()
    lastFocus = document.activeElement
    modal.hidden = false
    document.body.classList.add('modalOpen')
    fitBoard()

    // show the log in form straight away
    showLogin()

    const me = await window.site.loadMe()
    if (me && !modal.hidden) showNext(me)
  }

  function closeModal () {
    modal.hidden = true
    document.body.classList.remove('modalOpen')
    if (lastFocus && lastFocus.focus) lastFocus.focus()
  }

  window.loginModal = { open, close: closeModal }
})()
