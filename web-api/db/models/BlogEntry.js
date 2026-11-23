/* global mongoose: writeable */

mongoose = global.mongoose

const BlogEntry = new mongoose.model('BlogEntry', {
  feed: { type: String, enum: ['nevernews', 'knownissues', 'events', 'contests', 'polls'], required: true },
  title: { type: String, default: '' },
  // body is sanitized html, sanitizeHtmlBody in WebService.js decides what survives
  body: { type: String, default: '' },
  authorName: { type: String, default: '' },
  // chosen from the signature library or uploaded; '' for none.
  signature: { type: String, default: '' },
  heroImage: { type: String, default: '' },
  thumbImage: { type: String, default: '' },
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  contestOpen: { type: Boolean, default: false },
  contestAccepts: { type: String, enum: ['writing', 'art', 'either'], default: 'either' },
  contestEntriesPerPlayer: { type: Number, default: 1 },
  pollQuestions: {
    type: [new mongoose.Schema({ text: { type: String, default: '' }, options: { type: [String], default: [] } }, { _id: false })],
    default: []
  },
  pollOptions: { type: [String], default: [] },
  pollOpen: { type: Boolean, default: false },
  pollShowResults: { type: Boolean, default: false },
  commentsEnabled: { type: Boolean, default: false },
  calendarEventId: { type: String, default: '' },
  comments: {
    type: [{
      fairyName: { type: String, default: '' },
      accountId: { type: Number, default: null },
      body: { type: String, default: '' },
      status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
      postedAt: { type: Date, default: Date.now },
      reviewedBy: { type: String, default: '' }
    }],
    default: []
  },
  // when the post goes out, which is not when the draft was made.
  postedAt: { type: Date, default: Date.now },
  createdBy: { type: Number, default: null },
  createdByName: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
})

module.exports = BlogEntry
