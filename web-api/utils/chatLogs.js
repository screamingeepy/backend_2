const fs = require('fs')
const path = require('path')
const readline = require('readline')

const logDirectory = process.env.GAME_LOG_DIR || path.join(__dirname, '../../game-server/logs')

const kinds = {
  'chat-message': 'Chat',
  'whisper-chat-message': 'Whisper',
  'whisper-sent': 'Whisper',
  'muted-chat': 'Muted chat',
  'muted-whisper': 'Muted whisper',
  'banned-phrase': 'Flagged phrase',
  'banned-combo': 'Flagged combo'
}

const fileName = /^events-(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.log$/

function splitMessage (rest) {
  if (rest.length <= 1) return { message: rest.join('|'), shown: '' }

  const joined = rest.join('|')
  const middle = (joined.length - 1) / 2
  if (Number.isInteger(middle) && joined[middle] === '|' && joined.slice(0, middle) === joined.slice(middle + 1)) {
    return { message: joined.slice(0, middle), shown: joined.slice(middle + 1) }
  }

  return { message: rest.slice(0, -1).join('|'), shown: rest[rest.length - 1] }
}

function parseLine (line) {
  const parts = line.split('|')
  if (parts.length < 6 || parts[1] !== 'FairyClient') return null

  const event = parts[3]
  const kind = kinds[event]
  if (!kind) return null

  const args = parts.slice(4)
  const row = {
    time: parts[0],
    kind,
    accountId: Number(args[0]),
    avatarId: Number(args[1]),
    toAvatarId: null,
    message: '',
    shown: '',
    note: ''
  }

  if (event === 'chat-message' || event === 'whisper-chat-message') {
    Object.assign(row, splitMessage(args.slice(2)))
  } else if (event === 'whisper-sent') {
    row.toAvatarId = Number(args[2])
    Object.assign(row, splitMessage(args.slice(3)))
  } else if (event === 'muted-chat' || event === 'muted-whisper') {
    row.message = args.slice(2).join('|')
  } else {
    row.note = `${args[2]}: ${args[3]}`
    row.message = args.slice(4).join('|')
  }

  return row
}

async function filesBetween (fromDate, toDate) {
  const rangeStart = new Date(`${fromDate}T00:00:00`)
  const rangeEnd = new Date(`${toDate}T23:59:59`)

  let names
  try {
    names = await fs.promises.readdir(logDirectory)
  } catch (err) {
    return []
  }

  const files = []
  for (const name of names.sort()) {
    const match = fileName.exec(name)
    if (!match) continue

    const started = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]))
    const stat = await fs.promises.stat(path.join(logDirectory, name))
    if (stat.mtime >= rangeStart && started <= rangeEnd) files.push(path.join(logDirectory, name))
  }
  return files
}

async function readChat ({ from, to, accountIds, avatarIds, contains, limit }) {
  const rows = []
  const needle = contains ? contains.toLowerCase() : ''

  for (const file of await filesBetween(from, to)) {
    const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })

    for await (const line of lines) {
      const day = line.slice(0, 10)
      if (day < from || day > to) continue

      const row = parseLine(line)
      if (!row) continue

      if (accountIds || avatarIds) {
        const mine = (accountIds && accountIds.has(row.accountId)) ||
          (avatarIds && (avatarIds.has(row.avatarId) || avatarIds.has(row.toAvatarId)))
        if (!mine) continue
      }

      if (needle && !row.message.toLowerCase().includes(needle) && !row.shown.toLowerCase().includes(needle)) continue

      rows.push(row)
      if (rows.length >= limit) {
        lines.close()
        return { rows, truncated: true }
      }
    }
  }

  return { rows, truncated: false }
}

function oneLine (value) {
  return String(value === null || value === undefined ? '' : value).replace(/[\r\n\t]+/g, ' ')
}

function describe (id, name, accountName) {
  const who = name ? `${name}` : 'unknown fairy'
  return accountName ? `${who} (${accountName}, fairy ${id})` : `${who} (fairy ${id})`
}

function toText (rows, names, heading) {
  const lines = [...heading, '']

  for (const row of rows) {
    const from = describe(row.avatarId, names.fairies.get(row.avatarId), names.accounts.get(row.accountId))
    const to = row.toAvatarId ? ` -> ${describe(row.toAvatarId, names.fairies.get(row.toAvatarId), '')}` : ''
    let line = `${row.time}  ${row.kind}  ${from}${to}: ${oneLine(row.message)}`

    if (row.shown && row.shown !== row.message) line += `  [others saw: ${oneLine(row.shown)}]`
    if (row.note) line += `  [${oneLine(row.note)}]`

    lines.push(line)
  }

  return lines.join('\r\n') + '\r\n'
}

module.exports = { readChat, toText, parseLine, logDirectory }
