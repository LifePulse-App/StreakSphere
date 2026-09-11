import User from "../models/UserSchema.js";
import catchAsyncErrors from "../utils/catchAsyncErrors.js";
import Mood from "../models/MoodSchema.js";
import { sendToUser } from '../helpers/broadcastService.js';
import { TEMPLATES } from '../utils/notificationTemplates.js';
import { log } from "console";
import MoodSchema from "../models/MoodSchema.js";

/**
 * Helpers
 */
const isFriend = (user, otherId) => user.friends?.some(f => String(f.user) === String(otherId));
const hasOutgoingReq = (user, otherId) => user.friendRequests?.some(r => String(r.user) === String(otherId));
const hasIncomingReq = (user, otherId) => user.incomingFriendRequests?.some(r => String(r.user) === String(otherId));

/**
 * Send a friend request (current user -> target)
 */
export const sendFriendRequest = catchAsyncErrors(async (req, res) => {
  const currentUserId = req.user.id;
  const { targetUserId } = req.params;
  
  if (currentUserId === targetUserId) {
    return res.status(400).json({ message: "Cannot friend yourself" });
  }

  const me = await User.findById(currentUserId);
  const them = await User.findById(targetUserId);
  if (!them) return res.status(404).json({ message: "User not found" });

  // 1. Check if you are already friends
  if (isFriend(me, targetUserId)) {
    return res.json({ message: "Already friends", isFriend: true, isPremium: me.isPremium });
  }

  // 2. Check if THEY already sent ME a request (My Add acts as an Accept)
  const theySentMeReq = me.friendRequests?.some(r => String(r.user) === targetUserId);
  if (theySentMeReq) {
    me.friendRequests = me.friendRequests.filter(r => String(r.user) !== targetUserId);
    me.markModified('friendRequests'); // Force mongoose to save array change
    
    me.friends.push({ user: targetUserId });
    them.friends.push({ user: currentUserId });
    
    await me.save();
    await them.save();
    return res.json({ message: "Request accepted; you are now friends!", isFriend: true, isPremium: me.isPremium });
  }

  // 3. Check if I already sent THEM a request (Prevents duplicate click auto-adding)
  const iSentThemReq = them.friendRequests?.some(r => String(r.user) === currentUserId);
  if (iSentThemReq) {
    return res.json({ message: "Request already sent", requestSent: true, isPremium: me.isPremium });
  }

  // 4. Safely send the request
  them.friendRequests.push({ user: currentUserId, requestedAt: new Date() });
  await them.save();
  
  await sendToUser(targetUserId, {
    ...TEMPLATES.FRIEND_REQUEST_SENT(me.name),
    extra: {
      fromUserId: String(req.user._id),
      fromName: String(me.name),
    },
  });
  
  return res.json({ message: "Friend request sent", requestSent: true, isPremium: me.isPremium });
});

/**
 * Accept a friend request
 */
export const acceptFriendRequest = catchAsyncErrors(async (req, res) => {
const currentUserId = req.user.id;
  const { requesterId } = req.params;

  const me = await User.findById(currentUserId);
  const them = await User.findById(requesterId);
  if (!them) return res.status(404).json({ message: "User not found" });

  const hadRequest = hasOutgoingReq(me, requesterId);
  if (!hadRequest) return res.json({ message: "No request found", isPremium: me.isPremium });

  // ⚡ FIX: Filter the array and explicitly mark it as modified
  me.friendRequests = me.friendRequests.filter(r => String(r.user) !== requesterId);
  me.markModified('friendRequests'); 
  
  if (!isFriend(me, requesterId)) me.friends.push({ user: requesterId });
  if (!isFriend(them, currentUserId)) them.friends.push({ user: currentUserId });

  await me.save();
  await them.save();
  await sendToUser(requesterId, {
    ...TEMPLATES.FRIEND_REQUEST_ACCEPTED(me.name),
    extra: {
      fromUserId: String(req.user._id),
      fromName: String(me.name),
    },
  });
  return res.json({ message: "Request accepted", isFriend: true, isPremium: me.isPremium });
});

/**
 * Remove/cancel a pending friend request
 */
export const removeFriendRequest = catchAsyncErrors(async (req, res) => {
  const currentUserId = req.user.id;
  const { requesterId } = req.params; 

  const me = await User.findById(currentUserId);
  const them = await User.findById(requesterId);

  if (!me || !them) return res.status(404).json({ message: "User not found" });

  let modified = false;

  const initialMeCount = me.friendRequests.length;
  me.friendRequests = me.friendRequests.filter(r => String(r.user) !== requesterId);
  if (me.friendRequests.length < initialMeCount) {
    await me.save();
    modified = true;
  }

  const initialThemCount = them.friendRequests.length;
  them.friendRequests = them.friendRequests.filter(r => String(r.user) !== currentUserId);
  if (them.friendRequests.length < initialThemCount) {
    await them.save();
    modified = true;
  }

  if (modified) return res.json({ message: "Request removed successfully", isPremium: me.isPremium });
  return res.json({ message: "No request found", isPremium: me.isPremium });
});

/**
 * Unfriend
 */
export const unfriend = catchAsyncErrors(async (req, res) => {
  const currentUserId = req.user.id;
  const { userId } = req.params;

  const me = await User.findById(currentUserId);
  const them = await User.findById(userId);
  if (!me || !them) return res.status(404).json({ message: "User not found" });

  const beforeMe = me.friends.length;
  const beforeThem = them.friends.length;

  // Remove friends
  me.friends = me.friends.filter(f => String(f.user) !== userId);
  them.friends = them.friends.filter(f => String(f.user) !== currentUserId);

  // ⚡ NEW: If they were partners, unfriend ends the relationship permanently
  if (String(me.partner) === userId) {
    const now = new Date();
    me.relationshipHistory.push({
      partnerId: them._id,
      partnerName: them.name,
      startedAt: me.partnerSince,
      endedAt: now,
    });
    them.relationshipHistory.push({
      partnerId: me._id,
      partnerName: me.name,
      startedAt: them.partnerSince,
      endedAt: now,
    });

    me.partner = null;
    me.partnerSince = null;
    me.partnerGracePeriodEnd = null;
    them.partner = null;
    them.partnerSince = null;
    them.partnerGracePeriodEnd = null;
  }

  await me.save();
  await them.save();

  const changed = me.friends.length !== beforeMe || them.friends.length !== beforeThem;
  return res.json({ message: changed ? "Unfriended and connections removed" : "Not friends", isFriend: false, isPremium: me.isPremium });
});

export const friendStatus = catchAsyncErrors(async (req, res) => {
  const { userId } = req.params; 
  const currentUserId = req.user.id;
  const user = await User.findById(userId).select("friendRequests friends");
  if (!user) return res.status(404).json({ message: "User not found" });

  const isFriendFlag = isFriend(user, currentUserId);
  const hasRequestSent = user.friendRequests?.some(r => String(r.user) === currentUserId);
  const me = await User.findById(currentUserId).select("friendRequests isPremium");
  const hasIncoming = me?.friendRequests?.some(r => String(r.user) === userId);

  res.json({ isFriend: isFriendFlag, requestSent: hasRequestSent, requestIncoming: hasIncoming, isPremium: me?.isPremium });
});

export const listFriends = catchAsyncErrors(async (req, res) => {
  const currentUserId = req.user.id;
  
  const me = await User.findById(currentUserId)
    .populate("friends.user", "name username avatarUrl isPremium premiumPreferences tick avatarVersion") 
    .lean();
    
  if (!me) return res.status(404).json({ message: "User not found" });

  // 1. Get an array of just the friend IDs
  const friendIds = (me.friends || [])
    .filter(f => f.user)
    .map(f => f.user._id);

  // 2. Fetch all ACTIVE moods for these friends (sorted by newest first)
  const activeMoods = await MoodSchema.find({
    user: { $in: friendIds },
    expiresAt: { $gt: new Date() }
  })
    .sort({ createdAt: -1 })
    .lean();

  // 3. Create a quick lookup map for the newest mood per user
  const moodMap = {};
  for (const m of activeMoods) {
    // Because it's sorted by newest, the first one we process is the latest mood
    if (!moodMap[m.user]) {
      moodMap[m.user] = m.mood;
    }
  }

  // 4. Map the friends array and attach the mood
  const friends = (me.friends || [])
    .filter(f => f.user)
    .map(f => {
      // Safely calculate badge visibility based on preference
      const showBadge = f.user.isPremium && f.user.premiumPreferences?.premiumBadge !== false;
      
      return {
        _id: f.user._id,
        name: f.user.name,
        username: f.user.username,
        avatarUrl: f.user.avatarUrl,
        avatarVersion: f.user.avatarVersion, // Ensure frontend caching works flawlessly
        isPremium: showBadge, 
        showPremiumBadge: showBadge,
        tick: f.user.tick,
        since: f.since,
        mood: moodMap[f.user._id] || null, // ⚡ Attach the active mood here!
      };
    });

  res.json({ friends, isPremium: me.isPremium });
});

export const pendingFriendRequests = catchAsyncErrors(async (req, res) => {
  const currentUserId = req.user.id;
  const me = await User.findById(currentUserId)
    .populate("friendRequests.user", "name username avatarUrl isPremium premiumPreferences tick") // ⚡ Fetch premium preferences
    .lean();
  if (!me) return res.status(404).json({ message: "User not found" });

  res.json({
    requests: (me.friendRequests || [])
      .filter(r => !me.friends.some(f => String(f.user) === String(r.user?._id)))
      .map(r => {
        // ⚡ Safely calculate badge visibility based on preference
        const showBadge = r.user?.isPremium && r.user?.premiumPreferences?.premiumBadge !== false;
        return {
          _id: r.user?._id,
          name: r.user?.name,
          username: r.user?.username,
          avatar: r.user?.avatarUrl,
          isPremium: showBadge,
          showPremiumBadge: showBadge,
          tick: r.user?.tick,
          requestedAt: r.requestedAt,
        };
      }),
    isPremium: me.isPremium,
  });
});

export const searchUsers = catchAsyncErrors(async (req, res) => {
  const { q } = req.query;
  const currentUserId = req.user._id;

  if (!q) return res.status(200).json({ user: [], filteredUsersCount: 0, isPremium: req.user.isPremium });

  const me = await User.findById(currentUserId)
    .select("friendRequests friends blockedUsers blockedBy isPremium")
    .lean();
    
  if (!me) return res.status(404).json({ message: "User not found" });

  const blockedIds = [...(me.blockedUsers || []), ...(me.blockedBy || [])].map(String);
  const searchRegex = new RegExp(q, "i");
  
  let users = await User.find({
    accountStatus: 'active',
    _id: { 
      $ne: currentUserId,
      $nin: blockedIds
    },
    $or: [{ username: searchRegex }, { name: searchRegex }],
  })
    .select("name username avatarUrl friendRequests friends isPremium premiumPreferences tick") // ⚡ Fetch premium preferences
    .lean();

  users = users.map(u => {
    const friend = isFriend(u, currentUserId);
    const requestSent = u.friendRequests?.some(r => String(r.user) === String(currentUserId));
    const incoming = me?.friendRequests?.some(r => String(r.user) === String(u._id));
    
    // ⚡ Safely calculate badge visibility based on preference
    const showBadge = u.isPremium && u.premiumPreferences?.premiumBadge !== false;
    
    return {
      _id: u._id,
      name: u.name,
      username: u.username,
      avatar: u.avatarUrl,
      isPremium: showBadge,
      showPremiumBadge: showBadge,
      tick: u.tick,
      isFriend: friend,
      requestSent,
      requestIncoming: incoming,
    };
  });

  res.status(200).json({ user: users, filteredUsersCount: users.length, isPremium: me.isPremium });
});

export const suggestedFriends = catchAsyncErrors(async (req, res) => {
  const currentUserId = req.user._id;
  
  // ⚡ 1. Extract pagination params from the query (Default: Page 1, Limit 10)
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const me = await User.findById(currentUserId)
    .select("friendRequests friends blockedUsers blockedBy isPremium")
    .lean();
    
  if (!me) return res.status(404).json({ message: "User not found" });

  const blockedIds = [...(me.blockedUsers || []), ...(me.blockedBy || [])].map(String);
  const excludeIds = [
    String(currentUserId), 
    ...(me.friends || []).map(f => String(f.user)),
    ...blockedIds
  ];

  // ⚡ 2. Count total available users to determine if there are more pages
  const totalUsers = await User.countDocuments({ 
    accountStatus: 'active', 
    _id: { $nin: excludeIds } 
  });

  // ⚡ 3. Apply skip, limit, and a STABLE sort (Required for pagination)
  let users = await User.find({ accountStatus: 'active', _id: { $nin: excludeIds } })
    .select("name username avatarUrl friendRequests friends isPremium premiumPreferences tick") 
    .sort({ createdAt: -1 }) // Do not use random shuffle, it breaks pagination!
    .skip(skip)
    .limit(limit)
    .lean();

  users = users.map(u => {
    const friend = isFriend(u, currentUserId);
    const requestSent = u.friendRequests?.some(r => String(r.user) === String(currentUserId));
    const incoming = me?.friendRequests?.some(r => String(r.user) === String(u._id));
    
    const showBadge = u.isPremium && u.premiumPreferences?.premiumBadge !== false;
    
    return {
      _id: u._id,
      name: u.name,
      username: u.username,
      avatar: u.avatarUrl,
      isPremium: showBadge,
      showPremiumBadge: showBadge,
      tick: u.tick,
      isFriend: friend,
      requestSent,
      requestIncoming: incoming,
    };
  });

  // ⚡ 4. Return hasMore flag alongside the suggestions
  res.status(200).json({ 
    suggestions: users, 
    hasMore: totalUsers > (skip + users.length), // Tells frontend if it should keep loading
    isPremium: me.isPremium 
  });
});

// ==========================================
// ⚡ RELATIONSHIP SYSTEM
// ==========================================

const checkAndCleanupGracePeriod = async (userDoc) => {
  const now = new Date();
  if (userDoc.partner && userDoc.partnerGracePeriodEnd && userDoc.partnerGracePeriodEnd < now) {
    const them = await User.findById(userDoc.partner);
    
    userDoc.relationshipHistory.push({
      partnerId: them ? them._id : userDoc.partner,
      partnerName: them ? them.name : "Unknown User",
      startedAt: userDoc.partnerSince,
      endedAt: userDoc.partnerGracePeriodEnd, 
    });
    userDoc.partner = null;
    userDoc.partnerSince = null;
    userDoc.partnerGracePeriodEnd = null;
    await userDoc.save();

    if (them) {
      them.relationshipHistory.push({
        partnerId: userDoc._id,
        partnerName: userDoc.name,
        startedAt: them.partnerSince,
        endedAt: userDoc.partnerGracePeriodEnd,
      });
      them.partner = null;
      them.partnerSince = null;
      them.partnerGracePeriodEnd = null;
      await them.save();
    }
    return true; 
  }
  return false; 
};

export const previewProfile = catchAsyncErrors(async (req, res) => {
  const currentUserId = req.user.id;
  const { userId } = req.params;

  let targetDoc = await User.findById(userId)
    .select("name username avatarUrl avatarVersion avatarThumbnailUrl level isPremium premiumPreferences currentTitle country city isPublic tick partner partnerSince partnerGracePeriodEnd blockedUsers")
    .lean();

  if (!targetDoc || targetDoc.accountStatus === 'suspended' || targetDoc.accountStatus === 'banned') {
    return res.status(404).json({ message: "User not found" });
  }

  const targetUserObj = await User.findById(userId);
  const wasCleanedUp = await checkAndCleanupGracePeriod(targetUserObj);
  if (wasCleanedUp) {
    targetDoc = await User.findById(userId)
       .select("name username avatarUrl avatarVersion avatarThumbnailUrl level isPremium premiumPreferences currentTitle country city isPublic tick partner partnerSince partnerGracePeriodEnd blockedUsers")
       .lean();
  }

  const me = await User.findById(currentUserId).select("friends friendRequests relationshipIncoming relationshipOutgoing partner isPremium blockedUsers").lean();

  const iBlockedThem = me?.blockedUsers?.map(String).includes(userId);
  const theyBlockedMe = targetDoc.blockedUsers?.map(String).includes(currentUserId);
  
  if (theyBlockedMe || iBlockedThem) {
    return res.json({
      user: {
        _id: targetDoc._id,
        name: iBlockedThem ? "Blocked User" : "User not found",
        username: "",
        avatarUrl: null, 
        isBlockedByMe: iBlockedThem,
        isBlockedByThem: theyBlockedMe, 
        isPremium: false,
        showPremiumBadge: false,
        relationshipHidden: true,
      },
      friendship: { isFriend: false, requestSent: false, requestIncoming: false },
      relationship: { isPartner: false, requestSent: false, requestIncoming: false, isSuspended: false },
      isPremium: me?.isPremium
    });
  }

  const isFriendFlag = me ? isFriend(me, userId) : false;
  const requestSent = await User.exists({ _id: userId, "friendRequests.user": currentUserId });
  const requestIncoming = me?.friendRequests?.some((r) => String(r.user) === String(userId));
  const canSeeLocation = targetDoc.isPublic === true || isFriendFlag;

  const now = new Date();
  const moodDoc = await Mood.findOne({ user: userId, expiresAt: { $gt: now } })
    .sort({ createdAt: -1 }).select("mood createdAt expiresAt").lean();

  const isPartner = targetDoc.partner && String(targetDoc.partner) === currentUserId;
  const relRequestSent = me?.relationshipOutgoing?.some(r => String(r.user) === userId);
  const relRequestIncoming = me?.relationshipIncoming?.some(r => String(r.user) === userId);

  let partnerData = null;
  let hideRel = false;
  let isSuspended = false;

  const targetWantsHidden = targetDoc.isPremium && targetDoc.premiumPreferences?.hideRelationship;

  if (targetDoc.partner) {
    const partnerDoc = await User.findById(targetDoc.partner).select("name isPremium premiumPreferences").lean();
    const partnerWantsHidden = partnerDoc?.isPremium && partnerDoc?.premiumPreferences?.hideRelationship;

    if ((targetWantsHidden || partnerWantsHidden) && !isPartner) {
      hideRel = true;
    }

    if (!hideRel && partnerDoc) {
      const msInDay = 24 * 60 * 60 * 1000;
      const diff = now.getTime() - new Date(targetDoc.partnerSince).getTime();
      
      partnerData = {
        _id: partnerDoc._id,
        name: partnerDoc.name,
        days: Math.floor(diff / msInDay),
        isSuspended: !!targetDoc.partnerGracePeriodEnd,
        gracePeriodEnd: targetDoc.partnerGracePeriodEnd || null
      };
    }
    
    isSuspended = !hideRel ? !!targetDoc.partnerGracePeriodEnd : false;
  } else {
    if (targetWantsHidden) hideRel = true;
  }

  const showBadge = targetDoc.isPremium && targetDoc.premiumPreferences?.premiumBadge !== false;

  res.json({
    user: {
      _id: targetDoc._id,
      name: targetDoc.name,
      username: targetDoc.username,
      avatarUrl: targetDoc.avatarUrl,
      avatarThumbnailUrl: targetDoc.avatarThumbnailUrl,
      level: targetDoc.level,
      title: targetDoc.currentTitle || "",
      country: canSeeLocation ? targetDoc.country || "" : "",
      city: canSeeLocation ? targetDoc.city || "" : "",
      mood: moodDoc?.mood || "",
      moodCreatedAt: moodDoc?.createdAt || null,
      moodExpiresAt: moodDoc?.expiresAt || null,
      tick: targetDoc?.tick,
      isPremium: targetDoc.isPremium, 
      showPremiumBadge: showBadge,    
      relationshipHidden: hideRel,
      isBlockedByMe: iBlockedThem, 
      isBlockedByThem: theyBlockedMe,
      isPublic: !!targetDoc.isPublic,
      canSeeLocation,
      partner: partnerData, 
    },
    friendship: {
      isFriend: isFriendFlag,
      requestSent: !!requestSent,
      requestIncoming: !!requestIncoming,
    },
    relationship: {
      isPartner: !!isPartner,
      requestSent: !!relRequestSent,
      requestIncoming: !!relRequestIncoming,
      isSuspended: isSuspended,
      gracePeriodEnd: !hideRel ? targetDoc.partnerGracePeriodEnd || null : null
    },
    isPremium: me?.isPremium
  });
});

/**
 * Send a relationship request
 */
export const sendRelationshipRequest = catchAsyncErrors(async (req, res) => {
  const currentUserId = req.user.id;
  const { targetUserId } = req.params;

  if (currentUserId === targetUserId) return res.status(400).json({ message: "Cannot date yourself" });

  const me = await User.findById(currentUserId);
  const them = await User.findById(targetUserId);

  if (!them) return res.status(404).json({ message: "User not found" });

  await checkAndCleanupGracePeriod(me);
  await checkAndCleanupGracePeriod(them);

  if (me.partner) return res.status(400).json({ message: "You are already in a relationship." });
  if (them.partner) return res.status(400).json({ message: "They are already in a relationship." });

  const alreadySent = me.relationshipOutgoing?.some(r => String(r.user) === targetUserId);
  if (alreadySent) return res.status(400).json({ message: "Request already sent." });

  const alreadyReceived = me.relationshipIncoming?.some(r => String(r.user) === targetUserId);
  if (alreadyReceived) return res.status(400).json({ message: "They already sent you a request. Please accept it." });

  if (!me.relationshipOutgoing) me.relationshipOutgoing = [];
  if (!them.relationshipIncoming) them.relationshipIncoming = [];

  me.relationshipOutgoing.push({ user: targetUserId });
  them.relationshipIncoming.push({ user: currentUserId });

  await me.save();
  await them.save();

  // ⚡ Send notification to target user
  await sendToUser(targetUserId, {
    ...TEMPLATES.RELATIONSHIP_REQUEST(me.name),
    extra: {
      fromUserId: String(me._id),
      fromName: me.name,
    },
  });

  return res.json({ message: "Relationship request sent!", requestSent: true, isPremium: me.isPremium });
});


/**
 * Accept a relationship request & Restore Streak for Premium Users
 */
export const acceptRelationshipRequest = catchAsyncErrors(async (req, res) => {
  const currentUserId = req.user.id;
  const { targetUserId } = req.params;

  const me = await User.findById(currentUserId);
  const them = await User.findById(targetUserId);

  if (!them) return res.status(404).json({ message: "User not found" });

  if (me.partner) return res.status(400).json({ message: "You already have a partner." });
  if (them.partner) return res.status(400).json({ message: "They already have a partner." });

  const hasIncoming = me.relationshipIncoming?.some(r => String(r.user) === targetUserId);
  if (!hasIncoming) return res.status(400).json({ message: "No incoming request from this user." });

  const now = new Date();
  let streakStartDate = now;

  // Check history
  const lastRelationship = me.relationshipHistory
    .slice()
    .reverse()
    .find(h => String(h.partnerId) === targetUserId);

  if (lastRelationship) {
    const hoursSinceBreakup = (now.getTime() - new Date(lastRelationship.endedAt).getTime()) / (1000 * 60 * 60);
    
    // Strict check: 36h only applies if the person taking the action (ME) is premium
    const allowedHours = me.isPremium ? 36 : 24;

    if (hoursSinceBreakup <= allowedHours) {
      streakStartDate = lastRelationship.startedAt;
      me.relationshipHistory = me.relationshipHistory.filter(h => String(h.partnerId) !== targetUserId);
      them.relationshipHistory = them.relationshipHistory.filter(h => String(h.partnerId) !== currentUserId);
    }
  }

  me.relationshipIncoming = [];
  me.relationshipOutgoing = [];
  me.partner = them._id;
  me.partnerSince = streakStartDate;
  me.partnerGracePeriodEnd = null;

  them.relationshipIncoming = [];
  them.relationshipOutgoing = [];
  them.partner = me._id;
  them.partnerSince = streakStartDate;
  them.partnerGracePeriodEnd = null;

  await me.save();
  await them.save();

  // ⚡ Notify the person whose request was accepted
  await sendToUser(targetUserId, {
    ...TEMPLATES.RELATIONSHIP_ACCEPTED(me.name),
    extra: {
      fromUserId: String(me._id),
      fromName: me.name,
    },
  });

  const isRestored = streakStartDate !== now;
  return res.json({ 
    message: isRestored 
      ? "Relationship started! Previous streak restored. (StreakSphere+ Benefit)" 
      : "Relationship started!", 
    success: true,
    isPremium: me.isPremium 
  });
});


/**
 * Suspend current partner or Instant Break-up for Premium Users
 */
export const removeRelationship = catchAsyncErrors(async (req, res) => {
  const currentUserId = req.user.id;
  const { instant } = req.body; 
  const me = await User.findById(currentUserId);

  if (!me.partner) return res.status(400).json({ message: "You are not in a relationship." });

  const them = await User.findById(me.partner);
  const now = new Date();

  if (me.isPremium && instant === true) {
    me.relationshipHistory.push({
      partnerId: them ? them._id : me.partner,
      partnerName: them ? them.name : "Unknown",
      startedAt: me.partnerSince,
      endedAt: now,
    });
    
    me.partner = null;
    me.partnerSince = null;
    me.partnerGracePeriodEnd = null;
    await me.save();

    if (them) {
      them.relationshipHistory.push({
        partnerId: me._id,
        partnerName: me.name,
        startedAt: them.partnerSince,
        endedAt: now,
      });
      them.partner = null;
      them.partnerSince = null;
      them.partnerGracePeriodEnd = null;
      await them.save();

      // ⚡ Notify partner of instant breakup
      await sendToUser(them._id, TEMPLATES.RELATIONSHIP_ENDED(me.name));
    }

    return res.json({ 
      message: "Relationship ended instantly. (StreakSphere+ Benefit)", 
      success: true,
      isPremium: me.isPremium 
    });
  } else {
    const hoursToWait = me.isPremium ? 36 : 24;
    const graceEnd = new Date(Date.now() + hoursToWait * 60 * 60 * 1000);
    
    me.partnerGracePeriodEnd = graceEnd;
    await me.save();

    if (them) {
      them.partnerGracePeriodEnd = graceEnd;
      await them.save();

      // ⚡ Notify partner of suspension
      await sendToUser(them._id, TEMPLATES.RELATIONSHIP_SUSPENDED(me.name));
    }

    return res.json({ 
      message: `Relationship suspended. You have ${hoursToWait} hours to restore it.`, 
      success: true,
      isPremium: me.isPremium 
    });
  }
});


/**
 * Restore relationship (Cancels the grace period)
 */
export const restoreRelationship = catchAsyncErrors(async (req, res) => {
  const currentUserId = req.user.id;
  const me = await User.findById(currentUserId);

  if (!me.partner) return res.status(400).json({ message: "No relationship to restore." });
  if (!me.partnerGracePeriodEnd) return res.status(400).json({ message: "Your relationship is already active." });

  const isExpired = await checkAndCleanupGracePeriod(me);
  if (isExpired) {
    return res.status(400).json({ message: "Grace period expired. Relationship lost permanently.", isPremium: me.isPremium });
  }

  const them = await User.findById(me.partner);

  me.partnerGracePeriodEnd = null;
  await me.save();

  if (them) {
    them.partnerGracePeriodEnd = null;
    await them.save();

    // ⚡ Notify partner of restoration
    await sendToUser(them._id, TEMPLATES.RELATIONSHIP_RESTORED(me.name));
  }

  return res.json({ message: "Relationship successfully restored!", success: true, isPremium: me.isPremium });
});

export const blockUser = catchAsyncErrors(async (req, res) => {
  const currentUserId = req.user.id;
  const { targetUserId } = req.params;

  if (currentUserId === targetUserId) {
    return res.status(400).json({ message: "Cannot block yourself." });
  }

  const me = await User.findById(currentUserId);
  const them = await User.findById(targetUserId);

  if (!them) return res.status(404).json({ message: "User not found" });

  if (!me.blockedUsers.includes(targetUserId)) me.blockedUsers.push(targetUserId);
  if (!them.blockedBy.includes(currentUserId)) them.blockedBy.push(currentUserId);

  me.friends = me.friends.filter(f => String(f.user) !== targetUserId);
  them.friends = them.friends.filter(f => String(f.user) !== currentUserId);
  me.friendRequests = me.friendRequests.filter(r => String(r.user) !== targetUserId);
  them.friendRequests = them.friendRequests.filter(r => String(r.user) !== currentUserId);

  me.followers = me.followers.filter(f => String(f.user) !== targetUserId);
  me.following = me.following.filter(f => String(f.user) !== targetUserId);
  them.followers = them.followers.filter(f => String(f.user) !== currentUserId);
  them.following = them.following.filter(f => String(f.user) !== currentUserId);

  me.relationshipIncoming = me.relationshipIncoming.filter(r => String(r.user) !== targetUserId);
  me.relationshipOutgoing = me.relationshipOutgoing.filter(r => String(r.user) !== targetUserId);
  them.relationshipIncoming = them.relationshipIncoming.filter(r => String(r.user) !== currentUserId);
  them.relationshipOutgoing = them.relationshipOutgoing.filter(r => String(r.user) !== currentUserId);

  if (String(me.partner) === targetUserId) {
    const now = new Date();
    me.relationshipHistory.push({
      partnerId: them._id,
      partnerName: them.name,
      startedAt: me.partnerSince,
      endedAt: now,
    });
    them.relationshipHistory.push({
      partnerId: me._id,
      partnerName: me.name,
      startedAt: them.partnerSince,
      endedAt: now,
    });

    me.partner = null;
    me.partnerSince = null;
    me.partnerGracePeriodEnd = null;
    them.partner = null;
    them.partnerSince = null;
    them.partnerGracePeriodEnd = null;
  }

  await me.save();
  await them.save();

  return res.json({ message: "User blocked successfully", success: true, isPremium: me.isPremium });
});

export const getBlockedUsers = catchAsyncErrors(async (req, res) => {
  const currentUserId = req.user._id;
  
  const me = await User.findById(currentUserId)
    .populate("blockedUsers", "name username avatarUrl avatarVersion tick isPremium")
    .lean();

  if (!me) return res.status(404).json({ message: "User not found" });

  res.status(200).json({ success: true, blockedUsers: me.blockedUsers || [], isPremium: me.isPremium });
});

export const unblockUser = catchAsyncErrors(async (req, res) => {
  const currentUserId = req.user._id;
  const { targetUserId } = req.params;

  const me = await User.findById(currentUserId);
  const them = await User.findById(targetUserId);

  if (!me || !them) return res.status(404).json({ message: "User not found" });

  me.blockedUsers = me.blockedUsers.filter(id => String(id) !== String(targetUserId));
  them.blockedBy = them.blockedBy.filter(id => String(id) !== String(currentUserId));

  await me.save();
  await them.save();

  return res.status(200).json({ message: "User unblocked successfully", success: true, isPremium: me.isPremium });
});

export const getMyRelationshipHistory = catchAsyncErrors(async (req, res, next) => {
  const user = await User.findById(req.user.id).select("relationshipHistory isPremium");
  if (!user) return next(new ErrorHandler("User not found", 404));

  const history = user.relationshipHistory.map(h => {
    const msInDay = 24 * 60 * 60 * 1000;
    const duration = Math.floor((new Date(h.endedAt) - new Date(h.startedAt)) / msInDay) || 0;
    return {
      _id: h._id,
      partnerId: h.partnerId,
      partnerName: h.partnerName,
      durationDays: duration,
      endDate: h.endedAt
    };
  }).reverse(); // Newest first

  res.status(200).json({ success: true, history });
});

export const getPartnerRelationshipHistory = catchAsyncErrors(async (req, res, next) => {
  const user = await User.findById(req.user.id).select("partner isPremium");
  if (!user) return next(new ErrorHandler("User not found", 404));

  if (!user.partner) {
    return res.status(200).json({ success: true, history: [] });
  }

  const partner = await User.findById(user.partner).select("relationshipHistory");
  if (!partner) return res.status(404).json({ success: false, message: "Partner not found" });

  const history = partner.relationshipHistory.map(h => {
    const msInDay = 24 * 60 * 60 * 1000;
    const duration = Math.floor((new Date(h.endedAt) - new Date(h.startedAt)) / msInDay) || 0;
    return {
      _id: h._id,
      partnerId: h.partnerId,
      partnerName: h.partnerName,
      durationDays: duration,
      endDate: h.endedAt
    };
  }).reverse();

  res.status(200).json({ success: true, history });
});