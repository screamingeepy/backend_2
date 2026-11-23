(function () {
  const byId = id => document.getElementById(id)

  function show (heading, lead, more) {
    byId('confirmHeading').textContent = heading
    byId('confirmLead').textContent = lead
    const box = byId('confirmMore')
    box.replaceChildren()
    if (more) {
      const paragraph = document.createElement('p')
      paragraph.textContent = more
      box.appendChild(paragraph)
    }
    box.hidden = !more
  }

  async function confirm () {
    const token = new URLSearchParams(location.search).get('token') || ''

    if (!token) {
      show('This link is not right', 'Please use the link from the e-mail we sent you.')
      return
    }

    let body = null
    try {
      const res = await fetch('/account/confirm-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      })
      body = await res.json()
    } catch (err) {
      show('Something went wrong', 'We could not check your link just now. Please try again in a little while.')
      return
    }

    if (body.success) {
      show(
        'Thank you!',
        'Your e-mail address is confirmed.',
        body.underThirteen
          ? 'Typed chat stays off until you choose to turn it on in Parental Controls.'
          : ''
      )
      if (body.portal) {
        const link = document.createElement('a')
        link.href = '/parentalcontrols.html'
        link.textContent = 'Open Parental Controls'
        byId('confirmMore').appendChild(link)
      }
      return
    }

    if (body.error === 'TOO_MANY') {
      show('Please wait a little', 'That was a lot of tries. Please try again in an hour.')
      return
    }

    show('This link has expired or was already used', 'Log in and open the Account Manager to have a new one sent.')
  }

  confirm()
})()
