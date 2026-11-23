(function () {
  const byId = id => document.getElementById(id)

  // the grid is hardcoded, 7 columns by 6 rows
  const columns = [59, 157, 260, 362, 460, 560, 659]
  const rows = [256, 354, 457, 557, 658, 760]
  const eventStart = 15
  const eventStep = 23

  const meetLink = '/calendarmeetlist.html'
  const meetCopy = 'Meet the Coaches'

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  // pixie standard time is pacific, it is what WhoAmIRequest's server-time reports
  const pixieZone = 'America/Los_Angeles'

  function pixieNow () {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: pixieZone, year: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
    }).formatToParts(new Date())
    const get = type => (parts.find(p => p.type === type) || {}).value
    return {
      year: Number(get('year')),
      month: Number(get('month')),
      time: get('hour') + ':' + get('minute') + ' ' + (get('dayPeriod') || '').toLowerCase()
    }
  }

  function showClock () {
    byId('calClock').textContent = pixieNow().time
  }

  const today = pixieNow()
  const months = [
    { year: today.year, month: today.month },
    today.month === 12 ? { year: today.year + 1, month: 1 } : { year: today.year, month: today.month + 1 }
  ]
  const loaded = {}
  let showing = 0

  async function eventsFor ({ year, month }) {
    const key = year + '-' + month
    if (!loaded[key]) {
      const res = await fetch('/fairies/api/calendar/events?year=' + year + '&month=' + month).catch(() => null)
      const body = res && res.ok ? await res.json() : null
      loaded[key] = (body && body.events) || []
    }
    return loaded[key]
  }

  function daysIn (year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate()
  }

  function place (node, col, row, dy) {
    node.style.left = (columns[col] + 2) + 'px'
    node.style.top = (rows[row] + 2 + (dy || 0)) + 'px'
  }

  function dayLabel (date, col, row, gray) {
    const node = document.createElement('span')
    node.className = gray ? 'calDay grayOut' : 'calDay'
    node.textContent = date
    place(node, col, row)
    return node
  }

  async function render () {
    const which = months[showing]
    const other = months[1 - showing]
    const events = await eventsFor(which)

    byId('calMonthTitle').textContent = monthNames[which.month - 1]
    const switcher = byId('calMonthSwitch')
    switcher.textContent = monthNames[other.month - 1]
    switcher.setAttribute('aria-label', 'Show ' + monthNames[other.month - 1] + ' ' + other.year)

    const grid = byId('calGrid')
    grid.replaceChildren()
    closePopup()

    const lead = new Date(Date.UTC(which.year, which.month - 1, 1)).getUTCDay()
    const prevDays = daysIn(which.month === 1 ? which.year - 1 : which.year, which.month === 1 ? 12 : which.month - 1)
    const count = daysIn(which.year, which.month)

    let cell = 0
    for (let i = 0; i < lead; i++, cell++) {
      grid.appendChild(dayLabel(prevDays - lead + 1 + i, cell % 7, Math.floor(cell / 7), true))
    }

    for (let date = 1; date <= count; date++, cell++) {
      const col = cell % 7
      const row = Math.floor(cell / 7)
      grid.appendChild(dayLabel(date, col, row, false))

      const onDay = events.filter(e => new Date(e.date).getUTCDate() === date)
      onDay.forEach((event, index) => {
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.className = 'calEvent'
        chip.textContent = event.shortTitle
        place(chip, col, row, eventStart + index * eventStep)
        chip.addEventListener('click', () => openPopup(event, chip))
        grid.appendChild(chip)
      })
    }

    for (let date = 1; cell < columns.length * rows.length; date++, cell++) {
      grid.appendChild(dayLabel(date, cell % 7, Math.floor(cell / 7), true))
    }
  }

  let returnFocus = null

  function openPopup (event, from) {
    returnFocus = from
    byId('calPopupTitle').textContent = event.title
    byId('calPopupWhen').textContent = event.when
    byId('calPopupWhere').textContent = event.where
    const image = byId('calPopupImage')
    image.hidden = !event.imagePath
    if (event.imagePath) image.src = event.imagePath
    byId('calPopup').hidden = false
    byId('calPopupClose').focus()
  }

  function closePopup () {
    const popup = byId('calPopup')
    if (popup.hidden) return
    popup.hidden = true
    if (returnFocus) returnFocus.focus()
    returnFocus = null
  }

  function fit () {
    const box = byId('calFit')
    const room = box.parentElement.clientWidth
    box.style.zoom = Math.min(1, room / 813)
  }

  byId('calMonthSwitch').addEventListener('click', () => {
    showing = 1 - showing
    render()
  })
  byId('calPopupClose').addEventListener('click', closePopup)
  byId('calPopupX').addEventListener('click', closePopup)
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePopup()
  })

  const meet = byId('calMeet')
  meet.href = meetLink
  meet.querySelector('span').textContent = meetCopy

  window.addEventListener('resize', fit)
  fit()
  showClock()
  setInterval(showClock, 6000)
  render()
})()
