// one character per client setting
// fairies made by an older build have 'A' there, which reads as public

const MORE_OPTIONS_LENGTH = 24
const HOME_PRIVACY_OFFSET = 15

function isHomePrivate (moreOptions) {
  return typeof moreOptions === 'string' && moreOptions.charAt(HOME_PRIVACY_OFFSET) === '1'
}

function normalizeMoreOptions (moreOptions) {
  if (typeof moreOptions !== 'string') {
    return moreOptions
  }

  const padded = moreOptions.padEnd(MORE_OPTIONS_LENGTH, '0')
  const privacy = isHomePrivate(padded) ? '1' : '0'

  return padded.slice(0, HOME_PRIVACY_OFFSET) + privacy + padded.slice(HOME_PRIVACY_OFFSET + 1)
}

module.exports = { HOME_PRIVACY_OFFSET, isHomePrivate, normalizeMoreOptions }
