/* global mongoose: writeable */

mongoose = global.mongoose

const ContestEntry = new mongoose.model('ContestEntry', {
  // the BlogEntry (feed 'contests') this was sent to.
  contestId: { type: String, required: true, index: true },

  accountId: { type: Number, required: true, index: true },
  username: { type: String, default: '' },
  fairyId: { type: Number, default: null },
  fairyName: { type: String, default: '' },

  title: { type: String, default: '' },
  body: { type: String, default: '' },
  files: {
    type: [new mongoose.Schema({
      name: { type: String, required: true, index: true },
      kind: { type: String, enum: ['image', 'document'], default: 'image' },
      size: { type: Number, default: 0 }
    }, { _id: false })],
    default: []
  },
  image: { type: String, default: '', index: true },

  status: { type: String, enum: ['pending', 'finalist', 'picked', 'rejected'], default: 'pending', index: true },
  staffNote: { type: String, default: '' },
  reviewedBy: { type: String, default: '' },
  reviewedAt: { type: Date, default: null },

  createdAt: { type: Date, default: Date.now, index: true }
})

module.exports = ContestEntry
