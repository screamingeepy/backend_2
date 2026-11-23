(function () {
  const byId = id => document.getElementById(id)
  const { element, formatWhen } = window.tickets
  const { getJson, postJson, renderPager } = window.gmPortal

  const pageSize = 10
  let viewerTier = 'Moderator'

  // the three lists page like the tickets list
  function pagedList (listId, pagerId, countId, emptyText, buildRow) {
    let rows = []
    let page = 1

    function show () {
      const list = byId(listId)
      list.replaceChildren()

      if (!rows.length) {
        list.appendChild(element('li', 'ticketEmpty', emptyText))
        byId(pagerId).replaceChildren()
        return
      }

      page = renderPager(byId(pagerId), rows.length, page, pageSize, next => { page = next; show() })
      for (const row of rows.slice((page - 1) * pageSize, page * pageSize)) list.appendChild(buildRow(row))
    }

    return function setRows (next) {
      rows = next
      byId(countId).textContent = rows.length ? String(rows.length) : ''
      show()
    }
  }

  // removed fairies

  const removedUrl = '/fairies/api/gm/removed-fairies'

  const setRemovedFairies = pagedList('removedFairyList', 'removedPager', 'removedCount', 'None removed.', fairy => {
    const item = element('li', 'removedFairy')

    const who = element('span', 'removedWho')
    who.append(
      element('span', 'removedName', fairy.name || ('Fairy ' + fairy._id)),
      element('span', 'removedMeta',
        (fairy.ownerAccount || ('account ' + fairy.accountId)) +
        (fairy.deletedAt ? ' · removed ' + formatWhen(fairy.deletedAt) : ''))
    )

    const restore = element('button', 'btnGray', 'Restore')
    restore.type = 'button'
    restore.addEventListener('click', async () => {
      restore.disabled = true
      const { res: put, body: why } = await postJson('/fairies/api/gm/fairies/' + fairy._id + '/restore', {})
      if (!put.ok) {
        restore.disabled = false
        item.appendChild(element('span', 'removedNote', why.message || 'Could not restore her.'))
        return
      }
      loadRemovedFairies()
    })

    const actions = element('span', 'removedActions')
    actions.appendChild(restore)

    if (viewerTier === 'Administrator') {
      const purge = element('button', 'btnGray', 'Delete for good')
      purge.type = 'button'
      purge.addEventListener('click', async () => {
        if (!window.confirm('Delete ' + fairy.name + ' for good? This cannot be undone, and her name and address go with her.')) return
        purge.disabled = true
        const { res: gone, body: why } = await postJson('/fairies/api/gm/fairies/' + fairy._id + '/purge', {})
        if (!gone.ok) {
          purge.disabled = false
          item.appendChild(element('span', 'removedNote', why.message || 'Could not delete her.'))
          return
        }
        loadRemovedFairies()
      })
      actions.appendChild(purge)
    }

    item.append(who, actions)
    return item
  })

  async function loadRemovedFairies () {
    const { res, body } = await getJson(removedUrl)
    if (res.ok) setRemovedFairies(body)
  }

  // deleted accounts

  const deletedAccountsUrl = '/fairies/api/gm/deleted-accounts'

  const setDeletedAccounts = pagedList('deletedAccountList', 'deletedPager', 'deletedAccountCount', 'None deleted.', account => {
    const item = element('li', 'removedFairy')

    const who = element('span', 'removedWho')
    who.append(
      element('span', 'removedName', account.username),
      element('span', 'removedMeta',
        (account.email || 'no e-mail') + ' · deleted ' + formatWhen(account.deletedAt) +
        ' · ' + account.daysLeft + ' days left · ' + account.fairies + ' fairies')
    )

    const restore = element('button', 'btnGray', 'Restore')
    restore.type = 'button'
    restore.addEventListener('click', async () => {
      restore.disabled = true
      const { res: put, body: why } = await postJson('/fairies/api/gm/accounts/' + account._id + '/restore', {})
      if (!put.ok) {
        restore.disabled = false
        item.appendChild(element('span', 'removedNote', why.message || 'Could not restore it.'))
        return
      }
      loadDeletedAccounts()
      loadRemovedFairies()
    })

    const actions = element('span', 'removedActions')
    actions.appendChild(restore)

    if (viewerTier === 'Administrator') {
      const purge = element('button', 'btnGray', 'Delete for good')
      purge.type = 'button'
      purge.addEventListener('click', async () => {
        if (!window.confirm('Remove ' + account.username + ' for good? The account, its fairies and its tickets go, and this cannot be undone.')) return
        purge.disabled = true
        const { res: gone, body: why } = await postJson('/fairies/api/gm/accounts/' + account._id + '/purge', {})
        if (!gone.ok) {
          purge.disabled = false
          item.appendChild(element('span', 'removedNote', why.message || 'Could not remove it.'))
          return
        }
        loadDeletedAccounts()
      })
      actions.appendChild(purge)
    }

    item.append(who, actions)
    return item
  })

  async function loadDeletedAccounts () {
    const { res, body } = await getJson(deletedAccountsUrl)
    if (res.ok) setDeletedAccounts(body)
  }

  // the waitlist

  const waitlistUrl = '/fairies/api/gm/waitlist'
  let waitlistPage = 1
  let waitlistSearch = ''
  let searchTimer = null

  function setSettingsMessage (text, good) {
    const message = byId('waitlistAdminMessage')
    message.textContent = text || ''
    message.classList.toggle('ok', Boolean(good))
  }

  function setListMessage (text, good) {
    const message = byId('waitlistListMessage')
    message.textContent = text || ''
    message.classList.toggle('ok', Boolean(good))
  }

  function showOverview (info) {
    byId('waitlistEnabled').value = String(info.enabled)
    byId('waitlistCap').value = String(info.dailyCap)
    byId('waitlistCount').textContent = info.waiting ? String(info.waiting) : ''
    byId('waitlistStats').textContent = info.waiting + ' waiting · ' + info.invitedToday + ' of ' + info.dailyCap +
      ' invites used today · ' + info.outstanding + ' invited, not signed up · ' + info.registered + ' signed up' +
      (info.revoked ? ' · ' + info.revoked + ' revoked' : '')
  }

  async function loadOverview () {
    const { res, body } = await getJson(waitlistUrl)
    if (res.ok) showOverview(body)
    return res.ok ? body : null
  }

  function whenLine (entry) {
    if (entry.status === 'registered') return 'signed up as ' + entry.usedBy + ' · invited ' + formatWhen(entry.invitedAt)
    if (entry.status === 'revoked') return 'joined ' + formatWhen(entry.joinedAt) + ' · link revoked ' + formatWhen(entry.revokedAt)
    if (entry.status === 'invited') {
      return 'joined ' + formatWhen(entry.joinedAt) + ' · invited ' + formatWhen(entry.invitedAt) + (entry.bypass ? ' (by staff)' : '')
    }
    return 'joined ' + formatWhen(entry.joinedAt)
  }

  function entryRow (entry) {
    const item = element('li', 'removedFairy')

    const who = element('span', 'removedWho')
    who.append(element('span', 'removedName', entry.email), element('span', 'removedMeta', whenLine(entry)))

    const actions = element('span', 'removedActions')
    const can = entry.status === 'waiting' || entry.status === 'revoked'
      ? { label: 'Invite now', path: 'invite' }
      : entry.status === 'invited' ? { label: 'Revoke', path: 'revoke' } : null

    if (can) {
      const link = element('button', 'gmLink', can.label)
      link.type = 'button'
      link.addEventListener('click', async () => {
        if (can.path === 'revoke' && !window.confirm('Revoke the invite sent to ' + entry.email + '? The link stops working.')) return
        link.disabled = true
        setListMessage('')
        const { res, body } = await postJson(waitlistUrl + '/entries/' + entry.id + '/' + can.path, {})
        if (!res.ok) {
          link.disabled = false
          setListMessage(body.message || 'That did not work (' + res.status + ').')
          return
        }
        const overview = await loadOverview()
        setListMessage(can.path === 'invite'
          ? 'Invited ' + body.email + '.' + (overview ? ' ' + overview.remainingToday + ' left in today\'s batch.' : '')
          : 'Revoked the invite for ' + body.email + '.', true)
        loadEntries()
      })
      actions.appendChild(link)
    }

    item.append(who, actions)
    return item
  }

  async function loadEntries () {
    const query = '?view=' + byId('waitlistView').value + '&page=' + waitlistPage + '&pageSize=' + pageSize +
      (waitlistSearch ? '&search=' + encodeURIComponent(waitlistSearch) : '')
    const { res, body } = await getJson(waitlistUrl + '/entries' + query)
    const list = byId('waitlistList')
    list.replaceChildren()

    if (!res.ok || !body) {
      list.appendChild(element('li', 'ticketEmpty', 'Could not load the list (' + res.status + ').'))
      return
    }
    if (!body.items.length) {
      list.appendChild(element('li', 'ticketEmpty', waitlistSearch ? 'No matches.' : 'Nobody here.'))
      byId('waitlistPager').replaceChildren()
      return
    }

    for (const entry of body.items) list.appendChild(entryRow(entry))
    waitlistPage = renderPager(byId('waitlistPager'), body.total, waitlistPage, pageSize, next => { waitlistPage = next; loadEntries() })
  }

  byId('waitlistView').addEventListener('change', () => { waitlistPage = 1; setListMessage(''); loadEntries() })

  byId('waitlistSearch').addEventListener('input', event => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      waitlistSearch = event.target.value.trim()
      waitlistPage = 1
      loadEntries()
    }, 300)
  })

  byId('waitlistAdminForm').addEventListener('submit', async event => {
    event.preventDefault()
    setSettingsMessage('')

    const button = byId('waitlistSaveButton')
    button.disabled = true
    try {
      const { res, body } = await postJson(waitlistUrl, {
        enabled: byId('waitlistEnabled').value === 'true',
        dailyCap: byId('waitlistCap').value.trim()
      })
      if (!res.ok) {
        setSettingsMessage(body.message || 'That could not be saved (' + res.status + ').')
        return
      }
      showOverview(body)
      setSettingsMessage('Saved.', true)
      loadEntries()
    } finally {
      button.disabled = false
    }
  })

  document.addEventListener('gmSignedIn', event => {
    viewerTier = event.detail.accountType || 'Moderator'
    loadRemovedFairies()
    loadDeletedAccounts()

    if (viewerTier === 'Administrator') {
      byId('waitlistAdminBox').hidden = false
      loadOverview()
      loadEntries()
    }
  })
})()
