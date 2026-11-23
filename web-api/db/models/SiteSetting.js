/* global mongoose: writeable */

mongoose = global.mongoose

// a named site wide setting an Administrator can change while the server runs
const SiteSetting = new mongoose.model('SiteSetting', {
  _id: { type: String },
  value: { type: mongoose.Schema.Types.Mixed }
})

module.exports = SiteSetting
