//pm2 entry point for the renderer

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const RENDERED = path.join(ROOT, 'web', 'rendered')

require(path.join(ROOT, 'web-api', 'node_modules', 'dotenv'))
  .config({ path: path.join(ROOT, 'web-api', '.env'), quiet: true })

const API = process.env.RENDER_API || 'http://127.0.0.1:8013'
const SITE = process.env.RENDER_SITE || 'http://127.0.0.1'
const TOKEN = process.env.API_TOKEN

const IS_WINDOWS = process.platform === 'win32'

const HOST = process.env.RENDER_HOST || 'projector'
function onPath (name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir && fs.existsSync(path.join(dir, name))) return path.join(dir, name)
  }

  return null
}

const PROJECTOR = process.env.RENDER_PROJECTOR ||
  (IS_WINDOWS
    ? path.join('C:', 'Program Files (x86)', 'Flash Player', 'flashplayer_sa_debug.exe')
    : onPath('flashplayerdebugger') || onPath('flashplayer') || 'flashplayer')
const RUFFLE = process.env.RENDER_RUFFLE || (IS_WINDOWS ? 'ruffle.exe' : 'ruffle')
const DISPLAY = process.env.RENDER_DISPLAY || ':99'
const MANAGE_XVFB = process.env.RENDER_XVFB !== '0'
const XVFB_GEOMETRY = process.env.RENDER_XVFB_GEOMETRY || '1024x1024x24'
let xvfb = null

async function startDisplay () {
  if (IS_WINDOWS || !MANAGE_XVFB || xvfb) return

  const socket = path.join('/tmp/.X11-unix', 'X' + DISPLAY.replace(':', ''))

  if (fs.existsSync(socket)) {
    log(`using the X display already on ${DISPLAY}`)
    return
  }

  xvfb = spawn('Xvfb', [DISPLAY, '-screen', '0', XVFB_GEOMETRY, '-nolisten', 'tcp'], {
    stdio: 'ignore',
    detached: true
  })

  xvfb.on('error', e => {
    console.error(`could not start Xvfb: ${e.message}`)
    console.error('Install it, or set RENDER_XVFB=0 and provide RENDER_DISPLAY yourself.')
    process.exit(1)
  })

  // Wait for the socket rather than a fixed sleep: Xvfb is ready when it is
  // listening, and that is what the projector will try to connect to.
  for (let waited = 0; waited < 10000; waited += 100) {
    if (fs.existsSync(socket)) {
      log(`started Xvfb on ${DISPLAY} (${XVFB_GEOMETRY})`)
      return
    }
    await sleep(100)
  }

  throw new Error(`Xvfb did not come up on ${DISPLAY} within 10s`)
}

function stopDisplay () {
  if (!xvfb) return

  try {
    process.kill(-xvfb.pid, 'SIGTERM')
  } catch { /* already gone */ }

  xvfb = null
}

// Generous: a cold host start plus the client's own boot is most of it. The
// renderer reports its own failures, so this only catches a genuine hang.
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS || 90000)
const POLL_MS = 500

// Short on purpose. web-api holds a cache-miss request open while it waits for
// the render (RENDER_WAIT_MS in WebService.js), so every second spent idle here
// comes straight out of that budget and shows up as a blank fairy on the page.
const IDLE_POLL_MS = Number(process.env.RENDER_IDLE_POLL_MS || 250)

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const value = (name, fallback = null) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const CONCURRENCY = Math.max(1, Math.min(16, Math.floor(Number(value('--concurrency', process.env.RENDER_CONCURRENCY || 1))) || 1))

function log (...parts) {
  console.log(new Date().toISOString().slice(11, 19), ...parts)
}

async function api (method, route, { query = {} } = {}) {
  const url = new URL(API + route)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)

  const res = await fetch(url, { method, headers: { Authorization: TOKEN } })

  if (!res.ok) {
    throw new Error(`${method} ${route} -> ${res.status} ${await res.text()}`)
  }

  const text = await res.text()
  return text ? JSON.parse(text) : null
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Wait for the harness to produce <hash>.png, or <hash>.error if it gave up.
 *
 * Polling the filesystem rather than talking to the projector: the SWF has no
 * channel back to this process, and the file appearing is the same event
 * web-api already logged.
 */
async function waitForResult (hash, deadline) {
  const png = path.join(RENDERED, `${hash}.png`)
  const err = path.join(RENDERED, `${hash}.error`)

  while (Date.now() < deadline) {
    if (fs.existsSync(png)) return { ok: true, bytes: fs.statSync(png).size }
    if (fs.existsSync(err)) return { ok: false, error: fs.readFileSync(err, 'utf8') }
    await sleep(POLL_MS)
  }

  return { ok: false, error: `no result within ${RENDER_TIMEOUT_MS}ms` }
}

/**
 * The flashvars the harness reads, as one object per job.
 *
 * currentUrl and htmlEnvironment are not optional and not cosmetic: absent is
 * not the same as empty, and SessionManager asks a browser that is not there
 * for location.href the moment currentUrl is undefined. See the plan, §8.1a.
 */
function harnessParams (job) {
  const params = {
    mode: job.mode,
    name: job.hash,
    pickle: job.pickle,
    currentUrl: '',
    htmlEnvironment: ''
  }

  if (job.scale) params.scale = job.scale

  return params
}

// No host loads HTML: the harness SWF is built to the site root so its relative
// URLs resolve the same way a page would make them. bustHarness.html exists for
// a human to open when debugging.
function harnessURL (params) {
  const url = new URL(`${SITE}/bustHarness.swf`)

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  return url.toString()
}

const HOSTS = {
  projector: {
    binary: PROJECTOR,
    // The projector reads flashvars off the SWF's own query string.
    args: params => [harnessURL(params)]
  },

  ruffle: {
    binary: RUFFLE,
    args: params => {
      // -P is Ruffle's documented flashvar channel; do not rely on it parsing
      // the query string. The URL keeps its copy anyway -- harmless, and it is
      // what makes a failing job reproducible by pasting it into a browser.
      const args = [harnessURL(params)]

      for (const [key, value] of Object.entries(params)) {
        args.push(`-P${key}=${value}`)
      }

      // Stage size matches the harness's own; --no-gui drops the menu bar so
      // the window is only the movie.
      args.push('--no-gui', '--width', '994', '--height', '1000', '-q', 'high')

      // Nothing here should outlive a job. Disk storage would also put every
      // worker on one SharedObject directory, which is the lock contention that
      // per-job browser profiles used to lose to.
      args.push('--storage', 'memory')
      args.push('--config', ruffleScratch(params.name), '--cache-directory', ruffleScratch(params.name))

      // A server has no GPU; gl reaches Mesa's llvmpipe. On Windows let Ruffle
      // pick, which is Vulkan on real hardware.
      if (!IS_WINDOWS) args.push('--graphics', 'gl')

      return args
    }
  }
}

// Keyed by pid so two workers on one machine cannot share a config directory,
// and by job so two renders inside one worker (--concurrency) cannot either.
function ruffleScratch (name) {
  const base = path.join(os.tmpdir(), `ph-render-ruffle-${process.pid}`)
  return name ? path.join(base, name) : base
}

async function render (job) {
  // Stale results from an earlier attempt would be read as this one's.
  fs.mkdirSync(RENDERED, { recursive: true })
  fs.rmSync(path.join(RENDERED, `${job.hash}.png`), { force: true })
  fs.rmSync(path.join(RENDERED, `${job.hash}.error`), { force: true })

  const host = startHost(job)

  let spawnError = null
  host.on('error', e => { spawnError = e })

  try {
    const result = await waitForResult(job.hash, Date.now() + RENDER_TIMEOUT_MS)
    return spawnError ? { ok: false, error: `could not start the player: ${spawnError.message}` } : result
  } finally {
    await stop(host)
  }
}

function startHost (job) {
  // On Linux, detached so it leads its own process group: both players fork
  // helpers, and killing only the pid we spawned would leave them holding the
  // display.

  // On Windows there is no process group to lead and `taskkill /t` walks the
  // tree by itself, so the child stays attached.
  return spawn(HOSTS[HOST].binary, HOSTS[HOST].args(harnessParams(job)), {
    stdio: 'ignore',
    detached: !IS_WINDOWS,
    env: IS_WINDOWS ? process.env : { ...process.env, DISPLAY }
  })
}

/**
 * Kill the Flash host and wait for it to actually be gone.
 *
 * Both halves matter. The kill has to take the whole tree: on Windows the pid
 * we spawn is not the only process, and on Linux, Flash forks helpers that would
 * otherwise keep holding the display. The wait is because the next job reuses
 * the same profile directory or display, and starting it while the old process
 * still holds a lock fails, which used to take the whole worker down.
 */
async function stop (host) {
  const exited = new Promise(resolve => host.once('exit', resolve))

  try {
    if (IS_WINDOWS) {
      spawn('taskkill', ['/pid', String(host.pid), '/t', '/f'], { stdio: 'ignore' })
    } else {
      // Negative pid = the whole process group, which startProjector created.
      process.kill(-host.pid, 'SIGKILL')
    }
  } catch { /* already gone */ }

  await Promise.race([exited, sleep(10000)])

  // A tree kill returns before every child is reaped; locks outlive the parent
  // by a moment.
  await sleep(500)
}

// How long to wait after the API refuses to answer, before asking again. A
// web-api restart takes a few seconds; this is comfortably longer than that
// and short enough that nobody is left looking at a placeholder.
const API_DOWN_WAIT_MS = Number(process.env.RENDER_API_DOWN_WAIT_MS || 3000)

async function drain ({ watch }) {
  let done = 0
  let complained = false

  for (;;) {
    let job

    try {
      job = await api('POST', '/fairies/api/internal/render/claim')
      complained = false
    } catch (e) {
      // A one-shot drain has nothing to wait for, so it still fails loudly.
      if (!watch) throw e

      // Watching, the API going away is expected: it is restarted whenever
      // web-api changes, and fetch rejects for the few seconds it is down.
      // Exiting here is what used to stop houses and busts from appearing at
      // all -- the queue simply stopped being drained, and the only sign was
      // a page full of transparent placeholders. Said once per outage rather
      // than every poll, so an overnight restart does not fill the log.
      if (!complained) {
        log(`api unreachable (${e.message}); retrying every ${API_DOWN_WAIT_MS}ms`)
        complained = true
      }

      await sleep(API_DOWN_WAIT_MS)
      continue
    }

    if (!job) {
      if (!watch) return done
      await sleep(IDLE_POLL_MS)
      continue
    }

    log(`job ${job.id} fairy ${job.fairyId} ${job.mode} attempt ${job.attempts} -> ${job.hash.slice(0, 12)}`)

    const started = Date.now()
    const result = await render(job)
    const took = ((Date.now() - started) / 1000).toFixed(1)

    // Reporting the outcome can hit the same outage. The image is already
    // written either way, so losing the report only leaves a job marked
    // 'rendering' until its claim goes stale and someone picks it up again.
    try {
      if (result.ok) {
        log(`  ok in ${took}s, ${result.bytes} bytes`)
        await api('POST', `/fairies/api/internal/render/finish/${job.id}`)
        done++
      } else {
        log(`  FAILED in ${took}s: ${result.error}`)
        await api('POST', `/fairies/api/internal/render/finish/${job.id}`, {
          query: { error: result.error }
        })
      }
    } catch (e) {
      if (!watch) throw e
      log(`  could not report ${job.id}: ${e.message}`)
    }
  }
}

/**
 * Diagnose this machine: everything a render needs, one line each, so a fresh
 * server shows what is missing instead of a queue that quietly never drains.
 * With --render it also does one real render, which is the only test that the
 * player, the display, the site and the upload route all work together.
 */
async function check () {
  let failed = 0

  const step = async (label, fn) => {
    try {
      const detail = await fn()
      console.log(`  ok    ${label}${detail ? ` -- ${detail}` : ''}`)
    } catch (e) {
      failed++
      console.log(`  FAIL  ${label} -- ${e.message}`)
    }
  }

  console.log(`render setup check (${process.platform}, host ${HOST})`)

  await step('API_TOKEN set', async () => {
    if (!TOKEN) throw new Error('missing from web-api/.env')
  })

  await step(`web-api answers at ${API}`, async () => {
    const depth = await api('GET', '/fairies/api/internal/render/status')
    return `queue ${JSON.stringify(depth)}`
  })

  for (const file of ['bustHarness.swf', 'swf/avatarRenderer.swf', 'swf/containerLib.swf']) {
    await step(`${SITE}/${file} is served`, async () => {
      const res = await fetch(`${SITE}/${file}`)
      if (!res.ok) throw new Error(`HTTP ${res.status} (is the web server on ${SITE}? set RENDER_SITE if it is elsewhere)`)
    })
  }

  await step(`upload route accepts this machine (${SITE}/fairies/api/internal/renderResult)`, async () => {
    // A failed-render marker is the smallest legitimate post, and a real one is
    // cleaned up below. 404 here is the "not a local request" refusal.
    const res = await fetch(`${SITE}/fairies/api/internal/renderResult?name=checkprobe&error=probe`, { method: 'POST', body: 'x' })
    fs.rmSync(path.join(RENDERED, 'checkprobe.error'), { force: true })
    if (res.status === 404) throw new Error('refused as not-local; see "Proxies" in docs/renderer-linux.md')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  })

  await step(`player: ${HOSTS[HOST] ? HOSTS[HOST].binary : HOST}`, async () => {
    if (!HOSTS[HOST]) throw new Error(`unknown RENDER_HOST; expected ${Object.keys(HOSTS).join(' or ')}`)

    const binary = HOSTS[HOST].binary
    const found = binary.includes('/') || binary.includes('\\') ? fs.existsSync(binary) : Boolean(onPath(binary))

    if (!found) throw new Error(`not found; set ${HOST === 'ruffle' ? 'RENDER_RUFFLE' : 'RENDER_PROJECTOR'}`)
  })

  if (!IS_WINDOWS) {
    await step('display', async () => {
      if (MANAGE_XVFB) {
        if (!onPath('Xvfb')) throw new Error('Xvfb not installed (or set RENDER_XVFB=0 and RENDER_DISPLAY to a running display)')
        return 'Xvfb will be started by the worker'
      }

      if (!fs.existsSync(path.join('/tmp/.X11-unix', 'X' + DISPLAY.replace(':', '')))) throw new Error(`no X display on ${DISPLAY}`)
    })
  }

  await step(`${RENDERED} is writable`, async () => {
    fs.mkdirSync(RENDERED, { recursive: true })
    const probe = path.join(RENDERED, 'checkprobe.tmp')
    fs.writeFileSync(probe, 'x')
    fs.rmSync(probe)
  })

  if (flag('--render') && !failed) {
    await step('test render (the default fairy)', async () => {
      await startDisplay()
      const job = { mode: 'full', scale: 0, hash: 'checkrender', pickle: DEFAULT_CHECK_PICKLE }
      const started = Date.now()
      const result = await render(job)
      fs.rmSync(path.join(RENDERED, 'checkrender.png'), { force: true })
      if (!result.ok) throw new Error(result.error)
      return `${result.bytes} bytes in ${((Date.now() - started) / 1000).toFixed(1)}s`
    })
  } else if (flag('--render')) {
    console.log('  skip  test render -- fix the failures above first')
  }

  console.log(failed ? `${failed} problem(s) found.` : 'All checks passed.')
  return failed
}

// The Create-a-Fairy starting fairy (web/xml/caf/initDNA.xml), as a pickle.
const DEFAULT_CHECK_PICKLE = '100/95/88/5/-15/25/-10/0/10/1/5/28/106/5503:89:-1/5001:89:-1/4501:106:-1/4001:64:106/6001:109:-1/2001:48:-1/75:166:-1/1079:166:-1/2501:48:-1/541:166:-1/1501:48:-1/3001:48:-1/3501:166:-1'

async function main () {
  if (flag('--check')) {
    process.exitCode = (await check()) ? 1 : 0
    return
  }

  if (!TOKEN) {
    console.error('API_TOKEN is not set -- is web-api/.env present?')
    process.exit(1)
  }

  if (!HOSTS[HOST]) {
    console.error(`Unknown RENDER_HOST "${HOST}" -- expected ${Object.keys(HOSTS).join(' or ')}.`)
    process.exit(1)
  }

  if (!flag('--status')) {
    const binary = HOSTS[HOST].binary

    // A binary may legitimately be a bare name resolved through PATH, so only
    // an explicit path is worth checking up front.
    const named = binary.includes('/') || binary.includes('\\')

    if (named && !fs.existsSync(binary)) {
      console.error(`No ${HOST} binary at ${binary}`)
      console.error(`Set ${HOST === 'ruffle' ? 'RENDER_RUFFLE' : 'RENDER_PROJECTOR'}, or pick the other RENDER_HOST.`)
      process.exit(1)
    }

    log(`host ${HOST} (${binary})`)
    await startDisplay()
  }

  if (flag('--status')) {
    console.log(await api('GET', '/fairies/api/internal/render/status'))
    return
  }

  const pickle = value('--pickle')

  if (pickle) {
    const name = value('--name', 'pickle')
    const job = { mode: value('--mode', 'full'), scale: Number(value('--scale', '0')), hash: name, pickle }
    log(`pickle ${job.mode} -> ${name}`)
    const result = await render(job)

    if (!result.ok) throw new Error(result.error)

    log(`  ok, ${result.bytes} bytes`)
    return
  }

  const fairy = value('--fairy')

  if (fairy) {
    const job = await api('POST', '/fairies/api/internal/render/enqueue', {
      query: {
        fairyId: fairy,
        mode: value('--mode', 'bust'),
        scale: value('--scale', '0')
      }
    })
    log(`enqueued ${job.id} (${job.status}) ${job.hash.slice(0, 12)}`)
  }

  if (CONCURRENCY > 1) log(`${CONCURRENCY} renders at a time`)

  const counts = await Promise.all(Array.from({ length: CONCURRENCY }, () => drain({ watch: flag('--watch') })))
  log(`${counts.reduce((a, b) => a + b, 0)} render(s) completed`)
}

// Xvfb and Ruffle's scratch directory are ours to clean up however we exit,
// including Ctrl-C.
function cleanup () {
  stopDisplay()

  if (HOST === 'ruffle') {
    try {
      fs.rmSync(ruffleScratch(), { recursive: true, force: true })
    } catch { /* next run reuses it harmlessly */ }
  }
}

for (const signal of ['exit', 'SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cleanup()
    if (signal !== 'exit') process.exit(130)
  })
}

main()
  .then(cleanup)
  .catch(e => {
    cleanup()
    console.error(e.message)
    process.exit(1)
  })
