import PushToken from '../models/PushToken.js';
import admin from '../firebaseAdmin.js';

// POST /api/push/register
export const registerPushToken = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { token, platform } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!token) {
      return res.status(400).json({ success: false, message: 'token is required' });
    }

    // detach from other users
    await PushToken.deleteMany({ token, userId: { $ne: userId } });

    const pushTokenDoc = await PushToken.findOneAndUpdate(
      { token },
      { $set: { userId, token, platform, lastSeenAt: new Date() } },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Push token registered successfully',
      data: {
        id: pushTokenDoc._id,
        userId: pushTokenDoc.userId,
        platform: pushTokenDoc.platform,
        token: pushTokenDoc.token,
        lastSeenAt: pushTokenDoc.lastSeenAt,
      },
    });
  } catch (err) {
    console.error('Error registering push token:', err);
    return res.status(500).json({ success: false, message: 'Failed to register push token' });
  }
};

// POST /api/push/unregister
export const unregisterPushToken = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { token, platform } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!token) {
      return res.status(400).json({ success: false, message: 'token is required' });
    }

    const result = await PushToken.deleteOne({ userId, token, platform });

    return res.status(200).json({
      success: true,
      message: 'Push token unregistered successfully',
      data: { deletedCount: result.deletedCount },
    });
  } catch (err) {
    console.error('Error unregistering push token:', err);
    return res.status(500).json({ success: false, message: 'Failed to unregister push token' });
  }
};
async function sendNotificationFCM(tokens, payload) {
  for (const t of tokens) {
    try {
      const isChat = payload?.type === 'chat';
      const isIOS = t.platform === 'ios';
      const isAndroid = t.platform === 'android';

      const message = {
        token: t.token,
        data: Object.fromEntries(
          Object.entries(payload || {}).map(([k, v]) => [k, String(v ?? '')])
        ),
      };

      // Android: high priority, NO notification key (your notifee handler shows it)
      if (isAndroid) {
        message.android = {
          priority: 'high',
        };
      }

      // iOS: still needs apns alert since notifee background handler
      // may not run on iOS for data-only messages
      if (isIOS) {
        message.apns = {
          payload: {
            aps: {
              alert: isChat ? {
                title: payload.peerName || 'Someone',
                body: payload.body || 'Sent you a message',
              } : undefined,
              sound: isChat ? 'default' : undefined,
              'mutable-content': 1,
              'content-available': 1,
            },
          },
          headers: {
            'apns-priority': '10',
          },
        };
      }

      await admin.messaging().send(message);
    } catch (err) {
      if (
        err.code === 'messaging/registration-token-not-registered' ||
        err.errorInfo?.code === 'messaging/registration-token-not-registered'
      ) {
        await PushToken.deleteOne({ token: t.token });
      } else {
        console.error('[push] Failed to send to token', t.token, err.code, err.message);
      }
    }
  }
}

/**
 * CHAT push
 */
// ⚡ FIX: Added conversationId parameter
// ⚡ FIX: Added avatarUrl and avatarVersion to the function arguments
export async function sendMsgNotification(
  toUserId, 
  fromUserId, 
  fromUsername, 
  messageId, 
  bodyText = 'Sent you a message', 
  conversationId,
  avatarUrl = '',       // <-- Add this
  avatarVersion = 1     // <-- Add this (optional but good for cache busting)
) {
  const tokens = await PushToken.find({
    userId: toUserId,
    platform: { $in: ['android', 'ios'] },
  }).lean();
  
  if (!tokens.length) return;

  await sendNotificationFCM(tokens, {
    type: 'chat',
    peerUserId: String(fromUserId),
    peerName: String(fromUsername || 'Someone'),
    username: String(fromUsername || 'Someone'),
    body: String(bodyText || 'Sent you a message'),
    messageId: String(messageId),
    conversationId: String(conversationId), 
    
    // ⚡ FIX: Attach avatar URL and version so the frontend can cache it
    avatarUrl: String(avatarUrl),
    avatarVersion: String(avatarVersion),
  });
}

/**
 * SEEN push
 */
export async function sendSeenNotification(toUserId, peerUserId) {
  const tokens = await PushToken.find({
    userId: toUserId,
    platform: { $in: ['android', 'ios'] },
  }).lean();
  if (!tokens.length) return;

  await sendNotificationFCM(tokens, {
    type: 'seen',
    peerUserId: String(peerUserId),
  });
}

/**
 * DELIVERED push
 */
export async function sendDeliveredNotification(toUserId, peerUserId, messageIds = []) {
  const tokens = await PushToken.find({
    userId: toUserId,
    platform: { $in: ['android', 'ios'] },
  }).lean();
  if (!tokens.length) return;

  await sendNotificationFCM(tokens, {
    type: 'delivered',
    peerUserId: String(peerUserId),
    messageIds: JSON.stringify((messageIds || []).map(String)),
  });
}

/**
 * ⚡ NEW: Send Like Notification
 */
export async function sendLikeNotification(toUserId, likerName, postId) {
  const tokens = await PushToken.find({ userId: toUserId, platform: { $in: ['android', 'ios'] } }).lean();
  if (!tokens.length) return;

  await sendNotificationFCM(tokens, {
    type: 'post_like',
    title: 'New Like ❤️',
    body: `${likerName} liked your post.`,
    postId: String(postId),
  });
}

/**
 * ⚡ NEW: Send Comment Notification
 */
export async function sendCommentNotification(toUserId, commenterName, postId, commentText) {
  const tokens = await PushToken.find({ userId: toUserId, platform: { $in: ['android', 'ios'] } }).lean();
  if (!tokens.length) return;

  await sendNotificationFCM(tokens, {
    type: 'post_comment',
    title: 'New Comment 💬',
    body: `${commenterName} commented on your post.`,
    postId: String(postId),
  });
}

/**
 * ⚡ NEW: Broadcast to Friends (Used for Posts and Moods)
 */
export async function sendFriendBroadcastNotification(friendIds, payload) {
  if (!friendIds || !friendIds.length) return;
  
  const tokens = await PushToken.find({ 
    userId: { $in: friendIds }, 
    platform: { $in: ['android', 'ios'] } 
  }).lean();
  
  if (!tokens.length) return;
  await sendNotificationFCM(tokens, payload);
}

/**
 * Notify portal OWNER(s) when a new join request is sent.
 * @param {ObjectId} portalCreatorId 
 * @param {String} portalName
 * @param {String} requesterName
 */
export async function sendPrivatePortalJoinRequestNotification(portalCreatorId, portalName, requesterName) {
  const tokens = await PushToken.find({
    userId: portalCreatorId,
    platform: { $in: ['android', 'ios'] },
  }).lean();
  if (!tokens.length) return;

  await sendNotificationFCM(tokens, {
    type: 'ar_private_portal_join_request',
    title: `Join Request for ${portalName}`,
    body: `${requesterName} requested to join your AR portal.`,
    portalName: portalName,
  });
}

/**
 * Notify applicant when their join request is accepted/rejected
 * @param {ObjectId} userId 
 * @param {String} portalName 
 * @param {Boolean} isApproved 
 */
export async function sendJoinRequestReviewedNotification(userId, portalName, isApproved = true) {
  const tokens = await PushToken.find({
    userId,
    platform: { $in: ['android', 'ios'] },
  }).lean();
  if (!tokens.length) return;

  await sendNotificationFCM(tokens, {
    type: 'ar_private_portal_join_reviewed',
    title: `Your join request for ${portalName}`,
    body: isApproved
      ? `You have been approved to join ${portalName}!`
      : `Your request to join ${portalName} was rejected.`,
    portalName: portalName,
    approved: String(isApproved),
  });
}