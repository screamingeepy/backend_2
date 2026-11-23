// run with node seed-polls-and-quizzes.js
// necessary for pixie pages polls and quizzes to work
const path = require('path')

module.paths.push(path.join(__dirname, '../web-api/node_modules'))

require('dotenv').config({ path: path.join(__dirname, '../web-api/.env') })

const mongoose = require('mongoose')

const URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/PixieHollow'
const WRITE = process.argv.includes('--write')

const POLLS = [
  { question: 'Who is your favorite fairy?', options: ['Tinker Bell', 'Silvermist', 'Rosetta', 'Iridessa', 'Fawn', 'Vidia'] },
  { question: 'What talent do you wish you had?', options: ['Tinker', 'Water', 'Garden', 'Light', 'Animal', 'Fast-flying'] },
  { question: 'What is your favorite fairy food?', options: ['Acorn muffins', 'Nectar nectar', 'Berry tarts', 'Honey cakes'] },
  { question: 'Which forest creature are you most like?', options: ['A bold raccoon', 'A cautious chipmunk', 'A jumpy rabbit', 'A wise owl'] },
  { question: 'What is the best thing about Pixie Hollow?', options: ['My friends', 'My animal friend', 'Decorating my home', 'The games', 'Flying']  }
]

// Results are quizPanel.xml's, exactly. Questions are written to reach them.
const QUIZZES = [
  {
    title: 'Fairy Bug Quiz',
    intro: 'Are you a hard worker?',
    results: [
      { id: 'bee', title: "You're a Busy Little Bee!", text: 'No one better get in your way!' },
      { id: 'butterfly', title: "You're a Butterfly!", text: "You like to flutter around, but won't be doing any heavy lifting." },
      { id: 'ladybug', title: "You're a Ladybug!", text: 'Sometimes you fly, sometimes you walk.' }
    ],
    questions: [
      { text: 'There is a whole meadow to tidy before sundown. You...', answers: [
        { text: 'Start at one end and do not stop', resultId: 'bee' },
        { text: 'Do a little, then admire the view', resultId: 'butterfly' },
        { text: 'Do your share and no more', resultId: 'ladybug' }
      ] },
      { text: 'A friend asks for help with her chores. You...', answers: [
        { text: 'Have already finished yours, so yes', resultId: 'bee' },
        { text: 'Help if it sounds fun', resultId: 'butterfly' },
        { text: 'Help for a little while', resultId: 'ladybug' }
      ] },
      { text: 'Your favorite kind of day is...', answers: [
        { text: 'One where you got a lot done', resultId: 'bee' },
        { text: 'One spent in the sunshine', resultId: 'butterfly' },
        { text: 'A bit of both', resultId: 'ladybug' }
      ] }
    ]
  },
  {
    title: 'Fairy Fashion Quiz',
    intro: 'What Flower are you?',
    results: [
      { id: 'rose', title: "You're a Rose!", text: 'You like looking glamorous in any setting.' },
      { id: 'tulip', title: "You're a Tulip!", text: 'Your style is simple and elegant.' },
      { id: 'wildflower', title: "You're a Wildflower!", text: 'Rather than follow others, you cultivate your own personal style.' }
    ],
    questions: [
      { text: 'You are getting ready for a party. You wear...', answers: [
        { text: 'The most striking thing you own', resultId: 'rose' },
        { text: 'Something plain and perfectly cut', resultId: 'tulip' },
        { text: 'Whatever you made yourself', resultId: 'wildflower' }
      ] },
      { text: 'Your favorite color to wear is...', answers: [
        { text: 'Deep red', resultId: 'rose' },
        { text: 'Soft white', resultId: 'tulip' },
        { text: 'All of them at once', resultId: 'wildflower' }
      ] },
      { text: 'Someone copies your outfit. You...', answers: [
        { text: 'Take it as the compliment it is', resultId: 'rose' },
        { text: 'Do not really mind', resultId: 'tulip' },
        { text: 'Change yours immediately', resultId: 'wildflower' }
      ] }
    ]
  }
]

async function main () {
  await mongoose.connect(URI)
  const db = mongoose.connection.db

  console.log(`[seed] ${URI}${WRITE ? '' : '  (dry run -- pass --write to apply)'}`)

  let addedPolls = 0
  for (const poll of POLLS) {
    if (await db.collection('polls').findOne({ question: poll.question })) continue
    if (WRITE) {
      await db.collection('polls').insertOne({
        ...poll, createdBy: null, createdByName: 'Pixie Hollow', ownerFairyId: null,
        active: true, createdAt: new Date()
      })
    }
    console.log(`  poll: ${poll.question}`)
    addedPolls++
  }

  let addedQuizzes = 0
  for (const quiz of QUIZZES) {
    if (await db.collection('quizzes').findOne({ title: quiz.title })) continue
    if (WRITE) {
      await db.collection('quizzes').insertOne({
        ...quiz, createdBy: null, createdByName: 'Pixie Hollow', ownerFairyId: null,
        active: true, createdAt: new Date()
      })
    }
    console.log(`  quiz: ${quiz.title} (${quiz.questions.length} questions, ${quiz.results.length} results)`)
    addedQuizzes++
  }

  console.log(WRITE
    ? `[seed] added ${addedPolls} polls and ${addedQuizzes} quizzes`
    : `[seed] would add ${addedPolls} polls and ${addedQuizzes} quizzes`)

  await mongoose.disconnect()
}

main().catch(err => { console.error('[seed] failed:', err.message); process.exit(1) })
