//   pm2 start render/worker-watch.js --name render
process.argv.push('--watch')
require('./worker.js')
