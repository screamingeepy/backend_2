// what a contest page adds under the post: open or closed, the way in, finalists and winners
;(function () {
  const element = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function card (entry, winner) {
    const item = element('li', 'contestCard' + (winner ? ' winner' : ''))
    item.appendChild(element('h4', '', entry.title))
    item.appendChild(element('p', 'by', `by ${entry.fairyName}`))

    const pictures = entry.files.filter(file => file.kind === 'image')
    const documents = entry.files.filter(file => file.kind !== 'image')

    if (pictures.length) {
      const row = element('div', 'cardImages')
      pictures.forEach(file => {
        const img = element('img')
        img.src = file.url
        img.alt = entry.title
        img.loading = 'lazy'
        img.addEventListener('error', () => img.remove())
        row.appendChild(img)
      })
      item.appendChild(row)
    }

    if (entry.body) item.appendChild(element('p', 'text', entry.body))

    if (documents.length) {
      const list = element('ul', 'cardDocs')
      documents.forEach(file => {
        const link = element('a', '', file.text ? `Read ${file.label}` : `Download ${file.label}`)
        link.href = file.url
        link.target = '_blank'
        link.rel = 'noopener'
        const li = element('li')
        li.appendChild(link)
        list.appendChild(li)
      })
      item.appendChild(list)
    }

    return item
  }

  function group (title, entries, winner) {
    if (!entries.length) return null

    const section = element('section', 'contestShowcase')
    section.appendChild(element('h3', '', title))
    const list = element('ul', 'contestCards')
    entries.forEach(entry => list.appendChild(card(entry, winner)))
    section.appendChild(list)
    return section
  }

  async function render (entry) {
    const wrap = element('div', 'contestExtras')
    const box = element('div', 'contestBox')

    if (entry.contest.open) {
      box.appendChild(element('h3', '', 'This contest is open!'))
      const word = entry.contest.accepts === 'art' ? 'a picture' : entry.contest.accepts === 'writing' ? 'your writing' : 'your writing or a picture'
      box.appendChild(element('p', '', `Send in ${word}. A person reads every entry before anyone else can see it.`))
      const enter = element('a', 'btnGold', 'Enter this contest')
      enter.href = `/contests/enter.html?contest=${encodeURIComponent(entry._id)}`
      box.appendChild(enter)
    } else {
      box.appendChild(element('h3', '', 'This contest is closed'))
      box.appendChild(element('p', '', 'Thank you to everyone who entered!'))
    }

    wrap.appendChild(box)

    const res = await fetch(`/fairies/api/contests/${encodeURIComponent(entry._id)}/showcase`, { credentials: 'include' }).catch(() => null)
    const showcase = res && res.ok ? await res.json().catch(() => null) : null

    if (showcase) {
      for (const part of [group('Winners', showcase.winners, true), group('Finalists', showcase.finalists, false)]) {
        if (part) wrap.appendChild(part)
      }
    }

    return wrap
  }

  window.contestExtras = { render }
})()
