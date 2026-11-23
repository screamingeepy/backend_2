
const VISIBLE_ROOM = 1

const clamp = (value, low, high) => Math.min(high, Math.max(low, Math.round(Number(value) || 0)))

function housePickle (fairy, isMember) {
  if (!fairy) throw new Error('no fairy')

  const homeType = Number(fairy.homeType) || Number(fairy.talent) || 0
  const talent = Number(fairy.talent) || 0

  const head = [homeType, talent, isMember ? 1 : 0].join(',')

  const items = []

  for (const item of (fairy.avatar && fairy.avatar.items) || []) {
    const home = item.home

    if (!home || Number(home.roomId) !== VISIBLE_ROOM) continue

    items.push([
      Number(item.item_id) || 0,
      Number(item.color1) || 0,
      Number(item.color2) || 0,
      clamp(home.x, 0, 1000),
      clamp(home.y, 0, 1000),
      clamp(home.depth, 0, 1000),
      Number(home.flip) ? 1 : 0,
      clamp(home.scale, 1, 1000)
    ].join(':'))
  }

  items.sort()

  return head + ';' + items.join('|')
}

module.exports = { housePickle, VISIBLE_ROOM }
