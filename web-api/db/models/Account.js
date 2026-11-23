/* global mongoose: writeable */

mongoose = global.mongoose

const Account = new mongoose.model('Account', {
  _id: { type: Number },
  username: { type: String },
  password: { type: String },
  playerId: { type: Array }, // player object ids
  lastLogin: { type: String },
  codesRedeemed: { type: Array },
  codeLastUsed: { type: Object, default: {} },
  discordId: { type: String, default: null },  // Discord user snowflake (string)
  // membership tier for the monthly diamond drip
  membershipTier: { type: Number, default: 4 },
  membershipSince: { type: Date, default: null },
  membershipDripsPaid: { type: Number, default: null },
  banned: { type: Number, default: 0 },
  terminated: { type: Number, default: 0 },
  banUntil: { type: Date, default: null },
  banReason: { type: String, default: '' },
  muted: { type: Number, default: 0 },
  mutedUntil: { type: Date, default: null },
  muteReason: { type: String, default: '' },
  accountType: { type: String, enum: ['Player', 'Moderator', 'Administrator'], default: 'Player' },
  // staff only, whether this staff member's fairies log in as the gm avatar
  gmVisible: { type: Boolean, default: false },
  // who this player has muted, on the account because you ignore a person, not one of their fairies
  ignored: { type: Array, default: [] },
  // account ids this player is friends with, shared by all their fairies; null until moved over from the fairies
  friends: { type: Array, default: null },
  // sound, music, tutorial, alert and whisper settings, shared by the account's fairies; null until moved over
  optionsBitmask: { type: Number, default: null },
  email: { type: String, default: '' },
  firstName: { type: String, default: '' },
  deleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null },
  age: { type: Number, default: null },
  ageGivenAt: { type: Date, default: null },
  emailConfirmedAt: { type: Date, default: null },
  // when a player who signed up under 13 replaced their parent's address with their own
  ownEmailAt: { type: Date, default: null },
  chatApproved: { type: Boolean, default: false },
  chatApprovedAt: { type: Date, default: null },
  // staff-set, takes speedchat plus and open chat away whatever the age or parental setting is
  speedChatOnly: { type: Boolean, default: false },
  // the emailed link into the parent portal: hashed, single use.
  parentPortalToken: { type: String, default: '', index: true },
  parentPortalExpires: { type: Date, default: null },
  emailConfirmToken: { type: String, default: '', index: true },
  emailConfirmExpires: { type: Date, default: null },
  passwordResetToken: { type: String, default: '', index: true },
  passwordResetTokenExpires: { type: Date, default: null }
})

module.exports = Account
