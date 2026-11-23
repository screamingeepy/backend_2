OTP_DO_ID_PLAYER_FRIENDS_MANAGER = 4687

STATESERVER_OBJECT_UPDATE_FIELD = 2004

INVRESP_ACCEPTED = 5
INVRESP_DECLINED = 1
INVRESP_ALREADYFRIEND = 4

MAX_FRIENDS = 300

FRIENDMANAGER_ACCOUNT_ONLINE  = 10000
FRIENDMANAGER_ACCOUNT_OFFLINE = 10001

GROUP_WHISPER_MASK = 8

ACCOUNT_SET_IGNORED = 20041
ACCOUNT_CHANNEL_OFFSET = 3 * 4294967296

DBSS_OBJECT_GET_ACTIVATED      = 2207
DBSS_OBJECT_GET_ACTIVATED_RESP = 2208

-- For declaring friends.
CLIENT_AGENT_DECLARE_OBJECT   = 3010
CLIENT_AGENT_UNDECLARE_OBJECT = 3011

-- Avatar class to declare.
AVATAR_CLASS = dcFile:getClassByName("DistributedFairyPlayer"):getNumber()

-- Load the configuration varables (see config.example.lua)
dofile("config.lua")

invitesByInviterId = {} -- inviterId: invite
invitesByInviteeId = {} -- inviteeId: invite

friendsByAccountId = {}

-- accountId -> the avatar it has in the game, only set while online
avatarIdByAccountId = {}

onlineAccounts = {}

function dedupeFriends(list)
    local seen = {}
    local out = {}
    for _, id in ipairs(list or {}) do
        if not seen[id] then
            seen[id] = true
            table.insert(out, id)
        end
    end
    return out
end

function containsFriend(list, friendId)
    for _, id in ipairs(list or {}) do
        if id == friendId then
            return true
        end
    end
    return false
end

function removeAllFriends(list, friendId)
    local removed = 0
    for i = #list, 1, -1 do
        if list[i] == friendId then
            table.remove(list, i)
            removed = removed + 1
        end
    end
    return removed
end

function removeCachedFriend(accountId, friendId)
    local cached = friendsByAccountId[accountId]
    if cached == nil then
        return
    end
    removeAllFriends(cached, friendId)
end

CONTEXT = 0
DBSS_QUERY_MAP = {}

-- Load the TalkFilter
dofile("TalkFilter.lua")

function init(participant)
    participant:subscribeChannel(OTP_DO_ID_PLAYER_FRIENDS_MANAGER)
end

function newInviteTable(inviterId, inviterName, inviteeId)
    return {
        inviterId = inviterId,
        inviterName = inviterName,
        inviteeId = inviteeId
    }
end

function clearInvite(invite)
    if invite == nil then
        return
    end
    if invitesByInviterId[invite.inviterId] == invite then
        invitesByInviterId[invite.inviterId] = nil
    end
    if invitesByInviteeId[invite.inviteeId] == invite then
        invitesByInviteeId[invite.inviteeId] = nil
    end
end

local http = require("http")

if PRODUCTION_ENABLED then
    API_BASE = "https://fairies.sunrise.games/fairies/api/internal/"
else
    API_BASE = "http://127.0.0.1/fairies/api/internal/"
end

-- TODO: These three functions should be moved to their own
-- Lua role.

function urlencode(str)
  if not str then
    return ""
  end
  str = string.gsub(str, "\n", "\r\n")
  str = string.gsub(str, "([^%w %-%_%.~])", function(c)
    return string.format("%%%02X", string.byte(c))
  end)
  str = string.gsub(str, " ", "+")
  return str
end

function retrieveFairy(participant, data)
    local connAttempts = 0

    while (connAttempts < 3) do
        local response, error_message = http.get(API_BASE .. "retrieveFairy", {
            query=data,
            headers={
                ["User-Agent"]=USER_AGENT,
                ["Authorization"]=API_TOKEN
            }
        })

        if error_message then
            participant:warn(string.format("retrieveFairy returned an error! \"%s\"", error_message))
            connAttempts = connAttempts + 1
            goto retry
        end

        if response.status_code ~= 200 then
            participant:warn(string.format("retrieveFairy returned %d!, \"%s\"", response.status_code, response.body))
            connAttempts = connAttempts + 1
            goto retry
        end

        do
            -- If we're here, then we can return the response body.
            return response.body
        end

        -- retry goto to iterate again if we failed to retrieve our fairy data.
        ::retry::
    end

    participant:error(string.format("retrieveFairy gave up after 3 attempts (%s)", tostring(data)))
    return nil
end

function setFairyData(participant, fairyId, data)
    local request = {fairyId = fairyId, fieldData = data}
    local json = require("json")
    local result, err = json.encode(request)

    if err then
        participant:error(string.format("setFairyData - %d: failed to encode JSON (%s)", fairyId, tostring(err)))
        return nil
    end

    local connAttempts = 0
    while (connAttempts < 3) do
        local response, error_message = http.post(API_BASE .. "setFairyData", {
            body=result,
            headers={
                ["Authorization"]=API_TOKEN,
                ["User-Agent"]=USER_AGENT,
                ["Content-Type"]="application/json"
            }
        })

        if error_message then
            participant:warn(string.format("setFairyData - %d returned an error! \"%s\"", fairyId, error_message))
            connAttempts = connAttempts + 1
            goto retry
        end

        if response.status_code ~= 200 then
            participant:warn(string.format("setFairyData - %d returned %d!, \"%s\"", fairyId, response.status_code, response.body))
            connAttempts = connAttempts + 1
            goto retry
        end

        do
            -- If we're here, then we can return the response.
            return response
        end

        -- retry goto to iterate again if we failed to set our fairy data.
        ::retry::
    end

    participant:error(string.format("setFairyData - %d gave up after 3 attempts; this write was LOST", fairyId))
    return nil
end

-- an account id alone doesn't say which of its fairies, online it's the avatar in the game
-- offline web-api resolves it to the fairy the account chose
function lookupIdFor(accountId)
    return avatarIdByAccountId[accountId] or accountId
end

function fetchAccount(participant, accountId)
    local body = retrieveFairy(participant, string.format("identifier=%d", lookupIdFor(accountId)))
    if body == nil then
        participant:warn(string.format("fetchAccount - %d: retrieveFairy failed", accountId))
        return nil
    end

    local json = require("json")
    local ok, account = pcall(json.decode, body)
    if not ok or type(account) ~= "table" then
        participant:warn(string.format("fetchAccount - %d: bad response \"%s\"", accountId, tostring(body)))
        return nil
    end

    account.friends = dedupeFriends(account.friends)
    return account
end

function fetchAccountSummaries(participant, accountIds)
    if #accountIds == 0 then
        return {}
    end

    local json = require("json")
    local body, err = json.encode({identifiers = accountIds})

    if err then
        participant:error(string.format("fetchAccountSummaries: failed to encode JSON (%s)", tostring(err)))
        return nil
    end

    local connAttempts = 0
    while (connAttempts < 3) do
        local response, error_message = http.post(API_BASE .. "retrieveFairies", {
            body=body,
            headers={
                ["Authorization"]=API_TOKEN,
                ["User-Agent"]=USER_AGENT,
                ["Content-Type"]="application/json"
            }
        })

        if error_message then
            participant:warn(string.format("retrieveFairies returned an error! \"%s\"", error_message))
            connAttempts = connAttempts + 1
            goto retry
        end

        if response.status_code ~= 200 then
            participant:warn(string.format("retrieveFairies returned %d!, \"%s\"", response.status_code, response.body))
            connAttempts = connAttempts + 1
            goto retry
        end

        do
            local ok, summaries = pcall(json.decode, response.body)
            if not ok or type(summaries) ~= "table" then
                participant:warn(string.format("retrieveFairies: bad response \"%s\"", tostring(response.body)))
                return nil
            end
            return summaries
        end

        ::retry::
    end

    participant:error(string.format("retrieveFairies gave up after 3 attempts (%d ids)", #accountIds))
    return nil
end

function makeFriendInfo(account, onlineYesNo)
    return {
        account.name,
        account._id,
        account.ownerAccount,
        onlineYesNo,
        0,
        0,
        0,
        "Fairies",
        "",
        0
    }
end

function declareFriend(participant, avatarId, friendId)
    -- Make sure that these are AVATAR ids, not ACCOUNT ids.
    local dg = datagram:new()
    participant:addServerHeaderWithAvatarId(dg, avatarId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER, CLIENT_AGENT_DECLARE_OBJECT)
    dg:addUint32(friendId)
    dg:addUint16(AVATAR_CLASS)
    participant:routeDatagram(dg)
end

function undeclareFriend(participant, avatarId, friendId)
    -- Make sure that these are AVATAR ids, not ACCOUNT ids.
    local dg = datagram:new()
    participant:addServerHeaderWithAvatarId(dg, avatarId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER, CLIENT_AGENT_UNDECLARE_OBJECT)
    dg:addUint32(friendId)
    participant:routeDatagram(dg)
end

function queryDBSS(participant, avatarId, callback)
    DBSS_QUERY_MAP[CONTEXT] = callback

    local dg = datagram:new()
    dg:addServerHeader(avatarId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER, DBSS_OBJECT_GET_ACTIVATED)
    dg:addUint32(CONTEXT)
    dg:addUint32(avatarId)
    participant:routeDatagram(dg)

    CONTEXT = CONTEXT + 1
end

function handleDatagram(participant, msgType, dgi)
    if msgType == STATESERVER_OBJECT_UPDATE_FIELD then
        if dgi:readUint32() == OTP_DO_ID_PLAYER_FRIENDS_MANAGER then
            participant:handleUpdateField(dgi, "FMPlayerFriendsManager")
        end
    elseif msgType == FRIENDMANAGER_ACCOUNT_ONLINE then
        local accountId = dgi:readUint32()
        handleOnline(participant, accountId, dgi:readUint32())
    elseif msgType == FRIENDMANAGER_ACCOUNT_OFFLINE then
        local accountId = dgi:readUint32()
        handleOffline(participant, accountId, dgi:readUint32())
    elseif msgType == DBSS_OBJECT_GET_ACTIVATED_RESP then
        local context = dgi:readUint32()
        local doId = dgi:readUint32()
        local activated = dgi:readBool()

        local callback = DBSS_QUERY_MAP[context]
        if callback ~= nil then
            callback(doId, activated)
            DBSS_QUERY_MAP[context] = nil
        else
            participant:warn(string.format("Got GET_ACTIVATED_RESP with unknown context: %d", context))
        end
    end
end

function sendFriendsList(participant, accountId, friends)
    -- online friends show as the fairy they're playing, the rest as the one their account chose
    local lookupIds = {}
    for i, friendId in ipairs(friends) do
        lookupIds[i] = lookupIdFor(friendId)
    end

    local summaries = fetchAccountSummaries(participant, lookupIds)

    if summaries == nil then
        participant:error(string.format(
            "sendFriendsList - %d: could not load friend summaries; panel will be empty this session", accountId))
        return
    end

    for i, friendId in ipairs(friends) do
        local friend = summaries[string.format("%d", lookupIds[i])]

        if friend == nil then
            participant:warn(string.format("sendFriendsList - %d: no fairy record for friend %d", accountId, friendId))
        else
            local dg = datagram:new()
            participant:addServerHeaderWithAccountId(dg, accountId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER, CLIENT_AGENT_DECLARE_OBJECT)
            dg:addUint32(friend._id)
            dg:addUint16(AVATAR_CLASS)
            participant:routeDatagram(dg)

            local onlineYesNo = onlineAccounts[friendId] and 1 or 0

            participant:sendUpdateToAccountId(accountId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
                "FMPlayerFriendsManager", "updatePlayerFriend",
                {friendId, makeFriendInfo(friend, onlineYesNo), 0})
        end
    end
end

function handleOnline(participant, accountId, avatarId)
    participant:debug(string.format("handleOnline - %d (avatar %d)", accountId, avatarId))

    local previousAvatarId = avatarIdByAccountId[accountId]
    local isNewLogin = not onlineAccounts[accountId]

    -- same account as a different fairy, the old one's offline hasn't been handled yet
    -- friends need telling like a fresh login and the cached list is the old fairy's
    local switchedFairy = previousAvatarId ~= nil and previousAvatarId ~= avatarId

    onlineAccounts[accountId] = true
    avatarIdByAccountId[accountId] = avatarId

    if isNewLogin or switchedFairy then
        friendsByAccountId[accountId] = nil
    end

    local friends = friendsByAccountId[accountId]
    local ignored = nil

    if friends ~= nil then
        participant:debug(string.format(
            "handleOnline - %d already online; transfer re-generate, resending panel from cache", accountId))
    else
        local account = fetchAccount(participant, accountId)
        if account == nil then
            participant:warn(string.format("handleOnline - %d: could not load account; panel not sent", accountId))
            return
        end

        friends = account.friends
        ignored = account.ignored

        friendsByAccountId[accountId] = friends

        if not (isNewLogin or switchedFairy) then
            participant:debug(string.format(
                "handleOnline - %d already online; transfer re-generate, cache missing so refetched", accountId))
        else
            local friendInfo = makeFriendInfo(account, 1)

            local sent = 0
            for _, friendId in ipairs(friends) do
                if onlineAccounts[friendId] then
                    participant:sendUpdateToAccountId(friendId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
                        "FMPlayerFriendsManager", "updatePlayerFriend", {accountId, friendInfo, 0})

                    local dg = datagram:new()
                    participant:addServerHeaderWithAccountId(dg, friendId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER, CLIENT_AGENT_DECLARE_OBJECT)
                    dg:addUint32(avatarId)
                    dg:addUint16(AVATAR_CLASS)
                    participant:routeDatagram(dg)
                    sent = sent + 1
                end
            end
            participant:debug(string.format(
                "handleOnline - %d announced to %d/%d friends online", accountId, sent, #friends))
        end
    end

    sendFriendsList(participant, accountId, friends)

    -- a transfer resends from the cache, and the client kept its list
    if ignored ~= nil then
        sendIgnoredList(participant, accountId, ignored)
    end
end

function handleOffline(participant, accountId, avatarId)
    participant:debug(string.format("handleOffline - %d (avatar %d)", accountId, avatarId))

    local currentAvatarId = avatarIdByAccountId[accountId]

    if currentAvatarId ~= nil and currentAvatarId ~= avatarId then
        -- an avatar the account has since swapped away from, the one in the game isn't leaving
        participant:debug(string.format(
            "handleOffline - %d: avatar %d is stale, avatar %d is in the game; ignoring",
            accountId, avatarId, currentAvatarId))
        return
    end

    -- nothing cached if this role restarted, remember it so fetchAccount finds the right fairy
    avatarIdByAccountId[accountId] = avatarId

    queryDBSS(participant, avatarId, function (doId, activated)
        if activated then
            participant:debug(string.format(
                "handleOffline - %d avatar %d still activated; treating as transfer, not logout",
                accountId, doId))
            return
        end

        if avatarIdByAccountId[accountId] ~= avatarId then
            -- logged in as another fairy while we were asking
            participant:debug(string.format(
                "handleOffline - %d avatar %d: account moved on to avatar %s while checking; ignoring",
                accountId, avatarId, tostring(avatarIdByAccountId[accountId])))
            return
        end

        participant:debug(string.format("handleOffline - %d confirmed logout", accountId))
        onlineAccounts[accountId] = nil

        local account = fetchAccount(participant, accountId)

        if account == nil then
            participant:warn(string.format(
                "handleOffline - %d: confirmed logout but could not load account; friends not notified", accountId))
        else
            local friendInfo = makeFriendInfo(account, 0)

            local sent = 0
            for _, friendId in ipairs(account.friends) do
                if onlineAccounts[friendId] then
                    participant:sendUpdateToAccountId(friendId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
                        "FMPlayerFriendsManager", "updatePlayerFriend", {accountId, friendInfo, 0})
                    sent = sent + 1
                end
            end
            participant:debug(string.format(
                "handleOffline - %d announced to %d/%d friends online", accountId, sent, #account.friends))
        end

        friendsByAccountId[accountId] = nil
        avatarIdByAccountId[accountId] = nil
    end)
end

function handleFMPlayerFriendsManager_requestInvite(participant, fieldId, data)
    local senderId = participant:getAccountIdFromSender()
    local otherPlayerId = data[2]
    local secretYesNo = data[3]
    participant:debug(string.format("requestInvite - %d - %d - %d", senderId, otherPlayerId, secretYesNo))

    if senderId == otherPlayerId then
        return
    end

    local pending = invitesByInviteeId[senderId]
    if pending ~= nil and pending.inviterId == otherPlayerId then
        makeFriends(participant, pending)
        return
    end

    local sender = fetchAccount(participant, senderId)
    if sender == nil then
        participant:warn(string.format("requestInvite - %d: could not load sender; dropping invite", senderId))
        return
    end

    if containsFriend(sender.friends, otherPlayerId) then
        participant:debug(string.format("requestInvite - %d - %d are already friends", senderId, otherPlayerId))
        participant:sendUpdateToAccountId(senderId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
                "FMPlayerFriendsManager", "invitationResponse", {otherPlayerId, INVRESP_ALREADYFRIEND, 0})
        return
    end

    clearInvite(invitesByInviterId[senderId])
    clearInvite(invitesByInviteeId[otherPlayerId])

    local invite = newInviteTable(senderId, sender.name, otherPlayerId)
    invitesByInviterId[senderId] = invite
    invitesByInviteeId[otherPlayerId] = invite

    participant:sendUpdateToAccountId(otherPlayerId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
            "FMPlayerFriendsManager", "invitationFrom", {senderId, invite.inviterName})
end

function handleFMPlayerFriendsManager_requestDecline(participant, fieldId, data)
    local senderId = participant:getAccountIdFromSender()
    local otherPlayerId = data[2]
    participant:debug(string.format("requestDecline - %d - %d", senderId, otherPlayerId))

    local invite = invitesByInviteeId[senderId]
    if invite == nil or invite.inviterId ~= otherPlayerId then
        invite = invitesByInviterId[senderId]
        if invite ~= nil and invite.inviteeId ~= otherPlayerId then
            invite = nil
        end
    end
    clearInvite(invite)

    participant:sendUpdateToAccountId(otherPlayerId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
            "FMPlayerFriendsManager", "invitationResponse", {senderId, INVRESP_DECLINED, 0})
end

function makeFriends(participant, invite)
    participant:debug(string.format("makeFriends - %d - %d", invite.inviterId, invite.inviteeId))

    clearInvite(invite)

    local inviter = fetchAccount(participant, invite.inviterId)
    local invitee = fetchAccount(participant, invite.inviteeId)

    if inviter == nil or invitee == nil then
        participant:warn(string.format("makeFriends - %d - %d: could not load both accounts; aborting",
            invite.inviterId, invite.inviteeId))
        participant:sendUpdateToAccountId(invite.inviterId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
                "FMPlayerFriendsManager", "invitationResponse", {invite.inviteeId, INVRESP_DECLINED, 0})
        return
    end

    local inviterHas = containsFriend(inviter.friends, invite.inviteeId)
    local inviteeHas = containsFriend(invitee.friends, invite.inviterId)

    if inviterHas and inviteeHas then
        participant:debug(string.format("makeFriends - %d - %d are already friends", invite.inviterId, invite.inviteeId))
        participant:sendUpdateToAccountId(invite.inviterId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
                "FMPlayerFriendsManager", "updatePlayerFriend", {invite.inviteeId, makeFriendInfo(invitee, 1), 0})
        participant:sendUpdateToAccountId(invite.inviteeId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
                "FMPlayerFriendsManager", "updatePlayerFriend", {invite.inviterId, makeFriendInfo(inviter, 1), 0})
        participant:sendUpdateToAccountId(invite.inviterId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
                "FMPlayerFriendsManager", "invitationResponse", {invite.inviteeId, INVRESP_ALREADYFRIEND, 0})
        return
    end

    if (not inviterHas and #inviter.friends >= MAX_FRIENDS)
        or (not inviteeHas and #invitee.friends >= MAX_FRIENDS) then
        participant:debug(string.format("makeFriends - %d (%d friends) - %d (%d friends): list full",
            invite.inviterId, #inviter.friends, invite.inviteeId, #invitee.friends))
        participant:sendUpdateToAccountId(invite.inviterId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
                "FMPlayerFriendsManager", "invitationResponse", {invite.inviteeId, INVRESP_DECLINED, 0})
        return
    end

    if not inviterHas then
        table.insert(inviter.friends, invite.inviteeId)
        saveFriends(participant, invite.inviterId, inviter.friends)

        if friendsByAccountId[invite.inviterId] ~= nil then
            friendsByAccountId[invite.inviterId] = inviter.friends
        end
    end

    if not inviteeHas then
        table.insert(invitee.friends, invite.inviterId)
        saveFriends(participant, invite.inviteeId, invitee.friends)

        if friendsByAccountId[invite.inviteeId] ~= nil then
            friendsByAccountId[invite.inviteeId] = invitee.friends
        end
    end

    participant:sendUpdateToAccountId(invite.inviterId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
            "FMPlayerFriendsManager", "updatePlayerFriend", {invite.inviteeId, makeFriendInfo(invitee, 1), 0})
    participant:sendUpdateToAccountId(invite.inviteeId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
            "FMPlayerFriendsManager", "updatePlayerFriend", {invite.inviterId, makeFriendInfo(inviter, 1), 0})

    participant:sendUpdateToAccountId(invite.inviterId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
            "FMPlayerFriendsManager", "invitationResponse", {invite.inviteeId, INVRESP_ACCEPTED, 0})
end

function writeAccountChatViolationEvents(participant, accountId, otherAccountId, chatType, message, badPhrases, badCombos)
    if #badPhrases > 0 then
        participant:writeServerEvent("banned-phrase", "FMPlayerFriendsManager", OTP_DO_ID_PLAYER_FRIENDS_MANAGER, string.format("%d|%d|%s|%s|%s", accountId, otherAccountId, chatType, formatChatViolations(badPhrases), message))
    end

    if #badCombos > 0 then
        participant:writeServerEvent("banned-combo", "FMPlayerFriendsManager", OTP_DO_ID_PLAYER_FRIENDS_MANAGER, string.format("%d|%d|%s|%s|%s", accountId, otherAccountId, chatType, formatChatViolations(badCombos), message))
    end
end

function handleFMPlayerFriendsManager_setTalkAccount(participant, fieldId, data)
    local senderId = participant:getAccountIdFromSender()
    local otherAccountId = data[1]
    participant:debug(string.format("setTalkAccount - %d - %d", senderId, otherAccountId))

    local message = data[4] --chat

    if message == "" then
        return
    end

    local cleanMessage, modifications, badPhrases, badCombos = filterWhitelist(message, false)

    -- Log it for moderation purposes.
    participant:writeServerEvent("chat-message-whisper", "FMPlayerFriendsManager", OTP_DO_ID_PLAYER_FRIENDS_MANAGER, string.format("%d|%d|%s|%s", senderId, otherAccountId, message, cleanMessage))
    writeAccountChatViolationEvents(participant, senderId, otherAccountId, "whisper-account", message, badPhrases, badCombos)

    if #badCombos > 0 then
        return
    end

    participant:sendUpdateToAccountId(otherAccountId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
            "FMPlayerFriendsManager", "setTalkAccount", {otherAccountId, senderId, data[3], cleanMessage, modifications, 0})
end

function handleFMPlayerFriendsManager_setTalkAccountGroup(participant, fieldId, data)
    local senderId = participant:getAccountIdFromSender()
    local fromName = data[2]
    local message = data[3]
    participant:debug(string.format("setTalkAccountGroup - %d", senderId))

    if message == "" then
        return
    end

    local cleanMessage, modifications, badPhrases, badCombos = filterWhitelist(message, false)

    participant:writeServerEvent("chat-message-whisper-group", "FMPlayerFriendsManager", OTP_DO_ID_PLAYER_FRIENDS_MANAGER, string.format("%d|%s|%s", senderId, message, cleanMessage))
    writeAccountChatViolationEvents(participant, senderId, 0, "whisper-group", message, badPhrases, badCombos)

    if #badCombos > 0 then
        return
    end

    local friends = friendsByAccountId[senderId]
    if friends == nil then
        participant:warn(string.format("setTalkAccountGroup - %d not cached, falling back to retrieveFairy", senderId))
        local account = fetchAccount(participant, senderId)
        if account == nil then
            participant:warn(string.format("setTalkAccountGroup - %d could not be loaded; dropping message", senderId))
            return
        end
        friends = account.friends
    end

    local senderDislId = data[1]
    participant:sendUpdateToAccountId(senderId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
            "FMPlayerFriendsManager", "setTalkAccount", {senderDislId, senderDislId, fromName, cleanMessage, modifications, GROUP_WHISPER_MASK})

    local sent = 0
    local seen = {[senderId] = true}
    for _, friendId in ipairs(friends) do
        if onlineAccounts[friendId] and not seen[friendId] then
            seen[friendId] = true
            participant:sendUpdateToAccountId(friendId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
                    "FMPlayerFriendsManager", "setTalkAccount", {friendId, senderId, fromName, cleanMessage, modifications, GROUP_WHISPER_MASK})
            sent = sent + 1
        end
    end
    participant:debug(string.format("setTalkAccountGroup - %d fanned out to %d/%d friends online", senderId, sent, #friends))
end

-- friends and ignored belong to the account, so they go to the account routes and not onto one fairy
function postToAccount(participant, route, payload, what)
    local json = require("json")
    local body, err = json.encode(payload)

    if err then
        participant:error(string.format("%s: failed to encode JSON (%s)", what, tostring(err)))
        return false
    end

    for _ = 1, 3 do
        local response, error_message = http.post(API_BASE .. route, {
            body=body,
            headers={
                ["Authorization"]=API_TOKEN,
                ["User-Agent"]=USER_AGENT,
                ["Content-Type"]="application/json"
            }
        })

        if error_message then
            participant:warn(string.format("%s returned an error! \"%s\"", what, error_message))
        elseif response.status_code ~= 200 then
            participant:warn(string.format("%s returned %d!, \"%s\"", what, response.status_code, response.body))
        else
            return true
        end
    end

    participant:error(string.format("%s gave up after 3 attempts; this write was LOST", what))
    return false
end

function saveIgnore(participant, accountId, ignoreId)
    return postToAccount(participant, "addIgnore", {accountId = accountId, ignoreId = ignoreId},
        string.format("saveIgnore - %d ignoring %d", accountId, ignoreId))
end

function saveFriends(participant, accountId, friends)
    return postToAccount(participant, "setFriends", {accountId = accountId, friends = friends},
        string.format("saveFriends - %d", accountId))
end

function addIgnored(participant, ourData, accountId, ignoreId)
    local ignored = {}
    if type(ourData.ignored) == "table" then
        for _, id in pairs(ourData.ignored) do
            local number = tonumber(id)
            if number ~= nil and number ~= ignoreId then
                table.insert(ignored, number)
            end
        end
    end
    table.insert(ignored, ignoreId)

    saveIgnore(participant, accountId, ignoreId)
    pushIgnoredList(participant, accountId, ignored)

    participant:debug(string.format("requestRemove - %d now ignores %d", accountId, ignoreId))
end

-- the list the game server filters chat with
function pushIgnoredList(participant, accountId, ignored)
    local dg = datagram:new()
    dg:addServerHeader(ACCOUNT_CHANNEL_OFFSET + accountId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER, ACCOUNT_SET_IGNORED)
    dg:addUint16(#ignored)
    for _, id in ipairs(ignored) do
        dg:addUint32(id)
    end
    participant:routeDatagram(dg)
end

function ignoredIds(list)
    local ids = {}
    if type(list) == "table" then
        for _, id in pairs(list) do
            local number = tonumber(id)
            if number ~= nil then
                table.insert(ids, number)
            end
        end
    end
    return ids
end

-- the client has no message for unignoring, so it sends requestRemove with a sender of 0
function removeIgnored(participant, accountId, ignoreId)
    if not postToAccount(participant, "removeIgnore", {accountId = accountId, ignoreId = ignoreId},
            string.format("removeIgnored - %d unignoring %d", accountId, ignoreId)) then
        return
    end

    local account = fetchAccount(participant, accountId)
    if account == nil then
        participant:warn(string.format("removeIgnored - %d: could not reload the list; chat filter not refreshed", accountId))
        return
    end

    pushIgnoredList(participant, accountId, ignoredIds(account.ignored))
    participant:debug(string.format("requestRemove - %d no longer ignores %d", accountId, ignoreId))
end

-- the client has no message for its ignore list either, so each one rides in as a friend update marked 2
function sendIgnoredList(participant, accountId, ignored)
    local ids = ignoredIds(ignored)
    if #ids == 0 then
        return
    end

    local lookupIds = {}
    for i, id in ipairs(ids) do
        lookupIds[i] = lookupIdFor(id)
    end

    local summaries = fetchAccountSummaries(participant, lookupIds)
    if summaries == nil then
        participant:error(string.format(
            "sendIgnoredList - %d: could not load ignored summaries; ignore list will be empty this session", accountId))
        return
    end

    for i, id in ipairs(ids) do
        local summary = summaries[string.format("%d", lookupIds[i])]
        if summary ~= nil then
            participant:sendUpdateToAccountId(accountId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
                "FMPlayerFriendsManager", "updatePlayerFriend", {id, makeFriendInfo(summary, 0), 2})
        end
    end
end

function handleFMPlayerFriendsManager_requestRemove(participant, fieldId, data)
    local senderId = participant:getAccountIdFromSender()
    local otherAccountId = data[2]

    participant:debug(string.format("requestRemove - %d - %d", senderId, otherAccountId))

    if tonumber(data[1]) == 0 then
        removeIgnored(participant, senderId, otherAccountId)
        return
    end

    local ourData = fetchAccount(participant, senderId)
    local friendData = fetchAccount(participant, otherAccountId)

    if ourData == nil or friendData == nil then
        participant:warn(string.format("requestRemove - %d - %d: could not load both accounts; aborting",
            senderId, otherAccountId))
        return
    end

    local wasFriend = containsFriend(ourData.friends, otherAccountId)

    if removeAllFriends(ourData.friends, otherAccountId) > 0 then
        saveFriends(participant, senderId, ourData.friends)

        if friendsByAccountId[senderId] ~= nil then
            friendsByAccountId[senderId] = ourData.friends
        end
    end

    if tonumber(data[1]) == senderId and not wasFriend then
        addIgnored(participant, ourData, senderId, otherAccountId)
    end

    if removeAllFriends(friendData.friends, senderId) > 0 then
        saveFriends(participant, otherAccountId, friendData.friends)

        if friendsByAccountId[otherAccountId] ~= nil then
            friendsByAccountId[otherAccountId] = friendData.friends
        end
    end

    undeclareFriend(participant, ourData._id, friendData._id)
    undeclareFriend(participant, friendData._id, ourData._id)

    participant:sendUpdateToAccountId(senderId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
        "FMPlayerFriendsManager", "removePlayerFriend", {otherAccountId})
    participant:sendUpdateToAccountId(otherAccountId, OTP_DO_ID_PLAYER_FRIENDS_MANAGER,
        "FMPlayerFriendsManager", "removePlayerFriend", {senderId})
end
