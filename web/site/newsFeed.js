(function () {
  const { element, formatWhen } = window.tickets

  const root = document.getElementById('newsFeed')
  if (!root) return

  // set by the page, 'nevernews' or 'knownissues', same engine as the original's blogURL
  const feed = root.dataset.feed
  const perPage = Number(root.dataset.perPage) || 10
  const pageUrl = location.pathname

  function currentView () {
    const params = new URLSearchParams(location.search)
    return { id: params.get('entry'), page: Math.max(Number(params.get('page')) || 1, 1) }
  }

  function goTo (params, replace) {
    const query = new URLSearchParams()
    if (params.id) query.set('entry', params.id)
    if (params.page && params.page > 1) query.set('page', params.page)

    const url = query.toString() ? `${pageUrl}?${query}` : pageUrl
    if (replace) history.replaceState(null, '', url)
    else history.pushState(null, '', url)
    render()
  }

  async function getJson (url) {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) return null
    return res.json().catch(() => null)
  }

  function showLoading () {
    root.replaceChildren(element('p', 'newsLoading', root.dataset.loading || 'Fetching the latest news…'))
  }

  function showEmpty (text) {
    root.replaceChildren(element('p', 'newsEmpty', text))
  }

  // index

  function entryRow (entry) {
    const link = element('a', 'newsRow')
    link.href = `${pageUrl}?entry=${encodeURIComponent(entry._id)}`
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
      event.preventDefault()
      goTo({ id: entry._id })
    })

    const picture = entry.heroImage || entry.thumbImage

    if (picture) {
      const thumb = element('img', 'newsThumb')
      thumb.src = picture
      thumb.alt = ''
      thumb.loading = 'lazy'
      thumb.addEventListener('error', () => {
        thumb.remove()
        link.classList.add('noThumb')
      })
      link.appendChild(thumb)
    } else {
      link.classList.add('noThumb')
    }

    const text = element('div', 'newsRowText')
    text.appendChild(element('h2', '', entry.title))

    // the date, then who posted it, one above the other, as in the reference.
    const byline = element('p', 'newsByline')
    byline.append(
      element('span', 'newsDate', new Date(entry.postedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })),
      element('span', 'newsBy', entry.authorName ? `Posted by: ${entry.authorName}` : 'Posted by: the Pixie Hollow Team')
    )
    text.appendChild(byline)

    if (entry.excerpt) text.appendChild(element('p', 'newsExcerpt', entry.excerpt))
    if (entry.commentsEnabled) {
      const count = entry.commentCount === 1 ? '1 comment' : `${entry.commentCount} comments`
      text.appendChild(element('span', 'newsCommentCount', count))
    }

    if (entry.contest) {
      text.appendChild(element('span', 'contestState ' + (entry.contest.open ? 'open' : 'closed'), entry.contest.open ? 'Open for entries' : 'Closed'))
    }

    text.appendChild(element('span', 'newsReadMore btnGold', 'Read More'))

    link.appendChild(text)
    return link
  }

  function pager (data) {
    if (data.pages <= 1) return null

    const box = element('div', 'newsPager')
    const first = (data.page - 1) * data.perPage + 1
    const last = Math.min(data.page * data.perPage, data.total)

    const prev = element('button', 'newsArrow prev')
    prev.type = 'button'
    prev.setAttribute('aria-label', 'Previous entries')
    prev.disabled = data.page <= 1
    prev.addEventListener('click', () => goTo({ page: data.page - 1 }))

    const next = element('button', 'newsArrow next')
    next.type = 'button'
    next.setAttribute('aria-label', 'Next entries')
    next.disabled = data.page >= data.pages
    next.addEventListener('click', () => goTo({ page: data.page + 1 }))

    box.append(prev, element('span', 'newsRange', `${first}-${last} of ${data.total}`), next)
    return box
  }

  async function renderIndex (page) {
    showLoading()

    const data = await getJson(`/fairies/api/news/${feed}?page=${page}&perPage=${perPage}`)
    if (!data) return showEmpty('This page is currently unavailable. Please try again later.')
    if (!data.entries.length) return showEmpty(root.dataset.empty || 'There is no news to share just yet. Check back soon!')

    const list = element('ul', 'newsList')
    data.entries.forEach(entry => {
      const item = document.createElement('li')
      item.appendChild(entryRow(entry))
      list.appendChild(item)
    })

    root.replaceChildren(list)
    const paging = pager(data)
    if (paging) root.appendChild(paging)
  }

  // one entry

  function threadNav (data) {
    const nav = element('p', 'newsThreadNav')

    const older = element('a', '', '‹ Previous Thread')
    if (data.olderId) {
      older.href = `${pageUrl}?entry=${encodeURIComponent(data.olderId)}`
      older.addEventListener('click', event => {
        event.preventDefault()
        goTo({ id: data.olderId })
      })
    } else {
      older.className = 'spacer'
      older.href = '#'
    }

    const home = element('a', '', 'Read more articles')
    home.href = pageUrl
    home.addEventListener('click', event => {
      event.preventDefault()
      goTo({})
    })

    const newer = element('a', '', 'Next Thread ›')
    if (data.newerId) {
      newer.href = `${pageUrl}?entry=${encodeURIComponent(data.newerId)}`
      newer.addEventListener('click', event => {
        event.preventDefault()
        goTo({ id: data.newerId })
      })
    } else {
      newer.className = 'spacer'
      newer.href = '#'
    }

    nav.append(older, home, newer)
    return nav
  }

  async function renderEntry (id) {
    showLoading()

    const data = await getJson(`/fairies/api/news/${feed}/${encodeURIComponent(id)}`)
    if (!data) {
      showEmpty('That post could not be found.')
      const back = element('p', 'center')
      const link = element('a', '', 'Read more articles')
      link.href = pageUrl
      back.appendChild(link)
      root.appendChild(back)
      return
    }

    const entry = data.entry
    const parts = [threadNav(data)]

    const article = element('article', 'newsEntry')
    if (entry.heroImage) {
      const hero = element('img', 'newsHero')
      hero.src = entry.heroImage
      hero.alt = ''
      hero.addEventListener('error', () => hero.remove())
      article.appendChild(hero)
    }


    article.appendChild(element('h2', '', entry.title))

    const byline = element('p', 'newsByline')
    byline.append(
      element('span', 'newsBy', entry.authorName ? `Posted by ${entry.authorName}` : 'Posted by the Pixie Hollow Team'),
      element('span', 'newsDate', formatWhen(entry.postedAt))
    )
    article.appendChild(byline)

    // already allowlisted server side (sanitizeHtmlBody in WebService.js)
    const body = element('div', 'newsBody')
    body.innerHTML = entry.body
    article.appendChild(body)

    if (entry.signature) {
      const sig = element('img', 'newsSignature')
      sig.src = entry.signature
      sig.alt = entry.authorName ? `${entry.authorName}'s signature` : ''
      sig.addEventListener('error', () => sig.remove())
      article.appendChild(sig)
    }

    parts.push(article)

    if (entry.contest && window.contestExtras) parts.push(await window.contestExtras.render(entry))

    parts.push(element('div', 'newsVine'))

    parts.push(await window.newsComments.section(feed, entry._id, entry))
    root.replaceChildren(...parts)
  }

  function render () {
    const view = currentView()
    document.body.classList.toggle('newsEntryView', Boolean(view.id))
    if (view.id) renderEntry(view.id)
    else renderIndex(view.page)
  }

  window.addEventListener('popstate', render)
  render()
})()
