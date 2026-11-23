/* global mongoose: writeable */

mongoose = global.mongoose

// A page on Meet the Staff (/staff.html). It points at a fairy by id rather than copying her, so a name,
// talent and picture are whatever they are right now.
const StaffFairy = new mongoose.model('StaffFairy', {
  slug: { type: String, required: true, unique: true },
  fairyId: { type: Number, required: true, index: true },
  // what they do for the game, shown under the name
  role: { type: String, default: '' },
  // the red ribbon on the bio card
  didYouKnow: { type: String, default: '' },
  // the lines on the bio card, in order: Partner, Strengths and so on
  facts: {
    type: [new mongoose.Schema({ label: { type: String, default: '' }, value: { type: String, default: '' } }, { _id: false })],
    default: []
  },
  bio: { type: String, default: '' },
  // the meadow picture behind them, an id from web/site/img/staffbg/index.json; '' is the page's usual one
  background: { type: String, default: '' },
  order: { type: Number, default: 0 },
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  createdBy: { type: Number, default: null },
  createdByName: { type: String, default: '' },
  updatedByName: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
})

module.exports = StaffFairy
