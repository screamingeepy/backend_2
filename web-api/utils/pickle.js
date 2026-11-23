
const ROTATION_ORDER = [
  'head_rot',
  'ul_arm_rot', 'ur_arm_rot', 'll_arm_rot', 'lr_arm_rot',
  'ul_leg_rot', 'ur_leg_rot', 'll_leg_rot', 'lr_leg_rot'
]

const GARMENTS = {
  0: { type: 'Shirt', slot: 3 },
  1: { type: 'Belt', slot: 4 },
  2: { type: 'Skirt', slot: 5 },
  3: { type: 'WristItem', slot: 6 },
  4: { type: 'HeadItem', slot: 1 },
  5: { type: 'Necklace', slot: 2 },
  6: { type: 'AnkleItem', slot: 7 },
  7: { type: 'Shoes', slot: 8 }
}

const BODY_PARTS = {
  8: 'eye',
  9: 'face',
  10: 'hair_front',
  11: 'hair_back',
  12: 'wing'
}

const IDS_PER_TYPE = 500

const MAX_TYPES = 2000

const TYPE_ENEMY_ID = 38
const TYPE_ENEMY_ID_EXTENDED = [46, 47, 48, 49]

const GENDER_FEMALE = 1
const GENDER_MALE = 2

function getItemType (id) {
  let type = Math.floor(id / IDS_PER_TYPE)

  if (type >= MAX_TYPES) {
    type = Math.floor(parseInt(String(id).substr(1)) / IDS_PER_TYPE)
  }

  return TYPE_ENEMY_ID_EXTENDED.includes(type) ? TYPE_ENEMY_ID : type
}

function colorOrZero (value) {
  // -1 is the pickle's "unset"; the schema wants a plain 0.
  return value > 0 ? value : 0
}

function colorOrUnset (value) {
  // going the other way: the schema's 0 is the pickle's -1.
  return value > 0 ? value : -1
}

function parsePickle (pickle) {
  const parts = pickle.trim().split('/')

  let gender = GENDER_FEMALE

  if (parts[0] === 'M') {
    gender = GENDER_MALE
    parts.shift()
  }

  const proportions = {
    height: parseInt(parts.shift()),
    head: parseInt(parts.shift()),
    body: parseInt(parts.shift())
  }

  const rotations = {}
  for (const name of ROTATION_ORDER) rotations[name] = parseInt(parts.shift())

  const skinColor = parseInt(parts.shift())

  const avatar = {
    proportions,
    rotations,
    skin_color: skinColor,
    hair_back: 0,
    hair_front: 0,
    face: 0,
    eye: 0,
    wing: 0,
    hair_color: 0,
    hair_color2: 0,
    eye_color: 0,
    wing_color: 0,
    items: []
  }

  const garments = []

  for (const triplet of parts) {
    if (!triplet) continue

    const [id, c1, c2] = triplet.split(':').map(n => parseInt(n))
    const bucket = getItemType(id)

    if (bucket in GARMENTS) {
      garments.push({ id, color1: colorOrZero(c1), color2: colorOrZero(c2), ...GARMENTS[bucket] })
      continue
    }

    const part = BODY_PARTS[bucket]

    if (!part) {
      throw new Error(`item ${id} is in bucket ${bucket}, which is not a wearable or a body part`)
    }

    avatar[part] = id

    if (part === 'eye') avatar.eye_color = colorOrZero(c1)
    if (part === 'wing') avatar.wing_color = colorOrZero(c1)
    if (part === 'hair_front') {
      avatar.hair_color = colorOrZero(c1)
      avatar.hair_color2 = colorOrZero(c2)
    }
  }

  return { gender, avatar, garments }
}

function triplet (id, color1, color2) {
  return `${id}:${colorOrUnset(color1)}:${colorOrUnset(color2)}`
}

function pickleFromAvatar (avatar, gender) {
  if (!avatar || !avatar.proportions || !avatar.rotations) {
    throw new Error('avatar is missing proportions or rotations')
  }

  const head = []

  if (Number(gender) === GENDER_MALE) head.push('M')

  head.push(avatar.proportions.height, avatar.proportions.head, avatar.proportions.body)
  for (const name of ROTATION_ORDER) head.push(avatar.rotations[name] || 0)
  head.push(avatar.skin_color)

  const body = []

  if (avatar.hair_back) body.push(triplet(avatar.hair_back, avatar.hair_color, avatar.hair_color2))
  if (avatar.hair_front) body.push(triplet(avatar.hair_front, avatar.hair_color, avatar.hair_color2))
  if (avatar.face) body.push(triplet(avatar.face, avatar.skin_color, -1))
  if (avatar.eye) body.push(triplet(avatar.eye, avatar.eye_color, avatar.skin_color))
  if (avatar.wing) body.push(triplet(avatar.wing, avatar.wing_color, -1))

  const worn = []

  for (const item of avatar.items || []) {
    if (item.location !== 'Equipped') continue

    if (!(getItemType(item.item_id) in GARMENTS)) continue

    worn.push(triplet(item.item_id, item.color1, item.color2))
  }

  return head.concat(body, worn).join('/')
}

module.exports = {
  ROTATION_ORDER,
  GARMENTS,
  BODY_PARTS,
  IDS_PER_TYPE,
  MAX_TYPES,
  getItemType,
  GENDER_FEMALE,
  GENDER_MALE,
  colorOrZero,
  colorOrUnset,
  parsePickle,
  pickleFromAvatar
}
