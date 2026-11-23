/* global mongoose: writeable */

mongoose = global.mongoose

const SitePollVote = new mongoose.model('SitePollVote', {
  pollId: { type: String, required: true, index: true },
  accountId: { type: Number, required: true },
  // which of the poll's questions (an index; 0 for every poll that had just one).
  question: { type: Number, default: 0 },
  // an index into that question's options.
  option: { type: Number, required: true },
  created: { type: Date, default: Date.now }
})

SitePollVote.schema.index({ pollId: 1, accountId: 1, question: 1 }, { unique: true })

module.exports = SitePollVote
