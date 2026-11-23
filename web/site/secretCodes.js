(function () {
  const byId = id => document.getElementById(id)

  const problems = {
    ERROR_INVALID_PARMS: 'That code does not look right. Please check it and try again.',
    CODE_EXPIRED: 'Oops! That code has expired.',
    AT_MAX_USES: 'You have already redeemed this secret code.',
    CODE_ALREADY_USED: 'Oops! Looks like this code has already been used. Please try a different code.',
    NO_FAIRY_ACTIVE: 'You need at least one fairy to redeem a secret code.',
    ALREADY_OWNED: 'All of your fairies already have this gift, so the code has not been used up.',
    TOO_SOON: 'You used this code a little while ago. Please try again later.',
    NO_ELIGIBLE_FAIRY: 'None of your fairies can use this gift, so the code has not been used up.',
    GRANT_FAILED: 'We could not deliver your gift just now, so the code has not been used up. Please try again in a minute.',
    TOO_MANY: 'That was a lot of tries. Please wait a little and try again.'
  }

  function setMessage (text, good) {
    const message = byId('codeMessage')
    message.textContent = text || ''
    message.classList.toggle('ok', Boolean(good))
  }

  // "in about 20 minutes", "in about 5 hours", or the day it comes round.
  function whenAgain (iso) {
    const minutes = Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 60000))
    if (minutes < 60) return 'in about ' + minutes + (minutes === 1 ? ' minute' : ' minutes')
    if (minutes < 60 * 48) return 'in about ' + Math.round(minutes / 60) + ' hours'
    return 'on ' + new Date(iso).toLocaleDateString()
  }

  function giftSentence (reward) {
    let what = reward.name
    if (reward.kind === 'pouch' || reward.kind === 'gold') what = reward.count + ' ' + reward.name
    if (reward.kind === 'badge') what = 'the ' + reward.name + ' badge'
    const start = 'You\'ve unlocked ' + what + ' for your fairies.'
    const end = ' Fly in and check ' + reward.where + ' for more details.'
    return start + (reward.description ? ' ' + reward.description : '') + end
  }

  async function showLoginNote () {
    const me = await window.site.loadMe()
    byId('codeLogin').hidden = Boolean(me)
  }

  byId('codeForm').addEventListener('submit', async event => {
    event.preventDefault()
    setMessage('')

    const code = byId('codeInput').value.trim()
    if (!code) {
      setMessage('Please type your code.')
      return
    }

    const me = await window.site.loadMe()
    if (!me) {
      byId('codeLogin').hidden = false
      window.site.openLogin()
      return
    }

    const button = byId('codeButton')
    button.disabled = true
    byId('giftBox').hidden = true

    try {
      const res = await fetch('/account/redeem-code', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      })
      const body = await res.json().catch(() => ({}))

      if (!body.success) {
        let text = problems[body.error] || 'Sorry, something\'s not right. Try back later!'
        if (body.error === 'TOO_SOON' && body.retryAt) text = 'You can use this code again ' + whenAgain(body.retryAt) + '.'
        setMessage(text)
        return
      }

      byId('giftText').textContent = giftSentence(body.reward)
      byId('giftOwned').textContent = body.alreadyOwned.length
        ? body.alreadyOwned.join(' and ') + (body.alreadyOwned.length === 1 ? ' already has' : ' already have') + ' this shimmerific item!'
        : ''
      byId('giftBox').hidden = false
      byId('codeInput').value = ''
    } finally {
      button.disabled = false
    }
  })

  showLoginNote()
})()
