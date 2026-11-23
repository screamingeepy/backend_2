CENTRAL_LOGGER_REQUEST = 15000
CENTRAL_LOGGER_REQUEST_RESP = 15001

SERVER_TYPE = 11 -- Pixie Hollow

local http = require("http")
local json = require("json")

-- APIDatabase.lua and FairyClient.lua both do this; this file did not, which
-- left API_TOKEN and PRODUCTION_ENABLED nil and every report unauthorised.
dofile("config.lua")

-- Where reports are filed. The GM portal is the destination that matters --
-- Discord is a convenience on top, and is skipped when no webhook is set.
local API_BASE
if PRODUCTION_ENABLED then
    API_BASE = "https://fairies.sunrise.games/fairies/api/internal/"
else
    API_BASE = "http://127.0.0.1/fairies/api/internal/"
end

local function fileReport(report)
    local response, errorMessage = http.post(API_BASE .. "report", {
        body = json.encode(report),
        headers = {
            ["User-Agent"] = USER_AGENT,
            ["Content-Type"] = "application/json",
            ["Authorization"] = API_TOKEN
        }
    })

    if errorMessage then
        return false, tostring(errorMessage)
    end

    if response == nil then
        return false, "no response"
    end

    if response.status_code ~= 200 then
        return false, string.format("HTTP %d: %s", response.status_code, tostring(response.body))
    end

    return true, nil
end

function sendToDiscord(hook, color, name, message, fields)
    local embed = {
          {
              ["color"] = color,
              ["title"] = "**".. name .."**",
              ["description"] = message,
              ["fields"] = fields
          }
      }

    http.post(hook, {
        body=json.encode({username = name, embeds = embed}),
        headers={
            ["Content-Type"]="application/json"
        }
    })
end

function init(participant)
    participant:subscribeChannel(CENTRAL_LOGGER_REQUEST)
end

function handleDatagram(participant, msgType, dgi)
    if msgType == CENTRAL_LOGGER_REQUEST then
        handleCentralLoggerRequest(participant, dgi)
    else
        participant:warn(string.format("Got unknown message type: %d", msgType))
    end
end

function handleCentralLoggerRequest(participant, dgi)
    -- Field order matches FairyClient.lua's handleClientCentralLogger_sendMessage.
    local webhookUrl = dgi:readString()
    local message = dgi:readString()
    local category = dgi:readString()
    local categoryCode = dgi:readString()
    local targetAvId = dgi:readUint32()
    local targetDISLId = dgi:readUint32()
    local reporterAvId = dgi:readUint32()
    local reporterDISLId = dgi:readUint32()
    local reporterName = dgi:readString()

    -- The portal first: this is the copy staff work from, and it is filed
    -- whether or not Discord is configured. Names are left to the API, which
    -- has the database; sending ids keeps this service out of that business.
    local ok, why = fileReport({
        message = message,
        category = category,
        categoryCode = categoryCode,
        targetAvId = targetAvId,
        targetDISLId = targetDISLId,
        reporterAvId = reporterAvId,
        reporterDISLId = reporterDISLId,
        reporterName = reporterName
    })

    if not ok then
        participant:warn(string.format("could not file report from %d: %s", reporterAvId, why))
    end

    if webhookUrl == nil or webhookUrl == "" then
        return
    end

    sendToDiscord(webhookUrl, 1127128, "Reports", "Someone is reporting to us!", {
        {
            name = "Message",
            value = message,
            inline = true
        },
        {
            name = "Category",
            value = category,
            inline = true
        },
        {
            name = "Target Avatar Id",
            value = targetAvId,
            inline = true
        },
        {
            name = "Sender",
            value = string.format("%s (%d)", reporterName, reporterAvId),
            inline = true
        },
        {
            name = "Server Type",
            value = SERVER_TYPE,
            inline = true
        }
    })
end
