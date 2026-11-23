// the documents a contest entry may carry besides pictures

const { sniffImageType } = require('./images')

const DOCUMENT_TYPES = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.rtf': 'application/rtf',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.gif', '.webp', '.bmp']

// for error messages and <input accept>, kept next to the table above.
const ACCEPTED_DOCUMENT_TYPES = 'PDF, Word (.docx), OpenDocument (.odt), RTF, Markdown (.md) or plain text (.txt)'
const DOCUMENT_ACCEPT_ATTRIBUTE = '.pdf,.docx,.odt,.rtf,.md,.markdown,.txt,.text'

// plain text and Markdown are shown as text; everything else is a download.
const SHOWN_AS_TEXT = ['.md', '.txt']

function extensionOf (name) {
  const match = /\.[A-Za-z0-9]+$/.exec(String(name || ''))
  return match ? match[0].toLowerCase() : ''
}

function kindOfExtension (ext) {
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (DOCUMENT_TYPES[ext]) return 'document'
  return null
}

function zipNames (buffer) {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) return null

  let end = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break }
  }
  if (end < 0) return null

  const count = buffer.readUInt16LE(end + 10)
  let offset = buffer.readUInt32LE(end + 16)
  const names = []

  for (let i = 0; i < count && i < 20000; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) return null

    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    names.push(buffer.toString('utf8', offset + 46, offset + 46 + nameLength))
    offset += 46 + nameLength + extraLength + commentLength
  }

  return names
}

// an OpenDocument file begins with a stored entry called "mimetype".
function isOdt (buffer) {
  if (buffer.length < 30) return false

  const nameLength = buffer.readUInt16LE(26)
  const extraLength = buffer.readUInt16LE(28)
  if (buffer.toString('utf8', 30, 30 + nameLength) !== 'mimetype') return false

  const start = 30 + nameLength + extraLength
  return buffer.toString('ascii', start, start + 39) === 'application/vnd.oasis.opendocument.text'
}

function carriesCode (ext, buffer, names) {
  if (ext === '.docx') return names.some(name => /vbaProject\.bin$|\.exe$|\.dll$|\.js$/i.test(name))
  if (ext === '.pdf') return /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction)\b/.test(buffer.toString('latin1'))
  return false
}

// plain text: UTF-8, and nothing a text file would not have.
function isPlainText (buffer) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return !/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text)
  } catch (e) {
    return false
  }
}

function sniffDocumentType (buffer, originalName) {
  if (!buffer.length) return null

  let ext = null
  let names = []

  if (buffer.length >= 5 && buffer.toString('latin1', 0, 5) === '%PDF-') {
    ext = '.pdf'
  } else if (buffer.length >= 5 && buffer.toString('latin1', 0, 5) === '{\\rtf') {
    ext = '.rtf'
  } else if ((names = zipNames(buffer))) {
    if (names.includes('[Content_Types].xml') && names.some(name => name.startsWith('word/'))) ext = '.docx'
    else if (isOdt(buffer)) ext = '.odt'
  } else if (isPlainText(buffer)) {
    ext = /^\.(md|markdown)$/.test(extensionOf(originalName)) ? '.md' : '.txt'
  }

  if (!ext || carriesCode(ext, buffer, names || [])) return null

  return { ext, type: DOCUMENT_TYPES[ext], kind: 'document', text: SHOWN_AS_TEXT.includes(ext) }
}

// whatever a stranger sent: a picture, a document, or nothing we take.
function sniffUpload (buffer, originalName) {
  const image = sniffImageType(buffer)
  if (image) return { ext: image.ext, kind: 'image' }

  return sniffDocumentType(buffer, originalName)
}

module.exports = {
  DOCUMENT_TYPES,
  ACCEPTED_DOCUMENT_TYPES,
  DOCUMENT_ACCEPT_ATTRIBUTE,
  SHOWN_AS_TEXT,
  extensionOf,
  kindOfExtension,
  sniffDocumentType,
  sniffUpload
}
