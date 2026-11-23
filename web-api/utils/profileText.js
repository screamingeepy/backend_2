// the words on a fairy's profile

const fs = require('fs')
const path = require('path')
const { XMLParser } = require('fast-xml-parser')

const questions = new Map()
const answers = new Map()

const postcards = new Map()

const themes = new Map()

function initProfileText () {
  try {
    const file = path.join(__dirname, '../../web/xml/profileAssets.xml')
    if (!fs.existsSync(file)) {
      console.warn('[profileText] web/xml/profileAssets.xml not found -- profiles will show ids.')
      return
    }

    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
    const copy = (parser.parse(fs.readFileSync(file, 'utf-8')).profileAssets || {}).copy || {}

    for (const [key, value] of Object.entries(copy)) {
      const text = typeof value === 'object' ? (value['#text'] || '') : String(value ?? '')

      const question = key.match(/^question(\d+)$/)
      if (question) {
        questions.set(Number(question[1]), String(text).trim())
        continue
      }

      const answer = key.match(/^answer(\d+)$/)
      if (answer) answers.set(Number(answer[1]), String(text).trim())
    }

    loadThemes(parser, file)

    loadPostcards(parser)

    console.log(`[profileText] Loaded ${questions.size} profile questions, ${answers.size} answers, ${themes.size} themes and ${postcards.size} postcard designs.`)
  } catch (err) {
    console.error('[profileText] Could not read profileAssets.xml:', err.message)
  }
}

// "133 195 86" -> "#85c356".
function rgbTriplet (value) {
  const parts = String(value ?? '').trim().split(/\s+/).map(Number)
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return ''
  return '#' + parts.map(n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')
}

function loadThemes (parser, file) {
  const root = parser.parse(fs.readFileSync(file, 'utf-8')).profileAssets || {}
  const list = ((root.themes || {}).theme) || []

  for (const entry of (Array.isArray(list) ? list : [list])) {
    const id = Number(entry['@_theme_id'])
    if (!Number.isInteger(id)) continue

    themes.set(id, {
      id,
      primary: rgbTriplet(entry.primary),
      secondary: rgbTriplet(entry.secondary)
    })
  }
}

function themeFor (value) {
  const id = Number(value)
  return themes.get(Number.isInteger(id) && id > 0 ? id : 1) || themes.get(1) ||
    { id: 1, primary: '#85c356', secondary: '#696ec2' }
}

function loadPostcards (parser) {
  const file = path.join(__dirname, '../../web/xml/panels/postcards.xml')
  if (!fs.existsSync(file)) return

  const panel = parser.parse(fs.readFileSync(file, 'utf-8')).panel || {}
  const copy = panel.copy || {}
  const list = ((panel.config || {}).postcards || {}).postcard || []

  for (const card of Array.isArray(list) ? list : [list]) {
    const id = Number(card['@_id'])
    if (!id) continue

    const image = String(card.image || '').split('/').pop().replace(/\.ajpg$/i, '.jpg')
    const messageKey = String(card.message || '')
    const text = copy[messageKey]

    postcards.set(id, {
      image: image ? '/site/img/postcards/' + image : '',
      message: String(typeof text === 'object' ? (text['#text'] || '') : (text ?? '')).trim()
    })
  }
}

function postcardDesign (id) {
  return postcards.get(Number(id)) || { image: '', message: '' }
}

function questionText (id) {
  return questions.get(Number(id)) || `Question ${id}`
}

function answerText (id) {
  return answers.get(Number(id)) || (Number(id) ? `Answer ${id}` : 'None')
}

// A fairy's bio as the page wants it: the six rows, in order, already worded.
function bioRows (bio) {
  return (Array.isArray(bio) ? bio : [])
    .map(row => ({
      question: questionText(row && row.id),
      answer: answerText(row && row.answer)
    }))
}

// read at require time, as utils/itemNames.js does.
initProfileText()

module.exports = { initProfileText, questionText, answerText, bioRows, postcardDesign, themeFor }
