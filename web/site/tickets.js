(function () {
  const categoryLabels = {
    account: 'Account',
    tech: 'Tech',
    bugSite: 'Bug Report: Site',
    bugGame: 'Bug Report: Game',
    memberReport: 'Member Report',
    banAppeal: 'Ban Appeal',
    forgotCredentials: 'Forgot Username or Password',
    general: 'General Inquiry',
    applicationMod: 'Application: Mod Team',
    applicationCode: 'Application: Code Team'
  }

  const statusLabels = {
    open: 'Open',
    pending: 'Waiting on Player',
    resolved: 'Resolved',
    closed: 'Closed'
  }

  // labels for the per category answers in ticket.details
  const detailLabels = {
    stepsToReproduce: 'Steps to reproduce',
    expectedBehavior: 'Expected behavior',
    incidentWhen: 'When it happened',
    incidentWhere: 'Where it happened',
    banWhen: 'When the ban happened',
    banReason: 'Reason given',
    whyReview: 'Why it should be reviewed',
    reporterName: 'Reported by',
    reportCategory: 'Reported for',
    reportCategoryCode: 'Category code',
    reportedFairyId: 'Reported Fairy ID',
    reportedAccountId: 'Reported Account ID',
    reporterFairyId: 'Reporter Fairy ID',
    username: 'Account ID',
    fairyName: 'Fairy name',
    accountInfo: 'Account information'
  }

  function humanize (key) {
    const spaced = String(key).replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
  }

  function detailRows (ticket) {
    const details = (ticket && ticket.details) || null
    if (!details) return []
    return (details instanceof Map ? Array.from(details) : Object.entries(details))
      .filter(([, value]) => String(value || '').trim())
      .map(([key, value]) => [detailLabels[key] || humanize(key), String(value)])
  }

  function element (tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function shortId (id) {
    return '#' + String(id).slice(-6).toUpperCase()
  }

  function formatWhen (date) {
    return new Date(date).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  function formatDate (date) {
    return new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function statusBadge (status) {
    return element('span', 'statusBadge ' + status, statusLabels[status] || status)
  }

  function categoryLabel (category) {
    return categoryLabels[category] || category || 'General Inquiry'
  }

  function renderThread (messages, staffName) {
    const list = element('ol', 'messageList')
    for (const message of messages) {
      const item = element('li', 'messageItem ' + message.from)
      const who = message.from === 'staff' ? (message.authorName || staffName || 'Pixie Hollow Team') : 'Player'
      const head = element('p', 'messageHead')
      head.append(element('strong', '', who), ' · ' + formatWhen(message.sentAt))
      item.append(head, element('p', 'messageBody', message.body))
      list.appendChild(item)
    }
    return list
  }

  function attachmentList (ticket) {
    const files = (ticket && ticket.attachments) || []
    if (!files.length) return null

    const wrap = element('div', 'ticketFiles')
    wrap.appendChild(element('p', 'ticketFilesHead', files.length === 1 ? 'Attached image' : 'Attached images'))

    const strip = element('ul', 'ticketFileStrip')
    for (const file of files) {
      const item = element('li')
      const link = element('a', 'ticketFile')
      link.href = file.url
      link.target = '_blank'
      link.rel = 'noopener'
      link.title = file.name || 'Attachment'
      const img = document.createElement('img')
      img.src = file.url
      img.alt = file.name || 'Attachment'
      img.loading = 'lazy'
      link.appendChild(img)
      item.appendChild(link)
      strip.appendChild(item)
    }

    wrap.appendChild(strip)
    return wrap
  }

  window.tickets = {
    categoryLabels, statusLabels, detailLabels,
    element, shortId, formatWhen, formatDate, statusBadge, categoryLabel, renderThread,
    detailRows, attachmentList
  }
})()
