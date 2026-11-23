(function () {
  const byId = id => document.getElementById(id)
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  const form = byId('forgotForm') || byId('forgotUsernameForm')
  if (!form) return

  const forUsername = form.id === 'forgotUsernameForm'
  const url = forUsername ? '/account/forgot-username' : '/account/forgot'

  function setError (fieldId, errorId, message) {
    byId(errorId).textContent = message || ''
    byId(fieldId).classList.toggle('invalid', Boolean(message))
    return !message
  }

  form.addEventListener('submit', async event => {
    event.preventDefault()

    const username = forUsername ? '' : byId('username').value.trim()
    const email = byId('email').value.trim()

    let ok = setError('email', 'emailError', emailPattern.test(email) ? '' : 'Please enter the e-mail address on your account.')
    if (!forUsername) ok = setError('username', 'usernameError', username ? '' : 'Please enter your Account ID.') && ok
    if (!ok) return

    const button = byId('sendButton')
    const message = byId('message')
    button.disabled = true
    message.textContent = ''

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(forUsername ? { email } : { username, email })
      })
      const body = await res.json().catch(() => ({}))

      if (!body.success) {
        const wording = {
          NO_MATCH: 'We couldn\'t find an account with that Account ID and e-mail address. Please check for typos and try again.',
          NO_ACCOUNT: 'We couldn\'t find an account with that e-mail address. Please check for typos and try again.',
          TOO_MANY: 'That was a lot of tries. Please wait a little and try again.'
        }
        message.textContent = wording[body.error] || 'Sorry, something\'s not right. Try back later!'
        return
      }

      byId('inputBox').hidden = true
      byId('sentBox').hidden = false
    } catch (err) {
      message.textContent = 'Sorry, something\'s not right. Try back later!'
    } finally {
      button.disabled = false
    }
  })
})()
