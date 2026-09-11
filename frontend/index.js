import 'react-native-get-random-values';
import { Buffer } from 'buffer';

// Polyfills
if (!global.Buffer) global.Buffer = Buffer;

import 'react-native-gesture-handler';
import { AppRegistry, Platform, DeviceEventEmitter } from 'react-native';
// ⚡ FIX: Added AndroidVisibility to the import
import notifee, { EventType, AndroidImportance, AndroidCategory, AndroidVisibility, AndroidStyle } from '@notifee/react-native';

import { getApp } from '@react-native-firebase/app';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';

import App from './App';
import { name as appName } from './app.json';

import {
  markMessagesSeenLocally,
  markMessagesDeliveredLocally,
} from './src/screens/chat/services/ChatNotifications';

import { markDelivered, sendMessage } from './src/screens/chat/services/api_chat';
import { navigationRef } from './src/navigation/main/RootNavigation';
import { setSecretKey } from './src/auth/api-client/api_client';
import UserStorage from './src/auth/user/UserStorage';
import apiClient from './src/auth/api-client/api_client';
import { getAvatar } from './src/storage/AvatarManager';

/*
|--------------------------------------------------------------------------
| Notification Channels
|--------------------------------------------------------------------------
*/

// Chat channel
notifee.createChannel({
  id: 'default',
  name: 'Chat Notifications',
  importance: AndroidImportance.HIGH,
  sound: 'default',
  vibration: true,
});

// App notifications channel
notifee.createChannel({
  id: 'app_notifications',
  name: 'App Notifications',
  importance: AndroidImportance.HIGH,
  sound: 'default',
  vibration: true,
});

// ⚡ V2 FIX: Creating a BRAND NEW channel to force Android to respect the ringtone
notifee.createChannel({
  id: 'call_channel_v2',
  name: 'Incoming Calls',
  importance: AndroidImportance.HIGH,
  sound: 'ringtone', 
  vibration: true,
  vibrationPattern: [300, 1000, 300, 1000], 
});

/*
|--------------------------------------------------------------------------
| Helpers 
|--------------------------------------------------------------------------
*/

async function displayMessagingStyleNotification(data, fallback = {}) {
  const peerId = String(data.peerUserId || 'unknown');
  const peerName = data.username || data.peerName || fallback.title || 'Someone';
  const text = data.body || data.message || fallback.body || 'Sent you a message';
  
  // ⚡ 1. Extract avatar data from the backend push payload
  const senderAvatarUrl = data.avatarUrl || data.profileImage;
  const avatarVersion = data.avatarVersion || 1;

  // ⚡ 2. Download/Cache the avatar locally
  let localAvatarPath = undefined;
  if (senderAvatarUrl) {
    try {
      localAvatarPath = await getAvatar(peerId, senderAvatarUrl, avatarVersion);
    } catch (e) {
      console.log('Failed to cache avatar for notification:', e);
    }
  }

  const notificationId = `chat_messaging:${peerId}`; 

  // ⚡ 3. Add the cached file path to the sender's icon
  const sender = {
    name: peerName,
    id: peerId,
    ...(localAvatarPath ? { icon: localAvatarPath } : {}), 
  };

  const currentUser = {
    name: 'Me',
    id: 'me',
  };

  const displayed = await notifee.getDisplayedNotifications();
  const existingNotif = displayed.find(n => n.id === notificationId);

  let messages = [];

  if (
    existingNotif && 
    existingNotif.notification.android?.style?.type === AndroidStyle.MESSAGING
  ) {
    messages = existingNotif.notification.android.style.messages || [];
  }

  messages.push({
    text: text,
    timestamp: Date.now(),
    person: sender,
  });

  const notifData = { 
    type: 'chat', 
    peerUserId: peerId, 
    peerName, 
    conversationId: String(data.conversationId) 
  };

  await notifee.displayNotification({
    id: notificationId,
    title: peerName,
    body: text, 
    data: notifData,
    android: {
      channelId: 'default', 
      smallIcon: 'ic_launcher', // ⚡ Keeps your top status bar icon working!
      importance: AndroidImportance.HIGH,
      pressAction: { id: 'default' },
      sound: 'default',
      color: '#6366f1',
      style: {
        type: AndroidStyle.MESSAGING,
        person: currentUser,
        messages: messages, 
        title: peerName,
      },
      actions: [
        {
          title: 'Reply',
          pressAction: { id: 'reply_action' },
          input: { placeholder: 'Type a reply...' },
        },
      ],
    },
    ios: {
      sound: 'default',
      threadId: `chat:${peerId}`, 
      foregroundPresentationOptions: ['alert', 'sound', 'badge'],
    },
  });
}

function parseMessageIds(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.map(x => String(x)) : [];
  } catch {
    return [];
  }
}

function getNotifColor(type) {
  if (!type) return '#6366f1';
  if (type.includes('streak')) return '#f97316';
  if (type.includes('leaderboard') || type.includes('rank')) return '#818cf8';
  if (type.includes('friend')) return '#34d399';
  if (type.includes('mood')) return '#ec4899';
  if (type.includes('challenge') || type.includes('points')) return '#fbbf24';
  if (type.includes('weekly') || type.includes('recap')) return '#38bdf8';
  if (type.includes('welcome')) return '#a78bfa';
  return '#6366f1';
}

async function displayAppNotification(data) {
  try {
    await notifee.displayNotification({
      id: `${data.type || 'notif'}:${Date.now()}`,
      title: data.title || 'StreakSphere',
      body: data.body || '',
      android: {
        channelId: 'app_notifications',
        pressAction: { id: 'default' },
        sound: 'default',
        color: getNotifColor(data.type),
        importance: AndroidImportance.HIGH,
      },
      ios: {
        sound: 'default',
        foregroundPresentationOptions: ['alert', 'sound', 'badge'],
      },
      data: { ...data },
    });
  } catch (e) {
    console.log('[Notifee] displayAppNotification failed:', e);
  }
}

function handleNotificationPress(data) {
  if (!data?.type) return;
  const type = data.type;

  setTimeout(() => {
    try {
      if (type === 'chat' && data.peerUserId) {
        navigationRef.current?.navigate('chat', {
          peerUserId: data.peerUserId,
          peerName: data.peerName,
        });
      } else if (type === 'friend_request') {
        navigationRef.current?.navigate('FriendRequests');
      } else if (
        type === 'friend_accepted' ||
        type === 'friend_declined' ||
        type === 'friend_removed'
      ) {
        navigationRef.current?.navigate('Friends');
      } else if (type.includes('streak')) {
        navigationRef.current?.navigate('Home');
      } else if (type.includes('leaderboard') || type.includes('rank')) {
        navigationRef.current?.navigate('Leaderboard');
      } else if (type.includes('mood')) {
        navigationRef.current?.navigate('MoodMap');
      } else if (type.includes('challenge')) {
        navigationRef.current?.navigate('Challenges');
      } else if (type === 'weekly_recap' || type === 'points_milestone') {
        navigationRef.current?.navigate('Profile');
      } else {
        navigationRef.current?.navigate('Home');
      }
    } catch (e) {
      console.log('[Nav] handleNotificationPress error:', e);
    }
  }, 300);
}

export const notificationNavState = { pending: null };

/*
|--------------------------------------------------------------------------
| Firebase Background Message Handler
|--------------------------------------------------------------------------
*/

const firebaseApp = getApp();
const messagingInstance = getMessaging(firebaseApp);

setBackgroundMessageHandler(messagingInstance, async remoteMessage => {
  const data = remoteMessage?.data || {};

  // ── ⚡ WHATSAPP-STYLE CUSTOM WAKE UP ──
// ── ⚡ WHATSAPP-STYLE CUSTOM WAKE UP (FULL SCREEN INTENT) ──
  if (data.type === 'incoming_call') {
    const { callId, callerName, callerId } = data;

    // 1. Download/Cache the caller's avatar locally
    const callerAvatarUrl = data.avatarUrl || data.profileImage;
    const avatarVersion = data.avatarVersion || 1;
    let localAvatarPath = undefined;
    
    if (callerAvatarUrl) {
      try {
        localAvatarPath = await getAvatar(String(callerId || 'caller'), callerAvatarUrl, avatarVersion);
      } catch (err) {
        console.log('Failed to cache caller avatar', err);
      }
    }

try {
      await notifee.displayNotification({
        id: String(callId),
        title: 'Incoming Call',
        body: `${callerName} is calling...`,
        android: {
          channelId: 'call_channel_v2', 
          category: AndroidCategory.CALL, 
          importance: AndroidImportance.HIGH,
          visibility: AndroidVisibility.PUBLIC, 
          autoCancel: true,
          ongoing: true, // Prevents swiping it away accidentally
          loopSound: true, 

          // ⚡ FIX: Add this so Android badges the app icon over the caller's avatar!
          smallIcon: 'ic_launcher', 

          ...(localAvatarPath ? { largeIcon: localAvatarPath, circularLargeIcon: true } : {}),

          // ⚡ THIS IS THE MAGIC! It wakes the phone screen and launches your app's UI
          fullScreenAction: {
            id: 'default',
            mainComponent: appName,
          },

          pressAction: {
            id: 'default',
            mainComponent: appName,
          },
          actions: [
            {
              title: 'Decline',
              pressAction: { id: 'decline_call' },
            },
            {
              title: 'Answer',
              pressAction: { id: 'answer_call', mainComponent: appName },
            },
          ],
        },
        data: { ...data },
      });
    } catch (err) {
      console.log('[Notifee] Notification display failed:', err);
    }
    return; 
  }

  // ⚡ NEW FIX: The Caller Hung Up or Timed Out! Stops the ghost ringing.
  // ⚡ NEW FIX: The Caller Hung Up! Stop ringing and show Missed Call.
  if (data.type === 'call_ended' || data.type === 'call_missed' || data.type === 'call_cancelled') {
    if (data.callId) {
      // 1. Cancel the aggressive ringing notification
      await notifee.cancelNotification(String(data.callId));
    }

    // 2. Display a standard "Missed Call" notification
    const callerName = data.callerName || data.peerName || 'Someone';
    await notifee.displayNotification({
      id: `missed_call_${data.callId || Date.now()}`,
      title: 'Missed Call',
      body: `You missed a voice call from ${callerName}`,
      android: {
        channelId: 'app_notifications', // Standard channel, NO ringtone
        smallIcon: 'ic_launcher',
        color: '#ef4444', // Red to indicate missed call
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'default' },
      },
      ios: {
        sound: 'default',
        foregroundPresentationOptions: ['alert', 'sound', 'badge'],
      },
      data: { type: 'chat', peerUserId: data.callerId || data.peerUserId } // Routes to chat when clicked
    });
    
    return;
  }

  // ── Chat ──
  if (data.type === 'chat') {
    const incomingMessageId = String(data.messageId || data.msgId || data._id || '');
    if (incomingMessageId) {
      try {
        setSecretKey();
        const tokens = await UserStorage.getAccessToken();
        if (tokens) {
          apiClient.setAuthToken(tokens);
        }
        await markDelivered([incomingMessageId]);
        console.log('[BGHandler] ✅ Delivered:', incomingMessageId);
      } catch (e) {
        console.log('[BGHandler] ❌ markDelivered failed:', e);
      }
    }
   
    const peerId = String(data.peerUserId || 'unknown');
    const peerName = data.username || data.peerName || 'Someone';
    const messageId = data.messageId || data.msgId || data._id || Date.now();
    const body = data.body || data.message || 'Sent you a message';

// ⚡ FIX: Use the new MessagingStyle function instead of the old grouping logic!
    await displayMessagingStyleNotification(data, {
      title: remoteMessage?.notification?.title,
      body: remoteMessage?.notification?.body,
    });
    return;
  }

  // ── Seen / Delivered signals — no display needed ──
  if (data.type === 'seen') {
    markMessagesSeenLocally(data.peerUserId);
    return;
  }

  if (data.type === 'delivered') {
    const ids = parseMessageIds(data.messageIds);
    markMessagesDeliveredLocally(data.peerUserId, ids);
    return;
  }

  // ── All app notifications ──
  if (data.type && data.title) {
    await displayAppNotification(data);
  }
});

/*
|--------------------------------------------------------------------------
| Notifee Background Press Handler
|--------------------------------------------------------------------------
*/

notifee.onBackgroundEvent(async ({ type, detail }) => {
  const { notification, pressAction } = detail;
  const data = notification?.data;
  

  // 1. User clicked "Decline" from the banner while app was killed
// 1. User clicked "Decline" from the banner while app was killed
  if (type === EventType.ACTION_PRESS && pressAction?.id === 'decline_call') {
    if (notification?.id) {
      await notifee.cancelNotification(notification.id);
    }
    
    if (data?.callId) {
      try {
        const tokens = await UserStorage.getAccessToken();
        apiClient.setAuthToken(tokens);
        setSecretKey()
        if (tokens) {
          // ⚡ FIX: Change this URL from /call/reject-offline to /call/reject
          await apiClient.post('/call/reject', { callId: data.callId });
        }
      } catch (e) {
        console.log('[Notifee] Failed to reject call via API', e);
      }
    }
    return;
  }

  // 2. User clicked "Answer" from the banner
// 2. User clicked "Answer" from the banner
  if (type === EventType.ACTION_PRESS && pressAction?.id === 'answer_call') {
    if (notification?.id) await notifee.cancelNotification(notification.id);

    if (data) {
      data.autoAccept = true; 
      notificationNavState.pending = data; 
      // ⚡ FIX: Broadcast instant signal!
      DeviceEventEmitter.emit('auto_answer_call', data);
    }
    return;
  }

  // 3. User just tapped the notification body (wants to open app and see ringing screen)
  if (type === EventType.PRESS && data?.type === 'incoming_call') {
    if (notification?.id) await notifee.cancelNotification(notification.id);
    data.autoAccept = false;
    DeviceEventEmitter.emit('auto_answer_call', data);
    return;
  }

// Handle standard push routing for chat
  if (type === EventType.PRESS && data) {
    if (navigationRef.current) {
      handleNotificationPress(data);
    } else {
      notificationNavState.pending = data;
    }
  }

// ⚡ FIX: Handle the inline reply when app is in the background
  if (type === EventType.ACTION_PRESS && pressAction?.id === 'reply_action') {
    const replyText = detail.input;
    
    if (replyText && data?.peerUserId && data?.conversationId) {
      try {
        const tokens = await UserStorage.getAccessToken();
        if (tokens) {
          apiClient.setAuthToken(tokens);
          setSecretKey();

          // ⚡ FIX: Use your dedicated sendMessage service
          await sendMessage({
            conversationId: data.conversationId,
            receiverId: data.peerUserId,
            text: replyText,
            clientMessageId: `reply_${Date.now()}`,
            notifyUser: true
          });

          // Cancel notification after replying
          if (notification?.id) {
            await notifee.cancelNotification(notification.id);
          }
        }
      } catch (e) {
        console.log('[Notifee] Reply failed', e);
      }
    }
    return;
  }
});

/*
|--------------------------------------------------------------------------
| Register App
|--------------------------------------------------------------------------
*/

AppRegistry.registerComponent(appName, () => App);