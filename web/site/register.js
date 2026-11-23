(function () {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

  const byId = id => document.getElementById(id)
  const form = byId('regForm')
  const stepOne = byId('stepOne')
  const stepTwo = byId('stepTwo')
  const stepDone = byId('stepDone')

  const inviteToken = new URLSearchParams(window.location.search).get('invite') || ''

  async function chooseMode () {
    let mode = { gated: false }
    try {
      const res = await fetch('/account/registration-mode' + (inviteToken ? '?invite=' + encodeURIComponent(inviteToken) : ''))
      if (res.ok) mode = await res.json()
    } catch (err) {
      mode = { gated: false }
    }

    if (mode.gated && !mode.valid) {
      byId('waitlistInviteNote').hidden = !inviteToken
      byId('waitlistBox').hidden = false
      return
    }

    if (mode.gated && mode.email) byId('email').value = mode.email
    form.hidden = false
  }

  const waitlistErrors = {
    INVALID_EMAIL: 'Please enter a valid e-mail address.',
    TOO_MANY: 'That is a lot of tries. Please try again in an hour.',
    NOT_NEEDED: 'Good news, you can sign up right now!'
  }

  byId('waitlistForm').addEventListener('submit', async event => {
    event.preventDefault()
    const email = byId('waitlistEmail').value.trim()
    const error = byId('waitlistEmailError')
    const message = byId('waitlistMessage')
    const button = byId('waitlistButton')

    error.textContent = ''
    message.textContent = ''
    byId('waitlistEmail').classList.remove('invalid')

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      error.textContent = waitlistErrors.INVALID_EMAIL
      byId('waitlistEmail').classList.add('invalid')
      byId('waitlistEmail').focus()
      return
    }

    button.disabled = true
    try {
      const res = await fetch('/account/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      const body = await res.json().catch(() => ({}))

      if (body.error === 'NOT_NEEDED') {
        window.location.replace('/register.html')
        return
      }
      if (!body.success) {
        message.textContent = waitlistErrors[body.error] || 'Sorry, something\'s not right. Try back later!'
        return
      }

      byId('waitlistDoneEmail').textContent = email
      byId('waitlistForm').hidden = true
      byId('waitlistLead').hidden = true
      byId('waitlistInviteNote').hidden = true
      byId('waitlistDone').hidden = false
    } catch (err) {
      message.textContent = 'Sorry, something\'s not right. Try back later!'
    } finally {
      button.disabled = false
    }
  })

  function addOptions (select, values, labels) {
    values.forEach((value, index) => {
      const option = document.createElement('option')
      option.value = value
      option.textContent = labels ? labels[index] : value
      select.appendChild(option)
    })
  }

  function fillDays () {
    const select = byId('birthDay')
    const kept = select.value
    const month = parseInt(byId('birthMonth').value, 10)
    const count = month ? daysInMonth[month - 1] : 31
    select.length = 1
    addOptions(select, Array.from({ length: count }, (_, i) => i + 1))
    if (kept && parseInt(kept, 10) <= count) select.value = kept
  }

  chooseMode()

  addOptions(byId('birthMonth'), months.map((_, i) => i + 1), months)
  addOptions(byId('age'), Array.from({ length: 99 }, (_, i) => i + 1))
  fillDays()
  byId('birthMonth').addEventListener('change', fillDays)

  document.querySelectorAll('.whatsThis').forEach(button => {
    button.addEventListener('click', () => {
      const tip = byId(button.getAttribute('aria-controls'))
      tip.hidden = !tip.hidden
      button.setAttribute('aria-expanded', !tip.hidden)
    })
  })

  function setError (fieldIds, errorId, message) {
    byId(errorId).textContent = message || ''
    for (const fieldId of [].concat(fieldIds)) {
      const field = byId(fieldId)
      field.classList.toggle('invalid', Boolean(message))
      if (message) field.setAttribute('aria-describedby', errorId)
      else field.removeAttribute('aria-describedby')
    }
    return !message
  }

  function focusFirstError (section) {
    const bad = section.querySelector('.invalid')
    if (bad) bad.focus()
  }

  async function checkStepOne () {
    const month = byId('birthMonth').value
    const day = byId('birthDay').value
    const age = byId('age').value
    const username = byId('username').value.trim()
    const password = byId('password').value
    const again = byId('passwordAgain').value

    let ok = setError(['birthMonth', 'birthDay'], 'birthdayError', month && day ? '' : 'Please enter your birthday.')
    ok = setError('age', 'ageError', age ? '' : 'Please tell us how old you are.') && ok

    let usernameMessage = ''
    if (!/^[a-zA-Z0-9]{3,20}$/.test(username)) usernameMessage = 'Account IDs are 3 to 20 letters or numbers.'
    ok = setError('username', 'usernameError', usernameMessage) && ok

    let passwordMessage = ''
    if (password.length < 6) passwordMessage = 'Passwords need at least 6 characters.'
    else if (password.toLowerCase() === username.toLowerCase()) passwordMessage = 'Your password can\'t be your Account ID.'
    ok = setError('password', 'passwordError', passwordMessage) && ok
    ok = setError('passwordAgain', 'passwordAgainError', again && again === password ? '' : 'Passwords do not match.') && ok

    if (ok) {
      const res = await fetch('/account/username-available?username=' + encodeURIComponent(username)).catch(() => null)
      const body = res && res.ok ? await res.json() : null
      if (body && !body.available) ok = setError('username', 'usernameError', 'Sorry, that Account ID is taken. Please try another.')
    }

    if (!ok) focusFirstError(stepOne)
    return ok
  }

  function checkStepTwo () {
    const firstName = byId('firstName').value.trim()
    const email = byId('email').value.trim()
    let ok = setError('firstName', 'firstNameError', /^[a-zA-Z][a-zA-Z' -]{0,29}$/.test(firstName) ? '' : 'Please enter a valid name.')
    ok = setError('email', 'emailError', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? '' : 'Please enter a valid e-mail address.') && ok
    if (!ok) focusFirstError(stepTwo)
    return ok
  }

  function showStepTwo () {
    const isChild = parseInt(byId('age').value, 10) < 13
    byId('emailIntro').textContent = isChild ? 'Almost finished! Please enter your parent or guardian\'s e-mail address correctly.' : 'Almost finished! Please enter your e-mail address.'
    byId('emailLabel').textContent = isChild ? 'Parent/Guardian\'s E-mail Address:' : 'Your E-mail Address:'
    byId('emailNote').textContent = 'SpeedChat Plus stays off until a parent or guardian confirms this address and turns it on. We will send them an e-mail.'
    byId('emailNote').hidden = !isChild
    stepOne.hidden = true
    stepTwo.hidden = false
    byId('firstName').focus()
  }

  byId('continueButton').addEventListener('click', async () => {
    const button = byId('continueButton')
    button.disabled = true
    try {
      if (await checkStepOne()) showStepTwo()
    } finally {
      button.disabled = false
    }
  })

  byId('backButton').addEventListener('click', () => {
    stepTwo.hidden = true
    stepOne.hidden = false
    byId('username').focus()
  })

  const serverErrors = {
    USERNAME_TAKEN: 'Sorry, that Account ID was just taken. Go back and try another.',
    INVALID_USERNAME: 'That Account ID can\'t be used. Go back and try another.',
    INVALID_PASSWORD: 'That password can\'t be used. Go back and try another.',
    INVALID_NAME: 'Please enter a valid name.',
    INVALID_EMAIL: 'Please enter a valid e-mail address.',
    TOO_MANY: 'That is a lot of sign-ups from here. Please try again in an hour.',
    INVITE_REQUIRED: 'This invitation link has already been used, or is not right. Please join the waitlist for a new one.',
    REGISTRATIONS_LOCKED: 'Sign-ups are closed for now. Please try again later.'
  }

  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (stepTwo.hidden) {
      byId('continueButton').click()
      return
    }
    if (!checkStepTwo()) return

    const button = byId('signUpButton')
    const message = byId('signUpMessage')
    button.disabled = true
    message.textContent = ''

    try {
      const res = await fetch('/account/register', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: byId('username').value.trim(),
          password: byId('password').value,
          age: byId('age').value,
          firstName: byId('firstName').value.trim(),
          email: byId('email').value.trim(),
          inviteToken
        })
      })
      const body = await res.json().catch(() => ({}))
      if (!body.success) {
        message.textContent = serverErrors[body.error] || 'Sorry, something\'s not right. Try back later!'
        return
      }
      byId('doneName').textContent = body.username
      byId('doneEmailNote').textContent = 'We sent an e-mail to ' + byId('email').value.trim() + '. Open the link inside to confirm it.'
      form.hidden = true
      stepDone.hidden = false
      window.site.loadMe(true)
      window.site.refresh()
    } catch (err) {
      message.textContent = 'Sorry, something\'s not right. Try back later!'
    } finally {
      button.disabled = false
    }
  })
})()
