// websocket to tcp bridge for browser game clients (ruffle's socketProxy routes here)
// run with node socket-bridge/bridge.js, bytes pass through unchanged

const net = require('net')
const path = require('path')

// Resolve ws from web-api, with a local install as fallback. ws 7 exports
// Server; ws 8 also provides WebSocketServer.
function loadWs () {
  const candidates = [path.join(__dirname, '..', 'web-api', 'node_modules', 'ws'), 'ws']

  for (const candidate of candidates) {
    try {
      const ws = require(candidate)
      const Server = ws.WebSocketServer || ws.Server

      if (Server) return Server
    } catch { /* try the next one */ }
  }

  console.error("Could not load 'ws'. Install it in web-api, or beside this file.")
  process.exit(1)
}

const WebSocketServer = loadWs()

const LISTEN_HOST = process.env.BRIDGE_HOST || '127.0.0.1'
// can change this port if it's taken
const LISTEN_PORT = Number(process.env.BRIDGE_PORT || 9014)

// Clientagent address from otp.yml.
const GAME_HOST = process.env.GAME_HOST || '127.0.0.1'
const GAME_PORT = Number(process.env.GAME_PORT || 8012)

function log (...parts) {
  console.log(new Date().toISOString().slice(11, 19), ...parts)
}

const server = new WebSocketServer({ host: LISTEN_HOST, port: LISTEN_PORT })

let nextId = 1

server.on('connection', (ws, request) => {
  const id = nextId++
  const who = `#${id} ${request.socket.remoteAddress}`

  log(`${who} connected, dialing ${GAME_HOST}:${GAME_PORT}`)

  const tcp = net.connect(GAME_PORT, GAME_HOST)

  tcp.setNoDelay(true)

  let pending = []
  let open = false

  tcp.on('connect', () => {
    open = true
    for (const chunk of pending) tcp.write(chunk)
    pending = []
    log(`${who} upstream open`)
  })

  tcp.on('data', chunk => {
    if (ws.readyState === ws.OPEN) {
      ws.send(chunk, { binary: true })
    }
  })

  ws.on('message', (data, isBinary) => {
    const chunk = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)

    if (!isBinary && chunk.length === 0) return

    if (open) {
      tcp.write(chunk)
    } else {
      pending.push(chunk)
    }
  })

  const shutdown = reason => {
    if (!tcp.destroyed) tcp.destroy()
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close()
    log(`${who} closed (${reason})`)
  }

  tcp.on('close', () => shutdown('upstream closed'))
  tcp.on('error', e => shutdown(`upstream error: ${e.message}`))
  ws.on('close', () => shutdown('client closed'))
  ws.on('error', e => shutdown(`client error: ${e.message}`))
})

server.on('listening', () => {
  log(`bridge on ws://${LISTEN_HOST}:${LISTEN_PORT} -> tcp ${GAME_HOST}:${GAME_PORT}`)
})

server.on('error', e => {
  console.error(`bridge could not listen on ${LISTEN_HOST}:${LISTEN_PORT}: ${e.message}`)
  process.exit(1)
})
