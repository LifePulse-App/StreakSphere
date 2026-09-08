import React, { useEffect, useState, useCallback, useContext, useRef } from "react";
import {
  ScrollView,
  View,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  StatusBar,
  Platform,
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  TouchableWithoutFeedback,
  TextInput,
  Keyboard,
  Modal,
  useWindowDimensions,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Text } from "@rneui/themed";
import { AnimatedCircularProgress } from "react-native-circular-progress";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import Icon1 from "react-native-vector-icons/MaterialIcons";
import NetInfo from "@react-native-community/netinfo";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { TrueSheet } from "@lodev09/react-native-true-sheet";
import RNFS from "react-native-fs";

import MainLayout from "../../../../shared/components/MainLayout";
import AppScreen from "../../../../components/Layout/AppScreen/AppScreen";
import DashboardService from "../../services/api_dashboard";
import socialApi from "../../../friends/services/api_friends";
import FeedAPI from "../../../activity-feed/services/api_feed"; 
import DeviceInfo from "react-native-device-info";
import { ensureDeviceKeys, getUnreadChatCount, subscribeUnreadChanges } from "../../../chat/services/ChatNotifications"; 
import AuthContext from "../../../../auth/user/UserContext";
import { getStableDeviceId } from "../../../../shared/services/stableDeviceId";
import AsyncStorage from "@react-native-async-storage/async-storage";
import FastImage from "react-native-fast-image";

import { getAvatar } from "../../../../storage/AvatarManager"; 
import api_profile from "../../../profile/services/api_profile";
import apiClient from "../../../../auth/api-client/api_client"; 
import GlassyRateCard from "../../../../shared/components/GlassyRateCard";

const BASE_DIR = RNFS.DocumentDirectoryPath + "/streaksphere/avatar";
const baseUrl = apiClient.getBaseURL();
const newUrl = baseUrl.replace(/\/api\/?$/, "");

const DASHBOARD_CACHE_KEY = "dashboard:summary:v1";
const TODAY_HABITS_CACHE_KEY = "dashboard:todayHabits:v1";

const GLASS_BG = "rgba(15, 23, 42, 0.65)";
const GLASS_BORDER = "rgba(148, 163, 184, 0.35)";
const ICON_GLASS_BG = "rgba(15, 23, 42, 0)";

const MOOD_METADATA: Record<
  string,
  { label: string; icon: string; color?: string }
> = {
  ecstatic: { label: "Ecstatic", icon: "emoticon-excited-outline", color: "#FACC15" },
  happy: { label: "Happy", icon: "emoticon-happy-outline", color: "#FBBF24" },
  grateful: { label: "Grateful", icon: "hand-heart-outline", color: "#F97316" },
  calm: { label: "Calm", icon: "meditation", color: "#22C55E" },
  relaxed: { label: "Relaxed", icon: "emoticon-neutral-outline", color: "#38BDF8" },
  lovely: { label: "Lovely", icon: "heart-outline", color: "#FB7185" },

  neutral: { label: "Okay", icon: "emoticon-neutral-outline", color: "#9CA3AF" },
  meh: { label: "Meh", icon: "minus-circle-outline", color: "#9CA3AF" },
  tired: { label: "Tired", icon: "sleep", color: "#818CF8" },
  confused: { label: "Confused", icon: "help-circle-outline", color: "#F97316" },

  sad: { label: "Sad", icon: "emoticon-sad-outline", color: "#60A5FA" },
  lonely: { label: "Lonely", icon: "account-off-outline", color: "#6B7280" },
  discouraged: { label: "Discouraged", icon: "arrow-down-bold-circle-outline", color: "#F97316" },
  numb: { label: "Numb", icon: "emoticon-dead-outline", color: "#9CA3AF" },

  anxious: { label: "Anxious", icon: "alert-circle-outline", color: "#F97316" },
  stressed: { label: "Stressed", icon: "clock-alert-outline", color: "#FBBF24" },
  overwhelmed: { label: "Overwhelmed", icon: "water", color: "#38BDF8" },

  annoyed: { label: "Annoyed", icon: "emoticon-angry-outline", color: "#FB923C" },
  frustrated: { label: "Frustrated", icon: "emoticon-angry-outline", color: "#F97316" },
  angry: { label: "Angry", icon: "emoticon-angry-outline", color: "#EF4444" },
};

type Comment = {
  id: string;
  postId: string;
  parentId?: string;
  user: {
    id: string;
    name: string;
    username: string;
    avatar: string;
    avatarVersion?: number;
    isVerified?: boolean;
    tick?: string;        
    isPremium?: boolean;  
    isAdmin?: boolean;
  };
  text: string;
  likesCount: number;
  isLiked: boolean;
  createdAt: string;
};

const Dashboard = ({ navigation }: any) => {
  const [isCheckingCache, setIsCheckingCache] = useState(true); 
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [friendReqCount, setFriendReqCount] = useState(0);
  // 2. Inside your Dashboard component, add this state:
const [showRateCard, setShowRateCard] = useState(false);

  // ⚡ Live Unread Chat Count State
  const [unreadChats, setUnreadChats] = useState(getUnreadChatCount());

  const userContext = useContext(AuthContext);
  const user = userContext?.User?.user;
  const myUserId = user?.id || user?._id || userContext?.User?.id;
  

  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();

  const [finalAvatarUri, setFinalAvatarUri] = useState<string | null>(null);
  const [userBadges, setUserBadges] = useState({ tick: null, isPremium: false });

  const [profile, setProfile] = useState<any>(null);
  const [secondaryCards, setSecondaryCards] = useState<any>(null);
  const [habits, setHabits] = useState([]);
  const [currentMood, setCurrentMood] = useState<any>(null);
  const [friendsMoods, setFriendsMoods] = useState<any[]>([]);

  // ============================================================
  // ACTIVITY FEED STATE
  // ============================================================
  const [activeTab, setActiveTab] = useState<"foryou" | "world" | "country" | "city" | "friends">("foryou");
  const [posts, setPosts] = useState<any[]>([]);
  const [isLoadingFeed, setIsLoadingFeed] = useState(true);
  const [isRefreshingFeed, setIsRefreshingFeed] = useState(false);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [cachedAvatars, setCachedAvatars] = useState<{ [key: string]: string }>({});

  const [glassAlertVisible, setGlassAlertVisible] = useState(false);
  const [glassAlertConfig, setGlassAlertConfig] = useState({ title: "", message: "", type: "success" });

  const reportSheetRef = useRef<TrueSheet>(null);
  const [selectedPostForReport, setSelectedPostForReport] = useState<any>(null);

  const commentsSheetRef = useRef<TrueSheet>(null);
  const commentInputRef = useRef<TextInput>(null);
  const [selectedPostForComments, setSelectedPostForComments] = useState<any>(null);
  const [commentText, setCommentText] = useState("");
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
  const [expandedReplies, setExpandedReplies] = useState<{ [key: string]: boolean }>({});
  const [comments, setComments] = useState<Comment[]>([]);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const currentUserIsAdmin = false;

  // Subscribe to live unread chat changes
  useEffect(() => {
    const unsub = subscribeUnreadChanges(() => {
      setUnreadChats(getUnreadChatCount());
    });
    return () => unsub();
  }, []);

  // Double-tap heart state for inline feed posts
  const lastTapRef = useRef<{ [key: string]: number }>({});
  const heartScale = useSharedValue(0);
  const heartOpacity = useSharedValue(0);
  const [activeHeartPostId, setActiveHeartPostId] = useState<string | null>(null);

  const animatedHeartStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
    opacity: heartOpacity.value,
  }));

  const triggerHeartAnimation = (postId: string) => {
    setActiveHeartPostId(postId);
    heartScale.value = 0.4;
    heartOpacity.value = 1;
    heartScale.value = withSequence(
      withSpring(1.25, { damping: 6, stiffness: 250 }),
      withTiming(1, { duration: 100 })
    );
    heartOpacity.value = withTiming(0, { duration: 450 }, (finished) => {
      if (finished) runOnJS(setActiveHeartPostId)(null);
    });
  };

  const handleImageDoubleTap = (postId: string) => {
    const now = Date.now();
    const DOUBLE_PRESS_DELAY = 300;
    const lastTap = lastTapRef.current[postId] || 0;

    if (now - lastTap < DOUBLE_PRESS_DELAY) {
      const targetPost = posts.find((post) => post.id === postId);
      if (targetPost && !targetPost.isLiked) {
        handleLike(postId);
      }
      triggerHeartAnimation(postId);
    } else {
      lastTapRef.current[postId] = now;
    }
  };

  // Keyboard listener for comments sheet
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height - 175));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // ⚡ SMART RATE CARD LOGIC
  useEffect(() => {
    const checkRateStatus = async () => {
      try {
        const hasSeenRateCard = await AsyncStorage.getItem("has_seen_rate_card");
        if (!hasSeenRateCard) {
          // Show the card 10 seconds after the dashboard loads
          setTimeout(() => {
            setShowRateCard(true);
          }, 10000);
        }
      } catch (e) {
        console.log("Error checking rate status:", e);
      }
    };
    
    checkRateStatus();
  }, []);

  // Function to dismiss and never show again
  const handleDismissRateCard = async () => {
    setShowRateCard(false);
    await AsyncStorage.setItem("has_seen_rate_card", "true");
  };

  const getTimeAgo = (dateInput: string) => {
    const date = new Date(dateInput);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (seconds < 60) return `Just now`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    const weeks = Math.floor(days / 7);
    return `${weeks}w`;
  };

  const ensureDir = async () => {
    const exists = await RNFS.exists(BASE_DIR);
    if (!exists) await RNFS.mkdir(BASE_DIR);
  };

  const getCachedAvatarFeed = async (userId: string, url: string, avatarVersion = 1) => {
    try {
      if (!url) return null;
      await ensureDir();
      const localPath = `${BASE_DIR}/${userId}.jpg`;
      const exists = await RNFS.exists(localPath);
      const savedVersion = await AsyncStorage.getItem(`avatar_version_${userId}`);
      if (exists && String(savedVersion) === String(avatarVersion)) return "file://" + localPath;
      if (exists) await RNFS.unlink(localPath);

      const fullUrl = url.startsWith("http") ? url : (url.startsWith('/') ? newUrl + url : `${newUrl}/${url}`);
      const res = await RNFS.downloadFile({ fromUrl: fullUrl, toFile: localPath }).promise;
      if (res.statusCode === 200) {
        await AsyncStorage.setItem(`avatar_version_${userId}`, String(avatarVersion || 1));
        return "file://" + localPath;
      }
      return null;
    } catch { return null; }
  };

  const resolveAvatars = async (items: any[]) => {
    const newAvatarMap: { [key: string]: string } = {};
    for (const item of items) {
      const u = item.user;
      if (u && u.id && u.avatar && !cachedAvatars[u.id]) {
        const localUri = await getCachedAvatarFeed(u.id, u.avatar, u.avatarVersion || 1);
        if (localUri) newAvatarMap[u.id] = localUri;
      }
    }
    if (Object.keys(newAvatarMap).length > 0) {
      setCachedAvatars(prev => ({ ...prev, ...newAvatarMap }));
    }
  };

  const loadFeed = async (isRefresh = false) => {
    if (isRefresh) setIsRefreshingFeed(true);
    else setIsLoadingFeed(true);

    try {
      const res: any = await FeedAPI.GetFeed(activeTab);
      const feedData = res?.posts || res?.data?.posts || [];
      const formattedPosts = feedData.map((post: any) => {
        const cleanPath = post.mediaUrl ? post.mediaUrl.replace(/\\/g, '/') : '';
        const fullImageUrl = cleanPath.startsWith("http") ? cleanPath : `${baseUrl}${cleanPath}`;
        return { ...post, mediaUrl: fullImageUrl };
      });
      setPosts(formattedPosts);
      resolveAvatars(formattedPosts);
    } catch (e) {
      console.log("Failed to load feed", e);
    } finally {
      setIsRefreshingFeed(false);
      setIsLoadingFeed(false);
    }
  };

  useEffect(() => {
    loadFeed();
  }, [activeTab]);

  // ============================================================
  // FEED & COMMENT HANDLERS
  // ============================================================
  const handleLike = async (postId: string) => {
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, isLiked: !p.isLiked, likesCount: p.isLiked ? p.likesCount - 1 : p.likesCount + 1 } : p));
    try { await FeedAPI.ToggleLikePost(postId); } catch {}
  };

  const openComments = async (post: any) => {
    setSelectedPostForComments(post);
    setCommentText("");
    setReplyingTo(null);
    setExpandedReplies({});
    setComments([]);
    commentsSheetRef.current?.present();
    setIsLoadingComments(true);
    try {
      const res: any = await FeedAPI.GetComments(post.id);
      const fetched = res?.comments || res?.data?.comments || [];
      setComments(fetched);
      resolveAvatars(fetched);
    } catch {} finally { setIsLoadingComments(false); }
  };

  const closeComments = () => {
    commentsSheetRef.current?.dismiss();
    setSelectedPostForComments(null);
    setCommentText("");
    setReplyingTo(null);
    Keyboard.dismiss();
  };

  const getRootComments = () => comments.filter(c => c.postId === selectedPostForComments?.id && !c.parentId);
  const getReplies = (commentId: string) => comments.filter(c => c.parentId === commentId).reverse();

  const toggleReplies = (commentId: string) => {
    setExpandedReplies((prev) => ({ ...prev, [commentId]: !prev[commentId] }));
  };

  const handleAddComment = async () => {
    const text = commentText.trim();
    if (!text || !selectedPostForComments) return;
    const parentId = replyingTo ? (replyingTo.parentId || replyingTo.id) : undefined;
    
    setCommentText(""); 
    setReplyingTo(null); 
    Keyboard.dismiss();
    
    try {
      const res: any = await FeedAPI.AddComment(selectedPostForComments.id, { text, parentId });
      const newComment = res?.comment || res?.data?.comment;
      if (newComment) {
        setComments(prev => [newComment, ...prev]);
        resolveAvatars([newComment]);
        
        if (parentId) {
          setExpandedReplies((prev) => ({ ...prev, [parentId]: true }));
        }

        setPosts(prev => prev.map(p => p.id === selectedPostForComments.id ? { ...p, commentsCount: p.commentsCount + 1 } : p));
      }
    } catch {}
  };

  const handleLikeComment = async (commentId: string) => {
    setComments((previous) =>
      previous.map((comment) => {
        if (comment.id !== commentId) return comment;
        const newLikedState = !comment.isLiked;
        return {
          ...comment,
          isLiked: newLikedState,
          likesCount: newLikedState ? comment.likesCount + 1 : Math.max(0, comment.likesCount - 1),
        };
      })
    );
    try {
      await FeedAPI.ToggleLikeComment(commentId);
    } catch (error) {}
  };

  const canDeleteComment = (comment: Comment) => {
    const isCommentOwner = comment.user.id === myUserId;
    const isPostOwner = selectedPostForComments?.user?.id === myUserId;
    return isCommentOwner || isPostOwner || currentUserIsAdmin;
  };

  const handleDeleteComment = async (comment: Comment) => {
    if (!canDeleteComment(comment)) return;
    const targetId = comment.id;

    setComments((previous) => previous.filter((item) => item.id !== targetId && item.parentId !== targetId));

    if (selectedPostForComments) {
      setPosts((previous) =>
        previous.map((post) =>
          post.id === selectedPostForComments.id
            ? { ...post, commentsCount: Math.max(0, post.commentsCount - 1) }
            : post
        )
      );
    }

    try {
      await FeedAPI.DeleteComment(targetId);
    } catch (error) {}
  };

  const handleReply = (comment: Comment) => {
    setReplyingTo(comment);
    setCommentText("");
    setTimeout(() => { commentInputRef.current?.focus(); }, 100);
  };

  const renderCommentItem = (item: Comment, isReply = false) => {
    const canDelete = canDeleteComment(item);
    const commentAvatarUri = cachedAvatars[item.user.id] || item.user.avatar || 'https://via.placeholder.com/150';

    return (
      <View style={[styles.commentRow, isReply && styles.replyRow]}>
        <TouchableOpacity
          onPress={() => {
            commentsSheetRef.current?.dismiss();
            navigation.navigate("UserProfile", { userId: item.user.id });
          }}
          activeOpacity={0.85}
        >
          <Image
            source={{ uri: commentAvatarUri }}
            style={[styles.commentAvatar, isReply && styles.replyAvatar]}
          />
        </TouchableOpacity>

        <View style={styles.commentContent}>
          <View style={styles.commentTopRow}>
            <TouchableOpacity
              onPress={() => {
                commentsSheetRef.current?.dismiss();
                navigation.navigate("UserProfile", { userId: item.user.id });
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.commentUsername}>@{item.user.username}</Text>
            </TouchableOpacity>

            {item.user.tick === "golden" ? (
              <Icon name="check-decagram" size={14} color="#FBBF24" style={{ marginLeft: 4 }} />
            ) : item.user.tick === "verified" || item.user.isVerified ? (
              <Icon name="check-decagram" size={14} color="#38BDF8" style={{ marginLeft: 4 }} />
            ) : null}

            {item.user.isPremium && (
              <Icon name="crown" size={14} color="#F59E0B" style={{ marginLeft: 4 }} />
            )}

            <Text style={styles.commentTime}>
              {getTimeAgo(item.createdAt)}
            </Text>
          </View>

          <Text style={styles.commentText}>{item.text}</Text>

          <View style={styles.commentActions}>
            <TouchableOpacity style={styles.commentLikeButton} onPress={() => handleLikeComment(item.id)} activeOpacity={0.8}>
              <Icon name={item.isLiked ? "heart" : "heart-outline"} size={17} color={item.isLiked ? "#EF4444" : "#94A3B8"} />
              {item.likesCount > 0 && <Text style={styles.commentLikeCount}>{item.likesCount}</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => handleReply(item)} activeOpacity={0.8}>
              <Text style={styles.commentReplyText}>Reply</Text>
            </TouchableOpacity>

            {canDelete && (
              <TouchableOpacity onPress={() => handleDeleteComment(item)} activeOpacity={0.8}>
                <Text style={styles.commentDeleteText}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  };

  const submitReport = async (reasonObj: { label: string; type: string }) => {
    reportSheetRef.current?.dismiss();
    if (!selectedPostForReport) return;
    try {
      await apiClient.post(`/feed/posts/${selectedPostForReport.id}/report`, { reason: reasonObj.label, mediaUrl: selectedPostForReport.mediaUrl });
      setGlassAlertConfig({ title: "Report Submitted", message: "Thank you. Post sent for review.", type: "success" });
      setGlassAlertVisible(true);
    } catch (e: any) {
      setGlassAlertConfig({ title: "Error", message: e.response?.data?.message || "Failed to report", type: "error" });
      setGlassAlertVisible(true);
    }
  };

  // Cache & Profile Helpers
  const saveCache = async (key: string, value: any) => {
    try { await AsyncStorage.setItem(key, JSON.stringify({ ts: Date.now(), value })); } catch {}
  };
  
  const loadCache = async (key: string) => {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw)?.value ?? null;
    } catch { return null; }
  };

  const cacheUserAvatar = useCallback(async () => {
    if (!myUserId) return;
    try {
      const cacheKey = `dashboard:avatar:${myUserId}`;
      const cachedData = await loadCache(cacheKey);
      if (cachedData?.avatarUrl) {
        const localUri = await getAvatar(myUserId, cachedData.avatarUrl, cachedData.avatarVersion || 1);
        if (localUri) setFinalAvatarUri(`${localUri}?v=${cachedData.avatarVersion || 1}`);
      }
      if (cachedData) setUserBadges({ tick: cachedData.tick, isPremium: cachedData.isPremium });

      const response = await api_profile.getProfile(); 
      const userData = response.data?.user || response.data?.profile || response.data?.data || response.data;
      if (userData) {
        const freshUrl = userData.avatarUrl || userData.avatar;
        const freshVersion = userData.avatarVersion || 1;
        setUserBadges({ tick: userData.tick, isPremium: userData.isPremium });
        await saveCache(cacheKey, { avatarUrl: freshUrl, avatarVersion: freshVersion, tick: userData.tick, isPremium: userData.isPremium });

        if (freshUrl && freshUrl !== 'null' && freshUrl !== 'undefined') {
          const localUri = await getAvatar(myUserId, freshUrl, freshVersion);
          setFinalAvatarUri(localUri ? `${localUri}?v=${freshVersion}` : null);
        } else {
          setFinalAvatarUri(null);
        }
      }
    } catch {}
  }, [myUserId]);

  useEffect(() => { cacheUserAvatar(); }, [cacheUserAvatar]);

useEffect(() => {
    // ⚡ FIX: Wait until we have the user ID before loading cache to prevent cross-account leaks
    if (!myUserId) return; 

    (async () => {
      let anyLoaded = false;
      // ⚡ FIX: Make cache keys unique to the specific user
      const cached = await loadCache(`dashboard:summary:v1:${myUserId}`);
      if (cached) {
        setProfile(cached.profile);
        setSecondaryCards(cached.secondaryCards || null);
        setCurrentMood(cached.currentMood || null);
        if (cached.friendsMoods) setFriendsMoods(cached.friendsMoods); 
        anyLoaded = true;
      }
      
      const cachedFriends = await loadCache(`dashboard:friends:v1:${myUserId}`);
      if (cachedFriends) setFriendsMoods(p => p.length > 0 ? p : cachedFriends);
  
      const cachedHabits = await loadCache(`dashboard:todayHabits:v1:${myUserId}`);
      if (cachedHabits) { setHabits(cachedHabits); anyLoaded = true; }
      
      setHasLoadedOnce(anyLoaded);
      setLoading(!anyLoaded);
      setIsCheckingCache(false); 
      fetchDashboardInBackground();
      fetchTodayHabitsInBackground();
    })();
    refreshPendingCount();
    bootstrapKeys();
  }, [myUserId]); // ⚡ FIX: Add myUserId as a dependency

  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => setOffline(!state.isConnected || state.isInternetReachable === false));
    return () => unsub();
  }, []);

  const refreshPendingCount = useCallback(async () => {
    try {
      const res = await socialApi.getPendingFriendRequests();
      const cleaned = (res?.data?.requests ?? []).map((r: any) => r?.user?._id ? r : { ...r, user: { _id: r._id, name: r.name, username: r.username } }).filter((r: any) => r?.user?._id);
      setFriendReqCount(cleaned.length);
    } catch { setFriendReqCount(0); }
  }, []);

  const bootstrapKeys = async () => {
    try {
      const deviceId = await getStableDeviceId(myUserId);
      await ensureDeviceKeys(myUserId, deviceId);
    } catch {}
  };

const fetchDashboardInBackground = useCallback(async () => {
    try {
      setError(null);
      if (offline || !myUserId) return; // ⚡ Added safety check
      const res = await DashboardService.GetDashboardSummary();
      const responseData = (res as any).data ?? res;
      if (!responseData.success) throw new Error();
      const { profile, secondaryCards, currentMood, friendsMoods: apiFriendsMoods } = responseData.data;
      setProfile(profile);
      setSecondaryCards(secondaryCards || null);
      setCurrentMood(currentMood || null);
      if (apiFriendsMoods) setFriendsMoods(apiFriendsMoods);
      
      // ⚡ FIX: Save to dynamic key
      await saveCache(`dashboard:summary:v1:${myUserId}`, responseData.data);
      setHasLoadedOnce(true);
      setLoading(false);
    } catch {}
  }, [offline, myUserId]); // ⚡ Add myUserId

  const fetchTodayHabitsInBackground = useCallback(async () => {
    try {
      if (offline || !myUserId) return; // ⚡ Added safety check
      const res = await DashboardService.GetTodayHabits();
      if (res.data?.success) {
        setHabits(res?.data.habits);
        // ⚡ FIX: Save to dynamic key
        await saveCache(`dashboard:todayHabits:v1:${myUserId}`, res?.data.habits);
      }
    } catch {}
  }, [offline, myUserId]); // ⚡ Add myUserId

  const fetchFriendsInBackground = useCallback(async () => {
    try {
      if (offline || !myUserId) return; // ⚡ Added safety check
      const res = await socialApi.getFriends();
      if (res?.data?.friends) {
        setFriendsMoods(p => p.length > 0 && p[0].mood ? p : res.data.friends);
        // ⚡ FIX: Save to dynamic key
        await saveCache(`dashboard:friends:v1:${myUserId}`, res.data.friends);
      }
    } catch {}
  }, [offline, myUserId]); // ⚡ Add myUserId

  useFocusEffect(
    useCallback(() => {
      fetchDashboardInBackground();
      refreshPendingCount();
      fetchTodayHabitsInBackground();
      fetchFriendsInBackground(); 
    }, [fetchDashboardInBackground, refreshPendingCount, fetchTodayHabitsInBackground, fetchFriendsInBackground])
  );

  if (isCheckingCache) {
    return (
      <MainLayout>
        <AppScreen style={styles.root}>
          <View style={styles.baseBackground} />
          <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        </AppScreen>
      </MainLayout>
    );
  }

  if (loading && !hasLoadedOnce) {
    return <DashboardSkeleton />;
  }

  const level = profile?.xpProgress.level ?? 1;
  const xp = profile?.xpProgress.currentXp ?? 0;
  const xpRequired = profile?.xpProgress.nextLevelXp ?? 100;
  const fill = profile?.xpProgress.progressPercent ?? (xpRequired ? (xp / xpRequired) * 100 : 0);
  const streakCount = profile?.streak?.count ?? 0;
  const streakLabel = streakCount > 0 ? `${streakCount}-day streak` : "No streak yet";

  return (
    <MainLayout>
      <AppScreen style={styles.root}>
        <View style={styles.baseBackground} />
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

        <View style={styles.overlay}>
          {/* TOP BAR WITH CHAT BUTTON & UNREAD BADGE */}
          <View style={styles.topBar}>
            <TouchableOpacity 
              activeOpacity={0.8} 
              style={[styles.iconGlass, { justifyContent: 'center', alignItems: 'center', padding: 0 }]} 
              onPress={() => navigation.navigate("Profile")}
            >
              <View style={{ width: '100%', height: '100%', borderRadius: 16, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }}>
                {finalAvatarUri ? (
                  <FastImage style={{ width: '100%', height: '100%' }} source={{ uri: finalAvatarUri, priority: FastImage.priority.normal }} resizeMode={FastImage.resizeMode.cover} />
                ) : (
                  <Icon name="account" size={26} color="#E5E7EB" />
                )}
              </View>
              {(userBadges.tick === 'verified' || userBadges.tick === 'golden' || userBadges.isPremium) && (
                <View style={styles.avatarBadge}>
                  {userBadges.tick === 'verified' ? (
                    <Icon name="check-decagram" size={14} color="#3b82f6" />
                  ) : userBadges.tick === 'golden' ? (
                    <Icon name="check-decagram" size={14} color="#fbbf24" />
                  ) : (
                    <Icon name="star-circle" size={14} color="#fbbf24" />
                  )}
                </View>
              )}
            </TouchableOpacity>


            <View style={styles.topBarRight}>
              <TouchableOpacity activeOpacity={0.8} style={styles.iconGlass} onPress={() => navigation.navigate("FriendsManage")}>
                <Icon1 name="people-outline" size={22} color="#E5E7EB" />
                {friendReqCount > 0 && (
                  <View style={styles.badgeBubble}><Text style={styles.badgeText}>{friendReqCount}</Text></View>
                )}
              </TouchableOpacity>
               {/* ⚡ CHAT BUTTON WITH LIVE UNREAD BADGE */}
              <TouchableOpacity activeOpacity={0.8} style={styles.iconGlass} onPress={() => navigation.navigate("Chat")}>
                <Icon name="chat-outline" size={22} color="#E5E7EB" />
                {unreadChats > 0 && (
                  <View style={styles.badgeBubble}>
                    <Text style={styles.badgeText}>{unreadChats > 99 ? '99+' : unreadChats}</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>
            <View style={styles.notesDivider} />

          {/* MAIN SCROLL CONTAINER (Optimized with FlatList) */}
          <FlatList
            data={posts}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            
            // ⚡ Performance Props for buttery smooth scrolling
            removeClippedSubviews={Platform.OS === 'android'}
            initialNumToRender={3}
            maxToRenderPerBatch={3}
            windowSize={5}

            // 1. HEADER (Everything above the posts)
            ListHeaderComponent={
              <>
                {(offline || error) && (
                  <View style={styles.errorCard}>
                    <Icon name="cloud-alert" size={20} color="#F87171" />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.errorTitle}>{offline ? "Offline mode" : "Something went wrong"}</Text>
                      <Text style={styles.errorText}>{offline ? "You’re not connected to internet." : error}</Text>
                    </View>
                    <TouchableOpacity style={styles.errorRetryBtn} onPress={() => { fetchDashboardInBackground(); fetchTodayHabitsInBackground(); }}>
                      <Text style={styles.errorRetryText}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* MOOD NOTES BAR */}
                <View style={styles.notesWrapper}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.notesContainer}>
                    <TouchableOpacity
                      activeOpacity={0.8}
                      style={styles.noteItem}
                      onPress={() => navigation.navigate("MoodScreen", { currentMoodId: currentMood?.mood || null })}
                    >
                      <View style={styles.noteAvatarContainer}>
                        <View style={styles.noteSpeechBubble}>
                          {currentMood && MOOD_METADATA[currentMood.mood] ? (
                            <View style={styles.noteBubbleContent}>
                              <Icon name={MOOD_METADATA[currentMood.mood].icon} size={15} color={MOOD_METADATA[currentMood.mood].color || "#F9FAFB"} />
                              <Text style={styles.noteBubbleText}>{MOOD_METADATA[currentMood.mood].label}</Text>
                            </View>
                          ) : (
                            <View style={styles.noteBubbleContent}>
                              <Icon name="plus" size={15} color="#9CA3AF" />
                              <Text style={styles.noteBubbleText}>Share</Text>
                            </View>
                          )}
                          <View style={styles.noteSpeechTail} />
                        </View>
                        
                        <View style={[styles.noteAvatarWrap, currentMood && MOOD_METADATA[currentMood.mood] ? { borderColor: MOOD_METADATA[currentMood.mood].color } : null]}>
                          {finalAvatarUri ? (
                            <FastImage source={{ uri: finalAvatarUri }} style={styles.noteAvatarImage} />
                          ) : (
                            <Icon name="account" size={56} color="#E5E7EB" />
                          )}
                        </View>

                        {!currentMood && (
                          <View style={styles.noteAddBadge}><Icon name="plus" size={12} color="#fff" /></View>
                        )}
                      </View>
                      <Text style={styles.noteName} numberOfLines={1}>You</Text>
                    </TouchableOpacity>

                    {friendsMoods
  .filter((friend: any) => 
    friend.mood && 
    MOOD_METADATA[friend.mood] && 
    String(friend.id || friend._id) !== String(myUserId) // ⚡ STRICTLY hide current user from friends list
  )
                      .map((friend: any) => {
                        const fMoodMeta = MOOD_METADATA[friend.mood];
                        const rawAvatar = friend.avatarUrl || friend.avatar?.url || friend.avatar;
                        const friendAvatarUri = rawAvatar 
                          ? (rawAvatar.startsWith('http') ? rawAvatar : `${newUrl}${rawAvatar}`) 
                          : null;

                        return (
                          <TouchableOpacity key={friend.id || friend._id} activeOpacity={0.8} style={styles.noteItem}>
                            <View style={styles.noteAvatarContainer}>
                              {fMoodMeta && (
                                <View style={styles.noteSpeechBubble}>
                                  <View style={styles.noteBubbleContent}>
                                    <Icon name={fMoodMeta.icon} size={15} color={fMoodMeta.color || "#F9FAFB"} />
                                    <Text style={styles.noteBubbleText}>{fMoodMeta.label}</Text>
                                  </View>
                                  <View style={styles.noteSpeechTail} />
                                </View>
                              )}
                              <View style={[styles.noteAvatarWrap, fMoodMeta ? { borderColor: fMoodMeta.color } : null]}>
                                {friendAvatarUri ? (
                                  <FastImage source={{ uri: friendAvatarUri }} style={styles.noteAvatarImage} />
                                ) : (
                                  <Icon name="account" size={56} color="#E5E7EB" />
                                )}
                              </View>
                            </View>
                            <Text style={styles.noteName} numberOfLines={1}>{friend.name || friend.username}</Text>
                          </TouchableOpacity>
                        );
                    })} 
                  </ScrollView>
                </View>

                {/* FEED TABS HEADER */}
                <View style={styles.feedHeaderRow}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.feedTabsContainer}>
                    {[
                      { key: "foryou", label: "For You" },
                      { key: "friends", label: "Friends" },
                    ].map((tab) => {
                      const isActive = activeTab === tab.key;
                      return (
                        <TouchableOpacity
                          key={tab.key}
                          style={[styles.feedTabPill, isActive && styles.feedTabPillActive]}
                          onPress={() => setActiveTab(tab.key as any)}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.feedTabText, isActive && styles.feedTabTextActive]}>{tab.label}</Text>
                        </TouchableOpacity>
                      );
                    })}

                    <TouchableOpacity
                      style={[styles.yourPostsTabPill, { marginLeft: 'auto' }]}
                      onPress={() => navigation.navigate("UserProfile")}
                      activeOpacity={0.8}
                    >
                      <Icon name="folder-image" size={14} color="#A855F7" style={{ marginRight: 4 }} />
                      <Text style={styles.yourPostsTabText}>Your Posts</Text>
                    </TouchableOpacity>
                  </ScrollView>
                </View>
              </>
            }

            // 2. EMPTY / LOADING STATE
            ListEmptyComponent={
              isLoadingFeed ? (
                <View style={{ height: 400, justifyContent: "center", alignItems: "center" }}>
                  <ActivityIndicator size="large" color="#8B5CF6" />
                </View>
              ) : (
                <View style={{ height: 250, justifyContent: "center", alignItems: "center" }}>
                  <Text style={{ color: "#9CA3AF" }}>No posts found for {activeTab}</Text>
                </View>
              )
            }

            // 3. RENDER EACH POST
            renderItem={({ item }) => {
              const userAvatarUri = cachedAvatars[item.user.id] || item.user.avatar || 'https://via.placeholder.com/150';

              return (
                <View style={styles.inlinePostCard}>
                  {item.adminRemoved ? (
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0A0A0A', justifyContent: 'center', alignItems: 'center', zIndex: 999, borderRadius: 24 }]}>
                      <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(239, 68, 68, 0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                        <Icon name="shield-alert-outline" size={40} color="#EF4444" />
                      </View>
                      <Text style={{ color: "#F8FAFC", fontSize: 22, fontWeight: "700" }}>Post Removed</Text>
                      <Text style={{ color: "#94A3B8", fontSize: 14, textAlign: "center", marginTop: 8, paddingHorizontal: 40, lineHeight: 22 }}>
                        This post was removed because it violated our community guidelines.
                      </Text>
                    </View>
                  ) : (
                    <>
                      <TouchableWithoutFeedback onPress={() => handleImageDoubleTap(item.id)}>
                        <View style={StyleSheet.absoluteFill}>
                          <Image source={{ uri: item.mediaUrl }} style={styles.inlinePostImage} resizeMode="cover" />
                          <View style={styles.imageOverlayGradient} />

                          {activeHeartPostId === item.id && (
                            <View style={styles.doubleTapHeartContainer}>
                              <Animated.View style={animatedHeartStyle}>
                                <Icon name="heart" size={95} color="#EF4444" style={styles.popHeartIcon} />
                              </Animated.View>
                            </View>
                          )}
                        </View>
                      </TouchableWithoutFeedback>

                      {/* Right Action Icons */}
                      <View style={styles.rightActionContainer}>
                        <TouchableOpacity style={styles.actionIconButtonClean} onPress={() => handleLike(item.id)} activeOpacity={0.8}>
                          <Icon name={item.isLiked ? "heart" : "heart-outline"} size={28} color={item.isLiked ? "#EF4444" : "#F9FAFB"} />
                          <Text style={styles.actionCountText}>{item.likesCount}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.actionIconButtonClean} onPress={() => openComments(item)} activeOpacity={0.8}>
                          <Icon name="comment-outline" size={26} color="#F9FAFB" />
                          <Text style={styles.actionCountText}>{item.commentsCount}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity 
                          style={styles.actionIconButtonClean} 
                          onPress={() => navigation.navigate("ShareToChat", { 
                            postId: item.id, mediaUrl: item.mediaUrl, postUsername: item.user.username, postCaption: item.caption, postUserId: item.user.id || item.user._id 
                          })}
                        >
                          <Icon name="share-outline" size={26} color="#F9FAFB" />
                          <Text style={styles.actionCountText}>Share</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.actionIconButtonClean} onPress={() => { setSelectedPostForReport(item); reportSheetRef.current?.present(); }} activeOpacity={0.8}>
                          <Icon name="dots-horizontal" size={26} color="#F9FAFB" />
                        </TouchableOpacity>
                      </View>

                      {/* Bottom Left Author Info & Caption */}
                      <View style={styles.bottomLeftContent}>
                        <View style={styles.userInfoRow}>
                          <TouchableOpacity 
  style={styles.avatarContainer} 
  onPress={() => navigation.navigate("UserProfile", { userId: item.user.id })} 
  activeOpacity={0.9}
>
   {userAvatarUri ? (
                 <Image source={{ uri: userAvatarUri }} style={styles.avatarImage} />
              ) : (
                <Icon name="account" size={20} color="#E5E7EB" />
              )}
  <Image source={{ uri: userAvatarUri }} style={styles.avatarImage} />
</TouchableOpacity>
                          <View style={styles.usernameTextWrap}>
                            <TouchableOpacity onPress={() => navigation.navigate("UserProfile", { userId: item.user.id })} activeOpacity={0.8}>
                              <View style={styles.nameInlineRow}>
                                <Text style={styles.usernameText}>@{item.user.username}</Text>
                                {item.user.tick === "golden" ? (
                                  <Icon name="check-decagram" size={14} color="#FBBF24" style={{ marginLeft: 4 }} />
                                ) : item.user.tick === "verified" || item.user.isVerified ? (
                                  <Icon name="check-decagram" size={14} color="#38BDF8" style={{ marginLeft: 4 }} />
                                ) : null}
                                {item.user.isPremium && (
                                  <Icon name="crown" size={14} color="#F59E0B" style={{ marginLeft: 4 }} />
                                )}
                              </View>
                            </TouchableOpacity>
                          </View>
                        </View>
                        <Text style={styles.postCaption} numberOfLines={3}>{item.caption}</Text>
                      </View>
                    </>
                  )}
                </View>
              );
            }}

            // 4. FOOTER SPACER
            ListFooterComponent={<View style={{ height: 60 }} />}
          />
        </View>

  {/* ⚡ FLOATING GLASSY RATE CARD OVERLAY */}
              {showRateCard && (
                <View style={styles.floatingRateCardWrapper} pointerEvents="box-none">
                  <GlassyRateCard 
                    onDismiss={handleDismissRateCard} 
                    onSendFeedback={() => {
                      handleDismissRateCard();
                    }} 
                  />
                </View>
              )}

        {/* REPORT SHEET */}
        <TrueSheet ref={reportSheetRef} detents={[0.4]} cornerRadius={28} backgroundColor="#0F172A" grabber={false}>
          <View style={styles.sheetContentContainer}>
            <Text style={styles.sheetTitle}>Report Post</Text>
            {/* ⚡ FIXED: fontSize changed from "12" to 12 */}
            <Text style={styles.sheetSubText}>Why are you reporting this post?</Text>
            {[
              { label: "Inappropriate Content", type: "inappropriate" },
              { label: "Spam or Scam", type: "spam" },
              { label: "Harassment or Hate Speech", type: "harassment" },
            ].map((reason, idx) => (
              <TouchableOpacity key={idx} style={styles.sheetOptionRow} onPress={() => submitReport(reason)} activeOpacity={0.8}>
                <Icon name="alert-octagon-outline" size={20} color="#EF4444" style={{ marginRight: 12 }} />
                <Text style={styles.sheetOptionText}>{reason.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.sheetCancelButton} onPress={() => reportSheetRef.current?.dismiss()} activeOpacity={0.8}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TrueSheet>

        {/* ⚡ UPDATED COMMENTS SHEET WITH FULL FUNCTIONALITY */}
        <TrueSheet ref={commentsSheetRef} detents={[0.75]} cornerRadius={28} backgroundColor="#0F172A" grabber={false}>
          <View style={{ height: SCREEN_HEIGHT * 0.75 - 20, paddingBottom: keyboardHeight > 0 ? keyboardHeight : 0, flexDirection: "column" }}>
            <View style={styles.commentsHeader}>
              <View style={{ width: 40 }} />
              <View style={styles.commentsHeaderCenter}>
                <Text style={styles.commentsTitle}>Comments</Text>
                <Text style={styles.commentsSubtitle}>{selectedPostForComments?.commentsCount || 0} comments</Text>
              </View>
              <TouchableOpacity style={styles.commentsCloseButton} onPress={closeComments} activeOpacity={0.8}>
                <Icon name="close" size={22} color="#CBD5E1" />
              </TouchableOpacity>
            </View>

            {isLoadingComments ? (
              <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}><ActivityIndicator size="small" color="#8B5CF6" /></View>
            ) : (
              <FlatList
                style={styles.commentsFlatList}
                data={getRootComments()}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                keyboardDismissMode="interactive"
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled={true} 
                extraData={{ comments, expandedReplies }}
                contentContainerStyle={[
                  getRootComments().length === 0 ? styles.emptyCommentsContainer : styles.commentsList,
                  { paddingBottom: 20 }
                ]}
                renderItem={({ item }) => {
                  const replies = getReplies(item.id);
                  const isExpanded = expandedReplies[item.id];

                  return (
                    <View>
                      {renderCommentItem(item, false)}

                      {replies.length > 0 && (
                        <View style={styles.repliesWrapper}>
                          <TouchableOpacity
                            style={styles.viewRepliesButton}
                            onPress={() => toggleReplies(item.id)}
                            activeOpacity={0.8}
                          >
                            <View style={styles.replyLineIndicator} />
                            <Text style={styles.viewRepliesText}>
                              {isExpanded ? "Hide replies" : `View ${replies.length} replies`}
                            </Text>
                          </TouchableOpacity>

                          {isExpanded &&
                            replies.map((reply) => (
                              <React.Fragment key={reply.id}>
                                {renderCommentItem(reply, true)}
                              </React.Fragment>
                            ))}
                        </View>
                      )}
                    </View>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.noCommentsView}>
                    <View style={styles.noCommentsIcon}>
                      <Icon name="comment-outline" size={40} color="#64748B" />
                    </View>
                    <Text style={styles.noCommentsTitle}>No comments yet</Text>
                    <Text style={styles.noCommentsSubtitle}>Be the first to share your thoughts.</Text>
                  </View>
                }
              />
            )}

            <View style={styles.commentFooterWrapper}>
              {replyingTo && (
                <View style={styles.replyingIndicatorBar}>
                  <Text style={styles.replyingIndicatorText}>
                    Replying to <Text style={{ fontWeight: '700', color: "#94A3B8" }}>@{replyingTo.user.username}</Text>
                  </Text>
                  <TouchableOpacity onPress={() => { setReplyingTo(null); setCommentText(""); }}>
                    <Icon name="close-circle" size={18} color="#94A3B8" />
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.commentInputContainer}>
                <View style={styles.commentInputWrapper}>
                  <TextInput
                    ref={commentInputRef}
                    value={commentText}
                    onChangeText={setCommentText}
                    placeholder={replyingTo ? `Reply to ${replyingTo.user.username}...` : "Add a comment..."}
                    placeholderTextColor="#64748B"
                    multiline
                    maxLength={500}
                    style={styles.commentInput}
                  />

                  <TouchableOpacity
                    style={[styles.commentSendButton, !commentText.trim() && styles.commentSendButtonDisabled]}
                    disabled={!commentText.trim()}
                    onPress={handleAddComment}
                    activeOpacity={0.8}
                  >
                    <Icon name="send" size={19} color={commentText.trim() ? "#FFFFFF" : "#475569"} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

          </View>
        </TrueSheet>

        {/* CUSTOM GLASSY ALERT MODAL */}
        <Modal visible={glassAlertVisible} transparent animationType="fade" onRequestClose={() => setGlassAlertVisible(false)}>
          <View style={styles.glassModalOverlay}>
            <View style={styles.glassModalCard}>
              <Text style={styles.glassModalTitle}>{glassAlertConfig.title}</Text>
              <Text style={styles.glassModalSubText}>{glassAlertConfig.message}</Text>
              <TouchableOpacity style={styles.glassModalBtn} onPress={() => setGlassAlertVisible(false)} activeOpacity={0.8}>
                <Text style={styles.glassModalBtnText}>Okay</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

      </AppScreen>
    </MainLayout>
  );
};

const DashboardSkeleton = () => (
  <MainLayout>
    <AppScreen style={styles.root}>
      <View style={styles.baseBackground} />
      <ActivityIndicator size="large" color="#8B5CF6" style={{ flex: 1, justifyContent: "center", alignItems: "center" }} />
    </AppScreen>
  </MainLayout>
);

const styles = StyleSheet.create({
  root: { flex: 1 },
  baseBackground: { ...StyleSheet.absoluteFill, backgroundColor: "#020617" },
  overlay: { flex: 1, paddingTop: Platform.OS === "android" ? "3%" : "5%" },
  scrollContent: { paddingBottom: 0 },
   topBar: { 
    flexDirection: "row", 
    justifyContent: "space-between", 
    alignItems: "center", 
    marginBottom: "2%",
    paddingHorizontal: 20,
    height: 50,           // <-- Add this
    position: "relative", // <-- Add this
  },
  topBarRight: { flexDirection: "row", alignItems: "center" },
  iconGlass: { width: 40, height: 40, borderRadius: 16, backgroundColor: ICON_GLASS_BG, borderWidth: 1, borderColor: "rgba(148, 163, 184, 0.4)", justifyContent: "center", alignItems: "center", marginLeft: 10 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: "2%" },
  streakPill: { flexDirection: "row", alignItems: "center", paddingHorizontal: "5%", paddingVertical: 6, borderRadius: 999, backgroundColor: "rgba(22, 101, 52, 0.2)", borderWidth: 1, borderColor: "rgba(74, 222, 128, 0.4)" },
  streakText: { color: "#BBF7D0", marginLeft: 6, fontSize: 13, fontWeight: "600" },
  profileTextBlock: { alignItems: "flex-end" },
  profileTextMain: { color: "#E5E7EB", fontSize: 14, fontWeight: "600" },
  profileTextSub: { color: "#9CA3AF", fontSize: 11 },
  card: { backgroundColor: GLASS_BG, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: GLASS_BORDER, marginBottom: 18 },
  levelSection: { flexDirection: "row", alignItems: "center" },
  levelCircle: { justifyContent: "center", alignItems: "center" },
  levelText: { fontSize: 14, fontWeight: "600", color: "#A855F7" },
  levelNumber: { fontSize: 28, fontWeight: "800", color: "#E5DEFF" },
  levelInfo: { flex: 1, marginLeft: 16 },
  levelLabel: { fontSize: 18, fontWeight: "700", color: "#F9FAFB" },
  levelHint: { fontSize: 11, color: "#9CA3AF", marginTop: 8 },
  notesDivider: { height: 1, backgroundColor: "rgba(148, 163, 184, 0.2)", marginBottom: 5, marginTop: 0 },
  notesWrapper: { marginBottom: 2 },
  notesContainer: { paddingHorizontal: 20, paddingVertical: 10, alignItems: 'flex-start' },
  noteItem: { alignItems: 'center', marginRight: 20, width: 76 },
  noteAvatarContainer: { position: 'relative', alignItems: 'center', marginBottom: 6, marginTop: 26 },
  noteAvatarWrap: { width: 66, height: 66, borderRadius: 33, borderWidth: 2, borderColor: 'rgba(148, 163, 184, 0.4)', overflow: 'hidden', justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  noteAvatarImage: { width: '100%', height: '100%' },
  noteSpeechBubble: { position: 'absolute', top: -34, backgroundColor: 'rgba(30, 41, 59, 0.95)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(148, 163, 184, 0.3)', zIndex: 10, minWidth: 60, alignItems: 'center', justifyContent: 'center' },
  noteSpeechTail: { position: 'absolute', bottom: -5, left: '50%', marginLeft: -5, width: 10, height: 10, backgroundColor: 'rgba(30, 41, 59, 0.95)', borderBottomWidth: 1, borderRightWidth: 1, borderColor: 'rgba(148, 163, 184, 0.3)', transform: [{ rotate: '45deg' }] },
  noteBubbleContent: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  noteBubbleText: { color: '#F9FAFB', fontSize: 12, fontWeight: '600' },
  noteAddBadge: { position: 'absolute', bottom: -2, right: 0, backgroundColor: '#3B82F6', width: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#020617' },
  noteName: { color: '#E5E7EB', fontSize: 10, fontWeight: '500', textAlign: 'center' },
  avatarBadge: { position: "absolute", bottom: -4, right: -4, backgroundColor: "#020617", borderRadius: 10, width: 18, height: 18, justifyContent: "center", alignItems: "center", borderwidth: 1, borderColor: "rgba(148, 163, 184, 0.4)" },

  // INLINE FEED STYLES
  feedHeaderRow: { 
    flexDirection: "row", 
    justifyContent: "space-between", 
    alignItems: "center", 
    marginBottom: 12, 
    marginTop: 10,
    paddingHorizontal: 20 
  },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#F9FAFB" },
  feedTabsContainer: { 
    flexDirection: "row", 
    alignItems: "center",
    width: "100%", 
  },
  feedTabPill: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, marginLeft: 6, backgroundColor: "rgba(15, 23, 42, 0.6)", borderWidth: 1, borderColor: "rgba(148, 163, 184, 0.2)" },
  feedTabPillActive: { backgroundColor: "rgba(139, 92, 246, 0.4)", borderWidth: 1, borderColor: "#A855F7" },
  feedTabText: { fontSize: 12, color: "#9CA3AF", fontWeight: "600" },
  feedTabTextActive: { color: "#F9FAFB", fontWeight: "700" },

  // YOUR POSTS TAB BUTTON STYLES
  yourPostsTabPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    marginLeft: 'auto',
    backgroundColor: "rgba(168, 85, 247, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.4)",
  },
  yourPostsTabText: {
    fontSize: 12,
    color: "#E9D5FF",
    fontWeight: "700",
  },

  inlinePostCard: { 
    width: "100%", 
    height: 580, 
    overflow: "hidden", 
    backgroundColor: "#000", 
    position: "relative", 
    marginBottom: 30 
  },
  inlinePostImage: { ...StyleSheet.absoluteFill, width: "100%", height: "100%" },
  imageOverlayGradient: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0, 0, 0, 0.3)" },
  doubleTapHeartContainer: { ...StyleSheet.absoluteFill, justifyContent: "center", alignItems: "center", zIndex: 30 },
  popHeartIcon: { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.6, shadowRadius: 8, elevation: 12 },
  rightActionContainer: { position: "absolute", right: 12, bottom: 20, alignItems: "center", zIndex: 10 },
  actionIconButtonClean: { alignItems: "center", backgroundColor: "transparent", padding: 6, marginBottom: 10 },
  actionCountText: { color: "#F9FAFB", fontSize: 11, fontWeight: "700", marginTop: 2 },
  bottomLeftContent: { position: "absolute", left: 14, bottom: 20, right: 75, zIndex: 10 },
  userInfoRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  avatarContainer: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: "#bebebe", overflow: "hidden" },
  avatarImage: { width: "100%", height: "100%" },
  usernameTextWrap: { marginLeft: 8 },
  nameInlineRow: { flexDirection: "row", alignItems: "center" },
  usernameText: { color: "#F9FAFB", fontSize: 13, fontWeight: "700" },
  postCaption: { color: "#E2E8F0", fontSize: 12, lineHeight: 16 },

  // Comments Sheet styles
  commentsHeader: { height: 60, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "rgba(148, 163, 184, 0.15)", paddingHorizontal: 16 },
  commentsHeaderCenter: { alignItems: "center", justifyContent: "center" },
  commentsTitle: { color: "#F9FAFB", fontSize: 17, fontWeight: "700" },
  commentsSubtitle: { color: "#64748B", fontSize: 10, fontWeight: "500", marginTop: 2 },
  commentsCloseButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(148, 163, 184, 0.1)" },
  commentsFlatList: { flex: 1 },
  
  // ⚡ ADDED STYLES FOR REPLIES AND COMMENT ACTIONS
  commentsList: { paddingTop: 8, paddingBottom: 15, paddingHorizontal: 16 },
  emptyCommentsContainer: { flexGrow: 1, justifyContent: "center", alignItems: "center" },
  commentRow: { flexDirection: "row", paddingVertical: 11 },
  replyRow: { paddingLeft: 45, paddingVertical: 8 }, 
  commentAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#1E293B", marginRight: 11 },
  replyAvatar: { width: 30, height: 30, borderRadius: 15 }, 
  commentContent: { flex: 1, paddingRight: 5 },
  commentTopRow: { flexDirection: "row", alignItems: "center" },
  commentUsername: { color: "#F9FAFB", fontSize: 13, fontWeight: "700" },
  commentTime: { color: "#64748B", fontSize: 10, marginLeft: 8 },
  commentText: { color: "#E2E8F0", fontSize: 14, lineHeight: 20, marginTop: 3 },
  commentActions: { flexDirection: "row", alignItems: "center", marginTop: 7 },
  commentLikeButton: { flexDirection: "row", alignItems: "center", marginRight: 20 },
  commentLikeCount: { color: "#94A3B8", fontSize: 10, fontWeight: "600", marginLeft: 4 },
  commentReplyText: { color: "#94A3B8", fontSize: 11, fontWeight: "600", marginRight: 20 },
  commentDeleteText: { color: "#EF4444", fontSize: 11, fontWeight: "600" },
  
  repliesWrapper: { marginTop: -5, marginBottom: 5 },
  viewRepliesButton: { flexDirection: "row", alignItems: "center", marginLeft: 51, paddingVertical: 10 },
  replyLineIndicator: { width: 30, height: 1, backgroundColor: "#475569", marginRight: 10 },
  viewRepliesText: { color: "#94A3B8", fontSize: 12, fontWeight: "600" },
  
  noCommentsView: { alignItems: "center", justifyContent: "center", paddingHorizontal: 30 },
  noCommentsIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(30, 41, 59, 0.6)", borderWidth: 1, borderColor: "rgba(148, 163, 184, 0.2)", marginBottom: 15 },
  noCommentsTitle: { color: "#F9FAFB", fontSize: 16, fontWeight: "700" },
  noCommentsSubtitle: { color: "#64748B", fontSize: 12, textAlign: "center", marginTop: 5 },

  commentFooterWrapper: { width: "100%", backgroundColor: "#0F172A", borderTopWidth: 1, borderTopColor: "rgba(148, 163, 184, 0.15)" },
  replyingIndicatorBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "rgba(30, 41, 59, 0.5)", borderTopWidth: 1, borderTopColor: "rgba(148, 163, 184, 0.15)" },
  replyingIndicatorText: { color: "#94A3B8", fontSize: 12 },
  
  commentInputContainer: { width: "100%", flexDirection: "row", alignItems: "flex-end", paddingTop: 10, paddingBottom: Platform.OS === "ios" ? 18 : 10, backgroundColor: "#0F172A", paddingHorizontal: 16 },
  commentInputWrapper: { flex: 1, minHeight: 42, maxHeight: 100, flexDirection: "row", alignItems: "flex-end", borderRadius: 22, backgroundColor: "#111827", borderWidth: 1, borderColor: "rgba(148, 163, 184, 0.2)", paddingLeft: 14, paddingRight: 5 },
  commentInput: { flex: 1, minHeight: 40, maxHeight: 90, color: "#F8FAFC", fontSize: 14, paddingTop: Platform.OS === "ios" ? 9 : 7, paddingBottom: Platform.OS === "ios" ? 9 : 7 },
  commentSendButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  commentSendButtonDisabled: { backgroundColor: "#1E293B" },

  // Report & Glass Modal
  // Add this inside styles = StyleSheet.create({ ... })
  floatingRateCardWrapper: {
    position: "absolute",
    bottom: Platform.OS === "ios" ? 10 : 20, // Adjust so it sits right above your AppTabs
    left: 0,
    right: 0,
    zIndex: 90, // Keeps it above the feed but below TrueSheet modals
  },
  sheetContentContainer: { padding: 20, paddingBottom: 35 },
  sheetTitle: { color: "#F9FAFB", fontSize: 18, fontWeight: "700", textAlign: "center", marginBottom: 4 },
  sheetSubText: { color: "#94A3B8", fontSize: 12, textAlign: "center", marginBottom: 20 },
  sheetOptionRow: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(30, 41, 59, 0.5)", paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, marginBottom: 10, borderWidth: 1, borderColor: GLASS_BORDER },
  sheetOptionText: { color: "#E2E8F0", fontSize: 14, fontWeight: "600" },
  sheetCancelButton: { backgroundColor: "rgba(148, 163, 184, 0.2)", paddingVertical: 14, borderRadius: 14, alignItems: "center", marginTop: 8 },
  sheetCancelText: { color: "#CBD5E1", fontSize: 14, fontWeight: "700" },

  glassModalOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0, 0, 0, 0.8)", justifyContent: "center", alignItems: "center", zIndex: 99999, elevation: 99999, paddingHorizontal: 24 },
  glassModalCard: { width: "100%", maxWidth: 320, backgroundColor: "rgba(15, 23, 42, 0.95)", borderRadius: 24, borderWidth: 1, borderColor: GLASS_BORDER, padding: 24, alignItems: "center", shadowColor: "#000", shadowOpacity: 0.6, shadowOffset: { width: 0, height: 12 }, shadowRadius: 24, elevation: 20 },
  glassModalTitle: { color: "#F8FAFC", fontSize: 18, fontWeight: "700", textAlign: "center", marginBottom: 8 },
  glassModalSubText: { color: "#94A3B8", fontSize: 13, textAlign: "center", lineHeight: 18, marginBottom: 24 },
  glassModalBtn: { width: "100%", paddingVertical: 14, borderRadius: 14, backgroundColor: "rgba(148, 163, 184, 0.15)", borderWidth: 1, borderColor: "rgba(148, 163, 184, 0.2)", alignItems: "center" },
  glassModalBtnText: { color: "#F8FAFC", fontSize: 14, fontWeight: "700" },

  errorCard: { marginLeft: 10, marginRight:10, flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 16, backgroundColor: "rgba(127, 29, 29, 0.4)", borderWidth: 1, borderColor: "rgba(248, 113, 113, 0.45)", marginTop: 5, marginBottom: 10 },
  errorTitle: { color: "#FCA5A5", fontSize: 13, fontWeight: "700", marginBottom: 2 },
  errorText: { color: "#FEE2E2", fontSize: 11 },
  errorRetryBtn: { paddingHorizontal: 10, paddingVerification: 6, borderRadius: 999, borderWidth: 1, borderColor: "rgba(248, 250, 252, 0.5)", marginLeft: 8 },
  errorRetryText: { color: "#FEF2F2", fontSize: 11, fontWeight: "600" },
  badgeBubble: { position: "absolute", top: -10, right: -5.5, backgroundColor: "#EF4444", borderRadius: 10, minWidth: 18, height: 18, justifyContent: "center", alignItems: "center", paddingHorizontal: 4 },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "600", textAlign: "center" },
  floatingCameraButton: { position: "absolute", right: 20, bottom: Platform.OS === "android" ? 20 : 25, width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(30, 64, 175, 0.2)", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "rgba(191, 219, 254, 0.4)", shadowColor: "#000", shadowOpacity: 0.3, shadowOffset: { width: 0, height: 10 }, shadowRadius: 18, elevation: 15, zIndex: 99 },
  // ⚡ UPDATE YOUR EXISTING topBar STYLE:

  
  // ⚡ ADD THESE NEW STYLES:
  logoContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1, 
  },
  logoTextMain: {
    fontSize: 24,
    fontWeight: "900",
    color: "#F8FAFC",
    fontStyle: "italic",
    letterSpacing: -0.5,
  },
  logoTextSub: {
    color: "#A855F7",
    textShadowColor: "rgba(168, 85, 247, 0.4)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
});

export default Dashboard;