
const PREFIXES = ['North', 'Small', 'South', 'Tiny', 'Twisty', 'Upper']

const MIDDLES = [
  'Almond', 'Apple', 'Birch', 'Cedar', 'Coral', 'Crescent', 'Crystal', 'Daisy',
  'Elm', 'Feather', 'Fern', 'Havendish', 'Holly', 'Iris', 'Lemon', 'Lilac',
  'Lily', 'Maple', 'Moss', 'Oak', 'Peach', 'Pine', 'Pumpkin', 'Rainbow',
  'Raindrop', 'Rose', 'Starlight', 'Sunrise', 'Sunset', 'Thistle', 'Tulip',
  'Walnut', 'Whisper', 'Willow'
]

const SUFFIXES = [
  'Bay', 'Brook', 'Canyon', 'Circle', 'Cliffs', 'Cove', 'Creek', 'Dale',
  'Dell', 'Falls', 'Garden', 'Glade', 'Glen', 'Grove', 'Hill', 'Hollow',
  'Lagoon', 'Lake', 'Lane', 'Meadow', 'Orchard', 'Path', 'Point', 'Pond',
  'Ridge', 'Rock', 'Stream', 'Trail', 'Tree', 'Vale', 'Valley', 'Way', 'Wood'
]

function randomAddress () {
  const pick = list => list[Math.floor(Math.random() * list.length)]
  const number = 100 + Math.floor(Math.random() * 900)

  return `${number}${pick(PREFIXES)}${pick(MIDDLES)}${pick(SUFFIXES)}`
}

function readableAddress (address) {
  return String(address || '').replace(/([A-Z])/g, ' $1').trim()
}

async function allocateAddress (isTaken, attempts = 12) {
  for (let i = 0; i < attempts; i++) {
    const candidate = randomAddress()
    if (!await isTaken(candidate)) return candidate
  }

  return `${Date.now().toString().slice(-6)}${PREFIXES[0]}${MIDDLES[0]}${SUFFIXES[0]}`
}

module.exports = { PREFIXES, MIDDLES, SUFFIXES, randomAddress, readableAddress, allocateAddress }
