const mongoose = require('mongoose')

const eventSchema = new mongoose.Schema({
  date: { type: Date, required: true, index: true },
  endDate: { type: Date },
  type: { type: String, required: true, index: true },
  timeType: { type: String, enum: ['once', 'hourly', 'thisweek', 'contest'], default: 'once' },
  title: { type: String, required: true },
  shortTitle: { type: String, default: '' },
  when: { type: String, default: '' },
  where: { type: String, default: '' },
  color: { type: String, default: '' },
  link: { type: String, default: '' },
  imagePath: { type: String, default: '' },
  published: { type: Boolean, default: false, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  createdBy: { type: Number, default: null },
  createdByName: String
}, { collection: 'events' })

eventSchema.index({ date: 1, published: 1 })

module.exports = mongoose.model('Event', eventSchema)
