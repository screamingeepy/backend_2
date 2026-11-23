/* global mongoose: writeable */

mongoose = global.mongoose

const Fairy = new mongoose.model('Fairy', {
  _id: { type: Number },
  ownerAccount: { type: String, index: true },
  accountId: { type: Number, index: true },
  friends: { type: Array }, // Friends list (of Account object ids)
  ignored: { type: Array, default: [] },
  famousFairy: { type: Boolean, default: false },
  created: { type: Date, default: Date.now },
  name: String,
  talent: Number,
  gender: Number,
  chosen: { type: Boolean, default: true },
  pollId: { type: String, default: '' },
  quizId: { type: String, default: '' },
  deleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null },
  icon: { type: Number, default: 0 },
  game_prof_bg: { type: String, default: null },
  bio: { type: Array },
  address: { type: String, default: '1234CatepillerCorral' },
  homeType: { type: Number, default: null }, // home_type_id; falls back to talent when unset
  gardenType: { type: Number, default: null }, // garden_type_id; the client reads an unset one as 1
  // owned by the game server (housing/GardenData.py), declared so a mongoose save doesn't drop it
  gardenPlots: { type: Array, default: [] },
  moreOptions: { type: String, default: '000000000000000000000000' },
  tutorialBitmask: { type: Array, default: [0, 0] },
  optionsBitmask: { type: Number, default: 0 },
  gold: { type: Number, default: 0 },
  goldTradedToday: { type: Number, default: 0 },
  lastGoldTradeAt: { type: Date, default: null }, 
  pouch: { type: Array },
  // giveaway_ids this fairy has already collected from a meadow
  giveawaysCollected: { type: Array, default: [] },
  maxOutfitSlots: { type: Number, default: 1 }, // saved-outfit slots; owned by the game-server AI
  savedOutfits: { type: Array, default: [] }, // written only by the game-server AI (DistributedFairyPlayerAI)
  level: { type: Number, default: 0 },
  questState: {
    type: [{
      questId: { type: Number },
      currentStep: { type: Number, default: 0 },
      giverNpcId: { type: Number, default: 0 },
    }],
    default: [],
  },
  questHistory: {
    type: [{
      questGroup: { type: Number },
      questBitmask: { type: Number, default: 0 },
      acceptTimeForLastDone: { type: Number, default: 0 },
    }],
    default: [],
  },
  dailyChanceLastSpin: { type: Date, default: null },
  badgeData: {
    badges: [{
      badgeId: { type: Number },
      status: {
        type: String,
        enum: ['Active', 'Earned'],
        default: 'Active'
      },
      progress: { type: Number, default: 0 },
      dateEarned: { type: Date, default: null }
    }],
    unlockedPages: { type: Array, default: [] },
    favoriteBadgeId: { type: Number, default: 0 }
  },
  // owned by the game server (pet/pet_state.py), declared so a mongoose save doesn't drop it
  pet: {
    type: {
      itemId: Number, // species, 73000-73006
      color1: Number,
      color2: Number,
      outfitId: { type: Number, default: 0 },
      name1: Number, // ids into animalFriendNames.xml
      name2: Number,
      hunger: Number,
      happiness: Number,
      health: Number,
      growth: { type: Number, default: 0 },
      status: { type: Number, default: 3 }, // PetMgr.ANIMAL_FRIEND_ACTIVE
      golden: { type: Number, default: 0 },
      giftSteps: { type: Number, default: 0 }, // gift requests since the last gift
      giftsToday: { type: Number, default: 0 },
      giftDay: { type: String, default: null }, // the day giftsToday counts
      healthyDays: { type: Number, default: 0 }, // days since the pet last fell ill
      sadDays: { type: Number, default: 0 }, // days spent at zero happiness
      lastTick: { type: Date, default: null }, // last day of decay applied
      acquired: { type: Date, default: Date.now }
    },
    default: undefined,
    _id: false
  },
  petOutfits: { type: Array, default: [] },
  stats: [{
    type: { type: String, enum: ['recipe', 'game'], required: true },
    statId: { type: Number, required: true },
    count: { type: Number, default: 0 },
    best: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    bonus: { type: Number, default: 0 },
  }],
  avatar: {
    proportions: {
      head: Number,
      height: Number,
      body: Number
    },
    rotations: {
      head_rot: Number,
      ll_arm_rot: Number,
      ul_arm_rot: Number,
      ul_leg_rot: Number,
      ll_leg_rot: Number,
      lr_arm_rot: Number,
      ur_arm_rot: Number,
      lr_leg_rot: Number,
      ur_leg_rot: Number
    },
    hair_back: Number,
    hair_front: Number,
    face: Number,
    eye: Number,
    wing: Number,
    hair_color: Number,
    hair_color2: { type: Number, default: 0 },
    eye_color: Number,
    skin_color: Number,
    wing_color: Number,
    items: [{
      inv_id: Number,
      type: { type: String },
      item_id: Number,
      slot: { type: Number, default: 0 },
      createdById: { type: Number, default: 0 },
      createdByName: { type: String, default: '' },
      giftedById: { type: Number, default: 0 },
      giftedByName: { type: String, default: '' },
      quality: { type: Number, default: 0 },
      color1: { type: Number, default: 0 },
      color2: { type: Number, default: 0 },
      howAcquired: { type: Number, default: 0 },
      location: {
        type: String,
        enum: ['Equipped', 'Wardrobe', 'Storage'],
        default: 'Wardrobe'
      },
      home: {
        type: {
          roomId: Number,
          x: Number,
          y: Number,
          depth: Number,
          flip: Number,
          scale: Number
        },
        default: undefined,
        _id: false
      }
    }]
  }
})

module.exports = Fairy
