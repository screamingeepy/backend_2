/* global mongoose: writeable */

mongoose = global.mongoose

const RenderJob = new mongoose.model('RenderJob', {
  fairyId: { type: Number, required: true, index: true },
  pickle: { type: String, required: true },
  mode: { type: String, enum: ['bust', 'full', 'home', 'homefull'], default: 'bust' },
  scale: { type: Number, default: 0 },

  // sha1 of pickle + mode + scale; also the output filename.
  hash: { type: String, required: true, index: true },

  status: {
    type: String,
    enum: ['queued', 'rendering', 'done', 'failed'],
    default: 'queued',
    index: true
  },

  attempts: { type: Number, default: 0 },

  warm: { type: Boolean, default: false },
  error: { type: String, default: '' },

  requestedAt: { type: Date, default: Date.now },
  claimedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null }
})

module.exports = RenderJob
