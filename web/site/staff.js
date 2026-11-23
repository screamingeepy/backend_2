(function () {
  const byId = id => document.getElementById(id)

  // names, colors and bubbles for Fairy.talent, as pixiePage.js has them. The bubbles are the game's own, from
  // swf/panel_content/limitedProfile.swf. Anyone else, such as a queen, has no bubble
  const talents = {
    1: { name: 'Animal', color: '#e08a2c', bubble: '/site/img/talents/animal.png' },
    2: { name: 'Garden', color: '#d0558f', bubble: '/site/img/talents/garden.png' },
    3: { name: 'Light', color: '#e2bf2e', bubble: '/site/img/talents/light.png' },
    4: { name: 'Water', color: '#3f8ccf', bubble: '/site/img/talents/water.png' },
    5: { name: 'Tinker', color: '#6d9a6b', bubble: '/site/img/talents/tinker.png' }
  }

  const bustUrl = id => '/fairies-render/render/' + id
  const fullUrl = id => '/fairies-render/render/' + id + '/full'

  function element (tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  async function getJson (url) {
    const res = await fetch(url, { credentials: 'include' }).catch(() => null)
    return { res, body: res && res.ok ? await res.json().catch(() => null) : null }
  }

  function show (section) {
    for (const id of ['staffIndex', 'staffDetail', 'staffMissing']) byId(id).hidden = id !== section
  }

  // a picture that is still being drawn shows as a blank, so it fades in when it has arrived
  function picture (url, className, alt) {
    const img = element('img', className)
    img.alt = alt || ''
    img.loading = 'lazy'
    img.addEventListener('load', () => img.classList.add('loaded'))
    img.src = url
    return img
  }

  function link (slug) {
    return '/staff.html?f=' + encodeURIComponent(slug)
  }

  // the "Meet" card: a small bust in the corner and the leaf with their name
  function meetCard (person, current) {
    const card = element('a', 'meetCard' + (current ? ' current' : ''))
    card.href = link(person.slug)
    card.style.setProperty('--talent', (talents[person.talent] || {}).color || '#7a8f5a')
    paintScene(card, person)

    card.append(
      picture(bustUrl(person.fairyId), 'meetBust', ''),
      element('span', 'meetLeaf', 'Meet ' + person.name)
    )

    const talent = talents[person.talent]
    if (talent) {
      const bubble = element('img', 'meetTalent')
      bubble.src = talent.bubble
      bubble.alt = talent.name + ' talent'
      card.appendChild(bubble)
    }

    if (person.role) card.appendChild(element('span', 'meetRole', person.role))
    return card
  }

  function thumb (person, current) {
    const thumbLink = element('a', 'stripThumb' + (current ? ' current' : ''))
    thumbLink.href = link(person.slug)
    thumbLink.title = person.name
    thumbLink.style.setProperty('--talent', (talents[person.talent] || {}).color || '#7a8f5a')
    paintScene(thumbLink, person)
    thumbLink.append(picture(bustUrl(person.fairyId), 'stripBust', person.name), element('span', 'stripName', person.name))
    return thumbLink
  }

  // the meadow pictures tools/build-staff-backgrounds.js made. Loaded once, and the page still works without it
  let sceneList = null

  async function loadScenes () {
    if (sceneList) return sceneList

    const { body } = await getJson('/site/img/staffbg/index.json')
    const files = new Map()

    for (const group of (body && body.groups) || []) {
      for (const zone of group.zones) for (const variant of zone.variants) files.set(variant.id, variant.file)
    }

    sceneList = { files, usual: (body && body.default) || '' }
    return sceneList
  }

  function sceneUrl (id) {
    if (!sceneList) return null
    const file = sceneList.files.get(id) || sceneList.files.get(sceneList.usual)
    return file ? 'url("/site/img/staffbg/' + file + '")' : null
  }

  function paintScene (node, person) {
    const url = sceneUrl(person.background)
    if (url) node.style.setProperty('--scene', url)
  }

  async function showScene (id) {
    const scene = byId('charScene')
    scene.style.backgroundImage = sceneUrl(id) || ''
  }

  // the card's own scroll bar: a raspberry on a rail, which also works by dragging and by clicking the rail
  const scroll = (function () {
    const body = byId('charBody')
    const rail = byId('scrollRail')
    const knob = byId('scrollKnob')
    let drag = null

    function room () {
      return Math.max(0, rail.clientHeight - knob.offsetHeight)
    }

    function update () {
      const overflow = body.scrollHeight - body.clientHeight
      rail.hidden = overflow <= 1
      if (rail.hidden) return

      knob.style.top = (room() * body.scrollTop / overflow) + 'px'
    }

    function moveTo (clientY, grabbed) {
      const overflow = body.scrollHeight - body.clientHeight
      const top = clientY - rail.getBoundingClientRect().top - grabbed
      body.scrollTop = overflow * Math.min(1, Math.max(0, top / (room() || 1)))
    }

    knob.addEventListener('pointerdown', event => {
      drag = event.clientY - knob.getBoundingClientRect().top
      knob.setPointerCapture(event.pointerId)
      event.preventDefault()
    })

    knob.addEventListener('pointermove', event => {
      if (drag !== null) moveTo(event.clientY, drag)
    })

    knob.addEventListener('pointerup', () => { drag = null })
    knob.addEventListener('pointercancel', () => { drag = null })

    rail.addEventListener('pointerdown', event => {
      if (event.target !== knob) moveTo(event.clientY, knob.offsetHeight / 2)
    })

    body.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    if (window.ResizeObserver) new ResizeObserver(update).observe(body)

    return { update }
  })()

  // the team strip as a carousel: the arrows move it a page at a time, and the fairy being shown is kept in view
  const carousel = (function () {
    const holder = byId('charCarousel')
    const strip = byId('charStrip')
    const prev = byId('stripPrev')
    const next = byId('stripNext')

    function update () {
      const overflow = strip.scrollWidth - strip.clientWidth
      holder.classList.toggle('fits', overflow <= 1)
      prev.disabled = strip.scrollLeft <= 1
      next.disabled = strip.scrollLeft >= overflow - 1
    }

    // most of a page, so the last one on screen shows again as the first and the place is not lost
    const page = () => Math.max(120, strip.clientWidth - 130)

    prev.addEventListener('click', () => strip.scrollBy({ left: -page() }))
    next.addEventListener('click', () => strip.scrollBy({ left: page() }))

    strip.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    if (window.ResizeObserver) new ResizeObserver(update).observe(strip)

    // put the current thumbnail in the middle, without the slide
    function center () {
      const current = strip.querySelector('.current')
      if (current) {
        strip.style.scrollBehavior = 'auto'
        strip.scrollLeft = current.offsetLeft - (strip.clientWidth - current.offsetWidth) / 2
        strip.style.scrollBehavior = ''
      }

      update()
    }

    return { center }
  })()

  function showIndex (people) {
    document.title = 'Meet the Staff | Pixie Hollow Forever'
    byId('staffCrumbs').innerHTML = '<a href="/">Pixie Hollow</a> &gt; <span>Meet the Staff</span>'

    const grid = byId('meetGrid')
    grid.replaceChildren()

    if (!people.length) {
      grid.appendChild(element('p', 'staffEmpty', 'The team is still getting ready. Check back soon!'))
    }

    for (const person of people) grid.appendChild(meetCard(person, false))
    show('staffIndex')
  }

  function paragraphs (holder, text) {
    holder.replaceChildren()
    for (const chunk of String(text || '').split(/\n\s*\n/)) {
      if (chunk.trim()) holder.appendChild(element('p', '', chunk.trim()))
    }
  }

  function showDetail (person, people) {
    document.title = person.name + ' | Meet the Staff | Pixie Hollow Forever'

    const crumbs = byId('staffCrumbs')
    crumbs.replaceChildren()
    const home = element('a', '', 'Pixie Hollow')
    home.href = '/'
    const all = element('a', '', 'Meet the Staff')
    all.href = '/staff.html'
    crumbs.append(home, ' > ', all, ' > ', element('span', '', person.name))

    byId('charName').textContent = person.name
    byId('charRole').textContent = person.role || ''
    byId('charRole').hidden = !person.role

    const figure = byId('charFigure')
    figure.classList.remove('loaded')
    figure.alt = person.name
    figure.addEventListener('load', () => figure.classList.add('loaded'), { once: true })
    figure.src = fullUrl(person.fairyId)

    const talent = talents[person.talent]
    byId('charTalent').hidden = !talent
    if (talent) {
      const badge = byId('charTalentBadge')
      badge.src = talent.bubble
      badge.alt = talent.name + ' talent'
    }

    byId('charRibbon').hidden = !person.didYouKnow
    byId('charKnow').textContent = person.didYouKnow || ''

    const facts = byId('charFacts')
    facts.replaceChildren()

    if (talent) {
      facts.append(element('dt', '', 'Talent:'), element('dd', '', talent.name))
    }

    for (const fact of person.facts || []) {
      facts.append(element('dt', '', fact.label ? fact.label + ':' : ''), element('dd', '', fact.value))
    }

    paragraphs(byId('charBio'), person.bio)
    byId('charBody').scrollTop = 0
    showScene(person.background)

    const index = people.findIndex(one => one.slug === person.slug)

    // round again at the ends, so it keeps going either way
    const before = people[(index - 1 + people.length) % people.length]
    const after = people[(index + 1) % people.length]

    for (const [id, one] of [['charPrev', before], ['charNext', after]]) {
      const arrow = byId(id)
      arrow.hidden = people.length < 2
      arrow.href = link(one.slug)
    }

    const strip = byId('charStrip')
    strip.replaceChildren(...people.map(one => thumb(one, one.slug === person.slug)))

    show('staffDetail')
    scroll.update()
    carousel.center()
  }

  async function start () {
    const slug = new URLSearchParams(location.search).get('f')
    const list = await getJson('/fairies/api/staff')
    const people = Array.isArray(list.body) ? list.body : []
    await loadScenes()

    if (!slug) return showIndex(people)

    const one = await getJson('/fairies/api/staff/' + encodeURIComponent(slug))

    if (!one.body) {
      document.title = 'Meet the Staff | Pixie Hollow Forever'
      return show('staffMissing')
    }

    showDetail(one.body, people)
  }

  start()
})()
