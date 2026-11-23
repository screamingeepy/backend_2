// the team application forms. The page draws itself from these and the server checks answers
// against them, so a question is only ever added or reworded here

// the youngest anyone can apply, null for no limit. Under this nothing from the application is kept
const MIN_AGE = 18
const MAX_AGE = 120

const areaNotes = {
  id: 'areaNotes',
  label: 'Is there a category you\'d like to learn but don\'t feel comfortable with yet?',
  hint: 'If so, tell us here. We can help train.',
  type: 'textarea',
  required: false,
  max: 1000
}

const shared = [
  { id: 'discord', label: 'What is your Discord screen name and Discord user name?', type: 'text', required: true, max: 100 },
  { id: 'age', label: 'How old are you?', hint: MIN_AGE ? `Applications are open to people ${MIN_AGE} and older.` : '', type: 'number', required: true },
  { id: 'timeZone', label: 'What is your time zone?', type: 'text', required: true, max: 60 },
  { id: 'days', label: 'What day(s) can you be available?', hint: 'You can give a general answer, like weekdays, weekends, or specific days.', type: 'text', required: true, max: 300 },
  { id: 'times', label: 'What time(s) can you be available?', hint: 'You can give an estimate such as mornings, afternoons, evenings, nights, or specific times of day.', type: 'text', required: true, max: 300 },
  { id: 'hours', label: 'How much time can you realistically see yourself dedicating per week to helping out?', hint: 'This can be an estimate and changed later.', type: 'text', required: true, max: 300 },
  { id: 'why', label: 'Why do you want to be a part of this team? What would you specifically be able to bring?', type: 'textarea', required: true, max: 2000 },
  { id: 'weakness', label: 'What would you consider to be a weakness of yours?', type: 'textarea', required: true, max: 1000 }
]

const forms = {
  applicationMod: {
    title: 'Mod Team (Scouts)',
    category: 'applicationMod',
    fields: [
      ...shared,
      {
        id: 'areas',
        label: 'Which of these do you feel most comfortable helping out with?',
        hint: 'Pick as many as you like. Please answer honestly and be realistic about your limits. You do not need to pick every category.',
        type: 'checks',
        required: true,
        options: [
          'Communications/PR (making server announcements, greeting and directing members)',
          'In-Game Moderators (monitoring in-game chats and in-game events)',
          'Tech Support (game help, setup, directing and compiling bug reports and game suggestions)',
          'VC Moderators (monitoring voice chats, mitigating live conflicts)',
          'General Moderation (moderating general channels, specific sharing channels, 18+ chat, in-game conduct)'
        ]
      },
      areaNotes,
      { id: 'modExperience', label: 'What sort of experience do you have with moderating Discord servers? Do you have experience moderating large servers?', type: 'textarea', required: true, max: 2000 },
      { id: 'botExperience', label: 'Do you have experience using Discord bots?', hint: 'If not, that\'s okay, we can help you!', type: 'textarea', required: true, max: 1000 },
      {
        id: 'scenarioConflict',
        group: 'Moderation scenarios',
        groupHint: 'Please answer these how you would in the moment as part of the moderation team.',
        label: 'Two members break out into a conflict in the general chat. Neither of them have broken any rules, but it\'s gotten heated. How do you handle it?',
        type: 'textarea',
        required: true,
        max: 2000
      },
      { id: 'scenarioCrash', label: 'A new game release in the test server is causing a mass-server crash. People are blowing up the chat with complaints about not being able to access the game. What do you do to manage the chat?', type: 'textarea', required: true, max: 2000 },
      { id: 'scenarioScreenshots', label: 'Someone posts in-game screenshots regarding another user in a public chat and demands they be banned immediately. How do you mitigate the conflict and prevent the chat from dogpiling the person in question?', type: 'textarea', required: true, max: 2000 }
    ]
  },
  applicationCode: {
    title: 'Code Team',
    category: 'applicationCode',
    fields: [
      ...shared,
      {
        id: 'areas',
        label: 'Which of these do you feel most comfortable helping out with?',
        hint: 'Pick as many as you like. Please answer honestly and be realistic about your limits. You do not need to pick every category.',
        type: 'checks',
        required: true,
        options: [
          'Team Members (Game Development)',
          'Programming (creating and modifying backend server code)',
          'Data Entry (inputting item numbers for shops, clothing items, and furniture items)',
          'In-Game Moderators (monitoring in-game chats and in-game events)',
          'Tech Support (game help, setup, directing and compiling bug reports and game suggestions)'
        ]
      },
      areaNotes
    ]
  }
}

// shown at the top of the staff ticket, so a reviewer doesn't have to open the whole thing
const summaryFields = ['discord', 'age', 'timeZone', 'days', 'times', 'hours', 'areas']

function formFor (key) {
  return Object.prototype.hasOwnProperty.call(forms, key) ? forms[key] : null
}

// what the page needs to draw a form, which is everything but nothing it has no use for
function publicForms () {
  return Object.fromEntries(Object.entries(forms).map(([key, form]) => [key, { title: form.title, fields: form.fields }]))
}

// returns { errors } or { answers }, answers keyed by field id with text values only
function checkAnswers (form, raw) {
  const errors = {}
  const answers = {}
  const given = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}

  for (const field of form.fields) {
    const value = given[field.id]

    if (field.type === 'checks') {
      const picked = Array.isArray(value) ? value.map(String).filter(option => field.options.includes(option)) : []
      if (field.required && !picked.length) errors[field.id] = 'Please pick at least one.'
      else if (picked.length) answers[field.id] = [...new Set(picked)].join('\n')
      continue
    }

    const text = String(value == null ? '' : value).trim()

    if (!text) {
      if (field.required) errors[field.id] = 'Please answer this one.'
      continue
    }

    if (field.type === 'number') {
      const number = /^\d{1,3}$/.test(text) ? Number(text) : NaN
      if (!Number.isInteger(number) || number < 1 || number > MAX_AGE) errors[field.id] = 'Please enter a whole number.'
      else answers[field.id] = String(number)
      continue
    }

    if (field.type === 'choice') {
      if (!field.options.includes(text)) errors[field.id] = 'Please pick one.'
      else answers[field.id] = text
      continue
    }

    if (text.length > field.max) errors[field.id] = `Please keep this to ${field.max} characters.`
    else answers[field.id] = text
  }

  return Object.keys(errors).length ? { errors } : { answers }
}

// the first message of the ticket, every question with its answer
function composeBody (form, answers) {
  const parts = [`${form.title} application`]

  for (const field of form.fields) {
    parts.push(`${field.label}\n${answers[field.id] || '(no answer)'}`)
  }

  return parts.join('\n\n')
}

function summaryOf (answers) {
  const details = {}
  for (const id of summaryFields) {
    if (answers[id]) details[id] = answers[id].slice(0, 2000)
  }
  return details
}

module.exports = { MIN_AGE, formFor, publicForms, checkAnswers, composeBody, summaryOf, categories: { applicationMod: 'Application: Mod Team', applicationCode: 'Application: Code Team' } }
