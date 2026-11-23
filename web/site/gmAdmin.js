(function () {
  'use strict'

  const byId = id => document.getElementById(id)
  const { getJson, postJson } = window.gmPortal

  const settingsUrl = '/fairies/api/gm/admin/settings'
  const toggleUrl = '/fairies/api/gm/admin/toggle'

  let currentSettings = null

  function setSwitchUI(switchId, stateId, isChecked, activeLabel, inactiveLabel) {
    const sw = byId(switchId)
    const st = byId(stateId)
    if (!sw) return

    sw.setAttribute('aria-checked', String(isChecked))
    if (st) {
      st.textContent = isChecked ? (activeLabel || 'On') : (inactiveLabel || 'Off')
      st.style.color = isChecked ? '#9be36a' : '#7fb3cf'
    }
  }

  async function loadSettings() {
    try {
      const { res, body } = await getJson(settingsUrl)
      if (!res || !res.ok || !body) {
        console.error('[gmAdmin] Could not fetch settings')
        return
      }

      currentSettings = body

      // Set announcement preview
      const announcementEl = byId('currentLoginAnnouncement')
      if (announcementEl) {
        announcementEl.textContent = body.timeSpanMessage || 'Welcome to the test server. Missing features and bugs are to be expected. Enjoy!'
      }

      // Set switches
      setSwitchUI('globalSpeedChatSwitch', 'globalSpeedChatState', body.globalSpeedChat, 'Enforced', 'Standard')
      setSwitchUI('multiFairySwitch', 'multiFairyState', body.multiFairy, 'Enabled', 'Disabled')
      setSwitchUI('lockLoginsSwitch', 'lockLoginsState', body.lockLogins, 'LOCKED', 'Open')
      setSwitchUI('lockRegistrationsSwitch', 'lockRegistrationsState', body.lockRegistrations, 'LOCKED', 'Open')
      setSwitchUI('lockTicketsSwitch', 'lockTicketsState', body.lockTickets, 'LOCKED', 'Open')
      setSwitchUI('lockApplicationsSwitch', 'lockApplicationsState', body.lockApplications, 'LOCKED', 'Open')
      setSwitchUI('lockSubmissionsSwitch', 'lockSubmissionsState', body.lockSubmissions, 'LOCKED', 'Open')
      setSwitchUI('lockContestsSwitch', 'lockContestsState', body.lockContests, 'LOCKED', 'Open')
    } catch (err) {
      console.error('[gmAdmin] Load error:', err)
    }
  }

  function setupToggleHandler(switchId, stateId, key, activeLabel, inactiveLabel, statusId) {
    const sw = byId(switchId)
    if (!sw) return

    sw.addEventListener('click', async () => {
      const current = sw.getAttribute('aria-checked') === 'true'
      const next = !current
      sw.disabled = true

      const statusEl = statusId ? byId(statusId) : null
      if (statusEl) {
        statusEl.textContent = 'Updating setting…'
        statusEl.className = 'formMessage'
      }

      try {
        const { res, body } = await postJson(toggleUrl, { key, enabled: next })
        if (res.ok && body.success) {
          setSwitchUI(switchId, stateId, next, activeLabel, inactiveLabel)
          if (statusEl) {
            statusEl.textContent = `Saved: ${key} is now ${next ? (activeLabel || 'On') : (inactiveLabel || 'Off')}.`
            statusEl.className = 'formMessage ok'
            setTimeout(() => {
              if (statusEl.textContent.startsWith('Saved:')) statusEl.textContent = ''
            }, 4000)
          }
        } else {
          if (statusEl) {
            statusEl.textContent = (body && body.message) || 'Failed to update setting.'
            statusEl.className = 'formMessage error'
          }
        }
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = 'Error connecting to server.'
          statusEl.className = 'formMessage error'
        }
      } finally {
        sw.disabled = false
      }
    })
  }

  const holidaysUrl = '/fairies/api/gm/admin/holidays'
  const holidayUrl = '/fairies/api/gm/admin/holiday'
  const holidayTagUrl = '/fairies/api/gm/admin/holiday-tag'

  function holidayStatus(message, ok) {
    const status = byId('holidayStatus')
    status.textContent = message
    status.className = 'formMessage center' + (ok === undefined ? '' : (ok ? ' ok' : ' error'))
  }

  function holidayRow(label, on, title, change) {
    const item = document.createElement('li')
    const name = document.createElement('span')
    name.textContent = `${label} - ${on ? 'ON' : 'off'}`
    name.style.color = on ? '#9be36a' : ''
    if (title) name.title = title
    item.appendChild(name)

    const button = document.createElement('button')
    button.type = 'button'
    button.className = on ? 'btnGray staffRemove' : 'btnGold staffRemove'
    button.textContent = on ? 'Turn off' : 'Turn on'
    button.addEventListener('click', async () => {
      button.disabled = true
      await change(!on)
    })
    item.appendChild(button)
    return item
  }

  async function sendHoliday(url, payload, label) {
    holidayStatus('Saving…')
    try {
      const { res, body } = await postJson(url, payload)
      const ok = res.ok && body && body.success
      holidayStatus(ok ? `${label} is now ${payload.enabled ? 'on' : 'off'}.` : ((body && body.message) || 'That could not be saved.'), ok)
      return ok
    } catch (err) {
      holidayStatus('Error connecting to server.', false)
      return false
    }
  }

  async function loadHolidays() {
    const list = byId('holidayList')
    const extra = byId('holidayExtra')
    if (!list || !extra) return

    const { res, body } = await getJson(holidaysUrl)
    list.replaceChildren()
    extra.replaceChildren()

    if (!res || !res.ok || !body || !Array.isArray(body.holidays)) {
      holidayStatus('The holiday list could not be loaded.', false)
      return
    }

    for (const holiday of body.holidays) {
      list.appendChild(holidayRow(holiday.label, holiday.enabled, holiday.tags.join(', '), async next => {
        await sendHoliday(holidayUrl, { id: holiday.id, enabled: next }, holiday.label)
        await loadHolidays()
      }))
    }

    if (!body.extra.length) {
      const item = document.createElement('li')
      item.className = 'staffEmpty'
      item.textContent = 'No single tags are on.'
      extra.appendChild(item)
    }

    for (const tag of body.extra) {
      extra.appendChild(holidayRow(tag, true, '', async next => {
        await sendHoliday(holidayTagUrl, { tag, enabled: next }, tag)
        await loadHolidays()
      }))
    }
  }

  function setupHolidayCard() {
    const form = byId('holidayTagForm')
    if (!form) return

    form.addEventListener('submit', async event => {
      event.preventDefault()
      const tag = byId('holidayTag').value.trim()
      if (!tag) return

      if (await sendHoliday(holidayTagUrl, { tag, enabled: true }, tag)) byId('holidayTag').value = ''
      await loadHolidays()
    })
  }

  const staffUrl = '/fairies/api/gm/admin/staff'

  async function loadStaff() {
    const list = byId('staffList')
    if (!list) return

    const { res, body } = await getJson(staffUrl)
    list.replaceChildren()

    if (!res || !res.ok || !Array.isArray(body)) {
      const li = document.createElement('li')
      li.className = 'staffEmpty'
      li.textContent = 'The staff list could not be loaded.'
      list.appendChild(li)
      return
    }

    for (const person of body) {
      const item = document.createElement('li')
      const name = document.createElement('span')
      name.textContent = `${person.username} - ${person.accountType}${person.you ? ' (you)' : ''}`
      item.appendChild(name)

      if (person.accountType === 'Moderator') {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'btnGray staffRemove'
        button.textContent = 'Remove'
        button.setAttribute('aria-label', `Take Moderator access away from ${person.username}`)
        button.addEventListener('click', () => changeTier(person.username, 'Player', button))
        item.appendChild(button)
      }

      list.appendChild(item)
    }
  }

  async function changeTier(username, tier, button) {
    const status = byId('staffStatus')

    if (tier === 'Player' && !confirm(`Take Moderator access away from ${username}? They will be disconnected if they are in the game.`)) return

    button.disabled = true
    status.textContent = 'Saving…'
    status.className = 'formMessage center'

    try {
      const { res, body } = await postJson(staffUrl, { username, tier })
      const ok = res.ok && body && body.success
      status.textContent = (body && body.message) || (ok ? 'Saved.' : 'That could not be saved.')
      status.className = 'formMessage center' + (ok ? ' ok' : ' error')
      if (ok) byId('staffName').value = ''
      await loadStaff()
    } catch (err) {
      status.textContent = 'Error connecting to server.'
      status.className = 'formMessage center error'
    } finally {
      button.disabled = false
    }
  }

  function setupStaffCard() {
    const form = byId('staffForm')
    if (!form) return

    form.addEventListener('submit', event => {
      event.preventDefault()
      changeTier(byId('staffName').value.trim(), 'Moderator', byId('staffAddButton'))
    })
  }

  function initUI() {


    // Broadcast Announcement Form
    const announcementForm = byId('announcementForm')
    if (announcementForm) {
      announcementForm.addEventListener('submit', async e => {
        e.preventDefault()
        const button = byId('broadcastAnnouncementButton')
        const status = byId('announcementStatus')
        const input = byId('announcementInput')
        const saveAsLogin = byId('saveAsLoginAnnouncement').checked
        const message = (input.value || '').trim()

        if (!message) {
          status.textContent = 'Please enter an announcement message.'
          status.className = 'formMessage center error'
          return
        }

        button.disabled = true
        status.textContent = 'Broadcasting in-game announcement…'
        status.className = 'formMessage center'

        try {
          const { res, body } = await postJson('/fairies/api/gm/admin/announcement', {
            message,
            saveAsLoginAnnouncement: saveAsLogin
          })

          if (res.ok && body.success) {
            status.textContent = `Announcement broadcast to all connected players!${saveAsLogin ? ' (Saved as welcome announcement)' : ''}`
            status.className = 'formMessage center ok'
            if (saveAsLogin && byId('currentLoginAnnouncement')) {
              byId('currentLoginAnnouncement').textContent = message
            }
            input.value = ''
          } else {
            status.textContent = (body && body.message) || 'Could not send announcement.'
            status.className = 'formMessage center error'
          }
        } catch (err) {
          status.textContent = 'Error sending announcement to server.'
          status.className = 'formMessage center error'
        } finally {
          button.disabled = false
        }
      })
    }

    // Set up toggles
    setupToggleHandler('globalSpeedChatSwitch', 'globalSpeedChatState', 'globalSpeedChat', 'Enforced', 'Standard', 'globalSpeedChatStatus')
    setupToggleHandler('multiFairySwitch', 'multiFairyState', 'multiFairy', 'Enabled', 'Disabled', 'multiFairyStatus')
    setupToggleHandler('lockLoginsSwitch', 'lockLoginsState', 'lockLogins', 'LOCKED', 'Open', 'lockdownStatus')
    setupToggleHandler('lockRegistrationsSwitch', 'lockRegistrationsState', 'lockRegistrations', 'LOCKED', 'Open', 'lockdownStatus')
    setupToggleHandler('lockTicketsSwitch', 'lockTicketsState', 'lockTickets', 'LOCKED', 'Open', 'lockdownStatus')
    setupToggleHandler('lockApplicationsSwitch', 'lockApplicationsState', 'lockApplications', 'LOCKED', 'Open', 'lockdownStatus')
    setupToggleHandler('lockSubmissionsSwitch', 'lockSubmissionsState', 'lockSubmissions', 'LOCKED', 'Open', 'lockdownStatus')
    setupToggleHandler('lockContestsSwitch', 'lockContestsState', 'lockContests', 'LOCKED', 'Open', 'lockdownStatus')
    setupStaffCard()
    setupHolidayCard()
  }

  // Listen for GM portal auth event
  document.addEventListener('gmSignedIn', event => {
    const account = event.detail
    if ((account.accountType || '') !== 'Administrator') {
      byId('adminDenied').hidden = false
      byId('adminControlsContainer').hidden = true
      return
    }

    byId('adminDenied').hidden = true
    byId('adminControlsContainer').hidden = false
    initUI()
    loadSettings()
    loadStaff()
    loadHolidays()
  })
})()
