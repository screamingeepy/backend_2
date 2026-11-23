// trim a fairy name and collapse inner whitespace
function normalizeFairyName (name) {
  if (typeof name !== 'string') return name

  return name.trim().replace(/\s+/g, ' ')
}

module.exports = { normalizeFairyName }
