const FORMAT = 'pixie-hollow-fairy'
const VERSION = 1

const MAX_ITEMS = 5000
const MAX_POUCH = 200
const MAX_STATS = 2000
const MAX_BADGES = 2000
const MAX_PAGES = 500
const MAX_OUTFITS = 30
const MAX_QUESTS = 2000

// the game server has no ceiling on these, so they are what a fairy could plausibly hold
const MAX_GOLD = 10000000
const MAX_STACK = 999
const MAX_COUNT = 1000000

// FairiesConstants.ITEM_TYPES: an item's type is its id's bucket of 500, never something a file gets to say
const ITEM_TYPES = ['Shirt', 'Belt', 'Skirt', 'WristItem', 'HeadItem', 'Necklace', 'AnkleItem', 'Shoes', 'Eyes', 'Face',
  'HairFront', 'HairBack', 'Wings', 'Furniture', 'Lamp', 'Decoration']
const STORAGE_TYPES = ['Furniture', 'Lamp', 'Decoration']
// DistributedFairyPlayerAI.EQUIP_SLOT_FIELDS: the one slot each wearable fills
const EQUIP_SLOT = { HeadItem: 1, Necklace: 2, Shirt: 3, Belt: 4, Skirt: 5, WristItem: 6, AnkleItem: 7, Shoes: 8 }
const NOT_EQUIPPED_SLOT = -1

const BADGE_STATUS = ['Active', 'Earned']
const STAT_TYPES = ['recipe', 'game']
const MORE_OPTIONS_LENGTH = 24

// what a file may hold, everything else on a fairy (ids, friends, ignored, daily timers, gardens,
// quests in progress, giveaway bookkeeping) is left behind and the server starts it fresh

function int (value, fallback = 0, min = -2147483648, max = 2147483647) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(number)))
}

function text (value, max) {
  // eslint-disable-next-line no-control-regex
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : ''
}

function list (value, max) {
  return Array.isArray(value) ? value.slice(0, max) : []
}

function object (value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function date (value) {
  if (!value) return null
  const parsed = new Date(value)
  // a date before 1970 can't be read back by the game server's pymongo, and one in the future can't have happened
  return inRealRange(parsed) ? parsed : null
}

function inRealRange (value) {
  const time = value.getTime()
  return time >= Date.UTC(1970, 0, 1) && time <= Date.now() + 24 * 60 * 60 * 1000
}

// FairiesConstants.get_item_type, or null where it would raise
function typeOf (itemId) {
  let bucket = Math.floor(itemId / 500)
  if (bucket >= ITEM_TYPES.length) bucket = Math.floor(Number(String(itemId).slice(1)) / 500)
  return ITEM_TYPES[bucket] || null
}

function exportFairy (fairy) {
  const avatar = fairy.avatar || {}
  const badges = fairy.badgeData || {}
  const pet = fairy.pet

  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    fairy: {
      name: fairy.name,
      talent: fairy.talent,
      gender: fairy.gender,
      level: fairy.level || 0,
      xp: fairy.xp || 0,
      gold: fairy.gold || 0,
      bio: fairy.bio || [],
      icon: fairy.icon || 0,
      game_prof_bg: fairy.game_prof_bg || null,
      homeType: fairy.homeType ?? null,
      gardenType: fairy.gardenType ?? null,
      moreOptions: fairy.moreOptions,
      tutorialBitmask: fairy.tutorialBitmask || [0, 0],
      maxOutfitSlots: fairy.maxOutfitSlots || 1,
      pouch: fairy.pouch || [],
      stats: fairy.stats || [],
      completedQuests: fairy.questHistory || [],
      badges: {
        badges: badges.badges || [],
        unlockedPages: badges.unlockedPages || [],
        favoriteBadgeId: badges.favoriteBadgeId || 0
      },
      pet: pet
        ? {
            itemId: pet.itemId,
            color1: pet.color1,
            color2: pet.color2,
            outfitId: pet.outfitId,
            name1: pet.name1,
            name2: pet.name2,
            hunger: pet.hunger,
            happiness: pet.happiness,
            health: pet.health,
            growth: pet.growth,
            status: pet.status,
            golden: pet.golden
          }
        : null,
      petOutfits: fairy.petOutfits || [],
      savedOutfits: fairy.savedOutfits || [],
      avatar: {
        proportions: avatar.proportions,
        rotations: avatar.rotations,
        hair_back: avatar.hair_back,
        hair_front: avatar.hair_front,
        face: avatar.face,
        eye: avatar.eye,
        wing: avatar.wing,
        hair_color: avatar.hair_color,
        hair_color2: avatar.hair_color2 || 0,
        eye_color: avatar.eye_color,
        skin_color: avatar.skin_color,
        wing_color: avatar.wing_color,
        items: (avatar.items || []).map(item => ({
          inv_id: item.inv_id,
          type: item.type,
          item_id: item.item_id,
          slot: item.slot,
          createdByName: item.createdByName,
          giftedByName: item.giftedByName,
          quality: item.quality,
          color1: item.color1,
          color2: item.color2,
          howAcquired: item.howAcquired,
          location: item.location,
          home: item.home || undefined
        }))
      }
    }
  }
}

function readItems (source, catalog, skipped) {
  const idMap = new Map()
  const items = []

  // a fairy owns as many of the same piece as she likes, but wears one thing per slot
  const worn = new Set()

  for (const raw of list(source, MAX_ITEMS)) {
    const item = object(raw)
    const itemId = int(item.item_id, 0, 0)
    if (!itemId) continue

    const type = typeOf(itemId)
    // furniture, lamps and decorations are defined with the home, clothes with the avatar
    const storage = STORAGE_TYPES.includes(type)
    if (!type || !(storage ? catalog.hasHomeItem(itemId) : catalog.hasWardrobeItem(itemId))) {
      skipped.items++
      continue
    }

    // furniture lives in storage and clothes in the wardrobe, wherever the file says they were
    let location = storage ? 'Storage' : item.location === 'Equipped' ? 'Equipped' : 'Wardrobe'
    let slot = NOT_EQUIPPED_SLOT

    if (location === 'Equipped') {
      slot = EQUIP_SLOT[type]
      if (!slot || worn.has(slot)) {
        location = 'Wardrobe'
        slot = NOT_EQUIPPED_SLOT
      } else {
        worn.add(slot)
      }
    }

    const created = {
      type,
      item_id: itemId,
      slot,
      createdById: 0,
      createdByName: text(item.createdByName, 40),
      giftedById: 0,
      giftedByName: text(item.giftedByName, 40),
      quality: int(item.quality, 0, 0, 100),
      color1: colorOf(item.color1, catalog),
      color2: colorOf(item.color2, catalog),
      howAcquired: int(item.howAcquired, 0, 0, 1000),
      location
    }

    // only furniture can be placed in a home, as many of the same piece as are in the file
    if (storage && item.home && typeof item.home === 'object') {
      created.home = {
        roomId: int(item.home.roomId, 0, 0, 100000),
        x: int(item.home.x, 0, -100000, 100000),
        y: int(item.home.y, 0, -100000, 100000),
        depth: int(item.home.depth, 0, -100000, 100000),
        flip: int(item.home.flip, 0, 0, 1),
        scale: int(item.home.scale, 100, 1, 1000)
      }
    }

    items.push({ created, oldInvId: int(item.inv_id, 0, 0) })
  }

  return { items, idMap }
}

async function freshInventory (source, nextId, catalog, skipped) {
  const { items, idMap } = readItems(source, catalog, skipped)

  for (const entry of items) {
    entry.created.inv_id = await nextId()
    if (entry.oldInvId) idMap.set(entry.oldInvId, entry.created.inv_id)
  }

  return { items: items.map(entry => entry.created), idMap }
}

// an outfit names its items by inventory id, which the import just changed
async function readOutfits (source, idMap, nextId, maxOutfits) {
  const outfits = []

  for (const raw of list(source, Math.min(MAX_OUTFITS, maxOutfits))) {
    const outfit = object(raw)
    const slots = {}

    for (const [slot, value] of Object.entries(object(outfit.items))) {
      if (!/^[a-z]{2,16}$/i.test(slot) || !Array.isArray(value)) continue
      const newInvId = idMap.get(int(value[0], 0, 0))
      if (!newInvId) continue
      slots[slot] = [newInvId, ...value.slice(1, 8).map(part => int(part, 0, 0, 1000000))]
    }

    if (Object.keys(slots).length) outfits.push({ outfitId: await nextId(), items: slots })
  }

  return outfits
}

// a color the server doesn't know falls back to undyed
function colorOf (value, catalog) {
  const id = int(value, 0, 0, 100000)
  return catalog.hasColor(id) ? id : 0
}

// hair, face, eyes and wings are wardrobe pieces, and a fairy can't be drawn without one, so a missing
// piece is swapped for the server's default of that kind
const PART_BUCKETS = { eye: 8, face: 9, hair_front: 10, hair_back: 11, wing: 12 }
const FACE_TO_EYE_OFFSET = -500

function isPart (id, bucket, catalog) {
  return Math.floor(id / 500) === bucket && catalog.hasWardrobeItem(id)
}

function partOf (value, part, gender, catalog, skipped) {
  const id = int(value, 0, 0, 100000)
  if (!id || isPart(id, PART_BUCKETS[part], catalog)) return id
  skipped.parts++
  return catalog.defaultWardrobe(PART_BUCKETS[part], gender)
}

// an eye belongs to its face, so when the face was swapped the matching eye follows it
function eyeOf (value, face, gender, catalog, skipped) {
  const id = int(value, 0, 0, 100000)
  if (!id || isPart(id, PART_BUCKETS.eye, catalog)) return id
  skipped.parts++
  const paired = face + FACE_TO_EYE_OFFSET
  return isPart(paired, PART_BUCKETS.eye, catalog) ? paired : catalog.defaultWardrobe(PART_BUCKETS.eye, gender)
}

function petWears (id, catalog) {
  return id && !catalog.hasWardrobeItem(id) && !catalog.hasPouchItem(id) ? 0 : id
}

function petNameOf (value, catalog) {
  const id = int(value, 0, 0)
  return catalog.hasPetName(id) ? id : 0
}

// a home this server doesn't have becomes the one that goes with the talent
function homeTypeOf (value, talent, catalog, skipped) {
  if (value == null) return null
  const type = int(value, talent, 0, 1000)
  if (catalog.hasHome(type)) return type
  skipped.home++
  return talent
}

function known (entries, isKnown, skipped, key) {
  return entries.filter(entry => {
    if (isKnown(entry)) return true
    skipped[key]++
    return false
  })
}

// the same badge, quest or stat twice would be counted twice
function unique (entries, keyOf, skipped, key) {
  const seen = new Set()
  return entries.filter(entry => {
    const id = keyOf(entry)
    if (seen.has(id)) {
      skipped[key]++
      return false
    }
    seen.add(id)
    return true
  })
}

// a pouch slot holds one stack: a second claim on a slot moves to the next free one, and a stack is never empty
function seatedPouch (slots) {
  const taken = new Set()
  const seated = []

  for (const slot of slots) {
    if (slot.amount < 1) continue
    let place = slot.slot
    while (taken.has(place)) place++
    taken.add(place)
    seated.push({ ...slot, slot: place, amount: Math.min(slot.amount, MAX_STACK) })
  }

  return seated
}

// last check before mongo, nothing here should fail. a failure means a field was added without a rule
// and one value the district can't read takes it down
function assertStorable (value, where = 'fairy', depth = 0) {
  const fail = why => {
    console.warn(`fairy import refused at ${where}: ${why}`)
    throw new Error('This fairy file has something this game cannot store.')
  }

  if (depth > 10) fail('nested too deep')
  if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 2147483647)) fail('number out of range')
  // eslint-disable-next-line no-control-regex
  if (typeof value === 'string' && (value.length > 1000 || /[\u0000-\u001f\u007f]/.test(value))) fail('bad text')
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime()) || !inRealRange(value)) fail('date out of range')
    return
  }
  if (Array.isArray(value)) value.forEach((entry, index) => assertStorable(entry, `${where}[${index}]`, depth + 1))
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key.startsWith('$') || key.includes('.') || key.includes('\u0000')) fail(`bad key ${key}`)
      if (entry === undefined) fail(`${key} is undefined`)
      assertStorable(entry, `${where}.${key}`, depth + 1)
    }
  }
}

function moreOptionsOf (value) {
  const cleaned = typeof value === 'string' ? value.replace(/[^0-9A-Za-z]/g, '0') : ''
  return cleaned.slice(0, MORE_OPTIONS_LENGTH).padEnd(MORE_OPTIONS_LENGTH, '0')
}

async function buildFairyDocument (file, { account, nextId, address, normalizeName, validateName, fallbackName, catalog }) {
  const payload = object(file)
  if (payload.format !== FORMAT) throw new Error('This is not a Pixie Hollow fairy file.')
  if (int(payload.version, 0) > VERSION) throw new Error('This fairy file is from a newer version than this server understands.')

  const source = object(payload.fairy)
  const skipped = { items: 0, pouch: 0, badges: 0, quests: 0, stats: 0, pet: 0, petOutfits: 0, parts: 0, talent: 0, home: 0 }

  // a name outside the allowed ones isn't refused, the fairy comes back under a fresh allowed one
  let name = normalizeName(text(source.name, 60))
  let renamedFrom = null
  if (!name || !validateName(name)) {
    renamedFrom = name || null
    name = await fallbackName()
  }

  // a talent this server doesn't have becomes a tinker
  let talent = int(source.talent, 0)
  if (talent < 1 || talent > 5) {
    talent = 5
    skipped.talent++
  }

  const gender = int(source.gender, 0)
  if (gender !== 1 && gender !== 2) throw new Error('This file has no valid gender.')

  const avatarSource = object(source.avatar)
  const { items, idMap } = await freshInventory(avatarSource.items, nextId, catalog, skipped)

  const proportions = {}
  for (const key of ['head', 'height', 'body']) proportions[key] = int(object(avatarSource.proportions)[key], 0, -1000, 1000)

  const rotations = {}
  for (const key of ['head_rot', 'll_arm_rot', 'ul_arm_rot', 'ul_leg_rot', 'll_leg_rot', 'lr_arm_rot', 'ur_arm_rot', 'lr_leg_rot', 'ur_leg_rot']) {
    rotations[key] = int(object(avatarSource.rotations)[key], 0, -1000, 1000)
  }

  const maxOutfitSlots = int(source.maxOutfitSlots, 1, 1, 30)

  // xp decides the level, as it does on the game server: a level the file claims is only a floor, and neither
  // goes past the top level
  const topLevel = catalog.maxLevel()
  const claimedLevel = int(source.level, 0, 0, topLevel)
  const xp = Math.min(catalog.xpForLevel(topLevel), Math.max(int(source.xp, 0, 0), catalog.xpForLevel(claimedLevel)))
  const level = catalog.levelForXp(xp)

  const badgeSource = object(source.badges)
  const face = partOf(avatarSource.face, 'face', gender, catalog, skipped)

  const doc = {
    ownerAccount: account.username,
    accountId: account._id,
    friends: [],
    ignored: [],
    famousFairy: false,
    created: new Date(),
    name,
    talent,
    gender,
    chosen: true,
    pollId: '',
    quizId: '',
    deleted: false,
    deletedAt: null,
    icon: int(source.icon, 0, 0, 100000),
    game_prof_bg: typeof source.game_prof_bg === 'string' && /^[\w\-.]{1,64}$/.test(source.game_prof_bg) ? source.game_prof_bg : null,
    bio: list(source.bio, 20).map((answer, index) => ({
      id: int(object(answer).id, index + 1, 0, 1000),
      answer: int(object(answer).answer, 0, 0, 1000)
    })),
    address,
    homeType: homeTypeOf(source.homeType, talent, catalog, skipped),
    gardenType: source.gardenType == null ? null : int(source.gardenType, 1, 0, 1000),
    gardenPlots: [],
    moreOptions: moreOptionsOf(source.moreOptions),
    tutorialBitmask: [int(list(source.tutorialBitmask, 2)[0], 0, 0), int(list(source.tutorialBitmask, 2)[1], 0, 0)],
    optionsBitmask: 0,
    gold: int(source.gold, 0, 0, MAX_GOLD),
    goldTradedToday: 0,
    lastGoldTradeAt: null,
    pouch: seatedPouch(known(list(source.pouch, MAX_POUCH).map(slot => ({
      item_id: int(object(slot).item_id, 0, 0),
      slot: int(object(slot).slot, 0, 0, 1000),
      amount: int(object(slot).amount, 0, 0, MAX_STACK)
    })).filter(slot => slot.item_id), slot => catalog.hasPouchItem(slot.item_id), skipped, 'pouch')),
    giveawaysCollected: [],
    maxOutfitSlots,
    savedOutfits: await readOutfits(source.savedOutfits, idMap, nextId, maxOutfitSlots),
    level,
    dailyChanceLastSpin: null,
    questState: [],
    questHistory: known(list(source.completedQuests, MAX_QUESTS).map(quest => ({
      questGroup: int(object(quest).questGroup, 0, 0),
      questBitmask: int(object(quest).questBitmask, 0),
      acceptTimeForLastDone: int(object(quest).acceptTimeForLastDone, 0, 0)
    })).filter(quest => quest.questGroup), quest => catalog.hasQuestGroup(quest.questGroup), skipped, 'quests'),
    badgeData: {
      badges: known(list(badgeSource.badges, MAX_BADGES).map(badge => ({
        badgeId: int(object(badge).badgeId, 0, 0),
        status: BADGE_STATUS.includes(object(badge).status) ? badge.status : 'Active',
        progress: int(object(badge).progress, 0, 0, MAX_COUNT),
        dateEarned: date(object(badge).dateEarned)
      })).filter(badge => badge.badgeId), badge => catalog.hasBadge(badge.badgeId), skipped, 'badges'),
      unlockedPages: list(badgeSource.unlockedPages, MAX_PAGES).map(page => int(page, 0, 0)).filter(page => page && catalog.hasBadgePage(page)),
      favoriteBadgeId: catalog.hasBadge(int(badgeSource.favoriteBadgeId, 0, 0)) ? int(badgeSource.favoriteBadgeId, 0, 0) : 0
    },
    petOutfits: known(list(source.petOutfits, 200).map(outfit => int(outfit, 0, 0)).filter(Boolean), outfit => catalog.hasWardrobeItem(outfit) || catalog.hasPouchItem(outfit), skipped, 'petOutfits'),
    stats: known(list(source.stats, MAX_STATS).map(stat => ({
      type: STAT_TYPES.includes(object(stat).type) ? stat.type : null,
      statId: int(object(stat).statId, 0, 0),
      count: int(object(stat).count, 0, 0, MAX_COUNT),
      best: int(object(stat).best, 0, 0, MAX_COUNT),
      total: int(object(stat).total, 0, 0, MAX_COUNT),
      bonus: int(object(stat).bonus, 0, 0, MAX_COUNT)
    })).filter(stat => stat.type && stat.statId), stat => (stat.type === 'recipe' ? catalog.hasRecipe(stat.statId) : catalog.hasGame(stat.statId)), skipped, 'stats'),
    avatar: {
      proportions,
      rotations,
      hair_back: partOf(avatarSource.hair_back, 'hair_back', gender, catalog, skipped),
      hair_front: partOf(avatarSource.hair_front, 'hair_front', gender, catalog, skipped),
      face,
      eye: eyeOf(avatarSource.eye, face, gender, catalog, skipped),
      wing: partOf(avatarSource.wing, 'wing', gender, catalog, skipped),
      hair_color: colorOf(avatarSource.hair_color, catalog),
      hair_color2: colorOf(avatarSource.hair_color2, catalog),
      eye_color: colorOf(avatarSource.eye_color, catalog),
      skin_color: colorOf(avatarSource.skin_color, catalog),
      wing_color: colorOf(avatarSource.wing_color, catalog),
      items
    }
  }

  // xp has no field in the model, the game server writes it straight to the document
  doc.xp = xp

  // the same badge, quest, stat or outfit twice would count twice, though a fairy may own duplicate items
  doc.badgeData.badges = unique(doc.badgeData.badges, badge => badge.badgeId, skipped, 'badges')
  doc.badgeData.unlockedPages = [...new Set(doc.badgeData.unlockedPages)]
  if (!doc.badgeData.badges.some(badge => badge.badgeId === doc.badgeData.favoriteBadgeId)) doc.badgeData.favoriteBadgeId = 0
  doc.questHistory = unique(doc.questHistory, quest => quest.questGroup, skipped, 'quests')
  doc.stats = unique(doc.stats, stat => `${stat.type}|${stat.statId}`, skipped, 'stats')
  doc.petOutfits = unique(doc.petOutfits, outfit => outfit, skipped, 'petOutfits')

  const pet = source.pet && typeof source.pet === 'object' ? source.pet : null
  if (pet && int(pet.itemId, 0, 0) && !catalog.hasPetSpecies(int(pet.itemId, 0, 0))) {
    skipped.pet++
  } else if (pet && int(pet.itemId, 0, 0)) {
    const now = new Date()
    doc.pet = {
      itemId: int(pet.itemId, 0, 0),
      color1: colorOf(pet.color1, catalog),
      color2: colorOf(pet.color2, catalog),
      outfitId: petWears(int(pet.outfitId, 0, 0), catalog),
      name1: petNameOf(pet.name1, catalog),
      name2: petNameOf(pet.name2, catalog),
      hunger: int(pet.hunger, 100, 0, 100),
      happiness: int(pet.happiness, 100, 0, 100),
      health: int(pet.health, 100, 0, 100),
      growth: int(pet.growth, 0, 0, MAX_COUNT),
      status: int(pet.status, 3, 0, 10),
      golden: int(pet.golden, 0, 0, 1),
      giftSteps: 0,
      giftsToday: 0,
      giftDay: null,
      healthyDays: 0,
      sadDays: 0,
      lastTick: null,
      acquired: now
    }
  }

  if (renamedFrom) doc.importedName = renamedFrom

  assertStorable(doc)

  // dropped content is gone, swapped content was replaced by a default
  const swappedKeys = ['parts', 'talent', 'home']
  const total = keys => keys.reduce((sum, key) => sum + skipped[key], 0)
  const dropped = total(Object.keys(skipped).filter(key => !swappedKeys.includes(key)))

  return { doc, renamedFrom, skipped: dropped, swapped: total(swappedKeys) }
}

module.exports = { FORMAT, VERSION, exportFairy, buildFairyDocument }
