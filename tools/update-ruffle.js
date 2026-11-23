// update ruffle in web/ruffle 
// bundled version for devices that don't have the extension
// or native flash, smoke test to mamke sure nothing breaks under new ruffle build
// must run when ruffle gets an update

const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { execFileSync, execSync, spawn } = require('child_process')

const PACKAGE = '@ruffle-rs/ruffle'
const webDir = path.join(__dirname, '..', 'web')
const ruffleDir = path.join(webDir, 'ruffle')
const backupDir = path.join(__dirname, 'ruffle-backups')
const logFile = path.join(backupDir, 'update.log')

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback
}

const channel = option('channel', 'nightly')
const keep = Number(option('keep', 3))

const log = (message) => {
  const line = `${new Date().toISOString()}  ${message}`
  console.log(line)
  try {
    fs.mkdirSync(backupDir, { recursive: true })
    fs.appendFileSync(logFile, line + '\n')
  } catch (e) {}
}

const installedVersion = () => JSON.parse(fs.readFileSync(path.join(ruffleDir, 'package.json'), 'utf8')).version

const npm = (...npmArgs) => execSync(['npm', ...npmArgs].join(' '), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

// -- static checks ------------------------------------------------------------------------------

// the things phPlayer.js depends on, plus every hashed file ruffle.js says it will fetch
function staticChecks(dir) {
  const problems = []
  const entry = path.join(dir, 'ruffle.js')

  if (!fs.existsSync(entry)) return ['ruffle.js is missing']

  const source = fs.readFileSync(entry, 'utf8')

  // phPlayer.js passes socketProxy to load(), and without it the client cannot reach the game server
  for (const needle of ['socketProxy', 'fontSources', 'get metadata']) {
    if (!source.includes(needle)) problems.push(`ruffle.js no longer mentions "${needle}"`)
  }

  const referenced = new Set(source.match(/\b[0-9a-f]{20}\.(?:wasm|js)\b/g) || [])
  for (const file of referenced) {
    const candidates = [file, `core.ruffle.${file}`]
    if (!candidates.some((name) => fs.existsSync(path.join(dir, name)))) problems.push(`ruffle.js refers to ${file}, which is not in the package`)
  }

  return problems
}

// -- smoke test ---------------------------------------------------------------------------------

const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.xml': 'text/xml', '.swf': 'application/x-shockwave-flash', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.map': 'application/json'
}

// serves web/ as it is, except that /ruffle/ comes from `ruffleOverride`. No game API behind it, which
// is fine: the container movie only has to start for this to tell a working Ruffle from a broken one
function startServer(ruffleOverride) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    let pathname = decodeURIComponent(url.pathname)

    let file
    if (pathname.startsWith('/ruffle/')) file = path.join(ruffleOverride, pathname.slice('/ruffle/'.length))
    else file = path.join(webDir, pathname === '/' ? 'home.html' : pathname)

    const allowed = pathname.startsWith('/ruffle/') ? ruffleOverride : webDir
    if (!path.resolve(file).startsWith(path.resolve(allowed))) {
      res.writeHead(403).end()
      return
    }

    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' })
      res.end(data)
    })
  })

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

function findBrowser() {
  const candidates = [
    process.env.RUFFLE_SMOKE_BROWSER,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ]
  return candidates.find((p) => p && fs.existsSync(p))
}

// just enough Chrome DevTools Protocol to open a page and evaluate things in it
function cdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let nextId = 1
  const pending = new Map()
  const listeners = []

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
    } else if (message.method) {
      listeners.forEach((fn) => fn(message))
    }
  }

  return {
    ready: new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = () => reject(new Error('could not reach the browser'))
    }),
    send: (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params, sessionId }))
    }),
    on: (fn) => listeners.push(fn),
    close: () => ws.close()
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// the page's own check: Ruffle has parsed the movie, and has not fallen over
const probe = `(function () {
  var player = document.getElementById('pixiehollowcontent')
  if (!player || !player.ruffle) return { state: 'no-player', text: location.href }
  var panic = player.shadowRoot && player.shadowRoot.querySelector('#panic')
  if (panic) return { state: 'panic', text: panic.textContent.slice(0, 300) }
  var meta = player.metadata
  if (!meta) return { state: 'loading' }
  var config = player.ruffle().loadedConfig || {}
  return {
    state: 'ok', width: meta.width, height: meta.height, swfVersion: meta.swfVersion,
    version: player.ruffle().version || null,
    kind: window.phPlayer && phPlayer.kind, source: window.phPlayer && phPlayer.source,
    sources: Object.keys((window.RufflePlayer && RufflePlayer.sources) || {}), hasPlugin: !!navigator.plugins.namedItem('Shockwave Flash'),
    socketProxy: !!config.socketProxy, allowScriptAccess: config.allowScriptAccess === true
  }
})()`

async function smokeTest(ruffleOverride, label, extensionDir) {
  const browser = findBrowser()
  if (!browser) throw new Error('no Edge or Chrome found; set RUFFLE_SMOKE_BROWSER to a browser exe')

  const server = await startServer(ruffleOverride)
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ruffle-smoke-'))
  const child = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    // the Ruffle browser extension, to check the page still uses its own Ruffle with the extension around
    ...(extensionDir ? [`--load-extension=${extensionDir}`, '--disable-features=DisableLoadExtensionCommandLineSwitch'] : []),
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  const errors = []
  let client

  try {
    const wsUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the browser did not start')), 20000)
      let text = ''
      child.stderr.on('data', (chunk) => {
        text += chunk
        const found = text.match(/DevTools listening on (ws:\/\/\S+)/)
        if (found) {
          clearTimeout(timer)
          resolve(found[1])
        }
      })
      child.on('exit', () => reject(new Error('the browser exited early')))
    })

    client = cdpClient(wsUrl)
    await client.ready

    // a fresh profile's extension registers its page scripts from its service worker after start-up, and
    // they only reach pages opened after that. A player's extension did that long ago
    if (extensionDir) await wait(5000)

    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })

    client.on((message) => {
      if (message.sessionId !== sessionId) return
      if (message.method === 'Runtime.exceptionThrown') {
        errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
      }
    })

    await client.send('Runtime.enable', {}, sessionId)
    await client.send('Page.enable', {}, sessionId)

    // with no login the client sends the page back to the site root a moment after it starts, which is
    // too quick to catch by polling from here, so each page records what it saw in sessionStorage
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `setInterval(function () {
        try {
          var seen = ${probe}
          if (seen.state === 'ok' || seen.state === 'panic') sessionStorage.setItem('ruffleSmoke', JSON.stringify(seen))
        } catch (e) {}
      }, 50)`
    }, sessionId)

    // the extension adds its fake Flash plugin asynchronously, so whether swfobject.js sees it depends on a
    // race. Planting the same plugin before the page's scripts run makes the extension win every time
    if (extensionDir) {
      await client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(function () {
          var plugin = { name: 'Shockwave Flash', description: 'Shockwave Flash 32.0 r0', filename: 'ruffle.js', length: 0 }
          var mime = { type: 'application/x-shockwave-flash', description: 'Shockwave Flash', suffixes: 'swf', enabledPlugin: plugin }
          plugin['Shockwave Flash'] = plugin
          Object.defineProperty(navigator, 'plugins', { configurable: true, value: { 'Shockwave Flash': plugin, length: 1, 0: plugin, namedItem: function (n) { return n === 'Shockwave Flash' ? plugin : null } } })
          Object.defineProperty(navigator, 'mimeTypes', { configurable: true, value: { 'application/x-shockwave-flash': mime, length: 1, 0: mime } })
        })()`
      }, sessionId)
    }

    // canvas renderer so the result does not depend on this machine's GPU or a headless WebGL fallback
    const target = `http://127.0.0.1:${server.address().port}/live.html?renderer=canvas`
    await client.send('Page.navigate', { url: target }, sessionId)

    const recorded = `(function () { try { return JSON.parse(sessionStorage.getItem('ruffleSmoke')) } catch (e) { return null } })()`
    const deadline = Date.now() + 60000
    let last = { state: 'no-player' }

    while (Date.now() < deadline) {
      await wait(1000)
      const { result } = await client.send('Runtime.evaluate', { expression: recorded, returnByValue: true }, sessionId)
      last = result.value || last
      if (last.state === 'ok' || last.state === 'panic') break
    }

    if (last.state !== 'ok') {
      throw new Error(`${label}: Ruffle ${last.state === 'panic' ? 'panicked: ' + last.text : 'never reported the movie as loaded (' + last.state + ')'}`)
    }

    if (extensionDir) {
      const { result: fake } = await client.send('Runtime.evaluate', { expression: `!!navigator.plugins.namedItem('Shockwave Flash')`, returnByValue: true }, sessionId)
      if (!fake.value) throw new Error(`${label}: the Ruffle extension did not load in ${path.basename(browser)}`)
    }

    // a bad build often loads and then falls over a moment later; the record keeps the worst thing seen
    await wait(5000)
    const { result } = await client.send('Runtime.evaluate', { expression: recorded, returnByValue: true }, sessionId)
    if (result.value && result.value.state === 'panic') {
      throw new Error(`${label}: Ruffle fell over after loading: ${result.value.text}`)
    }

    const ruffleErrors = errors.filter((text) => /ruffle|wasm|WebAssembly/i.test(text || ''))
    if (ruffleErrors.length) throw new Error(`${label}: page errors: ${ruffleErrors[0]}`)

    // the page leaves Ruffle alone when the extension is there, and must still give it the config the client needs
    const expected = extensionDir ? 'extension' : 'bundled'
    if (last.kind !== 'ruffle' || last.source !== expected) {
      throw new Error(`${label}: the page ran ${last.kind}${last.source ? '/' + last.source : ''} instead of the ${expected} Ruffle (registered sources: ${(last.sources || []).join(', ') || 'none'})`)
    }
    if (!last.socketProxy || !last.allowScriptAccess) {
      throw new Error(`${label}: the running Ruffle lacks the page's config (socketProxy ${last.socketProxy}, allowScriptAccess ${last.allowScriptAccess})`)
    }

    log(`${label}: smoke test passed (${last.source} Ruffle, movie ${last.width}x${last.height}, SWF v${last.swfVersion}, ${last.version || 'version unknown'})`)
  } finally {
    try { client && client.close() } catch (e) {}
    child.kill()
    server.close()
    await wait(500)
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch (e) {}
  }
}

// -- backups ------------------------------------------------------------------------------------

function pruneBackups() {
  if (!fs.existsSync(backupDir)) return
  const old = fs.readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(keep)

  for (const name of old) fs.rmSync(path.join(backupDir, name), { recursive: true, force: true })
}

// -- main ---------------------------------------------------------------------------------------

async function main() {
  const current = installedVersion()

  if (flag('smoke-only')) {
    const dir = path.resolve(option('dir', ruffleDir))
    await smokeTest(dir, dir === ruffleDir ? `installed ${current}` : dir, option('extension', null) && path.resolve(option('extension')))
    return
  }

  const tags = JSON.parse(npm('view', PACKAGE, 'dist-tags', '--json'))
  const wanted = tags[channel === 'stable' ? 'latest' : channel]

  if (!wanted) throw new Error(`npm has no "${channel}" tag for ${PACKAGE}`)

  log(`installed ${current}, newest ${channel} is ${wanted}`)

  if (flag('check')) return

  if (wanted === current && !flag('force')) {
    log('already up to date')
    return
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ruffle-update-'))

  try {
    const tarball = npm('pack', `${PACKAGE}@${wanted}`, '--pack-destination', work, '--silent').split(/\r?\n/).pop()

    // relative names and cwd: GNU tar reads "C:" in an absolute path as a remote host
    execFileSync('tar', ['-xzf', tarball], { cwd: work })
    const staged = path.join(work, 'package')

    const problems = staticChecks(staged)
    if (problems.length) throw new Error(`${wanted} failed the static checks: ${problems.join('; ')}`)

    await smokeTest(staged, `staged ${wanted}`)

    if (flag('dry-run')) {
      log(`dry run: ${wanted} would be installed`)
      return
    }

    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
    const backup = path.join(backupDir, `${stamp}_${current}`)
    fs.mkdirSync(backupDir, { recursive: true })
    fs.renameSync(ruffleDir, backup)

    try {
      fs.cpSync(staged, ruffleDir, { recursive: true })
      await smokeTest(ruffleDir, `installed ${wanted}`)
    } catch (e) {
      log(`rolling back to ${current}: ${e.message}`)
      fs.rmSync(ruffleDir, { recursive: true, force: true })
      fs.renameSync(backup, ruffleDir)
      throw e
    }

    pruneBackups()
    log(`updated ${current} -> ${wanted}; previous build kept in ${backup}`)
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

main().catch((err) => {
  log(`update failed, nothing changed: ${err.message}`)
  process.exit(1)
})
