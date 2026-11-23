/* global mongoose: writeable */

mongoose = global.mongoose

// a poll that can sit on a fairy's pixie page
const Poll = new mongoose.model('Poll', {
  question: { type: String, required: true },
  options: { type: [String], default: [] },

  createdBy: { type: Number, default: null },     // accountId
  createdByName: { type: String, default: '' },
  ownerFairyId: { type: Number, default: null, index: true }, // null = anyone may use it

  active: { type: Boolean, default: true, index: true },
  createdAt: { type: Date, default: Date.now }
})

module.exports = Poll
