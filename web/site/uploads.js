;(function () {
  const byId = id => document.getElementById(id)
  const kind = document.body.dataset.kind || ''

  // the server holds the real rules (services/SubmissionService.js), these numbers only match them
  const shapes = {
    fairytale: { title: true, file: false, bodyMax: 5000 },
    poem: { title: true, file: false, bodyMax: 2000 },
    question: { title: false, file: false, bodyMax: 300 },
    art: { title: true, file: true, bodyMax: 300 }
  }

  function setError (id, message) {
    const element = byId(id)
    if (element) element.textContent = message || ''
    return !message
  }

  function clearErrors () {
    for (const id of ['uploadTitleError', 'uploadFileError', 'uploadBodyError']) setError(id)
    byId('uploadMessage').textContent = ''
  }

  function show (which) {
    for (const id of ['uploadFormBox', 'uploadThanks', 'uploadLogin']) byId(id).hidden = id !== which
  }

  async function sendPicture (file) {
    const res = await fetch('/fairies/api/submissions/upload?name=' + encodeURIComponent(file.name), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file
    })
    const body = await res.json().catch(() => ({}))

    if (!res.ok) throw new Error(body.message || 'The picture would not upload. Please try again.')

    return body.file
  }

  async function submit (event) {
    event.preventDefault()

    clearErrors()
    const shape = shapes[kind]
    const title = shape.title ? byId('uploadTitle').value.trim() : ''
    const body = byId('uploadBody').value.trim()
    const file = shape.file ? byId('uploadFile').files[0] : null

    let ok = true
    if (shape.title && !title) ok = setError('uploadTitleError', 'Please give it a title.') && ok
    if (shape.file && !file) ok = setError('uploadFileError', 'Please choose your picture.') && ok
    if (file && file.size > 4 * 1024 * 1024) ok = setError('uploadFileError', 'That picture is too big. It needs to be under 4 MB.') && ok
    if (!ok) return

    const button = byId('uploadSubmit')
    button.disabled = true
    byId('uploadMessage').textContent = 'Sending...'

    try {
      const image = file ? await sendPicture(file) : ''

      const res = await fetch('/fairies/api/submissions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: kind, title, body, image, website: byId('uploadWebsite').value })
      })
      const result = await res.json().catch(() => ({}))

      if (!res.ok) throw new Error(result.message || 'Something went wrong. Please try again.')

      show('uploadThanks')
      byId('uploadThanks').scrollIntoView({ behavior: 'smooth', block: 'start' })
      loadMine()
    } catch (e) {
      byId('uploadMessage').textContent = e.message
    } finally {
      button.disabled = false
    }
  }

  async function loadMine () {
    const res = await fetch('/fairies/api/submissions/mine', { credentials: 'include' })
    if (!res.ok) return

    const entries = (await res.json()).filter(entry => !kind || entry.type === kind)
    const list = byId('uploadList')
    list.textContent = ''

    for (const entry of entries) {
      const row = document.createElement('li')

      const label = document.createElement('span')
      label.className = 'uploadKindLabel'
      label.textContent = (kind ? '' : entry.typeLabel + (entry.title ? ': ' : '')) + entry.title

      const status = document.createElement('span')
      status.className = 'uploadStatus' + (entry.picked ? ' picked' : '')
      status.textContent = entry.status

      row.append(label, status)
      list.appendChild(row)
    }

    byId('uploadMine').hidden = !entries.length
  }

  function preview () {
    const file = byId('uploadFile').files[0]
    const img = byId('uploadPreview')

    if (!file) {
      img.hidden = true
      return
    }

    img.src = URL.createObjectURL(file)
    img.hidden = false
  }

  function count () {
    const max = shapes[kind].bodyMax
    byId('uploadCount').textContent = `${byId('uploadBody').value.length} / ${max}`
  }

  async function init () {
    const me = await window.site.loadMe()

    if (kind) {
      byId('uploadForm').addEventListener('submit', submit)
      byId('uploadBody').addEventListener('input', count)
      if (shapes[kind].file) byId('uploadFile').addEventListener('change', preview)
      byId('uploadAnother').addEventListener('click', () => {
        byId('uploadForm').reset()
        preview()
        count()
        clearErrors()
        show('uploadFormBox')
        window.scrollTo({ top: 0, behavior: 'smooth' })
      })
      count()
      show(me ? 'uploadFormBox' : 'uploadLogin')
    }

    if (me) loadMine()
  }

  init()
})()
