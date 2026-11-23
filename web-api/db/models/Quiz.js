/* global mongoose: writeable */

mongoose = global.mongoose

// a 'which one are you' quiz for a pixie page
const Quiz = new mongoose.model('Quiz', {
  title: { type: String, required: true },     // "Fairy Bug Quiz"
  intro: { type: String, default: '' },        // "Are you a hard worker?"

  questions: {
    type: [{
      text: { type: String },
      answers: {
        type: [{
          text: { type: String },
          resultId: { type: String }
        }],
        default: []
      }
    }],
    default: []
  },

  results: {
    type: [{
      id: { type: String },
      title: { type: String },   // "You're a Busy Little Bee!"
      text: { type: String }     // "No one better get in your way!"
    }],
    default: []
  },

  createdBy: { type: Number, default: null },
  createdByName: { type: String, default: '' },
  ownerFairyId: { type: Number, default: null, index: true },

  active: { type: Boolean, default: true, index: true },
  createdAt: { type: Date, default: Date.now }
})

module.exports = Quiz
