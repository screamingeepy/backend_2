(function () {
  const who = document.getElementById('holdWho')
  const details = document.getElementById('holdDetails')

  const bannedName = new URLSearchParams(location.search).get('bannedUsername')
  if (bannedName) who.textContent = 'The account ' + bannedName + ' can\'t fly into Pixie Hollow right now.'

  function liftDate (until) {
    return new Date(until).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })
  }

  async function showHold () {
    const me = await window.site.loadMe()
    if (!me || !me.hold) return

    const lines = []
    if (me.hold.until) lines.push('This hold ends on ' + liftDate(me.hold.until) + '.')
    if (me.hold.reason) lines.push('Reason given: ' + me.hold.reason)
    if (!lines.length) return

    details.textContent = lines.join(' ')
    details.hidden = false
  }

  showHold()
})()
