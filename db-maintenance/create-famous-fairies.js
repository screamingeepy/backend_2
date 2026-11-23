// run with node create-famous-fairies.js
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { createRequire } = require('module')

const REPO = path.join(__dirname, '..')
const WEB_API = path.join(REPO, 'web-api')

// Resolve web-api's dependencies from web-api, not from here.
const webRequire = createRequire(path.join(WEB_API, 'package.json'))

webRequire('dotenv').config({ path: path.join(WEB_API, '.env') })

const bcrypt = webRequire('bcrypt')
const mongooseLib = webRequire('mongoose')

// The models read their mongoose off the global, the way globals.js sets it up.
global.mongoose = mongooseLib

const Account = require(path.join(WEB_API, 'db', 'models', 'Account.js'))
const Fairy = require(path.join(WEB_API, 'db', 'models', 'Fairy.js'))

// The pickle format is shared with the avatar renderer, which needs the other
// direction too. One copy, so the two cannot drift.
const { parsePickle, GENDER_MALE } = require(path.join(WEB_API, 'utils', 'pickle.js'))

const PICKLED_DNA = path.join(REPO, 'web', 'xml', 'pickledDNA.xml')
const LIMITED_PROFILE = path.join(REPO, 'web', 'xml', 'panels', 'limitedProfile.xml')

const APPLY = process.env.APPLY === '1'
const SALT_ROUNDS = 12

const ROSTER = [
  { dna: 'tinkerbell', username: 'tinkerbell', name: 'Tinker Bell', talent: 5 },  // Tinker
  { dna: 'silvermist', username: 'silvermist', name: 'Silvermist', talent: 4 },   // Water
  { dna: 'fawn', username: 'fawnfairy', name: 'Fawn', talent: 1 },                // Animal
  { dna: 'rosetta', username: 'rosettafairy', name: 'Rosetta', talent: 2 },       // Garden
  { dna: 'iridessa', username: 'iridessa', name: 'Iridessa', talent: 3 },         // Light
  { dna: 'clarion', username: 'queenclarion', name: 'Queen Clarion', talent: 10, portrait: 'customProfileImages_20' },
  { dna: 'terence', username: 'terence', name: 'Terence', talent: 11, portrait: 'customProfileImages_21' },
  { dna: 'periwinkle', username: 'periwinkle', name: 'Periwinkle', talent: 13, portrait: 'customProfileImages_23' }
]

// ---------------------------------------------------------------------------
// pickledDNA.xml
// ---------------------------------------------------------------------------

function readPickles () {
  const xml = fs.readFileSync(PICKLED_DNA, 'utf8')
  const block = xml.slice(xml.indexOf('<famousfairies>'), xml.indexOf('</famousfairies>'))

  const byName = new Map()
  const re = /<dna\s+id="(\d+)"\s+name="([^"]+)"[^>]*>([^<]+)<\/dna>/g

  let match
  while ((match = re.exec(block)) !== null) {
    byName.set(match[2], { id: parseInt(match[1]), pickle: match[3] })
  }

  return byName
}

function aliasLine (doId, entry) {

  return `\t<dna id="${doId}" name="${entry.dna}">${entry.pickle}</dna>`
}

function writeAliases (created, file = PICKLED_DNA) {
  let xml = fs.readFileSync(file, 'utf8')
  const added = []

  for (const entry of created) {
    if (xml.includes(`<dna id="${entry.fairyId}"`)) continue

    added.push(aliasLine(entry.fairyId, entry))
  }

  if (added.length === 0) return added

  // Match the closing tag together with its own indent, so the aliases land at
  // the end of the block instead of inheriting it.
  xml = xml.replace(/[ \t]*<\/famousfairies>/, `${added.join('\n')}\n  </famousfairies>`)
  fs.writeFileSync(file, xml)

  return added
}

// ---------------------------------------------------------------------------
// limitedProfile.xml
// ---------------------------------------------------------------------------

const PROFILE_BLOCK = /(\t*)<customFamousFairyImages>[\s\S]*?<\/customFamousFairyImages>/

function buildProfileBlock (created, indent) {
  const inner = created
    .filter(entry => entry.portrait)
    .map(entry => `${indent}\t<ff_${entry.fairyId}>${entry.portrait}</ff_${entry.fairyId}> <!-- ${entry.name} -->`)

  return [
    `${indent}<!-- Keyed by the famous fairy's OWN doId, which is what the client sends as`,
    `${indent}     famousFairyId. Disney's original keys (ff_1000000010 and friends) were`,
    `${indent}     removed: those ids belong to real players on this server, so they drew a`,
    `${indent}     minister's portrait on an ordinary fairy's profile. -->`,
    `${indent}<customFamousFairyImages>`,
    ...inner,
    `${indent}</customFamousFairyImages>`
  ].join('\n')
}

function writeProfileImages (created, file = LIMITED_PROFILE) {
  const xml = fs.readFileSync(file, 'utf8')
  const match = xml.match(PROFILE_BLOCK)

  if (!match) {
    console.log('  ! customFamousFairyImages block not found -- limitedProfile.xml left alone')
    return false
  }

  const withPortraits = created.filter(entry => entry.portrait)

  if (withPortraits.length === 0) return false

  // Already ours? Every portrait key present means there is nothing to do.
  if (withPortraits.every(entry => match[0].includes(`<ff_${entry.fairyId}>`))) return false

  fs.writeFileSync(file, xml.replace(PROFILE_BLOCK, buildProfileBlock(created, match[1])))

  return true
}

// ---------------------------------------------------------------------------
// Mongo
// ---------------------------------------------------------------------------

async function getNextDoId (connection) {
  // Same call as Database.getNextDoId, so ids come off the one sequence that
  // both web-api and the DBSS allocate from.
  const ret = await connection.collection('globals').findOneAndUpdate(
    { _id: 'doid' },
    { $inc: { seq: 1 } },
    { returnOriginal: true }
  )

  return ret.seq
}

function bio () {
  const questions = []
  for (let i = 1; i <= 6; i++) questions.push({ id: i, answer: 0 })
  return questions
}

function randomPassword () {
  return crypto.randomBytes(12).toString('base64url')
}

async function main () {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/PixieHollow'

  await mongooseLib.connect(uri)

  const connection = mongooseLib.connection

  console.log('='.repeat(72))
  console.log(`create famous fairies -- ${APPLY ? 'APPLY (writes enabled)' : 'DRY RUN (no writes)'}`)
  console.log(`database: ${connection.name}`)
  console.log('='.repeat(72))

  const pickles = readPickles()
  const created = []
  const credentials = []

  for (const member of ROSTER) {
    const source = pickles.get(member.dna)

    if (!source) {
      console.log(`! ${member.name}: no <dna name="${member.dna}"> in pickledDNA.xml -- skipped`)
      continue
    }

    const existing = await Account.findOne({ username: member.username })

    if (existing) {
      const fairy = await Fairy.findById(existing.playerId)

      if (fairy && fairy.famousFairy) {
        console.log(`= ${member.name}: account ${member.username} (${existing._id}) already holds fairy ${fairy._id}`)
        created.push({ ...member, accountId: existing._id, fairyId: fairy._id, pickle: source.pickle })
      } else {
        console.log(`! ${member.name}: username ${member.username} is taken by an account that is not a famous fairy -- skipped`)
      }

      continue
    }

    const { gender, avatar, garments } = parsePickle(source.pickle)

    if (!APPLY) {
      const worn = garments.map(g => `${g.type} ${g.id}`).join(', ')
      console.log(`+ ${member.name} (${member.username}) talent ${member.talent}, ${gender === GENDER_MALE ? 'male' : 'female'}`)
      console.log(`    body: eye ${avatar.eye} face ${avatar.face} hair ${avatar.hair_front}/${avatar.hair_back} wing ${avatar.wing} skin ${avatar.skin_color}`)
      console.log(`    worn: ${worn || '(nothing)'}`)
      continue
    }

    const password = randomPassword()
    const accountId = await getNextDoId(connection)
    const fairyId = await getNextDoId(connection)

    // Inventory ids come off the same sequence as everything else, so a famous
    // fairy's clothes can be dyed and re-equipped like anyone else's.
    for (const garment of garments) {
      avatar.items.push({
        inv_id: await getNextDoId(connection),
        type: garment.type,
        item_id: garment.id,
        slot: garment.slot,
        color1: garment.color1,
        color2: garment.color2,
        location: 'Equipped'
      })
    }

    await new Account({
      _id: accountId,
      username: member.username,
      password: bcrypt.hashSync(password, SALT_ROUNDS),
      playerId: fairyId,
      accountType: 'Administrator'
    }).save()

    await new Fairy({
      _id: fairyId,
      ownerAccount: member.username,
      accountId,
      name: member.name,
      talent: member.talent,
      gender,
      famousFairy: true,
      bio: bio(),
      avatar
    }).save()

    console.log(`+ ${member.name}: account ${accountId} (${member.username}), fairy ${fairyId}`)

    created.push({ ...member, accountId, fairyId, pickle: source.pickle })
    credentials.push({ username: member.username, password })
  }

  // -------------------------------------------------------------------------
  // The XML that has to learn the new doIds.
  // -------------------------------------------------------------------------

  console.log('')

  if (!APPLY) {
    console.log('XML edits are skipped on a dry run -- the doIds they key on do not exist yet.')
  } else if (created.length === 0) {
    console.log('nothing to point the XML at')
  } else {
    const aliases = writeAliases(created)

    if (aliases.length) {
      console.log(`pickledDNA.xml: added ${aliases.length} alias entr${aliases.length === 1 ? 'y' : 'ies'}`)
    } else {
      console.log('pickledDNA.xml: already up to date')
    }

    if (writeProfileImages(created)) {
      console.log('limitedProfile.xml: customFamousFairyImages re-keyed to our doIds')
    } else {
      console.log('limitedProfile.xml: already up to date')
    }
  }

  if (credentials.length) {
    console.log('')
    console.log('='.repeat(72))
    console.log('PASSWORDS -- shown once, nothing stores the plaintext. Put them somewhere')
    console.log('staff can reach before you close this terminal.')
    console.log('='.repeat(72))
    for (const cred of credentials) console.log(`  ${cred.username.padEnd(16)} ${cred.password}`)
  }

  if (!APPLY) {
    console.log('')
    console.log('DRY RUN -- re-run with APPLY=1 to create these.')
  }

  await mongooseLib.disconnect()
}

// Exported so the XML rewrites can be exercised against copies of the files
// without touching the database (see the header for how this is normally run).
module.exports = { parsePickle, readPickles, writeAliases, writeProfileImages }

if (require.main === module) {
  main().catch(async err => {
    console.error(err)
    await mongooseLib.disconnect()
    process.exit(1)
  })
}
