(function () {
  const byId = id => document.getElementById(id)
  const { element, formatWhen } = window.tickets
  const { getJson, postJson, renderPager } = window.gmPortal

  const codesUrl = '/fairies/api/gm/codes'
  const pageSize = 10

  let allCodes = []
  let codePage = 1

  function setMessage (text, good) {
    const message = byId('codeMakeMessage')
    message.textContent = text || ''
    message.classList.toggle('ok', Boolean(good))
  }

  async function loadCodes () {
    const { res, body } = await getJson(codesUrl)
    if (!res.ok) return

    allCodes = body
    byId('codeCount').textContent = allCodes.length ? String(allCodes.length) : ''
    showCodes()
  }

  function showCodes () {
    const list = byId('codeList')
    list.replaceChildren()

    if (!allCodes.length) {
      list.appendChild(element('li', 'ticketEmpty', 'No codes yet.'))
      byId('codePager').replaceChildren()
      return
    }

    codePage = renderPager(byId('codePager'), allCodes.length, codePage, pageSize, page => { codePage = page; showCodes() })

    for (const code of allCodes.slice((codePage - 1) * pageSize, codePage * pageSize)) {
      const item = element('li', 'removedFairy')

      const uses = code.maxUses ? code.uses + ' of ' + code.maxUses + ' used' : code.uses + ' used'
      const expires = code.expirationDate ? ' · ends ' + formatWhen(code.expirationDate) : ''
      const amount = code.quantity > 1 && code.rewardType !== 'gold' ? ' x' + code.quantity : ''
      const forWho = (code.gender === 1 ? ' · fairies only' : code.gender === 2 ? ' · Sparrow Men only' : '') +
        (code.repeatHours === 0 ? ' · reusable any time' : code.repeatHours > 0 ? ' · reusable every ' + code.repeatHours + 'h' : '')

      let what = code.reward + amount + ' (item ' + code.rewardId + ')'
      if (code.rewardType === 'gold') what = code.quantity + ' gold'
      if (code.rewardType === 'badge') what = 'badge: ' + code.reward + ' (' + code.rewardId + ')'

      const who = element('span', 'removedWho')
      who.append(
        element('span', 'removedName', code.code),
        element('span', 'removedMeta', what + forWho + ' · ' + uses + expires + (code.note ? ' · ' + code.note : ''))
      )

      const remove = element('button', 'gmRemove', 'Delete')
      remove.type = 'button'
      remove.addEventListener('click', async () => {
        if (!window.confirm('Delete the code ' + code.code + '? Anyone who has not used it yet loses it.')) return
        remove.disabled = true
        const { res: gone, body: why } = await postJson(codesUrl + '/' + code._id + '/delete', {})
        if (!gone.ok) {
          remove.disabled = false
          item.appendChild(element('span', 'removedNote', why.message || 'Could not delete it.'))
          return
        }
        loadCodes()
      })

      const actions = element('span', 'removedActions')
      actions.appendChild(remove)
      item.append(who, actions)
      list.appendChild(item)
    }
  }

  byId('codeMakeForm').addEventListener('submit', async event => {
    event.preventDefault()
    setMessage('')
    byId('codeOutput').hidden = true

    const button = byId('codeMakeButton')
    button.disabled = true

    try {
      const { res, body } = await postJson(codesUrl, {
        rewardType: byId('codeRewardType').value,
        gender: byId('codeGender').value,
        color1: byId('codeColor').value.trim(),
        repeatHours: byId('codeRepeat').value.trim(),
        rewardId: byId('codeReward').value.trim(),
        quantity: byId('codeQuantity').value.trim(),
        code: byId('codeCustom').value.trim(),
        howMany: byId('codeHowMany').value.trim(),
        maxUses: byId('codeMaxUses').value.trim(),
        expires: byId('codeExpires').value,
        note: byId('codeNote').value.trim()
      })

      if (!res.ok || !body.success) {
        setMessage(body.message || 'The codes could not be made (' + res.status + ').')
        return
      }

      const output = byId('codeOutput')
      output.value = body.codes.join('\n')
      output.hidden = false
      setMessage(body.codes.length + (body.codes.length === 1 ? ' code made.' : ' codes made.') + ' Copy them now; they are also listed below.', true)
      loadCodes()
    } finally {
      button.disabled = false
    }
  })

  // what the reward boxes ask for depends on what the code gives.
  const rewardShapes = {
    item: {
      label: 'Reward item number:',
      hint: 'Clothes are under 4000 and home items under 8000. Anything higher goes in the pouch as an ingredient.',
      quantityLabel: 'How many:',
      quantityHint: 'Only used for pouch items. Clothes and home items are always one.',
      needsId: true,
      needsQuantity: true
    },
    gold: {
      quantityLabel: 'How much gold:',
      quantityHint: 'Added to every fairy the code is for, and shown to anyone online at once.',
      needsId: false,
      needsQuantity: true
    },
    badge: {
      label: 'Badge number:',
      hint: 'From the badge list. 10598 is the 2008 Harvest Hustle Champion. Badges go through the game server, so it has to be running when someone uses the code.',
      needsId: true,
      needsQuantity: false
    }
  }

  function showRewardShape () {
    const shape = rewardShapes[byId('codeRewardType').value]
    byId('codeRewardRow').hidden = !shape.needsId
    byId('codeQuantityRow').hidden = !shape.needsQuantity
    // only clothes and home items have a color; gold, badges and ingredients do not.
    byId('codeColorRow').hidden = byId('codeRewardType').value !== 'item'
    if (shape.needsId) {
      byId('codeRewardLabel').textContent = shape.label
      byId('codeRewardHint').textContent = shape.hint
    }
    if (shape.needsQuantity) {
      byId('codeQuantityLabel').textContent = shape.quantityLabel
      byId('codeQuantityHint').textContent = shape.quantityHint
    }
  }

  byId('codeRewardType').addEventListener('change', showRewardShape)
  showRewardShape()

  document.addEventListener('gmSignedIn', event => {
    if ((event.detail.accountType || '') !== 'Administrator') {
      byId('codesDenied').hidden = false
      return
    }
    byId('codesBox').hidden = false
    loadCodes()
  })
})()
