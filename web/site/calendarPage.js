(function () {
  const byId = id => document.getElementById(id)

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const iconTypes = ['pixie', 'wings', 'gift', 'scroll', 'balloon', 'fashion']
  const keyOrder = [
    ['wings', 'Pixie Pals'],
    ['pixie', 'Famous Fairies'],
    ['gift', 'Minister of the Season'],
    ['scroll', 'Fairy Tale Theater'],
    ['fashion', 'Fashion'],
    ['balloon', 'General']
  ]

  // pixie standard time is pacific, it is what WhoAmIRequest's server-time reports
  const pixieZone = 'America/Los_Angeles'

  function pixieNow () {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: pixieZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
    }).formatToParts(new Date())
    const get = type => (parts.find(p => p.type === type) || {}).value
    return {
      year: Number(get('year')),
      month: Number(get('month')),
      day: Number(get('day')),
      time: get('hour') + ':' + get('minute') + ' ' + (get('dayPeriod') || '').toLowerCase()
    }
  }

  const today = pixieNow()
  let viewYear = today.year
  let viewMonth = today.month

  function utc (y, m, d) { return new Date(Date.UTC(y, m - 1, d)) }
  function daysIn (y, m) { return utc(y, m + 1, 0).getUTCDate() }

  const loaded = {}
  async function eventsFor (year, month) {
    const key = year + '-' + month
    if (!loaded[key]) {
      loaded[key] = fetch('/fairies/api/calendar/events?year=' + year + '&month=' + month)
        .then(res => res.ok ? res.json() : { events: [] })
        .then(body => body.events || [])
        .catch(() => [])
    }
    return loaded[key]
  }

  // A day-of-month a span-event touches, clipped to the month being drawn.
  function spanDays (event, year, month) {
    const start = new Date(event.date)
    const end = new Date(event.endDate || event.date)
    const monthStart = utc(year, month, 1)
    const monthEnd = utc(year, month, daysIn(year, month))
    const from = start < monthStart ? monthStart : start
    const to = end > monthEnd ? monthEnd : end
    const days = []
    for (let d = from.getUTCDate(); d <= to.getUTCDate(); d++) days.push(d)
    return { days, startDay: start.getUTCDate(), endDay: end.getUTCDate(), startsThisMonth: start >= monthStart, endsThisMonth: end <= monthEnd }
  }

  function listShops (where) {
    const ul = document.createElement('ul')
    where.split(',').forEach(shop => {
      const li = document.createElement('li')
      li.textContent = shop.trim()
      ul.appendChild(li)
    })
    return ul
  }

  function iconEl (type) {
    if (!iconTypes.includes(type)) return null
    const span = document.createElement('span')
    span.className = 'calIcon calIcon-' + type
    return span
  }

  // key legend

  function renderKey () {
    const key = byId('calKey')
    key.replaceChildren()
    keyOrder.forEach(([type, label]) => {
      const li = document.createElement('li')
      li.appendChild(iconEl(type))
      li.appendChild(document.createTextNode(label))
      key.appendChild(li)
    })
  }

  // event popup (one event, opened from a grid chip)

  let popupReturnFocus = null

  function openEventPopup (event, from) {
    popupReturnFocus = from
    byId('calEventPopupTitle').textContent = event.title
    byId('calEventPopupWhen').textContent = event.type === 'fashion' ? '' : event.when
    byId('calEventPopupWhere').textContent = event.type === 'fashion' ? '' : event.where
    const linkP = byId('calEventPopupLink')
    const linkA = byId('calEventPopupLinkA')
    if (event.link) {
      linkA.href = event.link
      linkP.hidden = false
    } else {
      linkP.hidden = true
    }
    byId('calEventPopup').hidden = false
    byId('calEventPopupClose').focus()
  }

  function closeEventPopup () {
    const popup = byId('calEventPopup')
    if (popup.hidden) return
    popup.hidden = true
    if (popupReturnFocus) popupReturnFocus.focus()
    popupReturnFocus = null
  }

  // side panel: everything on one clicked day

  function contestPhaseText (event, day, span) {
    const range = monthNames[new Date(event.date).getUTCMonth()] + ' ' + span.startDay +
      ' - ' + monthNames[new Date(event.endDate || event.date).getUTCMonth()] + ' ' + span.endDay
    if (day === span.startDay && span.startsThisMonth) {
      return { when: 'Starts ' + range, where: event.where || 'Enter for a Chance to Win!' }
    }
    if (day === span.endDay && span.endsThisMonth) {
      return { when: 'Ends ' + range, where: event.where || 'Enter for a Chance to Win!' }
    }
    return { when: range, where: event.where || 'Enter for a Chance to Win!' }
  }

  function renderSideEvent (event, day, span) {
    const box = document.createElement('div')
    box.className = 'calSideEvent'

    const title = document.createElement('p')
    title.className = 'calSideEventTitle' + (iconTypes.includes(event.type) ? ' hasIcon calIcon-' + event.type : '')
    title.textContent = event.title
    box.appendChild(title)

    if (event.timeType === 'contest') {
      const phase = contestPhaseText(event, day, span)
      const when = document.createElement('p')
      when.textContent = phase.when
      const where = document.createElement('p')
      where.textContent = phase.where
      box.append(when, where)
    } else if (event.type === 'fashion') {
      box.appendChild(listShops(event.where))
    } else {
      if (event.when) {
        const when = document.createElement('p')
        when.textContent = event.when
        box.appendChild(when)
      }
      if (event.where) {
        const where = document.createElement('p')
        where.textContent = event.where
        box.appendChild(where)
      }
    }
    return box
  }

  function showSideDetails (day, dayEvents, spans, isToday) {
    const side = byId('calSide')
    side.classList.toggle('today', isToday)
    byId('calSideHeading').textContent = monthNames[viewMonth - 1] + ' ' + day
    const list = byId('calSideEvents')
    list.replaceChildren()

    if (!dayEvents.length) {
      const none = document.createElement('p')
      none.className = 'calSideNone'
      none.textContent = 'No Events'
      list.appendChild(none)
      return
    }

    dayEvents.forEach(event => list.appendChild(renderSideEvent(event, day, spans.get(event))))

    document.querySelectorAll('.calDay.selected').forEach(el => el.classList.remove('selected'))
  }

  // grid

  async function render () {
    byId('calHeadMonth').textContent = monthNames[viewMonth - 1] + ' ' + viewYear
    byId('calTodayDate').textContent = monthNames[today.month - 1] + ' ' + today.day + ', ' + today.year

    const events = await eventsFor(viewYear, viewMonth)

    const byDay = new Map()
    const spans = new Map()
    events.forEach(event => {
      const span = spanDays(event, viewYear, viewMonth)
      spans.set(event, span)
      span.days.forEach(day => {
        if (!byDay.has(day)) byDay.set(day, [])
        byDay.get(day).push(event)
      })
    })

    const titles = byId('calColTitles')
    titles.replaceChildren()
    dayNames.forEach(name => {
      const span = document.createElement('span')
      span.textContent = name.slice(0, 3)
      titles.appendChild(span)
    })

    const grid = byId('calDays')
    grid.replaceChildren()

    const lead = utc(viewYear, viewMonth, 1).getUTCDay()
    const count = daysIn(viewYear, viewMonth)
    const cells = 42

    let isTodayMonth = viewYear === today.year && viewMonth === today.month
    let openedSide = false

    for (let cell = 0; cell < cells; cell++) {
      const day = cell - lead + 1
      if (day < 1 || day > count) {
        grid.appendChild(document.createElement('div')).className = 'calDayEmpty'
        continue
      }

      const cellEl = document.createElement('button')
      cellEl.type = 'button'
      cellEl.className = 'calDay'
      const isToday = isTodayMonth && day === today.day
      if (isToday) cellEl.classList.add('today')

      const dayEvents = byDay.get(day) || []
      dayEvents.forEach(event => {
        const span = spans.get(event)
        if (event.timeType === 'thisweek') {
          cellEl.classList.add('thisweek')
          cellEl.style.backgroundColor = event.color || '#F86800'
        } else if (event.timeType === 'contest') {
          const isStart = day === span.startDay && span.startsThisMonth
          const isEnd = day === span.endDay && span.endsThisMonth
          const phase = isEnd ? 'contestEnd' : (isStart ? 'contestStart' : 'contestRunning')
          cellEl.classList.add(phase)
          if (phase !== 'contestRunning') {
            cellEl.style.backgroundImage = "url('/site/img/calendar/" + phase.replace('contest', 'contest-').toLowerCase() + '-' + event.type + ".png')"
          }
        }
      })

      const num = document.createElement('span')
      num.className = 'calDayNum'
      num.textContent = String(day)
      cellEl.appendChild(num)

      const chips = document.createElement('span')
      chips.className = 'calDayChips'
      dayEvents.filter(e => e.timeType === 'once' || e.timeType === 'hourly').forEach(event => {
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.className = 'calIcon-' + event.type
        chip.setAttribute('aria-label', event.title)
        chip.addEventListener('click', evt => {
          evt.stopPropagation()
          openEventPopup(event, chip)
        })
        chips.appendChild(chip)
      })
      if (chips.childElementCount) cellEl.appendChild(chips)

      cellEl.addEventListener('click', () => {
        document.querySelectorAll('.calDay.selected').forEach(el => el.classList.remove('selected'))
        cellEl.classList.add('selected')
        showSideDetails(day, dayEvents, spans, isToday)
      })

      grid.appendChild(cellEl)

      if (!openedSide && (isToday || (!isTodayMonth && day === 1))) {
        openedSide = true
        requestAnimationFrame(() => {
          cellEl.classList.add('selected')
          showSideDetails(day, dayEvents, spans, isToday)
        })
      }
    }

    byId('calPrev').setAttribute('aria-label', 'Show ' + prevLabel())
    byId('calNext').setAttribute('aria-label', 'Show ' + nextLabel())
  }

  function prevLabel () {
    const m = viewMonth === 1 ? 12 : viewMonth - 1
    const y = viewMonth === 1 ? viewYear - 1 : viewYear
    return monthNames[m - 1] + ' ' + y
  }

  function nextLabel () {
    const m = viewMonth === 12 ? 1 : viewMonth + 1
    const y = viewMonth === 12 ? viewYear + 1 : viewYear
    return monthNames[m - 1] + ' ' + y
  }

  byId('calPrev').addEventListener('click', () => {
    if (viewMonth === 1) { viewMonth = 12; viewYear -= 1 } else { viewMonth -= 1 }
    render()
  })
  byId('calNext').addEventListener('click', () => {
    if (viewMonth === 12) { viewMonth = 1; viewYear += 1 } else { viewMonth += 1 }
    render()
  })

  byId('calEventPopupClose').addEventListener('click', closeEventPopup)
  document.addEventListener('keydown', evt => {
    if (evt.key === 'Escape') closeEventPopup()
  })

  // "coming up" -- static replacement for the original's live countdown

  function comingContestText (event, todayUtc) {
    const start = new Date(event.date)
    const end = new Date(event.endDate || event.date)
    const range = monthNames[start.getUTCMonth()] + ' ' + start.getUTCDate() +
      ' - ' + monthNames[end.getUTCMonth()] + ' ' + end.getUTCDate()
    return todayUtc < start ? 'Starts ' + range : 'Ends ' + range
  }

  function comingRow (event, todayUtc) {
    const row = document.createElement('div')
    row.className = 'calComingRow ' + (event.timeType === 'contest' ? 'contest' : event.timeType === 'hourly' ? 'hourly' : '')

    const icon = iconEl(event.type)
    if (icon) row.appendChild(icon)

    const text = document.createElement('p')
    const titleSpan = document.createElement('span')
    titleSpan.className = 'calComingTitle'
    titleSpan.textContent = event.title + '  '
    text.appendChild(titleSpan)
    const whenSpan = document.createElement('span')
    whenSpan.className = 'calComingWhen'
    whenSpan.textContent = event.timeType === 'contest' ? comingContestText(event, todayUtc) : event.when
    text.appendChild(whenSpan)
    row.appendChild(text)

    if (event.timeType === 'contest') {
      const a = document.createElement('a')
      a.className = 'buttonBlue'
      a.href = event.link || '#'
      a.innerHTML = '<span>Enter Now</span>'
      row.appendChild(a)
    } else if (event.timeType === 'hourly') {
      const a = document.createElement('a')
      a.className = 'buttonBlue'
      a.href = '#'
      a.innerHTML = '<span>Play</span>'
      a.addEventListener('click', evt => {
        evt.preventDefault()
        if (window.site) window.site.openLogin()
      })
      row.appendChild(a)
    } else if (event.link) {
      const a = document.createElement('a')
      a.className = 'buttonOrange'
      a.href = event.link
      a.innerHTML = '<span>Read More</span>'
      row.appendChild(a)
    }

    return row
  }

  async function renderComingUp () {
    const [thisMonth, nextMonth] = await Promise.all([
      eventsFor(today.year, today.month),
      eventsFor(today.month === 12 ? today.year + 1 : today.year, today.month === 12 ? 1 : today.month + 1)
    ])

    const todayUtc = utc(today.year, today.month, today.day)
    const seen = new Set()
    const rows = []

    thisMonth.concat(nextMonth).forEach(event => {
      if (seen.has(event._id)) return
      seen.add(event._id)

      const start = new Date(event.date)
      const end = new Date(event.endDate || event.date)
      if (end < todayUtc) return
      if (start.getTime() - todayUtc.getTime() > 7 * 86400000) return

      rows.push({ event, sortKey: Math.max(start.getTime(), todayUtc.getTime()) })
    })

    rows.sort((a, b) => a.sortKey - b.sortKey)

    const box = byId('calComingUp')
    box.replaceChildren()
    rows.slice(0, 5).forEach(row => box.appendChild(comingRow(row.event, todayUtc)))
  }

  function showClock () {
    byId('calClockTime').textContent = pixieNow().time
  }

  renderKey()
  showClock()
  setInterval(showClock, 60000)
  render()
  renderComingUp()
})()
