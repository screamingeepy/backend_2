
const fs = require('fs')
const path = require('path')
const { XMLParser } = require('fast-xml-parser')

// phraseId -> { id, slot, template, before, after }
const phrases = new Map()

// slot ("word_13") -> [{ id, text }]
const wordsBySlot = new Map()

// wordId -> { id, slot, text }
const words = new Map()

const textOf = value => (typeof value === 'object' ? (value['#text'] ?? '') : String(value ?? '')).trim()

// the file lists a handful of these as one-element blocks rather than arrays.
const asArray = value => (Array.isArray(value) ? value : value == null ? [] : [value])

function initGuestbookText () {
  try {
    const file = path.join(__dirname, '../../web/xml/createMessageAssets.xml')

    if (!fs.existsSync(file)) {
      console.warn('[guestbookText] web/xml/createMessageAssets.xml not found -- the guestbook will have nothing to say.')
      return
    }

    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
    const root = parser.parse(fs.readFileSync(file, 'utf-8')).CreateMessageAssets || {}

    const copy = root.copy || {}
    const copyText = key => textOf(copy[key])

    for (const word of asArray((root.words || {}).word)) {
      const id = Number(word['@_word_id'])
      const text = copyText(textOf(word.text))
      const slot = textOf(word.type)

      if (!Number.isInteger(id) || !text || !slot) continue

      words.set(id, { id, slot, text })

      if (!wordsBySlot.has(slot)) wordsBySlot.set(slot, [])
      wordsBySlot.get(slot).push({ id, text })
    }

    // built from <copy> not <phrases>, phrases only registers 20 of the 25 templates
    for (const [key, value] of Object.entries(copy)) {
      const match = key.match(/^phraseText(\d+)$/)
      if (!match) continue

      const id = Number(match[1])
      const template = textOf(value)
      if (!template) continue

      const blank = template.match(/@(word_\d+)@/)
      if (!blank) continue

      const [before, after] = template.split(blank[0])

      phrases.set(id, { id, slot: blank[1], template, before, after })
    }

    for (const list of wordsBySlot.values()) list.sort((a, b) => a.text.localeCompare(b.text))

    console.log(`[guestbookText] Loaded ${phrases.size} phrases and ${words.size} words from createMessageAssets.xml`)
  } catch (e) {
    console.error(`[guestbookText] Could not read createMessageAssets.xml: ${e.message}`)
  }
}

function guestbookChoices () {
  const out = []

  for (const phrase of phrases.values()) {
    const choices = wordsBySlot.get(phrase.slot) || []
    if (!choices.length) continue

    out.push({
      id: phrase.id,
      before: phrase.before,
      after: phrase.after,
      words: choices
    })
  }

  return out.sort((a, b) => a.id - b.id)
}

function isSayable (phraseId, wordId) {
  const phrase = phrases.get(Number(phraseId))
  const word = words.get(Number(wordId))

  return Boolean(phrase && word && word.slot === phrase.slot)
}

function guestbookLine (phraseId, wordId) {
  if (!isSayable(phraseId, wordId)) return ''

  const phrase = phrases.get(Number(phraseId))

  return phrase.before + words.get(Number(wordId)).text + phrase.after
}

initGuestbookText()

module.exports = { initGuestbookText, guestbookChoices, guestbookLine, isSayable }
