const adultAge = 13

function currentAge (account, now = new Date()) {
  if (!account || !account.age || !account.ageGivenAt) return null

  const given = new Date(account.ageGivenAt)
  let years = now.getFullYear() - given.getFullYear()
  const anniversary = new Date(given)
  anniversary.setFullYear(given.getFullYear() + years)
  if (now < anniversary) years -= 1

  return account.age + Math.max(0, years)
}

function isUnderThirteen (account, now = new Date()) {
  const age = currentAge(account, now)
  return age !== null && age < adultAge
}

// an account made under 13 has its parent's address on it, so password resets would go to them
// after the player is old enough to look after the account themselves
function needsOwnEmail (account, now = new Date()) {
  if (!account || !account.email || account.ownEmailAt) return false
  return account.age < adultAge && !isUnderThirteen(account, now)
}

function chatPlusAllowed (account, now = new Date()) {
  if (!account || !account.emailConfirmedAt || account.speedChatOnly) return false
  if (!isUnderThirteen(account, now)) return true
  return Boolean(account.chatApproved)
}

module.exports = { currentAge, isUnderThirteen, needsOwnEmail, chatPlusAllowed, adultAge }
