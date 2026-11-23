/* global mongoose: writeable */

mongoose = global.mongoose

// the gm portal command queue
const GmCommand = new mongoose.model('GmCommand', {
  issuedAt: { type: Date, default: Date.now },
  issuedBy: { type: Number }, // accountId
  issuedByName: { type: String, default: '' },
  accountType: { type: String, default: 'Player' }, // tier at issue time
  command: { type: String }, // full magic word text, args included
  scope: { type: String, enum: ['global', 'district', 'any', 'anydistrict', 'web'] },
  category: { type: String, default: 'debug' },
  status: { type: String, enum: ['pending', 'running', 'done', 'failed', 'unclaimed'], default: 'pending' },
  claimedBy: { type: mongoose.Schema.Types.Mixed, default: null }, // 'uberdog' or a district id
  finishedAt: { type: Date, default: null },
  response: { type: String, default: null }
}, 'gmCommands')

module.exports = GmCommand
