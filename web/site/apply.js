(function () {
  const byId = id => document.getElementById(id)

  let forms = {}
  let knownEmail = ''

  function node (tag, className, text) {
    const made = document.createElement(tag)
    if (className) made.className = className
    if (text !== undefined) made.textContent = text
    return made
  }

  function questionRow (field) {
    const inputId = 'q_' + field.id
    const row = node('div', 'formRow')
    row.dataset.field = field.id

    const label = node('label', '', field.label + (field.required ? ' *' : ''))
    const body = node('div')

    if (field.type === 'checks') {
      const group = node('div', 'applyChecks')
      group.setAttribute('role', 'group')
      label.removeAttribute('for')
      field.options.forEach((option, index) => {
        const box = node('input')
        box.type = 'checkbox'
        box.value = option
        box.id = inputId + '_' + index
        const text = node('label', '', option)
        text.htmlFor = box.id
        const line = node('div', 'applyCheck')
        line.append(box, text)
        group.appendChild(line)
      })
      body.appendChild(group)
    } else if (field.type === 'number') {
      const input = node('input', 'textInput')
      input.id = inputId
      input.type = 'text'
      input.inputMode = 'numeric'
      input.maxLength = 3
      label.htmlFor = inputId
      body.appendChild(input)
    } else if (field.type === 'choice') {
      const select = node('select', 'selectInput')
      select.id = inputId
      select.append(new Option('Choose one', ''))
      for (const option of field.options) select.append(new Option(option, option))
      label.htmlFor = inputId
      body.appendChild(select)
    } else if (field.type === 'textarea') {
      const area = node('textarea', 'textInput textArea')
      area.id = inputId
      area.rows = 4
      area.maxLength = field.max
      label.htmlFor = inputId
      body.appendChild(area)
    } else {
      const input = node('input', 'textInput')
      input.id = inputId
      input.maxLength = field.max
      label.htmlFor = inputId
      body.appendChild(input)
    }

    if (field.hint) body.appendChild(node('p', 'fieldTip', field.hint))
    const error = node('p', 'fieldError')
    error.id = 'err_' + field.id
    body.appendChild(error)

    row.append(label, body)
    return row
  }

  function drawQuestions () {
    const form = forms[byId('formPick').value]
    const holder = byId('questions')
    holder.replaceChildren()
    byId('applyMessage').textContent = ''
    if (!form) return

    for (const field of form.fields) {
      if (field.group) {
        holder.appendChild(node('h4', 'applyGroup', field.group))
        if (field.groupHint) holder.appendChild(node('p', 'fieldTip', field.groupHint))
      }
      holder.appendChild(questionRow(field))
    }
  }

  function readAnswers (form) {
    const answers = {}
    for (const field of form.fields) {
      if (field.type === 'checks') {
        answers[field.id] = Array.from(document.querySelectorAll('[data-field="' + field.id + '"] input:checked')).map(box => box.value)
      } else {
        answers[field.id] = byId('q_' + field.id).value
      }
    }
    return answers
  }

  function showErrors (fields) {
    for (const row of document.querySelectorAll('#questions [data-field]')) {
      byId('err_' + row.dataset.field).textContent = (fields && fields[row.dataset.field]) || ''
    }
    byId('emailError').textContent = (fields && fields.email) || ''

    const first = fields && Object.keys(fields)[0]
    const target = first && (document.querySelector('[data-field="' + first + '"]') || byId('emailRow'))
    if (target) target.scrollIntoView({ block: 'center' })
  }

  byId('formPick').addEventListener('change', drawQuestions)

  byId('applyForm').addEventListener('submit', async event => {
    event.preventDefault()

    const key = byId('formPick').value
    const form = forms[key]
    const button = byId('applyButton')
    const message = byId('applyMessage')
    if (!form) return

    button.disabled = true
    message.textContent = ''
    showErrors(null)

    try {
      const res = await fetch('/fairies/api/support/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          form: key,
          answers: readAnswers(form),
          email: knownEmail || byId('applyEmail').value.trim(),
          accountName: byId('accountName').value.trim(),
          website: byId('website').value
        })
      })
      const body = await res.json().catch(() => ({}))

      if (!res.ok) {
        message.textContent = body.message || 'Sorry, something went wrong. Please try again in a little while.'
        showErrors(body.fields)
        return
      }

      byId('ticketNumber').textContent = '#' + String(body._id).slice(-6).toUpperCase()
      byId('formBox').hidden = true
      byId('sentBox').hidden = false
      window.scrollTo(0, 0)
    } catch (err) {
      message.textContent = 'Sorry, we couldn\'t reach the server. Please try again in a little while.'
    } finally {
      button.disabled = false
    }
  })

  async function start () {
    const res = await fetch('/fairies/api/support/application-forms')
    const body = await res.json().catch(() => null)

    if (!res.ok || !body) {
      byId('closedBox').hidden = false
      return
    }
    if (!body.open) {
      byId('closedBox').hidden = false
      return
    }

    forms = body.forms
    const pick = byId('formPick')
    for (const [key, form] of Object.entries(forms)) pick.append(new Option(form.title, key))

    const wanted = new URLSearchParams(window.location.search).get('team')
    if (wanted === 'code' && forms.applicationCode) pick.value = 'applicationCode'
    if (wanted === 'mod' && forms.applicationMod) pick.value = 'applicationMod'

    const me = await window.site.loadMe()
    if (me) {
      knownEmail = me.email || ''
      byId('emailRow').hidden = Boolean(knownEmail)
      byId('accountName').value = me.username || ''
      byId('accountNameRow').hidden = true
    }

    drawQuestions()
    byId('formBox').hidden = false
  }

  start()
})()
