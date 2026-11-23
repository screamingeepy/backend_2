const axios = require('axios')

async function sendToDiscord (webhookUrl, { title, message, color = 0x8a6d30, fields = [] }) {
  if (!webhookUrl) {
    console.log(`[DiscordService] (not sent, no webhook configured) ${title}: ${message}`)
    return true
  }

  try {
    await axios.post(webhookUrl, {
      embeds: [{ title, description: message, color, fields }]
    })
    return true
  } catch (err) {
    console.error('[DiscordService] post failed:', err.message)
    return false
  }
}

// outbound discord notifications
async function notifyTicket ({ ticketId, subject, category, fromEmail, playerName, reportedName }) {
  const fields = [
    { name: 'Category', value: category || 'General Inquiry', inline: true },
    { name: 'Player', value: playerName || 'unknown', inline: true },
    { name: 'From', value: fromEmail || 'unknown', inline: true },
    { name: 'Ticket', value: String(ticketId), inline: true }
  ]
  if (reportedName) fields.push({ name: 'Reported', value: reportedName, inline: true })

  return sendToDiscord(process.env.TICKETS_WEBHOOK_URL, {
    title: 'New Support Ticket',
    message: subject,
    color: 0x60d4c4,
    fields
  })
}

module.exports = { sendToDiscord, notifyTicket }
