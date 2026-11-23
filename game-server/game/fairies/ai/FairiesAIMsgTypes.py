from game.otp.ai.AIMsgTypes import *
FairiesAIMsgName2Id = {
    # PlayerFriendsManager messages:
    'FRIENDMANAGER_ACCOUNT_ONLINE': 10000,
    'FRIENDMANAGER_ACCOUNT_OFFLINE': 10001,
    'FRIENDMANAGER_INVITE_RACE': 10002,
    'FRIENDMANAGER_INVITE_RESP': 10003,
    # ShardManager messages:
    'SHARDMANAGER_ONLINE': 20000,
    # RealmGuardian <-> district AI messages:
    'REALM_GENERATE_REQUEST': 20010,
    'REALM_GENERATE_RESPONSE': 20011,
    # Broadcast from the RealmGuardian asking every district AI to (re)announce
    # itself. Covers the case where a district came up before the uberdog was
    # listening and its startup SHARDMANAGER_ONLINE was dropped.
    'REALM_REGISTER_REQUEST': 20012,
    # A district AI tells the RealmGuardian that an avatar entered/left a home
    # realm (for occupancy-based teardown).
    'REALM_OCCUPANCY_UPDATE': 20013,
    # The RealmGuardian asks a district AI to delete an empty home realm.
    'REALM_DELETE_REQUEST': 20014,
    # A district AI tells the RealmGuardian that Post Office mail was just
    # written for an avatar, so the mailbox can be put out in that avatar's home
    # realm even if the realm is hosted by a different district AI.
    'REALM_MAIL_ARRIVED': 20015,
    # The RealmGuardian passes that on to the district AI hosting the realm.
    'REALM_MAIL_DELIVERED': 20016,
    # A district AI announces its current headcount to the whole cluster, so
    # other district AIs and the RealmGuardian can make capacity decisions
    # about a district they do not host. See RealmPopulation.py.
    'REALM_POPULATION_UPDATE': 20017,
    # The district AI hosting a home realm tells the RealmGuardian that the
    # owner's party started, changed (e.g. went public) or ended. The guardian
    # needs it to send the party decorations in homeTeleportResponse.
    'REALM_PARTY_UPDATE': 20018,
    # The RealmGuardian asks the district AI hosting a home realm to end its
    # party, because the owner has been away from home too long.
    'REALM_PARTY_END_REQUEST': 20019,
    # A district's DistributedFairyPlayerAI forwards a client's requestMatchMaker
    # to the WildernessGuardian on the uberdog.
    'WILDERNESS_MATCHMAKER_REQUEST': 20020,
    # The WildernessGuardian asks the leader's district AI to build a
    # DistributedWilderness instance; the district replies with the same id.
    'WILDERNESS_GENERATE_REQUEST': 20021,
    'WILDERNESS_GENERATE_RESPONSE': 20022,
    # The PetMgr uberdog has changed a fairy's Animal Friend in the database and
    # needs whichever district AI holds that avatar to re-push it. The pet's two
    # client-facing fields (setPetDNA, setPetDetail) live on the avatar object,
    # which only its AI can send on, but the messages that change them
    # (PetMgr.setPetState and friends) are clsend to the uberdog.
    'PET_STATE_CHANGED': 20030,
    'ACCOUNT_SET_MUTE': 20040,
    'ACCOUNT_SET_IGNORED': 20041}
FairiesAIMsgId2Names = invertDictLossless(FairiesAIMsgName2Id)
for name, value in list(FairiesAIMsgName2Id.items()):
    exec('%s = %s' % (name, value))

del name
del value
