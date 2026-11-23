;(function () {
  const byId = id => document.getElementById(id)
  const contestId = new URLSearchParams(location.search).get('contest') || ''
  let contest = null

  function setError (id, message) {
    byId(id).textContent = message || ''
    return !message
  }

  function show (which) {
    for (const id of ['contestFormBox', 'contestThanks', 'contestLogin', 'contestClosed']) byId(id).hidden = id !== which
  }

  function closedBox (title, text) {
    byId('contestClosedTitle').textContent = title
    byId('contestClosedText').textContent = text
    show('contestClosed')
  }

  const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']
  const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/bmp'

  let picked = []

  const extensionOf = name => (/\.([A-Za-z0-9]+)$/.exec(name) || [])[1]?.toLowerCase() || ''
  const isImage = file => IMAGE_EXTENSIONS.includes(extensionOf(file.name))

  function sizeWord (bytes) {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
  }

  function allowedExtensions () {
    const documents = contest.rules.documentAccept.split(',').map(ext => ext.replace('.', ''))
    return [...(contest.rules.images ? IMAGE_EXTENSIONS : []), ...(contest.rules.documents ? documents : [])]
  }

  async function sendFile (file) {
    if (file.uploaded) return file.uploaded

    const res = await fetch('/fairies/api/contests/upload?name=' + encodeURIComponent(file.name), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`${file.name}: ${body.message || 'it would not upload. Please try again.'}`)

    file.uploaded = body.file
    return body.file
  }

  function drawFiles () {
    const list = byId('contestFiles')
    list.textContent = ''

    picked.forEach((file, index) => {
      const row = document.createElement('li')

      if (isImage(file)) {
        const img = document.createElement('img')
        img.alt = ''
        img.src = URL.createObjectURL(file)
        img.addEventListener('load', () => URL.revokeObjectURL(img.src))
        row.appendChild(img)
      } else {
        const icon = document.createElement('span')
        icon.className = 'fileIcon'
        icon.textContent = extensionOf(file.name).toUpperCase()
        row.appendChild(icon)
      }

      const name = document.createElement('span')
      name.className = 'fileName'
      name.textContent = `${file.name} (${sizeWord(file.size)})`
      row.appendChild(name)

      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'fileRemove'
      remove.textContent = 'Remove'
      remove.addEventListener('click', () => {
        picked.splice(index, 1)
        drawFiles()
      })
      row.appendChild(remove)

      list.appendChild(row)
    })

    byId('contestFile').disabled = picked.length >= contest.rules.maxFiles
  }

  function addFiles () {
    const input = byId('contestFile')
    setError('contestFileError')
    const problems = []

    for (const file of input.files) {
      const ext = extensionOf(file.name)
      const limit = IMAGE_EXTENSIONS.includes(ext) ? contest.rules.imageMaxBytes : contest.rules.documentMaxBytes

      if (!allowedExtensions().includes(ext)) problems.push(`${file.name} is not a kind of file this contest takes.`)
      else if (file.size > limit) problems.push(`${file.name} is too big. It needs to be under ${limit / 1024 / 1024} MB.`)
      else if (picked.some(other => other.name === file.name && other.size === file.size)) continue
      else if (picked.length >= contest.rules.maxFiles) problems.push(`You can add up to ${contest.rules.maxFiles} files.`)
      else picked.push(file)
    }

    input.value = ''
    drawFiles()
    if (problems.length) setError('contestFileError', [...new Set(problems)].join(' '))
  }

  async function submit (event) {
    event.preventDefault()

    for (const id of ['contestTitleError', 'contestFileError', 'contestBodyError']) setError(id)
    byId('contestMessage').textContent = ''

    const title = byId('contestTitle').value.trim()
    const body = byId('contestBody').value.trim()
    const rules = contest.rules
    const pictures = picked.filter(isImage)
    const documents = picked.filter(file => !isImage(file))

    let ok = true
    if (!title) ok = setError('contestTitleError', 'Please give your entry a title.') && ok
    if (rules.needsPicture && !pictures.length) ok = setError('contestFileError', 'Please choose your picture.') && ok

    if (!rules.needsPicture && body.length < rules.bodyMin && !(contest.accepts === 'writing' ? documents.length : picked.length)) {
      ok = setError('contestBodyError', contest.accepts === 'writing'
        ? `Please write a little more (at least ${rules.bodyMin} letters), or add your writing as a file.`
        : 'Please write something or add a file.') && ok
    }
    if (!ok) return

    const button = byId('contestSubmit')
    button.disabled = true

    try {
      const files = []
      for (const file of picked) {
        byId('contestMessage').textContent = picked.length > 1 ? `Sending file ${files.length + 1} of ${picked.length}...` : 'Sending...'
        files.push(await sendFile(file))
      }
      byId('contestMessage').textContent = 'Sending...'

      const res = await fetch(`/fairies/api/contests/${encodeURIComponent(contestId)}/entries`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, files, website: byId('contestWebsite').value })
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(result.message || 'Something went wrong. Please try again.')

      picked = []
      drawFiles()
      show('contestThanks')
      byId('contestThanks').scrollIntoView({ behavior: 'smooth', block: 'start' })
      loadMine()
    } catch (e) {
      byId('contestMessage').textContent = e.message
    } finally {
      button.disabled = false
    }
  }

  async function loadMine () {
    const res = await fetch(`/fairies/api/contests/${encodeURIComponent(contestId)}/mine`, { credentials: 'include' })
    if (!res.ok) return []

    const entries = await res.json()
    const list = byId('contestList')
    list.textContent = ''

    for (const entry of entries) {
      const row = document.createElement('li')
      const label = document.createElement('span')
      label.textContent = entry.files.length ? `${entry.title} (${entry.files.length} ${entry.files.length === 1 ? 'file' : 'files'})` : entry.title
      const status = document.createElement('span')
      status.className = 'status ' + entry.state
      status.textContent = entry.status
      row.append(label, status)
      list.appendChild(row)
    }

    byId('contestMine').hidden = !entries.length
    return entries
  }

  function count () {
    byId('contestCount').textContent = `${byId('contestBody').value.length} / ${contest.rules.bodyMax}`
  }

  function shapeForm () {
    const rules = contest.rules
    const art = contest.accepts === 'art'

    byId('contestFileRow').hidden = !(rules.images || rules.documents)
    byId('contestFileLabel').textContent = art ? 'Your Pictures:' : rules.images ? 'Your Files:' : 'Your Document:'
    byId('contestFile').accept = [rules.images ? IMAGE_ACCEPT : '', rules.documents ? rules.documentAccept : ''].filter(Boolean).join(',')
    byId('contestFileTip').textContent =
      `Up to ${rules.maxFiles} files. ${[
        rules.images ? `Pictures: ${rules.imageTypes}, up to ${rules.imageMaxBytes / 1024 / 1024} MB each.` : '',
        rules.documents ? `Documents: ${rules.documentTypes}, up to ${rules.documentMaxBytes / 1024 / 1024} MB each.` : ''
      ].filter(Boolean).join(' ')}`

    byId('contestBodyLabel').textContent = art ? 'About Your Art:' : 'Your Entry:'
    byId('contestBody').rows = art ? 4 : 8
    byId('contestBody').maxLength = rules.bodyMax
    byId('contestBodyTip').textContent = art ? 'Optional. Tell us about it!'
      : contest.accepts === 'either' ? 'Write something, add files, or both.'
        : 'Type it here, or add it as a document above.'
    count()
  }

  async function init () {
    if (!contestId) return closedBox('Which contest?', 'Please start from the contest you want to enter.')

    const res = await fetch(`/fairies/api/contests/${encodeURIComponent(contestId)}`, { credentials: 'include' })
    if (!res.ok) return closedBox('We could not find that contest', 'It may have been taken down. See the other contests on the Contests page.')

    contest = await res.json()
    document.title = `Enter: ${contest.title}`
    byId('contestHeading').textContent = contest.title
    byId('contestBack').href = `/contests_home.html?entry=${encodeURIComponent(contestId)}`

    const back = document.createElement('a')
    back.href = `/contests_home.html?entry=${encodeURIComponent(contestId)}`
    back.textContent = 'Read about this contest'
    byId('contestIntro').append(back)

    if (!contest.open) return closedBox('This contest is closed', 'It is not taking any more entries. Thank you to everyone who entered!')

    const me = await window.site.loadMe()
    if (!me) return show('contestLogin')

    const mine = await loadMine()
    if (mine.length >= contest.perPlayer) {
      const word = contest.perPlayer === 1 ? 'your entry' : `all ${contest.perPlayer} of your entries`
      return closedBox('You have entered', `You have sent in ${word} to this contest. Good luck!`)
    }

    byId('contestForm').addEventListener('submit', submit)
    byId('contestBody').addEventListener('input', count)
    byId('contestFile').addEventListener('change', addFiles)
    shapeForm()
    show('contestFormBox')
  }

  init()
})()
