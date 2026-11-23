// shared by the ticket upload route and the mail ingester

const imageSignatures = [
  { ext: '.png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: '.jpg', bytes: [0xff, 0xd8, 0xff] },
  { ext: '.gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: '.bmp', bytes: [0x42, 0x4d] }
]

// webp isn't a plain prefix match, it is 'RIFF', 4 bytes of size, then 'WEBP'
function isWebp (buffer) {
  return buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
}

function sniffImageType (buffer) {
  const bySignature = imageSignatures.find(type => type.bytes.every((byte, index) => buffer[index] === byte))
  if (bySignature) return bySignature
  if (isWebp(buffer)) return { ext: '.webp' }
  return null
}

const ACCEPTED_IMAGE_TYPES = 'PNG, JPEG, GIF, WEBP or BMP'

function uploadFileName (raw, ext) {
  const base = String(raw || '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
  return `${base || 'upload'}_${Date.now()}${ext}`
}

module.exports = { imageSignatures, sniffImageType, uploadFileName, ACCEPTED_IMAGE_TYPES }
