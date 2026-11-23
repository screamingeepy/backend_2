/* global mongoose: writeable */

mongoose = global.mongoose

// one signature in a fairy's guestbook
const GuestbookEntry = new mongoose.model('GuestbookEntry', {
  pageFairyId: { type: Number, required: true, index: true },

  signerFairyId: { type: Number, required: true, index: true },
  signerName: { type: String, default: '' },
  signerAddress: { type: String, default: '' },

  phraseId: { type: Number, required: true },
  wordId: { type: Number, required: true },

  // removed rows are kept so there is something to look at when one is reported
  removed: { type: Boolean, default: false, index: true },
  removedAt: { type: Date, default: null },
  removedBy: { type: String, default: '' },

  created: { type: Date, default: Date.now, index: true }
})

module.exports = GuestbookEntry
