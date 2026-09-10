import React, { useEffect, useState, useCallback, useRef, useContext, memo } from "react";
import {
  View,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Keyboard,
  Image,
  Modal,
  Pressable,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  Animated,
  TouchableWithoutFeedback,
  Dimensions,
  PanResponder,
} from "react-native";
import { KeyboardAvoidingView, KeyboardStickyView } from "react-native-keyboard-controller";
import NetInfo from "@react-native-community/netinfo";
import { Swipeable, TapGestureHandler } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@rneui/themed";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { v4 as uuidv4 } from "uuid";
import { launchImageLibrary, launchCamera } from "react-native-image-picker";
import { pick, types } from "@react-native-documents/picker";
import { useVideoPlayer, VideoView, useEvent } from "react-native-video";
import FileViewer from "react-native-file-viewer";
import RNFS from "react-native-fs";
import { BlurView } from "@react-native-community/blur";
import EmojiSelector, { Categories } from "react-native-emoji-selector";
import { getCachedMediaPath, prefetchMedia } from "../services/LocalMediaCache";
import AudioRecorderPlayer from "react-native-nitro-sound";
import { createThumbnail } from "react-native-create-thumbnail";
import { getSocket } from "../../../auth/api-client/socket";
import AuthContext from "../../../auth/user/UserContext";
import { CallContext } from "../../call/context/CallContext";
import {
  openDirectConversation,
  sendMessage,
  fetchThread,
  markDelivered,
  markSeen,
  reactToMessage,
  removeReaction,
  deleteForEveryone,
} from "../services/api_chat";
import {
  clearUnread,
  setActiveChatPeer,
  notifyConversationChanged,
  isMessageDeliveredLocally,
} from "../services/ChatNotifications";
import {
  loadThreadMessages as loadThreadCacheV2,
  saveThreadMessages as saveThreadCacheV2,
  upsertThreadMessage as upsertThreadMessageV2,
  upsertConversationPreview as upsertPreviewV2,
  addDeletedForMe,
  getDeletedForMe,
} from "../services/LocalChatCache";
import apiClient from "../../../auth/api-client/api_client";

type Item =
  | { type: "date"; id: string; dateKey: string }
  | { type: "msg"; id: string; msg: any };

const MAX_FILES = 10;
const MAX_SIZE = 50 * 1024 * 1024;
const REACTIONS = ["❤️", "😂", "😮", "😢", "😡", "👍"];

const VOICE_BAR_COUNT = 38;
const VOICE_PREVIEW_BAR_COUNT = 32; 
const VOICE_MIN_DB = -50;
const VOICE_MAX_DB = -2;
const SLIDE_TO_CANCEL_DISTANCE = 150;
const SLIDE_TO_LOCK_DISTANCE = 120;
const MAX_VOICE_DURATION_MS = 5 * 60 * 1000;

const dateKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const formatDateHeader = (yyyyMmDd: string) => {
  const d = new Date(`${yyyyMmDd}T00:00:00`);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, y)) return "Yesterday";
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
};
const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const stableMessageKey = (m: any) =>
  m?.clientMessageId ? `c:${String(m.clientMessageId)}` : `i:${String(m?._id ?? "")}`;

const dedupeMessages = (arr: any[]) => {
  const map = new Map<string, any>();
  for (const m of arr) {
    const k = stableMessageKey(m);
    if (!map.has(k)) {
      map.set(k, m);
    } else {
      const ex = map.get(k);
      map.set(k, {
        ...ex,
        ...m,
        deliveredAt: ex.deliveredAt || m.deliveredAt,
        seenAt: ex.seenAt || m.seenAt,
        tickState:
          ex.seenAt || m.seenAt
            ? "seen"
            : ex.deliveredAt || m.deliveredAt
            ? "delivered"
            : "sent"
      });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
};

const detectTypeFromMime = (mime?: string) => {
  const m = String(mime || "");
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "document";
};

const formatPlaybackTime = (seconds: number) => {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  if (h > 0) {
    return `${h}:${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
  }
  return `${m}:${s < 10 ? "0" : ""}${s}`;
};

const meteringToBarHeight = (db: number) => {
  if (!isFinite(db)) return 0.06;
  const clamped = Math.max(VOICE_MIN_DB, Math.min(VOICE_MAX_DB, db));
  const ratio = (clamped - VOICE_MIN_DB) / (VOICE_MAX_DB - VOICE_MIN_DB);
  return Math.max(0.06, Math.min(1, ratio));
};

function VideoViewerContent({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.play();
  });

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [barWidth, setBarWidth] = useState(0);
  const isScrubbing = useRef(false);
  const trackRef = useRef<View>(null);
  const trackPageX = useRef(0);

  const barWidthRef = useRef(barWidth);
  const durationRef = useRef(duration);
  useEffect(() => { barWidthRef.current = barWidth; }, [barWidth]);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  useEvent(player, "onLoad", (data: any) => {
    setDuration(data?.duration || 0);
  });

  useEvent(player, "onProgress", (data: any) => {
    if (!isScrubbing.current) {
      setCurrentTime(data?.currentTime || 0);
    }
  });

  useEvent(player, "onPlaybackStateChange", (data: any) => {
    setIsPlaying(!!player.isPlaying);
  });

  const togglePlayPause = () => {
    if (player.isPlaying) {
      player.pause();
      setIsPlaying(false);
    } else {
      player.play();
      setIsPlaying(true);
    }
  };

  const seekToRatio = (ratio: number) => {
    const d = durationRef.current;
    if (!d || !isFinite(d)) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    const time = clamped * d;
    setCurrentTime(time);
    player.currentTime = time;
  };

  const measureTrack = () => {
    trackRef.current?.measure((_x, _y, _width, _height, pageX) => {
      trackPageX.current = pageX;
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        isScrubbing.current = true;
        trackRef.current?.measure((_x, _y, _width, _height, pageX) => {
          trackPageX.current = pageX;
          const w = barWidthRef.current;
          if (w > 0) {
            seekToRatio((evt.nativeEvent.pageX - pageX) / w);
          }
        });
      },
      onPanResponderMove: (evt) => {
        const w = barWidthRef.current;
        if (w > 0) {
          seekToRatio((evt.nativeEvent.pageX - trackPageX.current) / w);
        }
      },
      onPanResponderRelease: () => {
        isScrubbing.current = false;
      },
      onPanResponderTerminate: () => {
        isScrubbing.current = false;
      },
    })
  ).current;

  const progressRatio = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <View style={styles.videoViewerContainer}>
      <Pressable style={styles.videoViewerPlayer} onPress={togglePlayPause}>
        <VideoView player={player} style={StyleSheet.absoluteFill} />
      </Pressable>

      <View style={styles.videoControlsBar}>
        <TouchableOpacity onPress={togglePlayPause} style={styles.videoControlsPlayBtn}>
          <Icon name={isPlaying ? "pause" : "play"} size={22} color="#fff" />
        </TouchableOpacity>

        <Text style={styles.videoControlsTime}>{formatPlaybackTime(currentTime)}</Text>

        <View
          ref={trackRef}
          style={styles.videoSeekTrack}
          onLayout={(e) => {
            setBarWidth(e.nativeEvent.layout.width);
            measureTrack();
          }}
          {...panResponder.panHandlers}
        >
          <View style={styles.videoSeekTrackBg} />
          <View style={[styles.videoSeekTrackFill, { width: `${progressRatio * 100}%` }]} />
          <View style={[styles.videoSeekThumb, { left: `${progressRatio * 100}%` }]} />
        </View>

        <Text style={styles.videoControlsTime}>{formatPlaybackTime(duration)}</Text>
      </View>
    </View>
  );
}

interface VoiceBubbleProps {
  mediaUrl: string;
  durationMs: number;
  peaks: number[];
  isMe: boolean;
  isActive: boolean;
  isPlaying: boolean;
  playbackProgress: number;
  onTogglePlay: () => void;
  onSeekVoice: (ratio: number) => void;
}

const VoiceBubble = memo(({
  mediaUrl,
  durationMs,
  peaks,
  isMe,
  isActive,
  isPlaying,
  playbackProgress,
  onTogglePlay,
  onSeekVoice
}: VoiceBubbleProps) => {
  const [waveWidth, setWaveWidth] = useState(0);
  const totalSeconds = Math.round(durationMs / 1000);
  const elapsedSeconds = isActive ? Math.round((playbackProgress * durationMs) / 1000) : 0;
  const filledBars = isActive ? Math.round(playbackProgress * peaks.length) : 0;

  const handleSeekPress = (e: any) => {
    if (waveWidth > 0 && isActive) {
      const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / waveWidth));
      onSeekVoice(ratio);
    }
  };

  return (
    <View style={[styles.voiceBubbleRow, isMe ? styles.voiceBubbleRowMe : styles.voiceBubbleRowOther]}>
      <TouchableOpacity onPress={onTogglePlay} style={styles.voicePlayBtn} activeOpacity={0.8}>
        <Icon name={isActive && isPlaying ? "pause" : "play"} size={18} color="#fff" />
      </TouchableOpacity>

      <Pressable 
        style={styles.voiceWaveform} 
        onLayout={(e) => setWaveWidth(e.nativeEvent.layout.width)}
        onPress={handleSeekPress}
      >
        {peaks.map((p, idx) => (
          <View
            key={idx}
            style={[
              styles.voiceWaveformBar,
              {
                height: Math.max(4, p * 28),
                backgroundColor: idx < filledBars ? "#ffffff" : "rgba(255,255,255,0.35)",
              },
            ]}
          />
        ))}
      </Pressable>

      <Text style={styles.voiceTimeText}>
        {formatPlaybackTime(isActive ? elapsedSeconds : totalSeconds)}
      </Text>
    </View>
  );
}, (prev, next) =>
  prev.mediaUrl === next.mediaUrl &&
  prev.isActive === next.isActive &&
  prev.isPlaying === next.isPlaying &&
  (!prev.isActive || Math.abs(prev.playbackProgress - next.playbackProgress) < 0.004)
);

interface MessageBubbleProps {
  msgId: string;
  fromUserId: string;
  plaintext: string;
  messageType: string;
  mediaUrl: string;
  mediaName: string;
  mediaThumbnailUrl: string;
  voiceDurationMs: number;
  voicePeaks: number[];
  createdAt: string;
  tickState: string;
  isMe: boolean;
  isCallLog: boolean;
  hasReactions: boolean;
  reactionEmojis: string;
  reactionCounts: string;
  isHighlighted: boolean;
  voicePlayback: { activeMsgId: string | null; isPlaying: boolean; progress: number };
  onLongPress: (msgId: string, isMe: boolean, layout: any) => void;
  onImagePress: (type: string, url: string, name: string) => void;
  onToggleVoicePlay: (msgId: string, url: string) => void;
  onSeekVoicePlay: (msgId: string, url: string, ratio: number) => void;
}

const MessageBubble = memo(({
  msgId,
  plaintext,
  messageType,
  mediaUrl,
  mediaName,
  mediaThumbnailUrl,
  voiceDurationMs,
  voicePeaks,
  createdAt,
  tickState,
  isMe,
  isCallLog,
  hasReactions,
  reactionEmojis,
  reactionCounts,
  isHighlighted,
  voicePlayback,
  onLongPress,
  onImagePress,
  onToggleVoicePlay,
  onSeekVoicePlay
}: MessageBubbleProps) => {
  const bubbleRef = useRef<View>(null);
  const isMedia = messageType !== "text";

  const highlightAnim = useRef(new Animated.Value(0)).current;
  const prevHighlighted = useRef(false);
  useEffect(() => {
    if (isHighlighted && !prevHighlighted.current) {
      highlightAnim.setValue(0);
      Animated.sequence([
        Animated.timing(highlightAnim, { toValue: 1, duration: 200, useNativeDriver: false }),
        Animated.timing(highlightAnim, { toValue: 0.3, duration: 200, useNativeDriver: false }),
        Animated.timing(highlightAnim, { toValue: 1, duration: 200, useNativeDriver: false }),
        Animated.timing(highlightAnim, { toValue: 0, duration: 500, useNativeDriver: false }),
      ]).start();
    }
    prevHighlighted.current = isHighlighted;
  }, [isHighlighted]);

  const highlightBg = highlightAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(99,102,241,0)', 'rgba(99,102,241,0.30)'],
  });

  const handleLongPress = () => {
    bubbleRef.current?.measure((_x, _y, width, height, pageX, pageY) => {
      onLongPress(msgId, isMe, { x: pageX, y: pageY, width, height });
    });
  };

  const handleImagePress = () => {
    onImagePress(messageType, mediaUrl, mediaName);
  };

  const renderTick = () => {
    if (isCallLog) return null
    if (tickState === "seen") return <Icon name="check-all" size={13} color="#2090af" style={styles.tickIcon} />;
    if (tickState === "delivered") return <Icon name="check-all" size={13} color="#a3a3a3" style={styles.tickIcon} />;
    if (tickState === "sent") return <Icon name="check" size={13} color="#a3a3a3" style={styles.tickIcon} />;
    return <Icon name="clock-outline" size={13} color="#a3a3a3" style={styles.tickIcon} />;
  };

  const renderContent = () => {
    if (isCallLog) {
      return <Text style={[styles.text, { color: '#cbd5e1', fontWeight: '500' }]}>{plaintext}</Text>;
    }
    if (messageType === "text") {
      return <Text style={styles.text}>{plaintext}</Text>;
    }

    if (messageType === "voice") {
      if (!mediaUrl) return null;
      const isActive = voicePlayback.activeMsgId === msgId;
      return (
        <VoiceBubble
          mediaUrl={mediaUrl}
          durationMs={voiceDurationMs}
          peaks={voicePeaks?.length ? voicePeaks : new Array(VOICE_PREVIEW_BAR_COUNT).fill(0.4)}
          isMe={isMe}
          isActive={isActive}
          isPlaying={isActive && voicePlayback.isPlaying}
          playbackProgress={isActive ? voicePlayback.progress : 0}
          onTogglePlay={() => onToggleVoicePlay(msgId, mediaUrl)}
          onSeekVoice={(ratio) => onSeekVoicePlay(msgId, mediaUrl, ratio)}
        />
      );
    }

    if (!mediaUrl) return null;

if (messageType === "image") {
  // ⚡ CHECK IF SHARED POST WAS REMOVED BY ADMIN
  if (plaintext?.startsWith("__SHARED_POST_REMOVED__|")) {
    return (
      <View style={[styles.sharedPostCard, { backgroundColor: '#0A0A0A', padding: 24, alignItems: 'center', justifyContent: 'center' }]}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(239, 68, 68, 0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.3)' }}>
          <Icon name="shield-alert-outline" size={24} color="#EF4444" />
        </View>
        <Text style={{ color: "#F8FAFC", fontSize: 16, fontWeight: "700", textAlign: "center" }}>Post Removed</Text>
        <Text style={{ color: "#94A3B8", fontSize: 12, textAlign: "center", marginTop: 4, lineHeight: 16 }}>
          This shared post was removed because it violated our community guidelines.
        </Text>
      </View>
    );
  }

  // ⚡ NORMAL SHARED POST RENDER
  if (plaintext?.startsWith("__SHARED_POST__|")) {
    const parts = plaintext.split("|");
    const sPostId = parts[1] || "";
    const sUserId = parts[2] || ""; 
    const sUsername = parts[3] || "user";
    const sCaption = parts[4] || "";

    const navData = JSON.stringify({ postId: sPostId, userId: sUserId });

    return (
      <View style={styles.sharedPostCard}>
        <View style={styles.sharedPostHeader}>
          <Icon name="play-box-multiple-outline" size={16} color="#F8FAFC" />
          <Text style={styles.sharedPostHeaderName}>@{sUsername}</Text>
        </View>
        
        <View style={styles.sharedPostImageWrap}>
          <Image source={{ uri: mediaUrl }} style={styles.sharedPostImage} resizeMode="cover" />
        </View>
        
        <View style={styles.sharedPostFooter}>
          <Text style={styles.sharedPostCaption} numberOfLines={3}>{sCaption}</Text>
          
          <TouchableOpacity 
            style={styles.sharedPostBtn} 
            activeOpacity={0.85}
            onPress={() => onImagePress("shared_post", mediaUrl, navData)} 
          >
            <Text style={styles.sharedPostBtnText}>View Post</Text>
            <Icon name="chevron-right" size={16} color="#FFF" style={{ marginLeft: 2 }} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ⚡ Normal Image Render (if it's not a shared post)
  return (
    <View style={styles.mediaContainer}>
      <Image source={{ uri: mediaUrl }} style={styles.mediaImage} resizeMode="cover" />
      <Pressable style={StyleSheet.absoluteFill} onPress={handleImagePress} android_ripple={{ color: "rgba(255,255,255,0.10)" }} />
    </View>
  );
}

    if (messageType === "video") {
      return (
        <View style={styles.mediaContainer}>
          <TouchableOpacity
            onPress={handleImagePress}
            activeOpacity={0.85}
            style={styles.videoWrap}
          >
            {mediaThumbnailUrl ? (
              <Image source={{ uri: mediaThumbnailUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : null}
            <View style={styles.videoThumbTint} />
            <View style={styles.videoThumbPlayCircle}>
              <Icon name="play" size={28} color="#ffffff" />
            </View>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.mediaContainer}>
        <TouchableOpacity
          onPress={handleImagePress}
          activeOpacity={0.8}
          style={styles.docRow}
        >
          <Icon name="file-document-outline" size={22} color="#fff" />
          <Text style={styles.docName} numberOfLines={1}>{mediaName || "Document"}</Text>
          <Icon name="download-outline" size={18} color="#94a3b8" style={{ marginLeft: 8 }} />
        </TouchableOpacity>
        <View style={styles.metaRow}>
          {isMe ? renderTick() : null}
          <Text style={styles.timeText}>{formatTime(createdAt)}</Text>
        </View>
      </View>
    );
  };

  const isVoice = messageType === "voice";

return (
    <View style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowOther, { alignItems: isMe ? "flex-end" : "flex-start" }]}>
      <Animated.View style={{ backgroundColor: highlightBg, borderRadius: 14 }}>
        <TouchableOpacity
          ref={bubbleRef}
          activeOpacity={0.85}
          delayLongPress={320}
          onLongPress={handleLongPress}
        >
          <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
            {isCallLog ? (
              <View style={isMe ? styles.callLogBubbleMe : styles.callLogBubbleOther}>
                {renderContent()}
                <View style={styles.metaRow}>
                  <Text style={styles.timeText}>{formatTime(createdAt)}</Text>
                </View>
              </View>
            ) : isVoice ? (
              <View style={isMe ? styles.textBubbleMe : styles.textBubbleOther}>
                {renderContent()}
                <View style={styles.metaRow}>
                  {isMe ? renderTick() : null}
                  <Text style={styles.timeText}>{formatTime(createdAt)}</Text>
                </View>
              </View>
            ) : isMedia ? (
              <>
                {renderContent()}
                {messageType !== 'document' && (
                  <View style={styles.metaRowMedia}>
                    {isMe ? renderTick() : null}
                    <Text style={styles.timeText}>{formatTime(createdAt)}</Text>
                  </View>
                )}
              </>
            ) : (
              <View style={isMe ? styles.textBubbleMe : styles.textBubbleOther}>
                {renderContent()}
                <View style={styles.metaRow}>
                  {isMe ? renderTick() : null}
                  <Text style={styles.timeText}>{formatTime(createdAt)}</Text>
                </View>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.msgId === nextProps.msgId &&
    prevProps.plaintext === nextProps.plaintext &&
    prevProps.tickState === nextProps.tickState &&
    prevProps.hasReactions === nextProps.hasReactions &&
    prevProps.reactionEmojis === nextProps.reactionEmojis &&
    prevProps.reactionCounts === nextProps.reactionCounts &&
    prevProps.mediaUrl === nextProps.mediaUrl &&
    prevProps.mediaThumbnailUrl === nextProps.mediaThumbnailUrl &&
    prevProps.isHighlighted === nextProps.isHighlighted &&
    prevProps.isCallLog === nextProps.isCallLog &&
    prevProps.voicePlayback.activeMsgId === nextProps.voicePlayback.activeMsgId &&
    prevProps.voicePlayback.isPlaying === nextProps.voicePlayback.isPlaying &&
    (prevProps.voicePlayback.activeMsgId !== prevProps.msgId ||
      Math.abs(prevProps.voicePlayback.progress - nextProps.voicePlayback.progress) < 0.004) &&
    prevProps.onLongPress === nextProps.onLongPress &&
    prevProps.onImagePress === nextProps.onImagePress &&
    prevProps.onToggleVoicePlay === nextProps.onToggleVoicePlay
  );
});

function ReactionBadge({
  isMe,
  reactionEmojis,
  reactionCounts,
}: {
  isMe: boolean;
  reactionEmojis: string;
  reactionCounts: string;
}) {
  const emojis = reactionEmojis.split(',').filter(Boolean);
  const counts = reactionCounts.split(',').filter(Boolean).map(Number);
  const cornerStyle = isMe ? { right: 6 } : { left: 6 };

  return (
    <View pointerEvents="none" style={[styles.reactionBadge, cornerStyle]}>
      {emojis.map((emoji, idx) => (
        <Text key={`${emoji}-${idx}`} style={styles.reactionBadgeText}>
          {emoji}{counts[idx] > 1 ? ` ${counts[idx]}` : ""}
        </Text>
      ))}
    </View>
  );
}

function BubbleGhost({ m, isMe, newUrl }: { m: any; isMe: boolean; newUrl: string }) {
  const getMediaUrl = () => {
    const raw = String(m?.media?.url || "");
    if (!raw) return "";
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    return `${newUrl}${raw.startsWith("/") ? "" : "/"}${raw}`;
  };

  const t = m.messageType || "text";
  const isMedia = t !== "text";
  const mediaUrl = getMediaUrl();

  const isCallLog = String(m.clientMessageId || '').startsWith('call_log_') || String(m._id || '').startsWith('call_log_');

  const renderTick = () => {
    if (isCallLog) return null;
    const s = m.tickState || "pending";
    if (s === "seen") return <Icon name="check-all" size={13} color="#2090af" style={styles.tickIcon} />;
    if (s === "delivered") return <Icon name="check-all" size={13} color="#a3a3a3" style={styles.tickIcon} />;
    if (s === "sent") return <Icon name="check" size={13} color="#a3a3a3" style={styles.tickIcon} />;
    return <Icon name="clock-outline" size={13} color="#a3a3a3" style={styles.tickIcon} />;
  };

  const content = () => {
    if (isCallLog) {
      return <Text style={[styles.text, { color: '#cbd5e1', fontWeight: '500' }]}>{m.plaintext}</Text>;
    }
    if (t === "text") return <Text style={styles.text}>{m.plaintext}</Text>;

    if (t === "voice") {
      const peaks: number[] = m?.media?.peaks?.length ? m.media.peaks : new Array(VOICE_PREVIEW_BAR_COUNT).fill(0.4);
      return (
        <View style={[styles.voiceBubbleRow, isMe ? styles.voiceBubbleRowMe : styles.voiceBubbleRowOther]}>
          <View style={styles.voicePlayBtn}>
            <Icon name="play" size={18} color="#fff" />
          </View>
          <View style={styles.voiceWaveform}>
            {peaks.map((p, idx) => (
              <View key={idx} style={[styles.voiceWaveformBar, { height: Math.max(4, p * 28), backgroundColor: "rgba(255,255,255,0.35)" }]} />
            ))}
          </View>
          <Text style={styles.voiceTimeText}>{formatPlaybackTime(Math.round((m?.media?.durationMs || 0) / 1000))}</Text>
        </View>
      );
    }

    if (!mediaUrl) return null;

    if (t === "image") {
      return (
        <View style={styles.mediaContainer}>
          <Image source={{ uri: mediaUrl }} style={styles.mediaImage} resizeMode="cover"/>
        </View>
      );
    }

    if (t === "video") {
      const thumb = m?.media?.thumbnailUrl
        ? (String(m.media.thumbnailUrl).startsWith("http") ? m.media.thumbnailUrl : `${newUrl}${m.media.thumbnailUrl}`)
        : "";
      return (
        <View style={styles.mediaContainer}>
          <View style={styles.videoWrap}>
            {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
            <View style={styles.videoThumbTint} pointerEvents="none" />
            <View style={styles.videoThumbPlayCircle}>
              <Icon name="play" size={28} color="#fff" />
            </View>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.mediaContainer}>
        <View style={styles.docRow}>
          <Icon name="file-document-outline" size={22} color="#fff" />
          <Text style={styles.docName} numberOfLines={1}>{m?.media?.name || "Document"}</Text>
        </View>
      </View>
    );
  };

return (
    <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
      {isCallLog ? (
        <View style={isMe ? styles.callLogBubbleMe : styles.callLogBubbleOther}>
          {content()}
          <View style={styles.metaRow}>
            <Text style={styles.timeText}>{formatTime(m.createdAt)}</Text>
          </View>
        </View>
      ) : t === "voice" ? (
        <View style={isMe ? styles.textBubbleMe : styles.textBubbleOther}>
          {content()}
          <View style={styles.metaRow}>
            {isMe ? renderTick() : null}
            <Text style={styles.timeText}>{formatTime(m.createdAt)}</Text>
          </View>
        </View>
      ) : isMedia ? (
        <>
          {content()}
          {t !== 'document' && (
            <View style={styles.metaRowMedia}>
              {isMe ? renderTick() : null}
              <Text style={styles.timeText}>{formatTime(m.createdAt)}</Text>
            </View>
          )}
        </>
      ) : (
        <View style={isMe ? styles.textBubbleMe : styles.textBubbleOther}>
          {content()}
          <View style={styles.metaRow}>
            {isMe ? renderTick() : null}
            <Text style={styles.timeText}>{formatTime(m.createdAt)}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

interface ActiveMenu {
  msgId: string;
  isMe: boolean;
  msg: any;
  position: { x: number; y: number; width: number; height: number };
}

interface MsgActionMenuProps {
  menu: ActiveMenu;
  newUrl: string;
  myUserId: string;
  currentReaction?: string;
  onReact: (emoji: string) => void;
  onDeleteForEveryone?: () => void;
  onDeleteForMe: () => void;
  onDismiss: () => void;
  openEmojiPicker: () => void;
}

const MsgActionMenu = memo(({
  menu,
  newUrl,
  myUserId,
  onReact,
  onDeleteForEveryone,
  onDeleteForMe,
  onDismiss,
  openEmojiPicker,
}: MsgActionMenuProps) => {
  const popAnim = useRef(new Animated.Value(0)).current;
  const { width: SW, height: SH } = Dimensions.get("window");
  const PAD = 10;
  const RXN_BAR_H = 58;
  const RXN_BAR_W = REACTIONS.length * 46 + 64;
  const DEL_H = menu.isMe ? 104 : 52;

  useEffect(() => {
    Animated.spring(popAnim, { toValue: 1, useNativeDriver: true, tension: 240, friction: 15 }).start();
  }, []);

  const { x, y, width, height } = menu.position;

  const bubbleTop = Math.max(PAD + 8, y - 10);
  const rxnAbove = bubbleTop - RXN_BAR_H - 8;
  const rxnBelow = bubbleTop + height + 8;
  const rxnTop = rxnAbove >= PAD ? rxnAbove : rxnBelow;
  const rxnLeft = menu.isMe
    ? Math.max(PAD, x + width - RXN_BAR_W)
    : Math.min(x, SW - RXN_BAR_W - PAD);

  const afterBubble = bubbleTop + height + 8;
  const delBelowTop = rxnTop === rxnBelow ? rxnTop + RXN_BAR_H + 8 : afterBubble;
  const delAboveTop = bubbleTop - DEL_H - RXN_BAR_H - 12;
  const isBottomEdge = delBelowTop + DEL_H + PAD > SH;
  const delTop = isBottomEdge ? Math.max(PAD, delAboveTop) : delBelowTop;
  const delLeft = menu.isMe ? undefined : Math.min(x, SW - 214 - PAD);
  const delRight = menu.isMe ? SW - (x + width) : undefined;

  const sc = popAnim.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] });
  const op = popAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const ty = popAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onDismiss}>
     <View style={StyleSheet.absoluteFill}>
  <BlurView
    style={StyleSheet.absoluteFill}
    blurType="dark"
    blurAmount={12}
    reducedTransparencyFallbackColor="rgba(2,6,23,0.88)"
  />
  <TouchableWithoutFeedback onPress={onDismiss}>
    <View style={StyleSheet.absoluteFill} />
  </TouchableWithoutFeedback>
</View>
      <Animated.View
        pointerEvents="none"
        style={[
          mStyles.ghost,
          menu.isMe
            ? { right: SW - (x + width), alignItems: "flex-end" }
            : { left: x, alignItems: "flex-start" },
          { top: bubbleTop, opacity: op, transform: [{ scale: sc }] },
        ]}
      >
        <BubbleGhost m={menu.msg} isMe={menu.isMe} newUrl={newUrl} />
      </Animated.View>
      <Animated.View
        style={[
          mStyles.reactionBar,
          { top: rxnTop, left: rxnLeft, opacity: op, transform: [{ scale: sc }, { translateY: ty }] },
        ]}
      >
        {REACTIONS.map((emoji) => {
          const hasMyReaction = menu.msg.reactions?.some((r: any) => r.userId === myUserId && r.emoji === emoji);
          return (
            <TouchableOpacity
              key={emoji}
              onPress={() => onReact(emoji)}
              style={[
                mStyles.reactionBtn,
                hasMyReaction && mStyles.reactionBtnActive
              ]}
              activeOpacity={0.7}
            >
              <Text style={mStyles.reactionEmoji}>{emoji}</Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity
          key="plus"
          onPress={openEmojiPicker}
          style={mStyles.reactionBtn}
          activeOpacity={0.7}
        >
          <Icon name="plus" size={22} color="#fff" />
        </TouchableOpacity>
      </Animated.View>
      <Animated.View
        style={[
          mStyles.deleteMenu,
          {
            top: delTop,
            left: delLeft,
            right: delRight,
            opacity: op,
            transform: [{ scale: sc }, { translateY: ty }],
          },
        ]}
      >
        <TouchableOpacity
          style={[mStyles.deleteItem, menu.isMe && mStyles.deleteItemBorder]}
          onPress={onDeleteForMe}
          activeOpacity={0.7}
        >
          <Icon name="delete-outline" size={16} color="#94a3b8" />
          <Text style={mStyles.deleteText}>Delete for me</Text>
        </TouchableOpacity>

                {menu.isMe && (
          <TouchableOpacity style={mStyles.deleteItem} onPress={onDeleteForEveryone} activeOpacity={0.7}>
            <Icon name="delete-sweep-outline" size={16} color="#f87171" />
            <Text style={[mStyles.deleteText, { color: "#f87171" }]}>Delete for everyone</Text>
          </TouchableOpacity>
        )}
      </Animated.View>
    </Modal>
  );
});

const mStyles = StyleSheet.create({
  ghost: { position: "absolute", maxWidth: "82%" },
  reactionBar: {
    position: "absolute",
    flexDirection: "row",
    backgroundColor: "rgba(15,23,42,0.96)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.2)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 18,
    elevation: 18,
  },
  reactionBtn: {
    width: 42, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
  },
  reactionBtnActive: { backgroundColor: "rgba(99,102,241,0.38)" },
  reactionEmoji: { fontSize: 24 },
  deleteMenu: {
    position: "absolute",
    backgroundColor: "rgba(15,23,42,0.97)",
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
    minWidth: 214,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 18,
    elevation: 18,
  },
  deleteItem: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 13, paddingHorizontal: 16, gap: 12,
  },
  deleteItemBorder: {
    borderTopWidth: 1, borderTopColor: "rgba(148,163,184,0.12)",
  },
  deleteText: { color: "#94a3b8", fontSize: 14, fontWeight: "500" },
});

function AttachMenu({
  visible,
  onClose,
  onCamera,
  onVideo,
  onGallery,
  onDocument,
}: {
  visible: boolean;
  onClose: () => void;
  onCamera: () => void;
  onVideo: () => void;
  onGallery: () => void;
  onDocument: () => void;
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      tension: 260,
      friction: 20,
    }).start();
  }, [visible]);

  if (!visible) return null;

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const opacity = anim;
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] });

  const tiles = [
    { key: "camera", icon: "camera-outline", tint: "#f97373", onPress: onCamera },
    { key: "video", icon: "video-outline", tint: "#fb923c", onPress: onVideo },
    { key: "gallery", icon: "image-multiple-outline", tint: "#a78bfa", onPress: onGallery },
    { key: "document", icon: "file-document-outline", tint: "#34d399", onPress: onDocument },
  ];

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      
      <Animated.View
        style={[
          attachStyles.cardVertical,
          { opacity, transform: [{ scale }, { translateY }] },
        ]}
      >
        {tiles.map((t) => (
          <TouchableOpacity 
            key={t.key} 
            style={attachStyles.tileVertical} 
            onPress={() => { t.onPress(); onClose(); }} 
            activeOpacity={0.75}
          >
            <View style={[attachStyles.tileCircleVertical, { backgroundColor: `${t.tint}26`, borderColor: `${t.tint}55` }]}>
              <Icon name={t.icon} size={22} color={t.tint} />
            </View>
          </TouchableOpacity>
        ))}
      </Animated.View>
    </Modal>
  );
}

const attachStyles = StyleSheet.create({
  cardVertical: {
    position: "absolute",
    right: 12, 
    bottom: 84, 
    backgroundColor: "rgba(20,26,42,0.98)",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    gap: 12, 
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 16,
  },
  tileVertical: { 
    alignItems: "center", 
    justifyContent: "center" 
  },
  tileCircleVertical: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});

function VoiceRecordOverlay({
  phase,
  elapsedMs,
  liveBars,
  cancelDragX,
  lockDragY,
  isLocked,
  previewPeaks,
  previewDurationMs,
  isPreviewPlaying,
  previewProgress,
  onTogglePreviewPlay,
  onDeleteAndClose,
  onStopToPreview,
  onSend,
}: {
  phase: "holding" | "locked" | "preview";
  elapsedMs: number;
  liveBars: number[];
  cancelDragX: Animated.Value;
  lockDragY: Animated.Value;
  isLocked: boolean;
  previewPeaks: number[];
  previewDurationMs: number;
  isPreviewPlaying: boolean;
  previewProgress: number;
  onTogglePreviewPlay: () => void;
  onDeleteAndClose: () => void;
  onStopToPreview: () => void;
  onSend: () => void;
}) {
  const dotPulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dotPulse, { toValue: 0.25, duration: 600, useNativeDriver: true }),
        Animated.timing(dotPulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const cancelTextOpacity = cancelDragX.interpolate({
    inputRange: [-SLIDE_TO_CANCEL_DISTANCE, 0],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });
  const lockOpacity = lockDragY.interpolate({
    inputRange: [-SLIDE_TO_LOCK_DISTANCE, 0],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  if (phase === "preview") {
    const filledBars = Math.round(previewProgress * previewPeaks.length);
    return (
      <View style={styles.voiceOverlayRow}>
        <TouchableOpacity onPress={onDeleteAndClose} style={styles.voiceOverlayIconBtn} activeOpacity={0.75}>
          <Icon name="delete-outline" size={22} color="#f87171" />
        </TouchableOpacity>

        <TouchableOpacity onPress={onTogglePreviewPlay} style={styles.voicePreviewPlayBtn} activeOpacity={0.8}>
          <Icon name={isPreviewPlaying ? "pause" : "play"} size={18} color="#fff" />
        </TouchableOpacity>

        <View style={styles.voicePreviewWaveform}>
          {previewPeaks.map((p, idx) => (
            <View
              key={idx}
              style={[
                styles.voiceWaveformBar,
                {
                  height: Math.max(4, p * 28),
                  backgroundColor: idx < filledBars ? "#6366f1" : "rgba(148,163,184,0.35)",
                },
              ]}
            />
          ))}
        </View>

        <Text style={styles.voiceOverlayTimer}>{formatPlaybackTime(previewDurationMs / 1000)}</Text>

        <TouchableOpacity onPress={onSend} style={styles.voiceOverlaySendBtn} activeOpacity={0.85}>
          <Icon name="send" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === "locked") {
    return (
      <View style={styles.voiceOverlayRow}>
        <TouchableOpacity onPress={onDeleteAndClose} style={styles.voiceOverlayIconBtn} activeOpacity={0.75}>
          <Icon name="delete-outline" size={22} color="#f87171" />
        </TouchableOpacity>

        <Animated.View style={[styles.voiceRecDot, { opacity: dotPulse }]} />
        <Text style={styles.voiceOverlayTimer}>{formatPlaybackTime(elapsedMs / 1000)}</Text>

        <View style={styles.voiceLiveWaveform}>
          {liveBars.map((h, idx) => (
            <View key={idx} style={[styles.voiceWaveformBar, { height: Math.max(4, h * 28), backgroundColor: "#6366f1" }]} />
          ))}
        </View>

        <TouchableOpacity onPress={onStopToPreview} style={styles.voiceOverlayStopBtn} activeOpacity={0.85}>
          <View style={styles.voiceStopSquare} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.voiceOverlayRow} pointerEvents="none">
      <Animated.View
        style={[
          styles.voiceLockPill,
          { opacity: lockOpacity, transform: [{ translateY: lockDragY.interpolate({ inputRange: [-SLIDE_TO_LOCK_DISTANCE, 0], outputRange: [-6, 0], extrapolate: "clamp" }) }] },
        ]}
      >
        <Icon name="lock-outline" size={16} color="#cbd5e1" />
        <Icon name="chevron-up" size={16} color="#cbd5e1" />
      </Animated.View>

      <Animated.View style={[styles.voiceRecDot, { opacity: dotPulse }]} />
      <Text style={styles.voiceOverlayTimer}>{formatPlaybackTime(elapsedMs / 1000)}</Text>

      <View style={styles.voiceLiveWaveform}>
        {liveBars.map((h, idx) => (
          <View key={idx} style={[styles.voiceWaveformBar, { height: Math.max(4, h * 28), backgroundColor: "#6366f1" }]} />
        ))}
      </View>

      <Animated.View
        style={[
          styles.voiceSlideToCancel,
          { opacity: cancelTextOpacity, transform: [{ translateX: cancelDragX }] },
        ]}
      >
        <Icon name="chevron-left" size={16} color="#94a3b8" />
        <Text style={styles.voiceSlideToCancelText}>Slide to cancel</Text>
      </Animated.View>
    </View>
  );
}

export default function ChatScreen({ route, navigation }: any) {
  const user = useContext(AuthContext);
  const callContext = useContext(CallContext);
  
  // ⚡ DESTRUCTURE BLOCK FLAGS
  const { peerUserId, peerName, peerMood, peerAvatarUrl, avatarUrl, amIBlocked, didIBlock, tick, isPremium } = route.params;
  const isBlockedChat = amIBlocked || didIBlock;

  const handleVoiceCallPress = () => {
    if (offline) {
      showGlassyError("You are offline. Connect to the internet to call.");
      return;
    }
    if (!conversationId) {
      showGlassyError("Cannot call until conversation is initialized");
      return;
    }
    
    if (callContext) {
      callContext.startCall(
        {
          id: String(route.params.peerUserId),
          name: route.params.peerName || "Friend",
          avatar: route.params.peerAvatarUrl || route.params.avatarUrl ? newUrl + String(route.params.peerAvatarUrl || route.params.avatarUrl || "") : "",
        }, 
        conversationId 
      );
    }
  };

  const insets = useSafeAreaInsets();
  const myUserId = String(user?.User?.user?.id || user?.User?.user?._id || "");

  const [conversationId, setConversationId] = useState<string | null>(
    route?.params?.conversationId || null
  );
  const [messages, setMessages] = useState<any[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [offline, setOffline] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [glassError, setGlassError] = useState<string | null>(null);
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [activeImageUrl, setActiveImageUrl] = useState("");
  const [videoViewerVisible, setVideoViewerVisible] = useState(false);
  const [activeVideoUrl, setActiveVideoUrl] = useState("");
  const [activeMenu, setActiveMenu] = useState<ActiveMenu | null>(null);
  const [reactions, setReactions] = useState<Record<string, string>>({});
  const [deletedForMe, setDeletedForMe] = useState<Set<string>>(new Set());
  const typingTimeout = useRef(null);
  const [emojiPickerVisible, setEmojiPickerVisible] = useState(false);
  const [emojiPickerTarget, setEmojiPickerTarget] = useState<{ msgId: string; isMe: boolean } | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const flatRef = useRef<FlatList>(null);
  const didInitialAutoScrollRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const [replyToMessage, setReplyToMessage] = useState(null);
  const resolvedPeerAvatar = String(peerAvatarUrl || avatarUrl || "");
  const [avatarFailed, setAvatarFailed] = useState(false);
  const baseUrl = apiClient.getBaseURL();
  const newUrl = baseUrl.replace(/\/api\/?$/, "");

  const socketRef = useRef(null);
  const activeSwipeableRef = useRef<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const messageRefs = useRef<Map<string, View>>(new Map());
  const flatListRef = useRef<FlatList>(null);
  
  const activeCallCallerIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (callContext?.currentSession) {
      activeCallCallerIdRef.current = callContext.currentSession.isIncoming 
        ? String(peerUserId) 
        : String(myUserId);
    }
  }, [callContext?.currentSession, myUserId, peerUserId]);

  const inputHasTextAnim = useRef(new Animated.Value(0)).current;
  const hadTextRef = useRef(false);

  const recorder = AudioRecorderPlayer;

  type VoicePhase = "idle" | "holding" | "locked" | "preview";
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("idle");
  const [voiceElapsedMs, setVoiceElapsedMs] = useState(0);
  const [voiceLiveBars, setVoiceLiveBars] = useState<number[]>(new Array(VOICE_BAR_COUNT).fill(0.06));
  const [voicePreviewPath, setVoicePreviewPath] = useState<string | null>(null);
  const [voicePreviewDurationMs, setVoicePreviewDurationMs] = useState(0);
  const [voicePreviewPeaks, setVoicePreviewPeaks] = useState<number[]>([]);
  const [voicePreviewPlaying, setVoicePreviewPlaying] = useState(false);
  const [voicePreviewProgress, setVoicePreviewProgress] = useState(0);

  const [voicePlayback, setVoicePlayback] = useState<{ activeMsgId: string | null; isPlaying: boolean; progress: number }>({
    activeMsgId: null,
    isPlaying: false,
    progress: 0,
  });

  const voiceRecordedPeaksRef = useRef<number[]>([]);
  const cancelDragX = useRef(new Animated.Value(0)).current;
  const lockDragY = useRef(new Animated.Value(0)).current;
  const voiceLockedRef = useRef(false);
  const voiceCancelledRef = useRef(false);
  const recordStartTsRef = useRef(0);

  const lastRecordCallbackRef = useRef(0);
  const lastPlaybackCallbackRef = useRef(0);

  const closeOtherSwipeables = (currentId: string) => {
    swipeableRefs.current.forEach((swipeable, id) => {
      if (id !== currentId && swipeable) {
        swipeable.close();
      }
    });
    activeSwipeableRef.current = currentId;
  };

  const safeStopRecorder = async () => {
    try {
      const uri = await recorder.stopRecorder();
      return uri;
    } catch (e) {
      console.log("Ignored expected stopRecorder rejection:", e);
      return null;
    }
  };


  useEffect(() => {
    return () => {
      safeStopRecorder().catch(() => {});
      try { recorder.removeRecordBackListener(); } catch {}
      recorder.stopPlayer().catch(() => {});
      try { recorder.removePlayBackListener(); } catch {}
    };
  }, []);

  const handleInputChange = (val: string) => {
    setInput(val);

    const hasText = val.trim().length > 0;
    if (hasText !== hadTextRef.current) {
      hadTextRef.current = hasText;
      Animated.spring(inputHasTextAnim, {
        toValue: hasText ? 1 : 0,
        useNativeDriver: false,
        tension: 280,
        friction: 22,
      }).start();
    }

    if (socketRef.current && conversationId) {
      socketRef.current.emit("typing", {
        conversationId,
        userId: myUserId,
      });
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => {
        socketRef.current.emit("stop-typing", {
          conversationId,
          userId: myUserId,
        });
      }, 1500);
    }
  };

  const scrollToBottom = useCallback((animated = false) => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated });
  }, []);

  const showGlassyError = useCallback((msg: string) => {
    setGlassError(msg);
    setTimeout(() => setGlassError(null), 2600);
  }, []);

  const openImageViewerCb = useCallback((url: string) => {
    setActiveImageUrl(url);
    setImageViewerVisible(true);
  }, []);

  const openVideoViewerCb = useCallback((url: string) => {
    setActiveVideoUrl(url);
    setVideoViewerVisible(true);
  }, []);

const [localMediaPaths, setLocalMediaPaths] = useState<Record<string, string>>({});

const getMediaUrlCb = useCallback((m: any) => {
    const raw = String(m?.media?.url || m?.media?.uri || "");
    if (!raw) return "";
    
    const normalizedRaw = raw.replace(/\\/g, "/");
    
    const remote = (normalizedRaw.startsWith("http://") || normalizedRaw.startsWith("https://") || normalizedRaw.startsWith("file://"))
      ? normalizedRaw
      : `${newUrl}${normalizedRaw.startsWith("/") ? "" : "/"}${normalizedRaw}`;
      
    return localMediaPaths[remote] || remote;
  }, [newUrl, localMediaPaths]);

  const getThumbnailUrlCb = useCallback((m: any) => {
    const raw = String(m?.media?.thumbnailUrl || m?.media?.localThumbnailUri || m?.media?.thumbnail || "");
    if (!raw) return "";
    
    const normalizedRaw = raw.replace(/\\/g, "/");
    
    if (normalizedRaw.startsWith("http://") || normalizedRaw.startsWith("https://") || normalizedRaw.startsWith("file://")) {
      return normalizedRaw;
    }
    return `${newUrl}${normalizedRaw.startsWith("/") ? "" : "/"}${normalizedRaw}`;
  }, [newUrl]);

  const ensureCameraPerms = useCallback(async () => {
    if (Platform.OS !== "android") return true;
    const cam = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    const mic = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    return cam === PermissionsAndroid.RESULTS.GRANTED && mic === PermissionsAndroid.RESULTS.GRANTED;
  }, []);

  const ensureMicPerms = useCallback(async () => {
    if (Platform.OS !== "android") return true;
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  }, []);

  const openDocInAppCb = useCallback(async (url: string, name?: string) => {
    try {
      const ext = (name?.split(".").pop() || "bin").toLowerCase();
      const filePath = `${RNFS.CachesDirectoryPath}/chat_${Date.now()}.${ext}`;
      const r = await RNFS.downloadFile({ fromUrl: url, toFile: filePath }).promise;

      if (r.statusCode >= 200 && r.statusCode < 300) {
        await FileViewer.open(filePath, {
          showOpenWithDialog: true,
          showAppsSuggestions: true,
        });
      } else {
        showGlassyError("Failed to download document");
      }
    } catch (downloadError) {
      console.log("Download error:", downloadError);
      showGlassyError("Cannot download this document");
    }
  }, [showGlassyError]);

  const normalizeServer = useCallback(
    (serverMsgs: any[]) =>
      serverMsgs
        .map((m: any) => {
          const isMe = String(m.senderId) === String(myUserId);
          let tickState = "pending";
          if (isMe) {
            if (m.seenAt) tickState = "seen";
            else if (m.deliveredAt) tickState = "delivered";
            else tickState = "sent";
          } else tickState = "delivered";

          let replyToData = null;
          if (m.replyTo) {
            if (typeof m.replyTo === 'object') {
              replyToData = {
                _id: String(m.replyTo._id),
                senderId: String(m.replyTo.senderId || m.replyTo.fromUserId),
                text: String(m.replyTo.text || m.replyTo.plaintext || ""),
                messageType: m.replyTo.messageType || "text",
                media: m.replyTo.media || null,
              };
            } else {
              replyToData = m.replyTo;
            }
          }

          return {
            _id: String(m._id),
            fromUserId: String(m.senderId),
            toUserId: String(m.receiverId),
            plaintext: String(m.text || ""),
            messageType: m.messageType || "text",
            media: m.media || null,
            createdAt: m.createdAt,
            clientMessageId: m.clientMessageId,
            seenAt: m.seenAt || null,
            deliveredAt: m.deliveredAt || null,
            tickState,
            reactions: m.reactions || [],
            deletedForEveryone: !!m.deletedForEveryone,
            replyTo: replyToData,
          };
        })
        .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [myUserId]
  );

useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    if (!socket?.connected) socket?.connect();

    socket?.emit("join", myUserId);
    if (conversationId) socket?.emit("join-conversation", conversationId);

    const handleChatMessage = (msg: any) => {
      if (!msg) return;
      const normalized = normalizeServer([msg]);
      if (normalized && normalized.length > 0) {
        setMessages(prev => dedupeMessages([...prev, normalized[0]]));
      }
    };

    const handleTyping = ({ userId }: any) => {
      if (String(userId) === String(peerUserId)) setPeerTyping(true);
    };

    const handleStopTyping = ({ userId }: any) => {
      if (String(userId) === String(peerUserId)) setPeerTyping(false);
    };

    const handleMsgDelivered = (payload: any) => {
      const idsToUpdate = payload.messageIds || (payload.msgId ? [payload.msgId] : []);
      if (!idsToUpdate.length) return;
      const now = new Date().toISOString();

      setMessages(prev => prev.map(m => {
        if (idsToUpdate.includes(String(m._id))) {
          const updated = { ...m, deliveredAt: m.deliveredAt || now, tickState: m.seenAt ? "seen" : "delivered" };
          
          upsertThreadMessageV2(String(myUserId), String(conversationId), {
            _id: String(updated._id),
            conversationId: String(conversationId),
            senderId: String(updated.fromUserId),
            receiverId: String(updated.toUserId),
            text: String(updated.plaintext),
            messageType: updated.messageType,
            media: updated.media,
            createdAt: updated.createdAt,
            clientMessageId: updated.clientMessageId,
            deliveredAt: updated.deliveredAt,
            seenAt: updated.seenAt
          }).catch(() => {});

          return updated;
        }
        return m;
      }));
    };

    const handleMsgSeen = (payload: any) => {
      const idsToUpdate = payload.messageIds || (payload.msgId ? [payload.msgId] : []);
      const now = new Date().toISOString();

      setMessages(prev => prev.map(m => {
        const isSentByMe = String(m.fromUserId) === String(myUserId);
        
        if (isSentByMe && (!idsToUpdate.length || idsToUpdate.includes(String(m._id)) || !m.seenAt)) {
          const updated = { ...m, seenAt: m.seenAt || now, tickState: "seen" };

          upsertThreadMessageV2(String(myUserId), String(conversationId), {
            _id: String(updated._id),
            conversationId: String(conversationId),
            senderId: String(updated.fromUserId),
            receiverId: String(updated.toUserId),
            text: String(updated.plaintext),
            messageType: updated.messageType,
            media: updated.media,
            createdAt: updated.createdAt,
            clientMessageId: updated.clientMessageId,
            deliveredAt: updated.deliveredAt || now, 
            seenAt: updated.seenAt
          }).catch(() => {});

          return updated;
        }
        return m;
      }));
    };

    const handleMsgDeleted = ({ msgId }: any) => {
      setMessages(prev => prev.filter(m => String(m._id) !== msgId));
    };

   const handleMsgReacted = ({ msgId, userId, emoji }: any) => {
      setMessages((prev) =>
        prev.map((m) => {
          const currentMsgId = String(m._id || m.clientMessageId || "");
          if (currentMsgId === String(msgId)) {
            return {
              ...m,
              reactions: emoji
                ? [
                    ...(m.reactions || []).filter((r: any) => String(r.userId) !== String(userId)),
                    { userId, emoji },
                  ]
                : (m.reactions || []).filter((r: any) => String(r.userId) !== String(userId)),
            };
          }
          return m;
        })
      );
    };

const handleCallLog = async (payload: any, text: string) => {
  const safePayload = payload || {};
  
  const cid = safePayload.conversationId || conversationId;
  if (!cid || !myUserId) return;

  const callerId = safePayload.callerId || activeCallCallerIdRef.current || myUserId;
  const receiverIdStr = safePayload.receiverId || (String(callerId) === String(myUserId) ? String(peerUserId) : String(myUserId));
  
  const clientMessageId = `call_log_${safePayload.callId || Date.now()}_${text.replace(/\s+/g, '')}`;
  const localId = `loc:${clientMessageId}`;
  const now = new Date().toISOString();

  const uiMsg = {
    _id: localId,
    fromUserId: String(callerId),
    toUserId: receiverIdStr,
    plaintext: text,
    messageType: "text",
    media: null,
    createdAt: now,
    clientMessageId,
    tickState: "pending",
    deliveredAt: null,
    seenAt: null,
  };
  setMessages((prev) => dedupeMessages([...prev, uiMsg]));
  
  await upsertThreadMessageV2(String(myUserId), String(cid), {
    _id: localId,
    conversationId: String(cid),
    senderId: String(callerId),
    receiverId: receiverIdStr,
    text: text, 
    messageType: "text",
    media: null,
    createdAt: now,
    clientMessageId,
    deliveredAt: null,
    seenAt: null,
  });

  await upsertPreviewV2(String(myUserId), {
    conversationId: String(cid),
    peerUserId: String(peerUserId),
    peerName: String(peerName || "Friend"),
    mood: String(peerMood || ""),
    lastText: text,
    lastAt: now,
    unread: 0,
  });

  notifyConversationChanged();
  setTimeout(() => scrollToBottom(true), 50);

  if (String(callerId) === String(myUserId)) {
    try {
      const { data } = await sendMessage({
        conversationId: String(cid),
        receiverId: String(peerUserId),
        text: text, 
        messageType: "text",
        clientMessageId: clientMessageId,
        notifyUser: false, 
      } as any); 

      if (data?.message?._id) {
        setMessages((prev) => dedupeMessages(prev.map((m) =>
          m.clientMessageId === clientMessageId
            ? { ...m, _id: String(data.message._id), tickState: "delivered" }
            : m
        )));
      }
    } catch (e) {
      console.log("Failed to sync call log to backend", e);
    }
  }
};

    const onCallEnded = (payload: any) => handleCallLog(payload, `📞 Call ended (${formatPlaybackTime(payload?.duration || 0)})`);
    const onCallMissed = (payload: any) => handleCallLog(payload, "🔴 Missed Call");
    const onCallCancelled = (payload: any) => handleCallLog(payload, "🔴 Call Cancelled");
    const onCallBusy = (payload: any) => handleCallLog(payload, "🔴 User Busy");
    const onCallNoAnswer = (payload: any) => handleCallLog(payload, "🔴 No Response");
    const onCallRejected = (payload: any) => handleCallLog(payload, "🔴 Call Declined");

    socket?.on("call:ended", onCallEnded);
    socket?.on("call:missed", onCallMissed);
    socket?.on("call:cancelled", onCallCancelled);
    socket?.on("call:busy", onCallBusy);
    socket?.on("call:no-answer", onCallNoAnswer);
    socket?.on("call:rejected", onCallRejected);

    socket?.on("chat-message", handleChatMessage);
    socket?.on("typing", handleTyping);
    socket?.on("stop-typing", handleStopTyping);
    socket?.on("msg-delivered", handleMsgDelivered);
    socket?.on("msg-seen", handleMsgSeen);
    socket?.on("msg-deleted", handleMsgDeleted);
    socket?.on("msg-reacted", handleMsgReacted);

    return () => {
      socket?.off("chat-message", handleChatMessage);
      socket?.off("typing", handleTyping);
      socket?.off("stop-typing", handleStopTyping);
      socket?.off("msg-delivered", handleMsgDelivered);
      socket?.off("msg-seen", handleMsgSeen);
      socket?.off("msg-deleted", handleMsgDeleted);
      socket?.off("msg-reacted", handleMsgReacted);
      
      socket?.off("call:ended", onCallEnded);
      socket?.off("call:missed", onCallMissed);
      socket?.off("call:cancelled", onCallCancelled);
      socket?.off("call:busy", onCallBusy);
      socket?.off("call:no-answer", onCallNoAnswer);
      socket?.off("call:rejected", onCallRejected);
    };
  }, [myUserId, conversationId, peerUserId, normalizeServer]);

  const buildItemsWithDateSeparators = useCallback(
    (msgs: any[]) => {
      const out: Item[] = [];
      let lastDate = "";
      for (const m of msgs) {
        if (deletedForMe.has(String(m._id))) continue;
        if (m.deletedForEveryone) continue;
        const dk = dateKey(m.createdAt);
        if (dk !== lastDate) {
          lastDate = dk;
          out.push({ type: "date", id: `date-${dk}`, dateKey: dk });
        }
        out.push({ type: "msg", id: `msg_${stableMessageKey(m)}`, msg: m });
      }
      return out;
    },
    [deletedForMe]
  );

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) =>
      setOffline(!state.isConnected || state.isInternetReachable === false)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const onFocus = async () => {
      setActiveChatPeer(String(peerUserId));
      clearUnread(String(peerUserId));
    };
    const onBlur = () => setActiveChatPeer(null);
    onFocus();
    return onBlur;
  }, [peerUserId]);

  useEffect(() => {
    const built = buildItemsWithDateSeparators(messages);
    setItems([...built].reverse());
  }, [messages, buildItemsWithDateSeparators]);

  useEffect(() => {
    (async () => {
      if (conversationId || !myUserId || offline) return;
      try {
        const { data } = await openDirectConversation(String(peerUserId));
        const cid = data?.conversation?._id;
        if (cid) setConversationId(String(cid));
      } catch {}
    })();
  }, [peerUserId, conversationId, myUserId, offline]);

  const loadThread = useCallback(async () => {
  if (!conversationId || !myUserId) return;

  const cached = await loadThreadCacheV2(String(myUserId), String(conversationId));
  if (cached.length) {
    setMessages(dedupeMessages(normalizeServer(cached.map((m: any) => ({
      _id: m._id, senderId: m.senderId, receiverId: m.receiverId, text: m.text,
      messageType: m.messageType || "text", media: m.media || null, createdAt: m.createdAt,
      clientMessageId: m.clientMessageId, deliveredAt: m.deliveredAt, seenAt: m.seenAt,
    })))));
  } else { 
    setMessages([]); 
  }

  if (offline) return;

  try {
    const { data } = await fetchThread(String(conversationId), { limit: 200 });
    const serverMsgs = data?.messages || [];
    
    if (serverMsgs.length) {
      const normalizedServer = normalizeServer(serverMsgs);
      
      setMessages((prev) => {
        const serverClientIds = new Set(normalizedServer.map((m: any) => m.clientMessageId).filter(Boolean).map((x: any) => String(x)));
        const serverIds = new Set(normalizedServer.map((m: any) => String(m._id)));
        const stillPendingLocal = prev.filter((m: any) => {
          const isLocalId = String(m._id).startsWith("loc:");
          return isLocalId && !serverIds.has(String(m._id)) && !(m.clientMessageId && serverClientIds.has(String(m.clientMessageId)));
        });
        return dedupeMessages([...normalizedServer, ...stillPendingLocal]);
      });

      await saveThreadCacheV2(String(myUserId), String(conversationId), serverMsgs.map((m: any) => ({
        _id: String(m._id), conversationId: String(conversationId),
        senderId: String(m.senderId), receiverId: String(m.receiverId),
        text: String(m.text || ""), messageType: String(m.messageType || "text"),
        media: m.media || null, createdAt: m.createdAt, clientMessageId: m.clientMessageId,
        deliveredAt: m.deliveredAt || null, seenAt: m.seenAt || null,
      })));

      const last = serverMsgs[serverMsgs.length - 1];
      const previewText =
        last?.messageType === "image" ? "sent a Photo"
        : last?.messageType === "video" ? "sent a video"
        : (last?.messageType === "voice" || last?.messageType === "audio") ? "sent a voice message"
        : last?.messageType === "document" ? "sent a document"
        : String(last.text || "");
        
      await upsertPreviewV2(String(myUserId), {
        conversationId: String(conversationId), peerUserId: String(peerUserId),
        peerName: String(peerName || "Friend"), mood: String(peerMood || ""),
        lastText: previewText, lastAt: String(last.createdAt || new Date().toISOString()), unread: 0,
      });

      notifyConversationChanged();
    }
  } catch (e) {
    console.log("fetchThread failed", e);
    notifyConversationChanged();
  }
}, [conversationId, myUserId, peerUserId, peerName, peerMood, offline, normalizeServer]);

  useEffect(() => {
    if (conversationId) {
      loadThread();
    }
  }, [conversationId, loadThread]);

  useEffect(() => {
    const unsub = navigation.addListener("focus", async () => {
      if (didInitialAutoScrollRef.current && conversationId) {
        await loadThread();
      }
      didInitialAutoScrollRef.current = true;
    });
    
    return unsub;
  }, [navigation, loadThread, conversationId]);

  useEffect(() => {
    if (socketRef.current && conversationId) {
      socketRef.current.emit("join-conversation", conversationId);
    }
  }, [conversationId]);

  useEffect(() => {
    return () => {
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
    };
  }, []);

useEffect(() => {
  if (!conversationId || !myUserId || offline) return;
  
  const latestIncoming = messages
    .filter(m => String(m.toUserId) === String(myUserId) && !m.seenAt)
    .slice(-1)[0];

  if (latestIncoming) {
    if (socketRef.current) {
      socketRef.current.emit("mark-seen", {
        conversationId: String(conversationId),
        peerUserId: String(peerUserId),
        lastSeenMessageId: String(latestIncoming._id),
        myUserId: String(myUserId)
      });
    }

    setMessages(prev => prev.map(m => 
      (String(m.toUserId) === String(myUserId) && !m.seenAt)
        ? { ...m, seenAt: new Date().toISOString() }
        : m
    ));
  }
}, [messages.length, conversationId, myUserId, peerUserId, offline]); 

  useEffect(() => {
    if (!conversationId || !myUserId) return;
    (async () => {
      const ids = await getDeletedForMe(String(myUserId), String(conversationId));
      setDeletedForMe(ids);
    })();
  }, [myUserId, conversationId]);

  useEffect(() => {
  messages.forEach((m) => {
    const raw = String(m?.media?.url || "");
    if (!raw) return;
    const remote = (raw.startsWith("http://") || raw.startsWith("https://"))
      ? raw
      : `${newUrl}${raw.startsWith("/") ? "" : "/"}${raw}`;
    if (localMediaPaths[remote]) return;
    getCachedMediaPath(remote).then((localPath) => {
      if (localPath && localPath !== remote) {
        setLocalMediaPaths((prev) => ({ ...prev, [remote]: localPath }));
      }
    });
  });
}, [messages, newUrl]);


  const uploadOne = useCallback(
    async (f: { uri: string; name: string; type: string; thumbnailUri?: string; durationMs?: number; peaks?: number[] }) => {
      const form = new FormData();
      form.append("files", {
        uri: f.uri,
        name: f.name || `file_${Date.now()}`,
        type: f.type || "application/octet-stream",
      } as any);

      if (f.thumbnailUri) {
        form.append("thumbnail", {
          uri: f.thumbnailUri,
          name: `thumb_${Date.now()}.jpg`,
          type: "image/jpeg",
        } as any);
      }
      if (typeof f.durationMs === "number") {
        form.append("durationMs", String(f.durationMs));
      }
      if (f.peaks?.length) {
        form.append("peaks", JSON.stringify(f.peaks));
      }

      const res = await apiClient.post("/chat/messages/upload-multiple", form, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      const d = res?.data || {};
      if (!d?.files?.length) throw new Error("Upload failed");

      const media = d.files[0];
      return {
        messageType: media.messageType || detectTypeFromMime(media.mimeType),
        media: {
          ...media,
          thumbnailUrl: media.thumbnailUrl || media.thumbnail || undefined,
          localThumbnailUri: f.thumbnailUri,
          durationMs: media.durationMs || f.durationMs || 0,
          peaks: (media.peaks && media.peaks.length > 0) ? media.peaks : (f.peaks || []),
        },
      };
    },
    []
  );

  const sendMediaMessage = useCallback(async (uploaded: { messageType: string; media: any }) => {
    if (!conversationId || !myUserId) return;
    const now = new Date().toISOString();
    const clientMessageId = uuidv4();
    const localId = `loc:${clientMessageId}`;
    setMessages((prev) => dedupeMessages([...prev, {
      _id: localId, fromUserId: String(myUserId), toUserId: String(peerUserId),
      plaintext: "", messageType: uploaded.messageType, media: uploaded.media,
      createdAt: now, clientMessageId, tickState: "pending", deliveredAt: null, seenAt: null,
    }]));
    
    await upsertThreadMessageV2(String(myUserId), String(conversationId), {
      _id: localId, conversationId: String(conversationId), senderId: String(myUserId), receiverId: String(peerUserId),
      text: "", messageType: uploaded.messageType, media: uploaded.media,
      createdAt: now, clientMessageId, deliveredAt: null, seenAt: null,
    });
    
    await upsertPreviewV2(String(myUserId), {
      conversationId: String(conversationId), 
      peerUserId: String(peerUserId),
      peerName: String(peerName || "Friend"), 
      mood: String(peerMood || ""),
      lastText: uploaded.messageType === "image" ? "sent a Photo" : uploaded.messageType === "video" ? "sent a video" : (uploaded.messageType === "voice" || uploaded.messageType === "audio") ? "sent a voice message" : "sent a document",
      lastAt: now, 
      unread: 0,
    });
    
    notifyConversationChanged();
    const { data } = await sendMessage({
      conversationId: String(conversationId), receiverId: String(peerUserId),
      text: "", messageType: uploaded.messageType, media: uploaded.media,
      clientMessageId: String(clientMessageId), notifyUser: true,
    });
    const srv = data?.message;
    if (srv?._id) {
      setMessages((prev) => dedupeMessages(prev.map((mm) =>
        mm.clientMessageId === clientMessageId
          ? { ...mm, _id: String(srv._id), createdAt: srv.createdAt || mm.createdAt, media: { ...uploaded.media, ...(srv.media || {}) }, messageType: srv.messageType || mm.messageType, tickState: srv.seenAt ? "seen" : srv.deliveredAt ? "delivered" : "sent", deliveredAt: srv.deliveredAt || null, seenAt: srv.seenAt || null }
          : mm
      )));
  
    upsertThreadMessageV2(String(myUserId), String(conversationId), {
          _id: String(srv._id),
          conversationId: String(conversationId),
          senderId: String(myUserId),
          receiverId: String(peerUserId),
          text: String(text),
          messageType: "text",
          createdAt: srv.createdAt || now,
          clientMessageId: String(clientMessageId),
          deliveredAt: srv.deliveredAt || null,
          seenAt: srv.seenAt || null,
        }).catch(() => {});
      }
  }, [conversationId, myUserId, peerUserId, peerName, peerMood]);

  const processAndSendFiles = useCallback(async (files: Array<{ uri: string; type?: string; name?: string; fileSize?: number }>) => {
    if (!files.length) return;
    if (offline) return showGlassyError("You're offline. Media upload needs internet.");
    if (files.length > MAX_FILES) return showGlassyError(`Select up to ${MAX_FILES} files only.`);
    if (files.find((f) => Number(f.fileSize || 0) > MAX_SIZE)) return showGlassyError("Each file must be <= 50MB.");
    try {
      setSendingMedia(true);
      for (const f of files) {
        const isVideo = String(f.type || "").startsWith("video/");
        let thumbnailUri: string | undefined;
        if (isVideo) {
          try {
            const thumb = await createThumbnail({ url: f.uri, timeStamp: 0, format: "jpeg", quality: 0.7 });
            thumbnailUri = Platform.OS === "android" ? `file://${thumb.path}` : thumb.path;
          } catch (thumbErr) {
            console.log("thumbnail generation failed", thumbErr);
          }
        }
        const uploaded = await uploadOne({ ...f, thumbnailUri } as any);
        await sendMediaMessage(uploaded);
      }
      setTimeout(() => scrollToBottom(true), 80);
    } catch (e: any) { showGlassyError(e?.message || "Failed to send media"); }
    finally { setSendingMedia(false); }
  }, [offline, showGlassyError, uploadOne, sendMediaMessage, scrollToBottom]);

  const pickFromGallery = useCallback(async () => {
    try {
      setSheetOpen(false);
      const res = await launchImageLibrary({ mediaType: "mixed", selectionLimit: MAX_FILES, includeExtra: true });
      if (res.didCancel || !res.assets?.length) return;
      await processAndSendFiles(res.assets.map((a) => ({ uri: String(a.uri || ""), type: a.type, name: a.fileName || `media_${Date.now()}`, fileSize: a.fileSize })));
    } catch { showGlassyError("Could not open gallery"); }
  }, [processAndSendFiles, showGlassyError]);

  const openCameraPhoto = useCallback(async () => {
    try {
      setSheetOpen(false);
      const ok = await ensureCameraPerms();
      if (!ok) return showGlassyError("Camera permission denied");
      const res = await launchCamera({ mediaType: "photo", saveToPhotos: false, quality: 1 });
      if (res.didCancel || !res.assets?.length) return;
      await processAndSendFiles(res.assets.map((a) => ({ uri: String(a.uri || ""), type: a.type, name: a.fileName || `photo_${Date.now()}.jpg`, fileSize: a.fileSize })));
    } catch { showGlassyError("Could not open camera"); }
  }, [ensureCameraPerms, processAndSendFiles, showGlassyError]);

  const openCameraVideo = useCallback(async () => {
    try {
      setSheetOpen(false);
      const ok = await ensureCameraPerms();
      if (!ok) return showGlassyError("Camera/Mic permission denied");
      const res = await launchCamera({ mediaType: "video", videoQuality: "high", saveToPhotos: false });
      if (res.didCancel || !res.assets?.length) return;
      await processAndSendFiles(res.assets.map((a) => ({ uri: String(a.uri || ""), type: a.type, name: a.fileName || `video_${Date.now()}.mp4`, fileSize: a.fileSize })));
    } catch { showGlassyError("Could not record video"); }
  }, [ensureCameraPerms, processAndSendFiles, showGlassyError]);

  const pickDocuments = useCallback(async () => {
    try {
      setSheetOpen(false);
      const docs = await pick({ allowMultiSelection: true, type: [types.allFiles] });
      if (!docs?.length) return;
      if (docs.length > MAX_FILES) return showGlassyError(`Select up to ${MAX_FILES} files only.`);
      await processAndSendFiles(docs.map((d: any) => ({ uri: d.uri, type: d.type, name: d.name || `doc_${Date.now()}`, fileSize: d.size })));
    } catch (e: any) {
      const code = e?.code || e?.name;
      if (code === "DOCUMENT_PICKER_CANCELED" || code === "OPERATION_CANCELED" || code === "AbortError") return;
      showGlassyError("Could not pick documents");
    }
  }, [processAndSendFiles, showGlassyError]);

  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());

  const resetAllSwipes = useCallback(() => {
    swipeableRefs.current.forEach((swipeable) => {
      swipeable?.close?.();
    });
  }, []);

  const handleSwipeToReply = useCallback((msgId: string) => {
    const msg = messages.find((m) => String(m._id) === msgId);
    if (msg) {
      setReplyToMessage(msg);
      resetAllSwipes();
    }
  }, [messages, resetAllSwipes]);

  const scrollToMessage = useCallback((messageId: string) => {
    const builtItems = buildItemsWithDateSeparators(messages);
    const forwardIndex = builtItems.findIndex(item =>
      item.type === 'msg' && String(item.msg._id) === String(messageId)
    );
    if (forwardIndex === -1) { showGlassyError("Message not found"); return; }

    const invertedIndex = builtItems.length - 1 - forwardIndex;
    flatListRef.current?.scrollToIndex({ index: invertedIndex, animated: true, viewPosition: 0.5 });

    setHighlightedMessageId(messageId);
    setTimeout(() => setHighlightedMessageId(null), 1400);
  }, [messages, buildItemsWithDateSeparators, showGlassyError]);

  const onScrollToIndexFailed = useCallback((info: { index: number; highestMeasuredFrameIndex: number; averageItemLength: number }) => {
    flatListRef.current?.scrollToEnd({ animated: true });
    setTimeout(() => {
      flatListRef.current?.scrollToIndex({
        index: info.index,
        animated: true,
      });
    }, 100);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !conversationId || !myUserId) return;

    const now = new Date().toISOString();
    const clientMessageId = uuidv4();
    const localId = `loc:${clientMessageId}`;

    const currentReplyTo = replyToMessage;

    setInput("");
    if (hadTextRef.current) {
      hadTextRef.current = false;
      Animated.spring(inputHasTextAnim, { toValue: 0, useNativeDriver: false, tension: 280, friction: 22 }).start();
    }
    setReplyToMessage(null);

    setMessages((prev) => dedupeMessages([...prev, {
      _id: localId,
      fromUserId: String(myUserId),
      toUserId: String(peerUserId),
      plaintext: text,
      messageType: "text",
      media: null,
      createdAt: now,
      clientMessageId,
      tickState: "pending",
      deliveredAt: null,
      seenAt: null,
      replyTo: currentReplyTo?._id || null,
    }]));

    await upsertThreadMessageV2(String(myUserId), String(conversationId), {
      _id: localId,
      conversationId: String(conversationId),
      senderId: String(myUserId),
      receiverId: String(peerUserId),
      text,
      messageType: "text",
      media: null,
      createdAt: now,
      clientMessageId,
      deliveredAt: null,
      seenAt: null,
      replyTo: currentReplyTo?._id || null,
    });

    await upsertPreviewV2(String(myUserId), {
      conversationId: String(conversationId),
      peerUserId: String(peerUserId),
      peerName: String(peerName || "Friend"),
      mood: String(peerMood || ""),
      lastText: currentReplyTo ? `↩️ ${text}` : text,
      lastAt: now,
      unread: 0,
    });

    notifyConversationChanged();
    setTimeout(() => scrollToBottom(true), 50);

    if (offline) return;

    try {
      const { data } = await sendMessage({
        conversationId: String(conversationId),
        receiverId: String(peerUserId),
        text: String(text),
        messageType: "text",
        clientMessageId: String(clientMessageId),
        notifyUser: true,
        replyTo: currentReplyTo?._id || null,
      });

      const srv = data?.message;
      if (srv?._id) {
        setMessages((prev) => dedupeMessages(prev.map((m) =>
          m.clientMessageId === clientMessageId
            ? {
                ...m,
                _id: String(srv._id),
                createdAt: srv.createdAt || m.createdAt,
                tickState: srv.seenAt ? "seen" : srv.deliveredAt ? "delivered" : "sent",
                deliveredAt: srv.deliveredAt || null,
                seenAt: srv.seenAt || null,
                replyTo: srv.replyTo || m.replyTo,
              }
            : m
        )));
        upsertThreadMessageV2(String(myUserId), String(conversationId), {
          _id: String(srv._id),
          conversationId: String(conversationId),
          senderId: String(myUserId),
          receiverId: String(peerUserId),
          text: String(text),
          messageType: "text",
          createdAt: srv.createdAt || now,
          clientMessageId: String(clientMessageId),
          deliveredAt: srv.deliveredAt || null,
          seenAt: srv.seenAt || null,
        }).catch(() => {});
      }
      }
    catch {
      showGlassyError("Failed to send message");
    }
  }, [
    input, conversationId, myUserId, peerUserId, peerName, peerMood, offline,
    scrollToBottom, showGlassyError, replyToMessage
  ]);

  const resetVoiceRecordingState = useCallback(() => {
    setVoicePhase("idle");
    setVoiceElapsedMs(0);
    setVoiceLiveBars(new Array(VOICE_BAR_COUNT).fill(0.06));
    setVoicePreviewPath(null);
    setVoicePreviewDurationMs(0);
    setVoicePreviewPeaks([]);
    setVoicePreviewPlaying(false);
    setVoicePreviewProgress(0);
    voiceRecordedPeaksRef.current = [];
    voiceLockedRef.current = false;
    voiceCancelledRef.current = false;
    cancelDragX.setValue(0);
    lockDragY.setValue(0);
  }, [cancelDragX, lockDragY]);

  const downsamplePeaks = (raw: number[], bucketCount: number) => {
    if (!raw.length) return new Array(bucketCount).fill(0.08);
    const out: number[] = [];
    const bucketSize = raw.length / bucketCount;
    for (let i = 0; i < bucketCount; i++) {
      const start = Math.floor(i * bucketSize);
      const end = Math.max(start + 1, Math.floor((i + 1) * bucketSize));
      const slice = raw.slice(start, end);
      const avg = slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length);
      out.push(avg);
    }
    return out;
  };

  const startVoiceRecording = useCallback(async () => {
    if (offline) return showGlassyError("You're offline. Voice messages need internet to send.");
    const ok = await ensureMicPerms();
    if (!ok) return showGlassyError("Microphone permission denied");

    voiceCancelledRef.current = false;
    voiceLockedRef.current = false;
    voiceRecordedPeaksRef.current = [];
    cancelDragX.setValue(0);
    lockDragY.setValue(0);
    setVoiceElapsedMs(0);
    setVoiceLiveBars(new Array(VOICE_BAR_COUNT).fill(0.06));
    setVoicePhase("holding");
    recordStartTsRef.current = Date.now();
    lastRecordCallbackRef.current = 0;

    try {
      await recorder.startRecorder(undefined, undefined, true);
      
      recorder.addRecordBackListener((e: any) => {
        const now = Date.now();
        const elapsed = Number(e?.currentPosition || 0);
        
        let bar = 0.06;
        if (e?.currentMetering !== undefined && e.currentMetering > -150) {
          bar = meteringToBarHeight(Number(e.currentMetering));
        } else {
          bar = 0.1 + (Math.random() * 0.4);
        }

        voiceRecordedPeaksRef.current.push(bar);
        
        if (now - lastRecordCallbackRef.current > 150) {
          setVoiceElapsedMs(elapsed);
          setVoiceLiveBars((prev) => [...prev.slice(1), bar]);
          lastRecordCallbackRef.current = now;
        }

        if (elapsed >= MAX_VOICE_DURATION_MS) {
          stopVoiceRecordingToPreviewRef.current?.();
        }
      });
    } catch (e) {
      console.log("startRecorder failed", e);
      showGlassyError("Could not start recording");
      resetVoiceRecordingState();
    }
  }, [offline, ensureMicPerms, recorder, showGlassyError, resetVoiceRecordingState, cancelDragX, lockDragY]);

  const cancelVoiceRecording = useCallback(async () => {
    voiceCancelledRef.current = true;
    try {
      const uri = await safeStopRecorder();
      try { recorder.removeRecordBackListener(); } catch {}
      if (uri && !uri.startsWith("http")) {
        RNFS.unlink(uri).catch(() => {});
      }
    } catch {}
    resetVoiceRecordingState();
  }, [resetVoiceRecordingState]);

  const lockVoiceRecording = useCallback(() => {
    voiceLockedRef.current = true;
    setVoicePhase("locked");
    Animated.spring(cancelDragX, { toValue: 0, useNativeDriver: true }).start();
    Animated.spring(lockDragY, { toValue: 0, useNativeDriver: true }).start();
  }, [cancelDragX, lockDragY]);

  const stopVoiceRecordingToPreview = useCallback(async () => {
    try {
      const actualDurationMs = Date.now() - recordStartTsRef.current;
      const uri = await safeStopRecorder();
      try { recorder.removeRecordBackListener(); } catch {}
      await new Promise(r => setTimeout(r, 150));
      
      const peaks = downsamplePeaks(voiceRecordedPeaksRef.current, VOICE_PREVIEW_BAR_COUNT);
      
      if (actualDurationMs < 500) {
        if (uri && !uri.startsWith("http")) RNFS.unlink(uri).catch(() => {});
        resetVoiceRecordingState();
        return;
      }
      setVoicePreviewPath(uri);
      setVoicePreviewDurationMs(actualDurationMs);
      setVoicePreviewPeaks(peaks);
      setVoicePhase("preview");
    } catch (e) {
      console.log("stopRecorder failed", e);
      showGlassyError("Recording failed");
      resetVoiceRecordingState();
    }
  }, [resetVoiceRecordingState, showGlassyError]);

  const stopVoiceRecordingToPreviewRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    stopVoiceRecordingToPreviewRef.current = stopVoiceRecordingToPreview;
  }, [stopVoiceRecordingToPreview]);

  const sendVoiceMessage = useCallback(async (uri: string, durationMs: number, peaks: number[]) => {
    if (!conversationId || !myUserId) return;
    if (offline) return showGlassyError("You're offline. Voice messages need internet to send.");
    try {
      setSendingMedia(true);
      const fileUri = (Platform.OS === "android" && !uri.startsWith("file://")) ? `file://${uri}` : uri;
      const uploaded = await uploadOne({
        uri: fileUri,
        name: `voice_${Date.now()}.${Platform.OS === "ios" ? "m4a" : "mp4"}`,
        type: Platform.OS === "ios" ? "audio/m4a" : "audio/mp4",
        durationMs,
        peaks,
      });
      await sendMediaMessage({ messageType: "voice", media: uploaded.media });
      setTimeout(() => scrollToBottom(true), 80);
    } catch (e: any) {
      showGlassyError(e?.message || "Failed to send voice message");
    } finally {
      setSendingMedia(false);
    }
  }, [conversationId, myUserId, offline, showGlassyError, uploadOne, sendMediaMessage, scrollToBottom]);

  const releaseVoiceRecordingAndSend = useCallback(async () => {
    if (voiceCancelledRef.current) return;
    try {
      const actualDurationMs = Date.now() - recordStartTsRef.current;
      const uri = await safeStopRecorder();
      try { recorder.removeRecordBackListener(); } catch {}
      await new Promise(r => setTimeout(r, 150)); 
      
      const peaks = downsamplePeaks(voiceRecordedPeaksRef.current, VOICE_PREVIEW_BAR_COUNT);
      
      if (actualDurationMs < 500 || !uri) {
        if (uri && !uri.startsWith("http")) RNFS.unlink(uri).catch(() => {});
        resetVoiceRecordingState();
        return;
      }
      resetVoiceRecordingState();
      await sendVoiceMessage(uri, actualDurationMs, peaks);
    } catch (e) {
      console.log("release-to-send failed", e);
      showGlassyError("Failed to process voice message");
      resetVoiceRecordingState();
    }
  }, [resetVoiceRecordingState, showGlassyError, sendVoiceMessage]);

  const togglePreviewPlayback = useCallback(async () => {
    if (!voicePreviewPath) return;
    if (voicePreviewPlaying) {
      recorder.pausePlayer().catch(() => {});
      setVoicePreviewPlaying(false);
      return;
    }
    try {
      lastPlaybackCallbackRef.current = 0;
      await recorder.startPlayer(voicePreviewPath);
      
      recorder.addPlayBackListener((e: any) => {
        const now = Date.now();
        const dur = Number(e?.duration || voicePreviewDurationMs || 1);
        const current = Number(e?.currentPosition || 0);

        if (now - lastPlaybackCallbackRef.current > 100 || current >= dur - 30) {
          setVoicePreviewProgress(Math.min(1, current / dur));
          lastPlaybackCallbackRef.current = now;
        }
        
        if (current >= dur - 30) {
          setVoicePreviewPlaying(false);
          setVoicePreviewProgress(0);
          recorder.stopPlayer().catch(() => {});
          try { recorder.removePlayBackListener(); } catch {}
        }
      });
      setVoicePreviewPlaying(true);
    } catch (e) {
      console.log("preview playback failed", e);
      showGlassyError("Could not play preview");
    }
  }, [voicePreviewPath, voicePreviewPlaying, voicePreviewDurationMs, recorder, showGlassyError]);

  const discardPreviewAndClose = useCallback(async () => {
    recorder.stopPlayer().catch(() => {});
    try { recorder.removePlayBackListener(); } catch {}
    if (voicePreviewPath && !voicePreviewPath.startsWith("http")) {
      RNFS.unlink(voicePreviewPath).catch(() => {});
    }
    resetVoiceRecordingState();
  }, [recorder, voicePreviewPath, resetVoiceRecordingState]);

  const sendPreviewVoiceMessage = useCallback(async () => {
    if (!voicePreviewPath) return;
    const uri = voicePreviewPath;
    const durationMs = voicePreviewDurationMs;
    const peaks = voicePreviewPeaks;
    recorder.stopPlayer().catch(() => {});
    try { recorder.removePlayBackListener(); } catch {}
    resetVoiceRecordingState();
    await sendVoiceMessage(uri, durationMs, peaks);
  }, [voicePreviewPath, voicePreviewDurationMs, voicePreviewPeaks, recorder, resetVoiceRecordingState, sendVoiceMessage]);

  const toggleThreadVoicePlayback = useCallback(async (msgId: string, url: string) => {
    if (voicePlayback.activeMsgId === msgId && voicePlayback.isPlaying) {
      recorder.pausePlayer().catch(() => {});
      setVoicePlayback((p) => ({ ...p, isPlaying: false }));
      return;
    }
    if (voicePlayback.activeMsgId === msgId && !voicePlayback.isPlaying) {
      recorder.resumePlayer().then(() => {
        setVoicePlayback((p) => ({ ...p, isPlaying: true }));
      }).catch(() => {});
      return;
    }
    recorder.stopPlayer().catch(() => {});
    try { recorder.removePlayBackListener(); } catch {}
    try {
      lastPlaybackCallbackRef.current = 0;
      await recorder.startPlayer(url);
      setVoicePlayback({ activeMsgId: msgId, isPlaying: true, progress: 0 });
      
      recorder.addPlayBackListener((e: any) => {
        const now = Date.now();
        const dur = Number(e?.duration || 1);
        const current = Number(e?.currentPosition || 0);

        if (now - lastPlaybackCallbackRef.current > 100 || current >= dur - 30) {
          const ratio = Math.min(1, current / dur);
          setVoicePlayback((p) => (p.activeMsgId === msgId ? { ...p, progress: ratio } : p));
          lastPlaybackCallbackRef.current = now;
        }

        if (current >= dur - 30) {
          setVoicePlayback({ activeMsgId: null, isPlaying: false, progress: 0 });
          recorder.stopPlayer().catch(() => {});
          try { recorder.removePlayBackListener(); } catch {}
        }
      });
    } catch (e) {
      console.log("thread voice playback failed", e);
      showGlassyError("Could not play voice message");
    }
  }, [voicePlayback, recorder, showGlassyError]);

  const seekThreadVoicePlayback = useCallback(async (msgId: string, url: string, ratio: number) => {
    if (voicePlayback.activeMsgId === msgId) {
      const msg = messages.find(m => String(m._id) === msgId);
      const dur = Number(msg?.media?.durationMs || 0);
      if (dur > 0) {
        await recorder.seekToPlayer(dur * ratio);
      }
    } else {
       await toggleThreadVoicePlayback(msgId, url);
    }
  }, [voicePlayback, messages, recorder, toggleThreadVoicePlayback]);

  const micCallbacks = useRef({
    start: startVoiceRecording,
    cancel: cancelVoiceRecording,
    release: releaseVoiceRecordingAndSend,
    lock: lockVoiceRecording
  });

  useEffect(() => {
    micCallbacks.current = {
      start: startVoiceRecording,
      cancel: cancelVoiceRecording,
      release: releaseVoiceRecordingAndSend,
      lock: lockVoiceRecording
    };
  });

  const micPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        micCallbacks.current.start();
      },
      onPanResponderMove: (_evt, gesture) => {
        if (voiceLockedRef.current) return;
        const dx = Math.min(0, gesture.dx);
        const dy = Math.min(0, gesture.dy);
        cancelDragX.setValue(dx);
        lockDragY.setValue(dy);
        if (dx <= -SLIDE_TO_CANCEL_DISTANCE) {
          voiceCancelledRef.current = true;
        }
        if (dy <= -SLIDE_TO_LOCK_DISTANCE && !voiceCancelledRef.current) {
          micCallbacks.current.lock();
        }
      },
      onPanResponderRelease: () => {
        if (voiceLockedRef.current) return;
        if (voiceCancelledRef.current) {
          micCallbacks.current.cancel().catch(() => {});
        } else {
          micCallbacks.current.release().catch(() => {});
        }
      },
      onPanResponderTerminate: () => {
        if (voiceLockedRef.current) return;
        micCallbacks.current.cancel().catch(() => {});
      },
    })
  ).current;

  const handleLongPress = useCallback((msgId: string, isMe: boolean, layout: any) => {
    const msg = messages.find((m: any) => String(m._id) === msgId);
    if (msg) {
      setActiveMenu({ msgId, isMe, msg, position: layout });
    }
  }, [messages]);

  const dismissMenu = useCallback(() => setActiveMenu(null), []);

const handleReact = useCallback(async (emoji: string) => {
    if (!activeMenu || !conversationId) return;
    const msgId = activeMenu.msgId;
    dismissMenu();

    setMessages(prevMessages =>
      prevMessages.map(m => {
        if (String(m._id) !== msgId) return m;
        const myPrevReaction = (m.reactions || []).find((r: any) => String(r.userId) === String(myUserId));
        let newReactions;
        
        if (myPrevReaction && myPrevReaction.emoji === emoji) {
          newReactions = m.reactions.filter((r: any) => !(String(r.userId) === String(myUserId) && r.emoji === emoji));
        } else {
          newReactions = [
            ...m.reactions.filter((r: any) => String(r.userId) !== String(myUserId)),
            { userId: myUserId, emoji }
          ];
        }
        return { ...m, reactions: newReactions };
      })
    );

    if (socketRef.current) {
      const msgObj = messages.find((m: any) => String(m._id) === msgId);
      const myReaction = (msgObj?.reactions || []).find((r: any) => String(r.userId) === String(myUserId));
      
      const isRemoving = myReaction && myReaction.emoji === emoji;
      
      socketRef.current.emit("react-message", {
        messageId: msgId,
        emoji: isRemoving ? null : emoji, 
        myUserId: String(myUserId),
        conversationId: String(conversationId)
      });
    } else {
      showGlassyError("Reconnecting to chat server...");
    }
  }, [activeMenu, myUserId, messages, dismissMenu, showGlassyError, conversationId]);

  const handleDeleteForMe = useCallback(() => {
    if (!activeMenu) return;
    const msgId = activeMenu.msgId;
    dismissMenu();
    setDeletedForMe(prev => {
      const updated = new Set([...prev, msgId]);
      addDeletedForMe(String(myUserId), String(conversationId), msgId);
      return updated;
    });
    setMessages(prev => prev.filter(m => String(m._id) !== msgId));
  }, [activeMenu, conversationId, myUserId, dismissMenu]);

  const handleDeleteForEveryone = useCallback(async () => {
    if (!activeMenu) return;
    const msgId = activeMenu.msgId;
    dismissMenu();

    try {
      await deleteForEveryone({ messageId: msgId });
      await loadThread();
    } catch (e) {
      showGlassyError("Unable to delete for everyone.");
    }
  }, [activeMenu, loadThread, dismissMenu, showGlassyError]);

  const openEmojiPicker = useCallback(() => {
    if (!activeMenu) return;
    setEmojiPickerTarget({ msgId: activeMenu.msgId, isMe: activeMenu.isMe });
    setEmojiPickerVisible(true);
  }, [activeMenu]);

  const toggleReaction = useCallback((msgId: string, emoji: string) => {
    if (!conversationId) return;

    dismissMenu();
    setEmojiPickerVisible(false);
    setEmojiPickerTarget(null);

    const msgObj = messages.find((m: any) => String(m._id || m.clientMessageId) === String(msgId));
    const myPrevReaction = (msgObj?.reactions || []).find((r: any) => String(r.userId) === String(myUserId));
    const isRemoving = myPrevReaction && myPrevReaction.emoji === emoji;

    if (socketRef.current) {
      socketRef.current.emit("react-message", {
        messageId: msgId,
        emoji: isRemoving ? null : emoji,
        myUserId: String(myUserId),
        conversationId: String(conversationId),
      });
    } else {
      showGlassyError("Not connected to chat server");
    }

    setMessages((prevMessages) =>
      prevMessages.map((m) => {
        const currentMsgId = String(m._id || m.clientMessageId || "");
        if (currentMsgId !== String(msgId)) return m;

        let newReactions;
        if (isRemoving) {
          newReactions = (m.reactions || []).filter(
            (r: any) => !(String(r.userId) === String(myUserId) && r.emoji === emoji)
          );
        } else {
          newReactions = [
            ...(m.reactions || []).filter((r: any) => String(r.userId) !== String(myUserId)),
            { userId: myUserId, emoji },
          ];
        }
        return { ...m, reactions: newReactions };
      })
    );
  }, [conversationId, myUserId, messages, dismissMenu, showGlassyError]);

const handleImagePress = useCallback((type: string, url: string, name: string) => {
    // ⚡ Redirect to UserFeedScreen if it's a shared post
    if (type === 'shared_post') {
      try {
        // Parse the JSON data we sent from the button
        const data = JSON.parse(name);
        
        navigation.navigate("UserFeedScreen", { 
          userId: data.userId, 
          initialPostId: data.postId 
        });
      } catch (e) {
        // Fallback for older messages
        navigation.navigate("UserFeedScreen", { initialPostId: name });
      }
      return;
    }
    
    // Normal media handling
    if (type === 'image') openImageViewerCb(url);
    if (type === 'video') openVideoViewerCb(url);
    if (type === 'document') openDocInAppCb(url, name);
  }, [openImageViewerCb, openVideoViewerCb, openDocInAppCb, navigation]);

  const handleDoubleTap = useCallback((msgId: string, isMe: boolean) => {
    toggleReaction(msgId, "❤️");
  }, [toggleReaction]);

  const handleEmojiPickerSelect = useCallback((emoji: string) => {
    if (!emojiPickerTarget) return;
    toggleReaction(emojiPickerTarget.msgId, emoji);
  }, [emojiPickerTarget, toggleReaction]);

  const renderItem = useCallback(({ item, index }: { item: Item; index: number }) => {
    if (item.type === "date") {
      return (
        <View style={styles.dateRow}>
          <Text style={styles.dateText}>{formatDateHeader(item.dateKey)}</Text>
        </View>
      );
    }

    const m = item.msg;
    const isMe = String(m.fromUserId) === String(myUserId);
    const isHighlighted = highlightedMessageId === String(m._id);

    const isCallLog = String(m.clientMessageId || '').startsWith('call_log_') || String(m._id || '').startsWith('call_log_');

    const effectiveTickState = isMe && !m.seenAt && !m.deliveredAt &&
      (isMessageDeliveredLocally(String(m._id)) ||
        (m.clientMessageId && isMessageDeliveredLocally(String(m.clientMessageId))))
        ? "delivered"
        : m.tickState;

    const reactions = m.reactions || [];
    const hasReactions = reactions.length > 0;
    const grouped: Record<string, number> = {};
    reactions.forEach((r: any) => {
      grouped[r.emoji] = (grouped[r.emoji] || 0) + 1;
    });
    const reactionEmojis = Object.keys(grouped).join(',');
    const reactionCounts = Object.values(grouped).join(',');

    let replyBubble = null;
    if (m.replyTo && m.replyTo !== null) {
      let repliedMsg = typeof m.replyTo === 'object' ? m.replyTo : null;
      const originalMsgId = typeof m.replyTo === 'object' ? m.replyTo._id : m.replyTo;

      if (!repliedMsg && typeof m.replyTo === 'string') {
        repliedMsg = messages.find(msg => String(msg._id) === String(m.replyTo));
      }

      if (repliedMsg) {
        const isRepliedMsgMine = String(repliedMsg.fromUserId || repliedMsg.senderId) === String(myUserId);
        const repliedMediaUrl = repliedMsg.media?.url ?
          (repliedMsg.media.url.startsWith("http") ? repliedMsg.media.url : `${newUrl}${repliedMsg.media.url}`)
          : null;

        replyBubble = (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => scrollToMessage(originalMsgId)}
            style={[
              styles.replyBubbleTouchable,
              {
                alignSelf: isMe ? 'flex-end' : 'flex-start'
              }
            ]}
          >
            <View style={styles.replyBubble}>
              <View style={[
                styles.replyBubbleLeftBorder,
                { backgroundColor: isMe ? "#818cf8" : "#6366f1" }
              ]} />
              <View style={styles.replyBubbleContent}>
                <Text style={[
                  styles.replySender,
                  { color: isMe ? "#818cf8" : "#60a5fa" }
                ]}>
                  {isRepliedMsgMine ? "You" : (peerName || "Other")}
                </Text>
                <Text style={styles.replyContent} numberOfLines={1}>
                  {repliedMsg.messageType === 'image' ? 'sent a Photo' :
                   repliedMsg.messageType === 'video' ? 'sent a video' :
                   repliedMsg.messageType === 'voice' ? 'sent a voice message' :
                   repliedMsg.messageType === 'document' ? 'sent a document' :
                   (repliedMsg.plaintext || repliedMsg.text || 'Message')}
                </Text>
              </View>
              {repliedMsg.messageType !== 'text' && repliedMsg.messageType !== 'voice' && repliedMediaUrl && (
                <View style={styles.replyBubbleThumbnail}>
                  <Image
                    source={{ uri: repliedMediaUrl }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                  />
                  {repliedMsg.messageType === 'video' && (
                    <View style={{
                      ...StyleSheet.absoluteFill,
                      justifyContent: 'center',
                      alignItems: 'center',
                      backgroundColor: 'rgba(0,0,0,0.3)'
                    }}>
                      <Icon name="play" size={10} color="#fff" />
                    </View>
                  )}
                </View>
              )}
            </View>
          </TouchableOpacity>
        );
      }
    }

    const renderReplyIcon = (progress: Animated.AnimatedInterpolation<number>, dragX: Animated.AnimatedInterpolation<number>) => {
      const opacity = dragX.interpolate({
        inputRange: [0, 20, 60],
        outputRange: [0, 0.3, 1],
        extrapolate: 'clamp',
      });

      const scale = dragX.interpolate({
        inputRange: [0, 20, 60],
        outputRange: [0.3, 0.7, 1],
        extrapolate: 'clamp',
      });

      return (
        <Animated.View style={[styles.replyIconWrap, { opacity, transform: [{ scale }] }]}>
          <View style={styles.replyIconCircle}>
            <Icon name="reply" size={24} color="#fff" />
          </View>
        </Animated.View>
      );
    };

    return (
      <View style={[
        styles.msgRowOuter,
        isMe ? styles.msgRowOuterMe : styles.msgRowOuterOther,
        hasReactions && styles.msgRowWithReaction,
      ]}>
        <Swipeable
          ref={(ref) => {
            if (ref && m._id) swipeableRefs.current.set(String(m._id), ref);
          }}
          renderLeftActions={!isMe ? (prog, dragX) => renderReplyIcon(prog, dragX) : null}
          renderRightActions={isMe ? (prog, dragX) => {
            const negDragX = Animated.multiply(dragX, new Animated.Value(-1));
            return renderReplyIcon(prog, negDragX);
          } : null}
          onSwipeableLeftOpen={!isMe ? () => handleSwipeToReply(m._id) : undefined}
          onSwipeableRightOpen={isMe ? () => handleSwipeToReply(m._id) : undefined}
          leftThreshold={60}
          rightThreshold={60}
          friction={2}
          overshootFriction={8}
          overshootLeft={false}
          overshootRight={false}
        >
          <TapGestureHandler onActivated={() => handleDoubleTap(m._id, isMe)} numberOfTaps={2}>
            <View style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
              {replyBubble}
              <MessageBubble
                msgId={String(m._id)}
                fromUserId={String(m.fromUserId)}
                plaintext={String(m.plaintext || "")}
                messageType={String(m.messageType || "text")}
                mediaUrl={getMediaUrlCb(m)}
                mediaName={String(m?.media?.name || "")}
                mediaThumbnailUrl={getThumbnailUrlCb(m)}
                voiceDurationMs={Number(m?.media?.durationMs || 0)}
                voicePeaks={m?.media?.peaks || []}
                createdAt={String(m.createdAt)}
                tickState={String(effectiveTickState)}
                isMe={isMe}
                isHighlighted={isHighlighted}
                hasReactions={hasReactions}
                isCallLog={isCallLog}
                reactionEmojis={reactionEmojis}
                reactionCounts={reactionCounts}
                voicePlayback={voicePlayback}
                onLongPress={handleLongPress}
                onImagePress={handleImagePress}
                onToggleVoicePlay={toggleThreadVoicePlayback}
                onSeekVoicePlay={seekThreadVoicePlayback}
              />
            </View>
          </TapGestureHandler>
        </Swipeable>

        {hasReactions && (
          <ReactionBadge
            isMe={isMe}
            reactionEmojis={reactionEmojis}
            reactionCounts={reactionCounts}
          />
        )}
      </View>
    );
  }, [myUserId, handleLongPress, getMediaUrlCb, getThumbnailUrlCb, handleImagePress, handleSwipeToReply,
      handleDoubleTap, messages, peerName, resetAllSwipes, highlightedMessageId, voicePlayback, toggleThreadVoicePlayback, seekThreadVoicePlayback]);

  const keyExtractor = useCallback((item: Item) => item.id, []);

  const attachMicOpacity = inputHasTextAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const attachMicScale = inputHasTextAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] });
  const sendOpacity = inputHasTextAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const sendScale = inputHasTextAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  
  const plusWidth = inputHasTextAnim.interpolate({ inputRange: [0, 1], outputRange: [46, 0] });
  const plusOpacity = inputHasTextAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const plusMargin = inputHasTextAnim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] });

  const isRecordingFlow = voicePhase !== "idle";

  const attachIconAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(attachIconAnim, {
      toValue: sheetOpen ? 1 : 0,
      useNativeDriver: true,
      tension: 280,
      friction: 22,
    }).start();
  }, [sheetOpen]);

  const attachIconRotate = attachIconAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "45deg"]
  });

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={{ flex: 1,marginBottom: Platform.OS === "ios" ? 20 : 0  }}
        behavior={Platform.OS === "ios" ? "" : "height"}
      >
        <View style={styles.container}>
          <View style={styles.topBar}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
              <Icon name="arrow-left" size={22} color="#fff" />
            </TouchableOpacity>

            {/* ⚡ BLOCK LOGIC: Disable profile click if blocked */}
            <TouchableOpacity
              style={styles.titlePressable}
              activeOpacity={0.7}
              onPress={() => navigation.navigate("ProfilePreview", { userId: String(peerUserId) })}
              disabled={isBlockedChat}
            >
              {/* ⚡ BLOCK LOGIC: Hide DP if blocked */}
              {resolvedPeerAvatar && !avatarFailed && !isBlockedChat ? (
                <Image
                  source={{ uri: newUrl + resolvedPeerAvatar }}
                  style={styles.headerAvatar}
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                <View style={styles.headerAvatarFallback}>
                  <Icon name="account" size={18} color="#cbd5e1" />
                </View>
              )}
              <Text numberOfLines={1} style={styles.title}>
                {peerName || "Friend"}
             
               {tick === "verified" && (
                    <Icon name="check-decagram" size={20} color="#3b82f6" style={styles.tickIcon} />
                )}
                  {tick === "golden" && (
                     <Icon name="check-decagram" size={20} color="#fbbf24" style={styles.tickIcon} />
                  )}
                {isPremium && (
                   <Icon name="star-circle" size={20} color="#fbbf24" style={{ marginLeft: 5 }} />
                              )}
                               </Text>
            </TouchableOpacity>

            {/* ⚡ BLOCK LOGIC: Hide Call Button if blocked */}
            {!isBlockedChat && (
              <TouchableOpacity style={styles.iconBtn} onPress={handleVoiceCallPress}>
                <Icon name="phone-outline" size={20} color="#fff" />
              </TouchableOpacity>
            )}
          </View>

          {peerTyping && !isBlockedChat && (
            <View style={{ paddingHorizontal: 22, paddingBottom: 6 }}>
              <Text style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: 13 }}>
                {peerName || "Friend"} is typing...
              </Text>
            </View>
          )}
          
          <FlatList
            ref={flatListRef}
            onScrollToIndexFailed={onScrollToIndexFailed}
            data={items}
            extraData={messages} 
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            inverted={true}
            contentContainerStyle={{ paddingTop: 8, paddingBottom: 12 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onScrollBeginDrag={() => Keyboard.dismiss()}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews={false}
            initialNumToRender={20}
            windowSize={10}
            maxToRenderPerBatch={5}
            updateCellsBatchingPeriod={50}
            onScroll={(e) => {
              isNearBottomRef.current = e.nativeEvent.contentOffset.y < 100;
            }}
            scrollEventThrottle={16}
          />
        </View>

        <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
          <View style={styles.inputBar}>
            {/* ⚡ BLOCK LOGIC: Replace Input Area with Blocked Banner */}
            {isBlockedChat ? (
              <View style={styles.blockedContainer}>
                <Icon name="lock-outline" size={18} color="#94a3b8" style={{ marginRight: 8 }} />
                <Text style={styles.blockedText}>
                  {didIBlock 
                    ? "You blocked this account." 
                    : "You cannot reply to this conversation."}
                </Text>
              </View>
            ) : (
              <>
                {!isRecordingFlow && replyToMessage && (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => replyToMessage._id && scrollToMessage(replyToMessage._id)}
                    style={styles.replyPreviewContainer}
                  >
                    <View style={styles.replyPreviewLeftBorder} />
                    {replyToMessage.messageType !== 'text' && replyToMessage.messageType !== 'voice' && replyToMessage.media?.url && (
                      <View style={styles.replyPreviewThumbnail}>
                        {replyToMessage.messageType === 'image' ? (
                          <Image source={{ uri: getMediaUrlCb(replyToMessage) }} style={styles.replyPreviewThumbImage} />
                        ) : replyToMessage.messageType === 'video' ? (
                          <View style={styles.replyPreviewThumbVideo}>
                            <Image source={{ uri: getMediaUrlCb(replyToMessage) }} style={styles.replyPreviewThumbImage} blurRadius={2} />
                            <View style={styles.replyPreviewPlayIcon}>
                              <Icon name="play" size={12} color="#fff" />
                            </View>
                          </View>
                        ) : null}
                      </View>
                    )}
                    <View style={styles.replyPreviewContent}>
                      <Text style={styles.replyPreviewName} numberOfLines={1}>
                        {String(replyToMessage.fromUserId) === String(myUserId) ? "You" : peerName}
                      </Text>
                      <Text style={styles.replyPreviewText} numberOfLines={1}>
                        {replyToMessage.messageType === 'image' ? 'sent a Photo' :
                         replyToMessage.messageType === 'video' ? 'sent a video' :
                         replyToMessage.messageType === 'voice' ? 'sent a voice message' :
                         replyToMessage.messageType === 'document' ? 'sent a document' :
                         replyToMessage.plaintext || 'Message'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.replyPreviewClose}
                      onPress={(e) => { e.stopPropagation(); setReplyToMessage(null); resetAllSwipes(); }}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Icon name="close" size={16} color="#94a3b8" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                )}

                <View style={[styles.inputRow, isRecordingFlow && { opacity: 0 }]} pointerEvents={isRecordingFlow ? "none" : "auto"}>
                  <TextInput
                    style={[styles.input, replyToMessage && styles.inputWithReply]}
                    placeholder={offline ? "Offline: message will stay local" : "Type a message"}
                    placeholderTextColor="#94a3b8"
                    value={input}
                    onChangeText={handleInputChange}
                    multiline
                  />

                  {sendingMedia ? (
                    <View style={styles.sendBtn}><ActivityIndicator size="small" color="#fff" /></View>
                  ) : (
                    <>
                      <View style={styles.morphSlotsWrap}>
                        <Animated.View
                          style={[
                            styles.morphSlotAbsolute,
                            { opacity: attachMicOpacity, transform: [{ scale: attachMicScale }] },
                          ]}
                          pointerEvents={input.trim().length ? "none" : "auto"}
                        >
                          <View style={styles.micBtn} {...micPanResponder.panHandlers}>
                            <Icon name="microphone" size={20} color="#fff" />
                          </View>
                        </Animated.View>

                        <Animated.View
                          style={[
                            styles.morphSlotAbsolute,
                            { opacity: sendOpacity, transform: [{ scale: sendScale }] },
                          ]}
                          pointerEvents={input.trim().length ? "auto" : "none"}
                        >
                          <TouchableOpacity style={styles.sendBtn} onPress={send}>
                            <Icon name="send" size={20} color="#fff" />
                          </TouchableOpacity>
                        </Animated.View>
                      </View>

                      <Animated.View style={{ width: plusWidth, opacity: plusOpacity, marginLeft: plusMargin, overflow: 'hidden' }}>
                        <TouchableOpacity style={styles.attachBtnRight} onPress={() => setSheetOpen(!sheetOpen)}>
                          <Animated.View style={{ transform: [{ rotate: attachIconRotate }] }}>
                            <Icon name="plus" size={24} color="#fff" />
                          </Animated.View>
                        </TouchableOpacity>
                      </Animated.View>
                    </>
                  )}
                </View>

                {isRecordingFlow && (
                  <View style={styles.recordingOverlayAbsolute}>
                    <VoiceRecordOverlay
                      phase={(voicePhase === "idle" ? "holding" : voicePhase) as "holding" | "locked" | "preview"}
                      elapsedMs={voiceElapsedMs}
                      liveBars={voiceLiveBars}
                      cancelDragX={cancelDragX}
                      lockDragY={lockDragY}
                      isLocked={voicePhase === "locked"}
                      previewPeaks={voicePreviewPeaks}
                      previewDurationMs={voicePreviewDurationMs}
                      isPreviewPlaying={voicePreviewPlaying}
                      previewProgress={voicePreviewProgress}
                      onTogglePreviewPlay={togglePreviewPlayback}
                      onDeleteAndClose={voicePhase === "preview" ? discardPreviewAndClose : cancelVoiceRecording}
                      onStopToPreview={stopVoiceRecordingToPreview}
                      onSend={sendPreviewVoiceMessage}
                    />
                  </View>
                )}
              </>
            )}
          </View>
        </KeyboardStickyView>
      </KeyboardAvoidingView>

      <Modal visible={imageViewerVisible} transparent animationType="fade" onRequestClose={() => setImageViewerVisible(false)}>
        <View style={styles.imageViewerRoot}>
          <TouchableOpacity style={styles.imageViewerClose} onPress={() => setImageViewerVisible(false)}>
            <Icon name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <Image source={{ uri: activeImageUrl }} style={styles.imageViewerImage} resizeMode="contain" />
        </View>
      </Modal>

      <Modal
        visible={videoViewerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setVideoViewerVisible(false)}
      >
        <View style={styles.videoViewerRoot}>
          <TouchableOpacity
            style={styles.imageViewerClose}
            onPress={() => setVideoViewerVisible(false)}
          >
            <Icon name="close" size={24} color="#fff" />
          </TouchableOpacity>
          {videoViewerVisible && activeVideoUrl ? (
            <VideoViewerContent uri={activeVideoUrl} />
          ) : null}
        </View>
      </Modal>

      <AttachMenu
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCamera={openCameraPhoto}
        onVideo={openCameraVideo}
        onGallery={pickFromGallery}
        onDocument={pickDocuments}
      />

      {activeMenu && (
        <MsgActionMenu
          menu={activeMenu}
          newUrl={newUrl}
          myUserId={myUserId}
          currentReaction={reactions[activeMenu.msgId]}
          onReact={(emoji) => toggleReaction(activeMenu.msgId, emoji)}
          onDeleteForEveryone={activeMenu.isMe ? handleDeleteForEveryone : undefined}
          onDeleteForMe={handleDeleteForMe}
          onDismiss={dismissMenu}
          openEmojiPicker={openEmojiPicker}
        />
      )}

      <Modal visible={emojiPickerVisible} transparent animationType="slide" onRequestClose={() => setEmojiPickerVisible(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.48)' }}>
          <View style={{ backgroundColor: '#192134', padding: 8, borderTopLeftRadius: 18, borderTopRightRadius: 18 }}>
            <EmojiSelector
              onEmojiSelected={handleEmojiPickerSelect}
              showSearchBar showTabs showHistory
              category={Categories.all}
              columns={8}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#020617" },
  root: { flex: 1, backgroundColor: "#020617" },
  innerContainer: { flex: 1, backgroundColor: "#020617" },
  
  // ⚡ Blocked UI Styles
  blockedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.1)'
  },
  blockedText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center'
  },

  replyBubbleTouchable: {
    marginBottom: 2,
    marginTop: 2,
    maxWidth: '80%',
  },
  replyBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    minHeight: 36,
    width: '100%',
  },
  replyBubbleLeftBorder: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 2,
    marginRight: 8,
  },
  replyBubbleContent: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  replyBubbleThumbnail: {
    width: 28,
    height: 28,
    borderRadius: 4,
    marginLeft: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  replySender: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 1,
  },
  replyContent: {
    fontSize: 12,
    color: "#cbd5e1",
    lineHeight: 16,
  },
  replyPreviewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30,41,59,0.6)',
    borderRadius: 12,
    marginHorizontal: 12,
    marginBottom: 8,
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    maxWidth: '85%',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: "rgba(99,102,241,0.15)",
  },
  replyPreviewThumbnail: {
    width: 36,
    height: 36,
    borderRadius: 6,
    marginRight: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  replyPreviewThumbImage: {
    width: '100%',
    height: '100%',
    borderRadius: 6,
  },
  replyPreviewThumbVideo: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  replyPreviewPlayIcon: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  replyPreviewContent: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  replyPreviewName: {
    color: "#6e70e5",
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 2,
  },
  replyPreviewText: {
    color: "#b7bfc9",
    fontSize: 13,
    lineHeight: 16,
  },
  replyPreviewClose: {
    padding: 4,
    marginLeft: 8,
    borderRadius: 12,
  },
  highlightedMessageContainer: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderRadius: 12,
    transform: [{ scale: 1.02 }],
  },
  baseBackground: { ...StyleSheet.absoluteFill, backgroundColor: "#020617" },
  errorCard: { position: "absolute", top: 16, left: 12, right: 12, zIndex: 20, flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 14, backgroundColor: "rgba(127, 29, 29, 0.45)", borderWidth: 1, borderColor: "rgba(248, 113, 113, 0.5)" },
  errorText: { color: "#FEE2E2", marginLeft: 8, fontSize: 12, flex: 1 },
  container: { flex: 1, paddingTop: 16, paddingHorizontal: 12 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 1, paddingVertical: 6, marginTop: 0 },
  iconBtn: { width: 42, height: 42, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(148,163,184,0.35)", marginRight: 8 },
  titlePressable: { flex: 1, marginLeft: 12, marginRight: 10, paddingVertical: 4, flexDirection: "row", alignItems: "center" },
  headerAvatar: { width: 34, height: 34, borderRadius: 17, marginRight: 10, borderWidth: 1, borderColor: "rgba(148,163,184,0.35)", backgroundColor: "rgba(255,255,255,0.08)" },
  headerAvatarFallback: { width: 34, height: 34, borderRadius: 17, marginRight: 10, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(148,163,184,0.35)" },
  title: { color: "#fff", fontSize: 18, fontWeight: "700", flex: 1 },
  listContent: { paddingVertical: 8 },
  dateRow: { alignItems: "center", marginVertical: 10 },
  dateText: { color: "#cbd5e1", fontSize: 12, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(148,163,184,0.25)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: "hidden" },
  msgRow: { minWidth: "100%", flexDirection: "row", marginBottom: 8, alignItems: "flex-end" },
  msgRowMe: { justifyContent: "flex-end" },
  msgRowOther: { justifyContent: "flex-start" },
  msgRowOuter: { width: "100%", position: "relative" },
  msgRowOuterMe: { alignItems: "flex-end" },
  msgRowOuterOther: { alignItems: "flex-start" },
  msgRowWithReaction: { marginBottom: 10 },
  bubble: { paddingHorizontal: 0, paddingVertical: 0, maxWidth: "100%", minWidth: 5, position: "relative", alignSelf: "flex-start" },
  bubbleMe: { backgroundColor: "transparent" },
  bubbleOther: { backgroundColor: "transparent" },
  textBubbleMe: { 
    backgroundColor: "#4f46e5", 
    paddingHorizontal: 12, 
    paddingVertical: 8, 
    borderRadius: 16, 
    borderBottomRightRadius: 4 
  },
  textBubbleOther: { 
    backgroundColor: "rgba(255,255,255,0.08)", 
    paddingHorizontal: 12, 
    paddingVertical: 8, 
    borderRadius: 16, 
    borderBottomLeftRadius: 4 
  },
  text: { color: "#fff", flexShrink: 1, flexWrap: "wrap" },
  mediaContainer: { paddingBottom: 0 },
  mediaImage: { width: 190, height: 220, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.08)" },
  videoWrap: {
    width: 220,
    height: 200,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#2a3142",
    alignItems: "center",
    justifyContent: "center",
  },
  videoThumbTint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(15,20,35,0.30)",
  },
  videoThumbPlayCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.20)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  videoViewerRoot: {
    flex: 1,
    backgroundColor: "#000",
  },
  videoViewerContainer: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
  },
  videoViewerPlayer: {
    flex: 1,
    width: "100%",
    backgroundColor: "#000",
  },
  videoControlsBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    paddingBottom: 24,
    backgroundColor: "rgba(0,0,0,0.55)",
    gap: 10,
  },
  callLogBubbleMe: { backgroundColor: "rgba(15,23,42,0.85)", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderBottomRightRadius: 4, borderWidth: 1, borderColor: "rgba(99,102,241,0.2)" },
  callLogBubbleOther: { backgroundColor: "rgba(15,23,42,0.85)", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: "rgba(148,163,184,0.15)" },
  videoControlsPlayBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  videoControlsTime: {
    color: "#fff",
    fontSize: 12,
    minWidth: 36,
    textAlign: "center",
  },
  videoSeekTrack: {
    flex: 1,
    height: 28,
    justifyContent: "center",
  },
  videoSeekTrackBg: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  videoSeekTrackFill: {
    position: "absolute",
    left: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#6366f1",
  },
  videoSeekThumb: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#fff",
    marginLeft: -6,
  },
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minWidth: 180,
    maxWidth: 220
  },
  docName: { color: "#fff", marginLeft: 8, flex: 1, fontSize: 12 },
  metaRow: { flexDirection: "row", alignItems: "center", alignSelf: "flex-end", marginTop: 4, marginLeft: 5 },
  metaRowMedia: { position: "absolute", right: 0, bottom: 6, flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  tickIcon: { marginRight: 4 },
  timeText: { color: "rgba(255,255,255,0.9)", fontSize: 11, marginRight: 4 },

  voiceBubbleRow: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 200,
    maxWidth: 240,
    paddingVertical: 2,
  },
  voiceBubbleRowMe: {},
  voiceBubbleRowOther: {},
  voicePlayBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  voiceWaveform: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    height: 36, 
    gap: 2,
    overflow: "hidden", 
  },
  voiceWaveformBar: {
    width: 2.5,
    borderRadius: 2,
  },
  voiceTimeText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    marginLeft: 8,
    minWidth: 32,
  },

  inputBar: {
    paddingTop: 8,
    paddingBottom: 20,
    backgroundColor: "#020617",
    borderTopWidth: 1,
    borderTopColor: "rgba(148,163,184,0.12)",
    position: 'relative',
  },
  inputRow: {
    flexDirection: "row",
    paddingHorizontal: 10,
    alignItems: "flex-end",
    backgroundColor: "transparent"
  },
  attachBtnRight: { 
    width: 40, 
    height: 40, 
    borderRadius: 20, 
    backgroundColor: "rgba(255,255,255,0.08)", 
    alignItems: "center", 
    justifyContent: "center", 
    marginBottom: 4,
    borderWidth: 1, 
    borderColor: "rgba(148,163,184,0.35)" 
  },
  micBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#6366f1", alignItems: "center", justifyContent: "center" },
  input: { 
    flex: 1, 
    color: "#fff", 
    paddingHorizontal: 16, 
    paddingTop: 10,
    paddingBottom: 10, 
    backgroundColor: "rgba(255,255,255,0.05)", 
    borderRadius: 20, 
    marginRight: 8, 
    minHeight: 40,
    maxHeight: 140, 
    borderWidth: 1, 
    borderColor: "rgba(148,163,184,0.5)",
    textAlignVertical: 'center'
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#6366f1", alignItems: "center", justifyContent: "center" },
  morphSlotsWrap: { width: 40, height: 40, justifyContent: "center", marginBottom: 4 },
  morphSlotAbsolute: { position: "absolute", left: 0, top: 0 },

  recordingOverlayAbsolute: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#020617',
    zIndex: 10,
    justifyContent: 'center'
  },

  imageViewerRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)", justifyContent: "center", alignItems: "center", height: "100%" },
  imageViewerClose: { position: "absolute", top: 50, right: 18, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  imageViewerImage: { width: "100%", height: "85%" },

  replyActionContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    backgroundColor: 'transparent',
  },
  replyActionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: "#6366f1",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 5,
  },
  reactionBadge: {
    position: "absolute",
    bottom: -10,
    minWidth: 28,
    height: 22,
    paddingHorizontal: 6,
    backgroundColor: "#1e2433",
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
    borderWidth: 1.5,
    borderColor: "#020617",
    zIndex: 30,
  },
  reactionBadgeText: {
    fontSize: 12,
    color: "#fff",
    lineHeight: 14,
  },
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59,130,246,0.17)',
    borderLeftWidth: 3,
    borderLeftColor: "#6366f1",
    marginBottom: 6,
    borderRadius: 9,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  replyText: { color: "#fff", fontSize: 13, flex: 1, marginRight: 8 },
  inputWithReply: {
    borderColor: "rgba(99,102,241,0.5)",
    backgroundColor: "rgba(99,102,241,0.08)",
  },
  replyIconWrap: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 70,
    height: '100%',
    backgroundColor: 'transparent',
  },
  replyIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: "#6366f1",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },

  voiceOverlayRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    height: 48,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 12,
    marginHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.25)",
  },
  voiceOverlayIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  voiceRecDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#ef4444",
    marginRight: 8,
  },
  voiceOverlayTimer: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "600",
    minWidth: 40,
  },
  voiceLiveWaveform: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    height: 28,
    gap: 2,
    marginLeft: 8,
    overflow: "hidden",
  },
  voiceSlideToCancel: {
    position: "absolute",
    right: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  voiceSlideToCancelText: {
    color: "#94a3b8",
    fontSize: 12,
    marginLeft: 2,
  },
  voiceLockPill: {
    position: "absolute",
    top: -52,
    right: 56, 
    width: 34,
    height: 64,
    borderRadius: 17,
    backgroundColor: "rgba(15,23,42,0.92)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.3)",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  voiceOverlayStopBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  voicePreviewPlayBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#6366f1",
    alignItems: "center",

    justifyContent: "center",
    marginRight: 8,
  },
  voicePreviewWaveform: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    height: 28,
    gap: 2,
    overflow: "hidden",
  },
  voiceOverlaySendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#6366f1",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  // ⚡ SHARED POST STYLES
  sharedPostCard: {
    width: 240,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
  },
  sharedPostHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
  },
  sharedPostHeaderName: {
    color: "#F8FAFC",
    fontSize: 13,
    fontWeight: "600",
    marginLeft: 6,
  },
  sharedPostImageWrap: {
    width: "100%",
    height: 240,
    position: "relative",
  },
  sharedPostImage: {
    width: "100%",
    height: "100%",
    backgroundColor: "#1E293B",
  },
  sharedPostPlayOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  sharedPostFooter: {
    padding: 12,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
  },
  sharedPostCaption: {
    color: "#CBD5E1",
    fontSize: 12,
    marginBottom: 10,
    lineHeight: 16,
  },
  sharedPostBtn: {
    flexDirection: "row",
    backgroundColor: "#6366F1",
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  sharedPostBtnText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "700",
  },
});