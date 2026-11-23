// making the game's print buttons work with ruffle
// via using pixie pages

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const SWF = path.join(ROOT, 'web', 'swf')
const BACKUPS = path.join(SWF, '_prepatch')
const FFDEC = process.env.FFDEC || 'C:\\Program Files (x86)\\FFDec\\ffdec-cli.exe'
const MARKER = 'phPrintFromGame'

const args = process.argv.slice(2)

const q = (pkg, name) => `QName(PackageNamespace("${pkg}"),"${name}")`
const PLAYER = 'com.disney.fairies.distributed'

// the p-code that calls the page: kind, then the fairy's id and name, from `fairy`
function callPage (kind, idBlock, nameBlock, extraBlock = []) {
  return [
    `findpropstrict ${q('flash.external', 'ExternalInterface')}`,
    `getproperty ${q('flash.external', 'ExternalInterface')}`,
    `pushstring "${MARKER}"`,
    `pushstring "${kind}"`,
    ...idBlock,
    ...nameBlock,
    ...extraBlock,
    `callproperty ${q('', 'call')}, ${extraBlock.length ? 5 : 4}`,
    'pop'
  ]
}

const localFairy = [
  `findpropstrict ${q(PLAYER, 'DistributedFairyPlayer')}`,
  `getproperty ${q(PLAYER, 'DistributedFairyPlayer')}`,
  `getproperty ${q('', 'localPlayerFairy')}`
]

const pageFairy = [
  `findpropstrict ${q('com.disney.fairies.managers', 'SessionManager')}`,
  `getproperty ${q('com.disney.fairies.managers', 'SessionManager')}`,
  `callproperty ${q('', 'getInstance')}, 0`,
  `getproperty ${q('', 'pageFairy')}`
]

// `after` is the line the new code goes after, so it runs once that has: the start of the method by default
const targets = [
  {
    // the Print button on the fairy page panel
    file: path.join('panel_code', 'printPanel.swf'),
    cls: 'com.disney.fairies.homepage.PrintPanel',
    method: 'printFairy',
    code: callPage('both', [...pageFairy, `getproperty ${q('', 'fairyId')}`], [...pageFairy, `getproperty ${q('', 'name')}`])
  },
  {
    // the Print button next to the poser in the journal
    file: path.join('panel_code', 'inventory.swf'),
    cls: 'com.disney.fairies.inventory.InventoryPanel',
    method: 'printFairy',
    after: /callpropvoid QName\(PrivateNamespace\(null\),"savePose"\), 0|callproperty QName\(PrivateNamespace\(null\),"savePose"\), 0\n\s*pop/,
    code: callPage('fairy', [...localFairy, `getproperty ${q('', 'doId')}`], [...localFairy, `getproperty ${q('', 'name')}`])
  },
  {
    // the Print button on the profile edit panel
    file: path.join('panel_code', 'profileEdit.swf'),
    cls: 'com.disney.fairies.profile.ProfileEdit',
    method: 'onPrintRequested',
    code: callPage('profile', [...localFairy, `getproperty ${q('', 'doId')}`], [...localFairy, `getproperty ${q('', 'name')}`], [
      'getlocal0',
      'getproperty QName(PrivateNamespace(null),"_selectedBGIcon")',
      `getproperty ${q('', 'name')}`
    ])
  },
  {
    // the Print button on the home page, which prints the whole room
    file: 'mmo.swf',
    cls: 'com.disney.fairies.meadow.display.HomeView',
    method: 'printRoom',
    code: [...callPage('home', [...localFairy, `getproperty ${q('', 'doId')}`], [...localFairy, `getproperty ${q('', 'name')}`]), 'returnvoid']
  }
]

function ffdec (options = {}, ...a) {
  return execFileSync(FFDEC, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60 * 1000, ...options })
}

// the class as P-code text
function pcodeOf (swf, cls) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-pcode-'))
  try {
    ffdec({}, '-format', 'script:pcode', '-selectclass', cls, '-export', 'script', out, swf)
    const file = path.join(out, 'scripts', ...cls.split('.')) + '.pcode'
    if (!fs.existsSync(file)) throw new Error(`could not read ${cls} from ${path.basename(swf)}`)
    return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
}

function bodyOf (text, method) {
  const head = text.search(new RegExp(`function ${method}\\(`))
  if (head < 0) return null

  const found = /\n[ \t]*method\n/.exec(text.slice(head))
  if (!found) return null

  const start = head + found.index + 1
  const end = text.indexOf('end ; method', start) + 'end ; method'.length

  return { start, end, text: text.slice(start, end) }
}

const isPatched = (swf, target) => {
  const body = bodyOf(pcodeOf(swf, target.cls), target.method)
  return Boolean(body && body.text.includes(MARKER))
}

const MARKER_BODY = i => [
  'method', 'name null', 'returns QName(PackageNamespace(""),"void")', 'body', 'maxstack 2', 'localcount 1', 'initscopedepth 0', 'maxscopedepth 1', 'code',
  'getlocal0', 'pushscope', `pushstring "PHMARK_${i}_"`, 'pop', 'returnvoid', 'end ; code', 'end ; body', 'end ; method'
].join('\n')

// how many method bodies the SWF has. FFDec refuses an index past the end, so the last good one is found by halving
function countBodies (swf, cls, work) {
  const valid = i => {
    fs.writeFileSync(path.join(work, 'probe.pcode'), MARKER_BODY(i))
    const out = path.join(work, 'probe.swf')
    fs.rmSync(out, { force: true })

    try {
      ffdec({ cwd: work }, '-replace', swf, out, cls, 'probe.pcode', String(i))
    } catch (e) {
      return false
    }

    return fs.existsSync(out)
  }

  let low = 0
  let high = 1

  while (valid(high)) {
    low = high
    high *= 2
    if (high > 200000) break
  }

  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (valid(middle)) low = middle
    else high = middle
  }

  return low + 1
}

// the index of the body that belongs to the method: swap the bodies for numbered markers, read the class back
// and look for the one inside the method
function findBodyIndex (swf, target) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-index-'))
  const RUN = 250

  try {
    const total = countBodies(swf, target.cls, work)

    for (let first = 0; first < total; first += RUN) {
      const pairs = []

      for (let i = first; i < Math.min(first + RUN, total); i++) {
        fs.writeFileSync(path.join(work, `m${i}.pcode`), MARKER_BODY(i))
        pairs.push(target.cls, `m${i}.pcode`, String(i))
      }

      const out = path.join(work, 'marked.swf')
      fs.rmSync(out, { force: true })
      ffdec({ cwd: work }, '-replace', swf, out, ...pairs)
      if (!fs.existsSync(out)) throw new Error('FFDec did not write the marked SWF')

      const body = bodyOf(pcodeOf(out, target.cls), target.method)
      const hit = body && body.text.match(/PHMARK_(\d+)_/)
      if (hit) return Number(hit[1])
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }

  return null
}

function patch (target) {
  const live = path.join(SWF, target.file)
  const backup = path.join(BACKUPS, target.file)
  const name = target.file

  if (!fs.existsSync(live)) { console.log(`${name}: not there, skipped`); return }

  if (!fs.existsSync(backup)) {
    if (isPatched(live, target)) throw new Error('already patched and there is no backup of the original')
    fs.mkdirSync(path.dirname(backup), { recursive: true })
    fs.copyFileSync(live, backup)
    console.log(`${name}: original kept in web/swf/_prepatch`)
  } else if (isPatched(live, target)) {
    console.log(`${name}: already patched`)
    return
  }

  const original = pcodeOf(backup, target.cls)
  const body = bodyOf(original, target.method)
  if (!body) throw new Error(`${target.cls} has no ${target.method}, so this is not the SWF the patch was written for`)

  const index = findBodyIndex(backup, target)
  if (index === null) throw new Error(`could not find which body in the SWF is ${target.method}`)

  // new code goes after the line asked for, or after pushscope at the start
  let text = body.text.replace(/\n\s*\n/g, '\n')
  let at

  if (target.after) {
    const found = text.match(target.after)
    if (!found) throw new Error(`${target.method} is not what the patch was written for (no ${String(target.after).slice(0, 60)})`)
    at = found.index + found[0].length
  } else {
    const found = text.match(/\n\s*pushscope\n/)
    if (!found) throw new Error(`${target.method} does not start the way the patch expects`)
    at = found.index + found[0].length - 1
  }

  text = text.slice(0, at) + '\n' + target.code.join('\n') + text.slice(at)

  // room for what the new code puts on the stack
  text = text.replace(/maxstack (\d+)/, (all, n) => `maxstack ${Math.max(Number(n), 8)}`)

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-patch-'))

  try {
    fs.writeFileSync(path.join(work, 'body.pcode'), text)
    const built = path.join(work, 'patched.swf')
    ffdec({ cwd: work }, '-replace', backup, built, target.cls, 'body.pcode', String(index))

    if (!fs.existsSync(built)) throw new Error('FFDec did not write the patched SWF')

    // the change has to be in the method, and the rest of the class still has to read back
    const check = bodyOf(pcodeOf(built, target.cls), target.method)
    if (!check || !check.text.includes(MARKER)) throw new Error('the change is not in the patched SWF')

    fs.copyFileSync(built, live)
    console.log(`${name}: ${target.method} patched (body ${index}), ${(fs.statSync(backup).size / 1024).toFixed(0)} KB -> ${(fs.statSync(live).size / 1024).toFixed(0)} KB`)
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

function main () {
  if (args.includes('--restore')) {
    for (const target of targets) {
      const backup = path.join(BACKUPS, target.file)
      if (fs.existsSync(backup)) {
        fs.copyFileSync(backup, path.join(SWF, target.file))
        console.log(`${target.file}: original put back`)
      }
    }
    return
  }

  if (args.includes('--check')) {
    for (const target of targets) console.log(`${target.file}: ${isPatched(path.join(SWF, target.file), target) ? 'patched' : 'original'}`)
    return
  }

  let failed = 0
  for (const target of targets) {
    try {
      patch(target)
    } catch (e) {
      failed++
      console.log(`${target.file}: NOT patched. ${e.message.split('\n')[0]}`)
    }
  }

  process.exit(failed ? 1 : 0)
}

main()
