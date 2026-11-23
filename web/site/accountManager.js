(function () {
  const byId = id => document.getElementById(id)

  const tiers = [
    { value: 0, label: 'Free', diamonds: 0 },
    { value: 1, label: 'Weekly', diamonds: 30 },
    { value: 2, label: 'Monthly', diamonds: 60 },
    { value: 3, label: 'Semiannual', diamonds: 120 },
    { value: 4, label: 'Annual', diamonds: 240 },
    { value: 5, label: 'Member (No Diamonds)', diamonds: 0 }
  ]

  function setMessage (id, text, good) {
    const message = byId(id)
    message.textContent = text
    message.classList.toggle('ok', Boolean(good))
  }

  async function postJson (url, body) {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    return res.json().catch(() => ({}))
  }

  function renderTiers (selected) {
    const list = byId('tierList')
    list.querySelectorAll('.tierOption').forEach(option => option.remove())
    for (const tier of tiers) {
      const option = document.createElement('label')
      option.className = 'tierOption'
      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = 'tier'
      radio.value = tier.value
      radio.checked = tier.value === selected
      const name = document.createElement('span')
      name.textContent = tier.label
      const diamonds = document.createElement('span')
      diamonds.className = 'tierDiamonds'
      diamonds.textContent = tier.diamonds + ' / month'
      option.append(radio, name, diamonds)
      list.appendChild(option)
    }
  }

  function showAccount (me) {
    byId('loggedOut').hidden = true
    byId('loggedIn').hidden = false
    byId('welcomeName').textContent = me.firstName || me.fairyName || me.username
    byId('detailUsername').textContent = me.username
    byId('detailFirstName').textContent = me.firstName || '-'
    byId('detailEmail').textContent = me.email || '-'
    byId('detailEmailStatus').textContent = !me.email ? '-' : (me.emailConfirmed ? 'Confirmed' : 'Not confirmed yet')
    byId('resendConfirmButton').hidden = !me.email || me.emailConfirmed
    byId('detailAge').textContent = me.age || '-'
    byId('ageBox').hidden = Boolean(me.age)
    byId('loginChangeBox').hidden = Boolean(me.underThirteen) || !me.age
    byId('parentLoginNote').hidden = !me.underThirteen
    byId('ownEmailNote').hidden = !me.needsOwnEmail
    byId('deleteBox').hidden = Boolean(me.underThirteen || me.isStaff)
    byId('deleteConfirmLabel').textContent = me.email ? 'Your e-mail address:' : 'Your Account ID:'
    byId('detailFairy').textContent = me.fairies && me.fairies.length ? me.fairies.map(f => f.name).join(', ') : 'None yet'
    byId('diamondBalance').textContent = me.gold || 0
    renderTiers(me.membershipTier)
    document.querySelector('.staffLink').hidden = !me.isStaff
  }

  function showLogin () {
    byId('loggedIn').hidden = true
    byId('loggedOut').hidden = false
  }

  byId('loginForm').addEventListener('submit', async event => {
    event.preventDefault()
    const name = byId('loginName').value.trim()
    const password = byId('loginPassword').value
    if (!name || !password) {
      setMessage('loginMessage', !name ? 'Please enter your Account ID' : 'Please enter your Password')
      return
    }
    const button = byId('loginButton')
    button.disabled = true
    try {
      const body = await postJson('/account/login', { username: name, password })
      if (!body.success) {
        setMessage('loginMessage', 'Login attempt failed, please try again.')
        return
      }
      setMessage('loginMessage', '')
      const me = await window.site.loadMe(true)
      await window.site.refresh()
      if (me) showAccount(me)
    } finally {
      button.disabled = false
    }
  })

  byId('membershipForm').addEventListener('submit', async event => {
    event.preventDefault()
    const picked = document.querySelector('input[name="tier"]:checked')
    if (!picked) return
    const body = await postJson('/account/membership', { tier: Number(picked.value) })
    setMessage('membershipMessage', body.success ? 'Your Membership is now ' + body.tierLabel + '.' : 'Sorry, something\'s not right. Try back later!', body.success)
  })

  const passwordErrors = {
    WRONG_PASSWORD: 'Your old password is not correct. Please try again.',
    PASSWORD_TOO_SHORT: 'Passwords need at least 6 characters.',
    MISSING_FIELDS: 'Please fill in every box.'
  }

  byId('passwordForm').addEventListener('submit', async event => {
    event.preventDefault()
    const currentPassword = byId('oldPassword').value
    const newPassword = byId('newPassword').value
    if (newPassword !== byId('confirmPassword').value) {
      setMessage('passwordMessage', 'Passwords do not match.')
      return
    }
    const body = await postJson('/account/change-password', { currentPassword, newPassword })
    if (body.success) {
      byId('passwordForm').reset()
      setMessage('passwordMessage', 'Your password has been changed.', true)
    } else {
      setMessage('passwordMessage', passwordErrors[body.error] || 'Sorry, something\'s not right. Try back later!')
    }
  })

  byId('resendConfirmButton').addEventListener('click', async () => {
    const button = byId('resendConfirmButton')
    button.disabled = true
    const body = await postJson('/account/resend-confirmation', {})
    byId('detailEmailStatus').textContent = body.success
      ? 'Sent. Check your e-mail.'
      : (body.error === 'TOO_MANY' ? 'Please wait a little before asking again.' : 'Could not send it just now.')
    button.hidden = Boolean(body.success)
    button.disabled = false
  })

  const ageSelect = byId('ageInput')
  for (let age = 1; age <= 99; age++) ageSelect.appendChild(new Option(String(age), String(age)))
  ageSelect.addEventListener('change', () => {
    const age = parseInt(ageSelect.value, 10)
    byId('parentEmailRow').hidden = !(age < 13)
  })

  const ageErrors = {
    AGE_ALREADY_SET: 'This account already has an age. If it is wrong, please contact us.',
    INVALID_AGE: 'Please tell us how old you are.',
    PARENT_EMAIL_NEEDED: 'Please enter a parent or guardian\'s e-mail address.'
  }

  byId('ageForm').addEventListener('submit', async event => {
    event.preventDefault()
    const button = byId('ageButton')
    button.disabled = true
    try {
      const body = await postJson('/account/set-age', {
        age: ageSelect.value,
        email: byId('parentEmail').value.trim()
      })
      if (!body.success) {
        setMessage('ageMessage', ageErrors[body.error] || 'Sorry, something\'s not right. Try back later!')
        return
      }
      setMessage('ageMessage', 'Thank you! Your age has been saved.', true)
      const me = await window.site.loadMe(true)
      await window.site.refresh()
      if (me) showAccount(me)
    } finally {
      button.disabled = false
    }
  })

  const deleteErrors = {
    WRONG_PASSWORD: 'Your password is not correct. Please try again.',
    WRONG_CONFIRM: 'That does not match the account. Please check it and try again.',
    PARENT_ONLY: 'A parent or guardian can ask for this from Parental Controls.',
    STAFF_ACCOUNT: 'Staff accounts are removed by an Administrator.',
    ON_HOLD: 'An account on hold cannot be deleted. Please contact us.',
    TOO_MANY: 'Too many tries. Please wait a little and try again.'
  }

  byId('deleteForm').addEventListener('submit', async event => {
    event.preventDefault()
    if (!byId('deletePassword').value || !byId('deleteConfirm').value.trim()) {
      setMessage('deleteAccountMessage', 'Please fill in both boxes.')
      return
    }
    if (!confirm('Delete your account and hide all of your fairies?')) return

    const button = byId('deleteAccountButton')
    button.disabled = true
    try {
      const body = await postJson('/account/delete', {
        confirm: byId('deleteConfirm').value.trim(),
        password: byId('deletePassword').value
      })
      if (!body.success) {
        setMessage('deleteAccountMessage', deleteErrors[body.error] || 'Sorry, something went wrong. Try back later!')
        return
      }
      byId('deleteForm').reset()
      setMessage('deleteAccountMessage', 'Your account has been deleted. You can get it back by contacting us in the next ' + body.graceDays + ' days.', true)
      setTimeout(() => { location.href = '/' }, 4000)
    } finally {
      button.disabled = false
    }
  })

  const loginChangeErrors = {
    WRONG_PASSWORD: 'Your password is not correct. Please try again.',
    AGE_NEEDED: 'Please tell us your age first.',
    PARENT_ONLY: 'A parent or guardian can change this from Parental Controls.',
    NOTHING_TO_CHANGE: 'Type a new Account ID or e-mail first.',
    INVALID_USERNAME: 'Account IDs are 3 to 20 letters or numbers.',
    USERNAME_TAKEN: 'Sorry, that Account ID is taken. Please try another.',
    INVALID_EMAIL: 'Please enter a valid e-mail address.'
  }

  byId('loginChangeForm').addEventListener('submit', async event => {
    event.preventDefault()
    const button = byId('loginChangeButton')
    button.disabled = true
    try {
      const body = await postJson('/account/update-login', {
        newUsername: byId('newUsername').value.trim(),
        newEmail: byId('newEmail').value.trim(),
        password: byId('loginChangePassword').value
      })
      if (!body.success) {
        setMessage('loginChangeMessage', loginChangeErrors[body.error] || 'Sorry, something\'s not right. Try back later!')
        return
      }
      byId('loginChangeForm').reset()
      setMessage('loginChangeMessage', 'Your changes have been saved.', true)
      const me = await window.site.loadMe(true)
      await window.site.refresh()
      if (me) showAccount(me)
    } finally {
      button.disabled = false
    }
  })

  byId('logOutLink').addEventListener('click', event => {
    event.preventDefault()
    window.site.logOut()
  })

  window.site.loadMe().then(me => (me ? showAccount(me) : showLogin()))
})()
