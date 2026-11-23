/* global mongoose: writeable */

mongoose = global.mongoose

const Submission = new mongoose.model('Submission', {
  type: { type: String, enum: ['fairytale', 'poem', 'question', 'art'], required: true, index: true },

  accountId: { type: Number, required: true, index: true },
  username: { type: String, default: '' },
  fairyId: { type: Number, default: null },
  fairyName: { type: String, default: '' },

  title: { type: String, default: '' },
  body: { type: String, default: '' },
  image: { type: String, default: '' },

  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  // staff-only. Never shown to the player.
  staffNote: { type: String, default: '' },
  reviewedBy: { type: String, default: '' },
  reviewedAt: { type: Date, default: null },

  createdAt: { type: Date, default: Date.now, index: true }
})

module.exports = Submission
