// build the default avatars from initDNA.xml and save them in web/site/img/default

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const { parseStringPromise } = require(path.join(ROOT, 'web-api', 'node_modules', 'xml2js'))

const ROTATION_ORDER = ['HEAD_ROT', 'UL_ARM_ROT', 'UR_ARM_ROT', 'LL_ARM_ROT', 'LR_ARM_ROT', 'UL_LEG_ROT', 'UR_LEG_ROT', 'LL_LEG_ROT', 'LR_LEG_ROT']
const unset = value => (value > 0 ? value : -1)
const triplet = (id, c1, c2) => `${id}:${unset(c1)}:${unset(c2)}`

function pickleFromInitDNA (node, male) {
  const proportion = {}
  for (const p of node.proportion) proportion[p.$.type] = p._
  const rotation = {}
  for (const r of node.rotation) rotation[r.$.type] = Math.round(Number(r._))

  const one = name => Number(node[name][0])
  const parts = []

  if (male) parts.push('M')
  parts.push(proportion.HEIGHT, proportion.HEAD, proportion.BODY)
  for (const name of ROTATION_ORDER) parts.push(rotation[name] || 0)
  parts.push(one('skin_color'))

  parts.push(triplet(one('hair_back'), one('hair_color'), -1))
  parts.push(triplet(one('hair_front'), one('hair_color'), -1))
  parts.push(triplet(one('face'), one('skin_color'), -1))
  parts.push(triplet(one('eye'), one('eye_color'), one('skin_color')))
  parts.push(triplet(one('wing'), one('wing_color'), -1))

  for (const item of node.inv_item || []) {
    const colors = {}
    for (const c of item.color || []) colors[c.$.number] = Number(c._)
    parts.push(triplet(Number(item.item_id[0]), colors[1], colors[2]))
  }

  return parts.join('/')
}

async function main () {
  const xml = await parseStringPromise(fs.readFileSync(path.join(ROOT, 'web', 'xml', 'caf', 'initDNA.xml'), 'utf8'))
  const out = path.join(ROOT, 'web', 'site', 'img', 'default')
  fs.mkdirSync(out, { recursive: true })

  const avatars = [
    { name: 'defaultFairy', node: xml.avatars.femaleAvatar[0], male: false },
    { name: 'defaultSparrowMan', node: xml.avatars.maleAvatar[0], male: true }
  ]

  for (const { name, node, male } of avatars) {
    const pickle = pickleFromInitDNA(node, male)

    for (const mode of ['full', 'bust']) {
      const hash = `${name}${mode === 'full' ? 'Full' : 'Bust'}`
      console.log(`${hash}: ${pickle}`)

      const run = spawnSync(process.execPath, [path.join(__dirname, 'worker.js'), '--pickle', pickle, '--name', hash, '--mode', mode, '--scale', mode === 'full' ? '2' : '0'], { stdio: 'inherit' })
      if (run.status !== 0) throw new Error(`render of ${hash} failed`)

      fs.copyFileSync(path.join(ROOT, 'web', 'rendered', `${hash}.png`), path.join(out, `${hash}.png`))
    }
  }
}

main().catch(e => { console.error(e.message); process.exit(1) })
