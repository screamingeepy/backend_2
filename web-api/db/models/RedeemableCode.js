/* global mongoose: writeable */

mongoose = global.mongoose

const RedeemableCode = new mongoose.model('RedeemableCode', {
  _id: { type: Number },
  codeName: { type: String, index: true },
  rewardType: { type: String, enum: ['item', 'gold', 'badge'], default: 'item' },
  // item id, or badge id. Unused for gold.
  rewardId: { type: Number },
  gender: { type: Number, default: 0 },
  quantity: { type: Number, default: 1 },
  color1: { type: Number, default: 166 },
  color2: { type: Number, default: 166 },
  repeatHours: { type: Number, default: -1 },
  expirationDate: { type: Date, default: null },
  maxUses: { type: Number, default: 0 },
  uses: { type: Number, default: 0 },
  note: { type: String, default: '' },
  createdBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
})

module.exports = RedeemableCode
