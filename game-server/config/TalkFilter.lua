-- From https://stackoverflow.com/a/22831842
function string.starts(String,Start)
    return string.sub(String,1,string.len(Start))==Start
end

-- https://gist.github.com/VADemon/afb10dbb0d10d99aeb21449752da6285
function regexEscape(str)
    return string.gsub(str, "[%(%)%.%%%+%-%*%?%[%^%$%]]", "%%%1")
end

string.replace = function (str, this, that)
    return string.gsub(str, regexEscape(this), string.gsub(that, "%%", "%%%%")) -- only % needs to be escaped for 'that'
end

local function replaceModifiedText(str, modifications)
    local cleanMessage = str
    for _, modification in ipairs(modifications) do
        local length = modification[2] - modification[1] + 1
        cleanMessage = string.sub(cleanMessage, 0, modification[1]) .. string.rep("*", length) .. string.sub(cleanMessage, modification[1] + 1 + length)
    end
    return cleanMessage
end

WHITELIST = {}
function readWhitelist()
    local io = require("io")
    local f, err = io.open("../assets/localization/WhiteListEnglish_words.txt")
    assert(not err, err)
    for line in f:lines() do
        WHITELIST[line] = true
    end
end
readWhitelist()
print("TalkFilter: Successfully loaded whitelist.")

SPEEDCHAT = {}
function readChatPhrases()
    local io = require("io")
    local f, err = io.open("../assets/localization/SpeedChatEnglish_words.txt")
    assert(not err, err)
    for line in f:lines() do
        SPEEDCHAT[line] = true
    end
end
readChatPhrases()
print("TalkFilter: Successfully loaded SpeedChat phrases.")

-- Name generator prefix/suffix lists, used to allow mixed-and-matched
-- pixie names like "Bumblebee" (Bumble + bee) even if the combined
-- word isn't individually listed in the whitelist.
NAME_PREFIXES = {}
function readNamePrefixes()
    local io = require("io")
    local f, err = io.open("../assets/localization/NamePrefixes.txt")
    assert(not err, err)
    for line in f:lines() do
        NAME_PREFIXES[line] = true
    end
end
readNamePrefixes()
print("TalkFilter: Successfully loaded name prefixes.")

NAME_SUFFIXES = {}
function readNameSuffixes()
    local io = require("io")
    local f, err = io.open("../assets/localization/NameSuffixes.txt")
    assert(not err, err)
    for line in f:lines() do
        NAME_SUFFIXES[line] = true
    end
end
readNameSuffixes()
print("TalkFilter: Successfully loaded name suffixes.")


local function normalizeWord(word)
    return (string.gsub(string.lower(word), "[^%w]", ""))
end

local function stripPossessive(word)
    return string.match(word, "^(.+)'s$") or string.match(word, "^(.+s)'$")
end

local function splitIntoWords(phrase)
    local words = {}
    local wordCount = 0
    for word in string.gmatch(phrase, "%S+") do
        wordCount = wordCount + 1

        local normalizedWord = normalizeWord(word)
        if normalizedWord ~= "" then
            table.insert(words, normalizedWord)
        end
    end
    return words, wordCount
end

BAD_PHRASES = {}
BAD_PHRASE_MAX_WORDS = 0

local function registerBadPhrase(phrase)
    local words, wordCount = splitIntoWords(phrase)
    if #words == 0 then
        return
    end

    if #words == 1 and wordCount > 1 then
        return
    end

    BAD_PHRASES[table.concat(words, " ")] = true

    if #words > BAD_PHRASE_MAX_WORDS then
        BAD_PHRASE_MAX_WORDS = #words
    end
end

local function addBadPhrase(phrase)
    registerBadPhrase(phrase)
    if string.find(phrase, "-", 1, true) then
        registerBadPhrase(string.gsub(phrase, "%-", " "))
    end
end

function readBadPhrases()
    local io = require("io")
    local f, err = io.open("../game/otp/switchboard/bwdict/badphrases.txt")
    assert(not err, err)
    for line in f:lines() do
        for phrase in string.gmatch(line, "[^,]+") do
            addBadPhrase(phrase)
        end
    end
end
readBadPhrases()
print("TalkFilter: Successfully loaded banned phrases.")

function formatChatViolations(violations)
    return table.concat(violations, ", ")
end

BAD_COMBOS = {}

local function registerBadCombo(words)
    local combo = {
        words = words,
        name = table.concat(words, "+"),
    }

    local firstWord = words[1]
    if BAD_COMBOS[firstWord] == nil then
        BAD_COMBOS[firstWord] = {}
    end

    table.insert(BAD_COMBOS[firstWord], combo)
end

function readBadCombos()
    local io = require("io")
    local f, err = io.open("badcombos.txt")
    assert(not err, err)
    for line in f:lines() do
        if not string.find(line, "^%s*#") then
            local words = splitIntoWords(line)

            local uniqueWords = {}
            local alreadyListed = {}
            for _, word in ipairs(words) do
                if not alreadyListed[word] then
                    alreadyListed[word] = true
                    table.insert(uniqueWords, word)
                end
            end

            if #uniqueWords > 1 then
                registerBadCombo(uniqueWords)
            end
        end
    end
end
readBadCombos()
print("TalkFilter: Successfully loaded banned word combos.")

local function findBadCombos(words)
    local occurrences = {}
    for _, word in ipairs(words) do
        if word.normalized ~= "" then
            if occurrences[word.normalized] == nil then
                occurrences[word.normalized] = {}
            end
            table.insert(occurrences[word.normalized], word.index)
        end
    end

    local flagged = {}
    local matched = {}
    local alreadyMatched = {}

    for _, word in ipairs(words) do
        local candidates = BAD_COMBOS[word.normalized]
        if candidates ~= nil then
            for _, combo in ipairs(candidates) do
                if not alreadyMatched[combo.name] then
                    local complete = true
                    for _, comboWord in ipairs(combo.words) do
                        if occurrences[comboWord] == nil then
                            complete = false
                            break
                        end
                    end

                    if complete then
                        alreadyMatched[combo.name] = true
                        table.insert(matched, combo.name)

                        for _, comboWord in ipairs(combo.words) do
                            for _, index in ipairs(occurrences[comboWord]) do
                                flagged[index] = true
                            end
                        end
                    end
                end
            end
        end
    end

    return flagged, matched
end

local function findBadPhrases(words)
    local indices = {}
    for index, word in ipairs(words) do
        if word.normalized ~= "" then
            table.insert(indices, index)
        end
    end

    local flagged = {}
    local matched = {}
    local alreadyMatched = {}

    for start = 1, #indices do
        local phrase = words[indices[start]].normalized
        local last = start + BAD_PHRASE_MAX_WORDS - 1
        if last > #indices then
            last = #indices
        end

        for position = start, last do
            if position > start then
                phrase = phrase .. " " .. words[indices[position]].normalized
            end

            if BAD_PHRASES[phrase] then
                for i = start, position do
                    flagged[indices[i]] = true
                end

                if not alreadyMatched[phrase] then
                    alreadyMatched[phrase] = true
                    table.insert(matched, phrase)
                end
            end
        end
    end

    return flagged, matched
end

function isWordOnWhitelist(word)
    -- Test without stripping out the punctuations first
    if WHITELIST[string.lower(word)] then
        return true
    end
    -- Now try with puncutations stripped out
    local strippedWord = string.lower(string.gsub(word, "[.,?!]", ""))
    if WHITELIST[strippedWord] then
        return true
    end
    local baseWord = stripPossessive(strippedWord)
    return baseWord ~= nil and WHITELIST[baseWord] == true
end

-- Checks whether a word can be split into a known name prefix
-- followed by a known name suffix, e.g. "bumble" + "bee" = "bumblebee".
local function isPrefixSuffixName(word)
    local lowerWord = string.lower(word)
    local len = string.len(lowerWord)

    -- Try every possible split point. Require at least 1 character
    -- on each side.
    for splitPoint = 1, len - 1 do
        local left = string.sub(lowerWord, 1, splitPoint)
        local right = string.sub(lowerWord, splitPoint + 1)

        if NAME_PREFIXES[left] and NAME_SUFFIXES[right] then
            return true
        end
    end

    return false
end

function filterWhitelist(message, filterOverride)
    if SPEEDCHAT[message] then
        return message, {}, {}, {}
    end

    local modifications = {}
    local wordsToSub = {}

    if filterOverride then
        local cleanMessage = "*"
        table.insert(modifications, {0, 0})
        return cleanMessage, modifications, {}, {}
    end

    local function stripLeadingAndTrailingPunctuation(word, reversed)
        -- Disney just stripped punctuation from the start and end of the word. This allows words with punctuation to be in the whitelist.
        local pattern = "[.,?!]+"
        local strippedWord = word
        local matchStart, matchEnd = string.find(strippedWord, pattern)

        -- Strip leading characters.
        if matchStart == 1 then
            strippedWord = string.sub(strippedWord, matchEnd + 1)
        end

        -- We will reverse the word and call ourself again if we haven't already, to make checking for trailing characters easier.
        local reversedWord = string.reverse(strippedWord)

        if not reversed then
            return stripLeadingAndTrailingPunctuation(reversedWord, true)
        end

        -- Return the reversed word. This will actually be the normal word since we only get here in the reversed call.
        return reversedWord
    end

    local function isAllowedWord(word)
        return WHITELIST[word] == true or isPrefixSuffixName(word)
    end

    local function isWordOnWhitelist(word)
        local wordToFind = string.lower(word)

        if isAllowedWord(wordToFind) then
            return true
        end

        wordToFind = stripLeadingAndTrailingPunctuation(wordToFind, false)

        if isAllowedWord(wordToFind) then
            return true
        end

        local baseWord = stripPossessive(wordToFind)
        return baseWord ~= nil and isAllowedWord(baseWord)
    end

    local words = {}
    local searchStart = 1
    while true do
        local wordStart, wordEnd = string.find(message, "%S+", searchStart)
        if not wordStart then
            break
        end

        local word = string.sub(message, wordStart, wordEnd)
        table.insert(words, {
            word = word,
            normalized = normalizeWord(word),
            index = #words + 1,
            offset = wordStart - 1,
            length = wordEnd - wordStart + 1,
        })

        searchStart = wordEnd + 1
    end

    local badPhraseWords, badPhrases = findBadPhrases(words)
    local badComboWords, badCombos = findBadCombos(words)

    for index, word in ipairs(words) do
        if badPhraseWords[index] or badComboWords[index] or not isWordOnWhitelist(word.word) then
            table.insert(modifications, {word.offset, word.offset + word.length - 1})
            table.insert(wordsToSub, word.word)
        end
    end
    local cleanMessage = replaceModifiedText(message, modifications)

    return cleanMessage, modifications, badPhrases, badCombos
end
