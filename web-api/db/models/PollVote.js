/* global mongoose: writeable */

mongoose = global.mongoose

// one vote on one fairy's page
const PollVote = new mongoose.model('PollVote', {
  pollId: { type: String, required: true, index: true },
  pageFairyId: { type: Number, required: true, index: true },
  voter: { type: String, required: true },  // accountId as a string, or "ip:<hash>"
  option: { type: Number, required: true }, // index into Poll.options
  created: { type: Date, default: Date.now }
})

PollVote.schema.index({ pollId: 1, pageFairyId: 1, voter: 1 }, { unique: true })

module.exports = PollVote
