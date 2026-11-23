/* global mongoose: writeable */

mongoose = global.mongoose

const WaitlistEntry = new mongoose.model('WaitlistEntry', {
  email: { type: String, required: true, unique: true, index: true },
  joinedAt: { type: Date, default: Date.now, index: true },
  invitedAt: { type: Date, default: null, index: true },
  tokenHash: { type: String, default: '', index: true },
  bypass: { type: Boolean, default: false },
  revokedAt: { type: Date, default: null },
  used: { type: Boolean, default: false },
  usedAt: { type: Date, default: null },
  usedBy: { type: String, default: '' }
})

module.exports = WaitlistEntry
