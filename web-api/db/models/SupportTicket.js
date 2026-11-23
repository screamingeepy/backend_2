/* global mongoose: writeable */

mongoose = global.mongoose

const SupportTicket = new mongoose.model('SupportTicket', {
  accountId: { type: Number, default: null }, // who filed it
  email: { type: String }, // where replies go; the account's email at filing time
  category: { type: String, default: 'general' },
  subject: { type: String },
  playerName: { type: String, default: '' },
  reportedName: { type: String, default: '' },
  source: { type: String, enum: ['site', 'game', 'email'], default: 'site' },
  details: { type: Map, of: String, default: () => ({}) },
  attachments: {
    type: [{
      url: { type: String },
      name: { type: String, default: '' },
      uploadedAt: { type: Date, default: Date.now }
    }],
    default: []
  },
  status: { type: String, enum: ['open', 'pending', 'resolved', 'closed'], default: 'open' },
  // lets someone who filed without an account come back to their thread
  viewToken: { type: String, default: '', index: true },
  assignedTo: { type: Number, default: null }, // staff accountId
  messages: {
    type: [{
      from: { type: String, enum: ['player', 'staff'] },
      authorName: { type: String, default: '' }, // staff username, blank for the player's own messages
      body: { type: String },
      emailMessageId: { type: String, default: '', index: true },
      sentAt: { type: Date, default: Date.now }
    }],
    default: []
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
})

module.exports = SupportTicket
