const fs = require('fs')
const path = require('path')

const XML_DIR = path.join(__dirname, '../../web/xml')
const XP_CONFIG = path.join(__dirname, '../../game-server/game/fairies/experience/XPConfig.py')
const QUESTS_PER_QUEST_GROUP = 32

// what exists on this server is whatever the client xml says, custom content included, so the files are
// read again when they change instead of once at boot
const cache = new Map()

function readIds (file, pattern) {
  const full = path.join(XML_DIR, file)
  let mtime
  try {
    mtime = fs.statSync(full).mtimeMs
  } catch {
    return new Set()
  }

  const key = `${file}|${pattern.source}`
  const cached = cache.get(key)
  if (cached && cached.mtime === mtime) return cached.ids

  const ids = new Set()
  for (const match of fs.readFileSync(full, 'utf8').matchAll(pattern)) ids.add(Number(match[1]))
  cache.set(key, { mtime, ids })
  return ids
}

// id -> display name for a file, read again when it changes like the id sets are
const names = new Map()

function readNames (file, pattern) {
  const full = path.join(XML_DIR, file)
  let mtime
  try {
    mtime = fs.statSync(full).mtimeMs
  } catch {
    return new Map()
  }

  const cached = names.get(file)
  if (cached && cached.mtime === mtime) return cached.byId

  const byId = new Map()
  for (const match of fs.readFileSync(full, 'utf8').matchAll(pattern)) {
    const text = match[2].replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    byId.set(Number(match[1]), text)
  }
  names.set(file, { mtime, byId })
  return byId
}

// the xp each level costs, from the same table the game server levels fairies with: cumulative[level] is the
// total xp a fairy needs to be that level
let levelTable = null

function levels () {
  let mtime
  try {
    mtime = fs.statSync(XP_CONFIG).mtimeMs
  } catch {
    throw new Error('The server could not check the level right now.')
  }

  if (levelTable && levelTable.mtime === mtime) return levelTable

  const cumulative = [0]
  for (const match of fs.readFileSync(XP_CONFIG, 'utf8').matchAll(/\{"level":\s*(\d+),[^\n]*?"xp":\s*(\d+)/g)) {
    cumulative[Number(match[1])] = cumulative[Number(match[1]) - 1] + Number(match[2])
  }

  if (cumulative.length < 2 || cumulative.some(total => !Number.isFinite(total))) {
    throw new Error('The server could not check the level right now.')
  }

  levelTable = { mtime, cumulative }
  return levelTable
}

function levelForXp (xp) {
  const { cumulative } = levels()
  let level = 0
  while (level + 1 < cumulative.length && xp >= cumulative[level + 1]) level++
  return level
}

const itemTags = /<item(\d+)[\s>/]/g

const sets = {
  wardrobe: () => readIds('avatarAssets.xml', itemTags),
  badges: () => readIds('badges.xml', /<name(\d+)[\s>]/g),
  pages: () => readIds('badgePages.xml', /<page\s+id="(\d+)"/g),
  quests: () => readIds('quests.xml', /<quest\s+questId="(\d+)"/g),
  recipes: () => readIds('recipes.xml', /<recipe\s+itemId="(\d+)"/g),
  species: () => readIds('animalFriendAssets.xml', /<species\s+id="(\d+)"/g),
  games: () => readIds('minigames.xml', /<game\s+id="(\d+)"/g),
  petNames: () => readIds('animalFriendNames.xml', /<name\s+id="(\d+)"/g),
  colors: () => readIds('colorAssets.xml', /<color\s+color_id="(\d+)"/g)
}

// the first wardrobe piece of a kind (an id bucket of 500) that fits the gender, for when a file's own is gone
function defaultWardrobe (bucket, gender) {
  const full = path.join(XML_DIR, 'avatarAssets.xml')
  let mtime
  try {
    mtime = fs.statSync(full).mtimeMs
  } catch {
    return 0
  }

  let byBucket = defaults.get(mtime)
  if (!byBucket) {
    byBucket = new Map()
    for (const match of fs.readFileSync(full, 'utf8').matchAll(/<item(\d+)([^>]*)>/g)) {
      const id = Number(match[1])
      const itemGender = Number((/\bg="(\d+)"/.exec(match[2]) || [])[1] || 0)
      const key = `${Math.floor(id / 500)}|${itemGender}`
      if (!byBucket.has(key) || id < byBucket.get(key)) byBucket.set(key, id)
    }
    defaults.clear()
    defaults.set(mtime, byBucket)
  }

  return byBucket.get(`${bucket}|${gender}`) || byBucket.get(`${bucket}|0`) || 0
}

const defaults = new Map()

const pouchFiles = ['ingredientItems.xml', 'items.xml', 'bakingAssets.xml']

function has (set, id) {
  return set().has(Number(id))
}

const catalog = {
  hasWardrobeItem: id => has(sets.wardrobe, id),
  hasHomeItem: id => readIds('homeAssets.xml', itemTags).has(Number(id)),
  hasPouchItem: id => pouchFiles.some(file => readIds(file, itemTags).has(Number(id))),
  hasBadge: id => has(sets.badges, id),
  hasBadgePage: id => has(sets.pages, id),
  hasQuestGroup: group => {
    for (const questId of sets.quests()) if (Math.floor(questId / QUESTS_PER_QUEST_GROUP) === group) return true
    return false
  },
  hasRecipe: id => has(sets.recipes, id),
  hasHome: type => readIds('homeUpgradeAssets.xml', itemTags).has(29000 + Number(type)),
  defaultWardrobe,
  maxLevel: () => levels().cumulative.length - 1,
  xpForLevel: level => levels().cumulative[level] || 0,
  levelForXp,
  hasPetSpecies: id => has(sets.species, id),
  hasGame: id => has(sets.games, id),
  badgeName: id => readNames('badges.xml', /<name(\d+)[^>]*>([^<]*)<\/name\d+>/g).get(Number(id)) || '',
  gameName: id => readNames('minigames.xml', /<game\s+id="(\d+)"\s+name="([^"]*)"/g).get(Number(id)) || '',
  hasPetName: id => Number(id) === 0 || has(sets.petNames, id),
  hasColor: id => Number(id) === 0 || has(sets.colors, id)
}

module.exports = { catalog }
