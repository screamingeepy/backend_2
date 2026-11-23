// the comments under a post
;(function () {
  const { element, formatWhen } = window.tickets

  // never fairies are highlighted in their own color like the original
  const neverFairies = ['SweetPea', 'Sweet Pea', 'Tabby', 'Marina', 'Kit', 'Sil', 'Dess', 'Tink',
    'Rosetta', 'Fawn', 'Terence', 'Clank', 'Bobble', 'Dulcie', 'Bobbin', 'Mendy', 'Slate']

  function isNeverFairy (name) {
    return neverFairies.some(fairy => fairy.toLowerCase() === String(name || '').trim().toLowerCase())
  }

  function commentItem (comment) {
    const item = element('li', 'newsComment' + (isNeverFairy(comment.fairyName) ? ' fromStaff' : ''))
    item.append(
      element('p', 'newsCommentWho', comment.fairyName),
      element('p', 'newsCommentBody', comment.body),
      element('p', 'newsCommentWhen', formatWhen(comment.postedAt))
    )
    return item
  }

  function commentForm (feed, entry, me) {
    const form = element('form', 'acctForm newsCommentForm')
    form.noValidate = true

    const note = element('p', 'newsCommentNote')
    note.append('If you have a question or technical problem, please use our ')
    const contact = element('a', '', 'contact us form')
    contact.href = '/contactUs.html'
    note.append(contact, '. We will only show comments that are related to this post.')

    const nameRow = element('div', 'formRow')
    const nameLabel = element('label', '', 'Fairy Nickname:')
    nameLabel.htmlFor = 'newsCommentName'
    const nameInput = element('input', 'textInput')
    nameInput.id = 'newsCommentName'
    nameInput.maxLength = 40
    if (me) {
      nameInput.value = me.fairyName || me.username
      nameInput.readOnly = true
    }
    nameRow.append(nameLabel, nameInput)

    const bodyRow = element('div', 'formRow')
    const bodyLabel = element('label', '', 'Your Comment:')
    bodyLabel.htmlFor = 'newsCommentBody'
    const bodyInput = element('textarea', 'textInput textArea')
    bodyInput.id = 'newsCommentBody'
    bodyInput.maxLength = 1000
    bodyInput.rows = 5
    bodyRow.append(bodyLabel, bodyInput)

    const message = element('p', 'formMessage')
    message.setAttribute('role', 'alert')

    const actions = element('p', 'center')
    const submit = element('button', 'btnGold', 'Submit')
    submit.type = 'submit'
    actions.appendChild(submit)

    form.addEventListener('submit', async event => {
      event.preventDefault()
      submit.disabled = true
      message.className = 'formMessage'
      message.textContent = ''

      const res = await fetch(`/fairies/api/news/${feed}/${encodeURIComponent(entry._id)}/comments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fairyName: nameInput.value.trim(), body: bodyInput.value.trim() })
      })
      const body = await res.json().catch(() => ({}))

      if (res.ok && body.success) {
        message.className = 'formMessage ok'
        message.textContent = 'Thank you! A Never Fairy will read your comment before it appears.'
        bodyInput.value = ''
      } else {
        message.textContent = body.message || 'Your comment could not be sent. Please try again later.'
      }
      submit.disabled = false
    })

    form.append(note, nameRow, bodyRow, message, actions)
    return form
  }

  async function section (feed, id, entry) {
    const comments = element('section', 'newsComments')
    comments.appendChild(element('h3', '', 'Leave a Comment'))

    if (entry.commentsEnabled) {
      if (entry.comments.length) {
        const list = element('ul', 'newsCommentList')
        entry.comments.forEach(comment => list.appendChild(commentItem(comment)))
        comments.appendChild(list)
      }
      const me = window.site ? await window.site.loadMe() : null
      comments.appendChild(commentForm(feed, { _id: id }, me))
    } else {
      comments.appendChild(element('p', 'newsCommentsClosed', 'Comments are closed on this post.'))
    }

    return comments
  }

  window.newsComments = { section }
})()
