// one entry per process, pm2 matches on name so starting twice never makes a second copy
// npm start, npm run restart, npm run status
module.exports = {
  apps: [
    { name: 'app', script: 'app.js', cwd: __dirname },
    { name: 'xml', script: 'xml.js', cwd: __dirname },
    { name: 'socket-bridge', script: '../socket-bridge/bridge.js', cwd: __dirname },
    { name: 'render', script: '../render/worker-watch.js', cwd: __dirname }
  ].map(app => ({ ...app, min_uptime: '10s', max_restarts: 10 }))
}
