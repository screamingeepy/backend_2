// print job
(function () {
  const FAIRY_SCALE = 3
  const HOME_SCALE = 2
  const SAVE_FAIRY_SCALE = 4
  const SAVE_HOME_SCALE = 3

  // a render the service has not drawn yet comes back as a stand-in for a moment; these are the ones that are real
  const READY = ['hit', 'rendered']
  const GIVE_UP_MS = 120000

  const url = (id, kind, scale, download) => '/fairies-render/render/' + id + '/' + kind + '?scale=' + scale + (download ? '&download=1' : '')

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

  const fileName = name => String(name || 'fairy').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-') || 'fairy'

  function element (tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  // the picture as a blob, once it is really drawn. Big ones take a few seconds the first time and are kept after
  async function getRender (address, say) {
    const started = Date.now()

    for (;;) {
      const res = await fetch(address, { cache: 'no-cache', credentials: 'include' }).catch(() => null)

      if (res && res.ok) {
        const status = res.headers.get('X-Render-Status') || ''
        if (READY.includes(status)) return res.blob()

        // 'fallback' is the service giving up on her and sending a stand-in, which is not worth printing or saving
        if (status === 'fallback') throw new Error('That picture could not be drawn. Try again in a little while.')
      }

      if (Date.now() - started > GIVE_UP_MS) throw new Error('The picture is taking too long to draw. Try again in a little while.')

      if (say) say('Drawing the picture...')
      await wait(2000)
    }
  }

  function saveBlob (blob, name) {
    const objectUrl = URL.createObjectURL(blob)
    const link = element('a')
    link.href = objectUrl
    link.download = name
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
  }

  function sheetPage (title, blob, address) {
    const page = element('section', 'phSheetPage')
    page.append(element('h1', 'phSheetName', title))
    const img = element('img')
    img.src = URL.createObjectURL(blob)
    img.alt = title
    page.appendChild(img)
    if (address) page.appendChild(element('p', 'phSheetAddress', address))
    return page
  }

  let busy = false

  // runs a button's job once at a time, and says how it went
  async function job (options, work) {
    const say = options.onStatus || (() => {})
    if (busy) return false
    busy = true

    try {
      await work(say)
    } catch (e) {
      say(e.message || 'That did not work.', true)
      return false
    } finally {
      busy = false
    }

    return true
  }

  function print (options) {
    return job(options, async say => {
      const id = Number(options.fairyId)
      const name = String(options.name || 'Fairy')

      say('Loading...')
      const [fairy, home] = await Promise.all([
        getRender(url(id, 'full', FAIRY_SCALE), say),
        getRender(url(id, 'homefull', HOME_SCALE), say)
      ])

      let sheet = document.getElementById('phPrintSheet')
      if (sheet) sheet.remove()

      sheet = element('div')
      sheet.id = 'phPrintSheet'
      sheet.append(
        sheetPage(name, fairy, options.address),
        sheetPage(name + "'s Home", home, options.address)
      )
      document.body.appendChild(sheet)

      // print only once the pictures are in
      await Promise.all([...sheet.querySelectorAll('img')].map(img => (img.complete ? Promise.resolve() : new Promise(resolve => { img.onload = img.onerror = resolve }))))

      say('')
      document.body.classList.add('phPrinting')

      const done = () => {
        document.body.classList.remove('phPrinting')
        window.removeEventListener('afterprint', done)
        sheet.remove()
      }
      window.addEventListener('afterprint', done)

      window.print()
    })
  }

  // fairy on the profile background they've chosen
  function printProfile (options) {
    return job(options, async say => {
      const id = Number(options.fairyId)
      const bg = Number(options.bgId)

      say('Getting the picture ready...')
      const fairy = await getRender(url(id, 'full', FAIRY_SCALE), say)

      let sheet = document.getElementById('phPrintSheet')
      if (sheet) sheet.remove()

      sheet = element('div')
      sheet.id = 'phPrintSheet'

      const card = element('div', 'phProfileCard')
      const back = element('img', 'phProfileBack')
      back.src = '/images/loyalty_bgs/lbg' + (Number.isInteger(bg) && bg >= 0 ? bg : 0) + '.jpg'
      back.alt = ''
      const her = element('img', 'phProfileFairy')
      her.src = URL.createObjectURL(fairy)
      her.alt = String(options.name || '')
      card.append(back, her)
      sheet.appendChild(card)
      document.body.appendChild(sheet)

      await Promise.all([back, her].map(img => (img.complete ? Promise.resolve() : new Promise(resolve => { img.onload = img.onerror = resolve }))))

      say('')
      document.body.classList.add('phPrinting')

      const done = () => {
        document.body.classList.remove('phPrinting')
        window.removeEventListener('afterprint', done)
        sheet.remove()
      }
      window.addEventListener('afterprint', done)

      window.print()
    })
  }

  function save (options) {
    return job(options, async say => {
      const id = Number(options.fairyId)
      const base = fileName(options.name)

      say('Loading...')
      const fairy = await getRender(url(id, 'full', SAVE_FAIRY_SCALE, true), say)
      saveBlob(fairy, base + '.png')

      const home = await getRender(url(id, 'homefull', SAVE_HOME_SCALE, true), say)
      saveBlob(home, base + '-home.png')

      say('Saved ' + base + '.png and ' + base + '-home.png')
    })
  }

  window.phPrint = { print, printProfile, save }
})()
