// include our configuration info.
require('dotenv').config()

// include our globals.
require('./globals')

app = global.app

/* global app: writeable */

const server = app.listen(8013, () => {
  console.log('Listening on port 8013')
})

// a second copy can't serve anything, and left alive it would still run every background job
server.on('error', err => {
  console.error(`Could not listen on port 8013: ${err.code || err.message}`)
  process.exit(1)
})
