import React, { useEffect, useState, useCallback, useContext, useRef } from "react";
import { 
  View, 
  FlatList, 
  TouchableOpacity, 
  StyleSheet, 
  TextInput, 
  ActivityIndicator,
  Modal,
  Animated
} from "react-native";
import { Text } from "@rneui/themed";
import { useFocusEffect } from "@react-navigation/native";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import NetInfo from "@react-native-community/netinfo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Swipeable } from "react-native-gesture-handler";
import FastImage from "react-native-fast-image";

import { listConversationPreviews as listConversationPreviewsApi, fetchFriends } from "../services/api_chat";
import MainLayout from "../../../shared/components/MainLayout";
import AuthContext from "../../../auth/user/UserContext";
import { CallContext } from "../../call/context/CallContext"; 
import { getUnread, subscribeUnreadChanges, subscribeConversationChanges } from "../services/ChatNotifications";
import apiClient from "../../../auth/api-client/api_client";
import { getAvatar } from "../../../storage/AvatarManager";

const CACHE_KEY = "chat_list_cache";
const HIDDEN_CHATS_KEY = "hidden_chats_cache";

const formatLastTime = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();

  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
};

// ⚡ HELPER: Formats the snippet so the __SHARED_POST__ signature looks clean
const formatSnippet = (text: string) => {
  if (!text) return "No messages yet";
  if (text.startsWith("__SHARED_POST__|")) {
    return " Shared a post";
  }
  return text;
};

const saveCache = async (userId: string, data: any[]) => {
  try {
    await AsyncStorage.setItem(`${CACHE_KEY}:${userId}`, JSON.stringify(data));
  } catch (err) {
    console.log('Cache save error', err);
  }
};

const loadCache = async (userId: string): Promise<any[]> => {
  try {
    const raw = await AsyncStorage.getItem(`${CACHE_KEY}:${userId}`);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.log('Cache load error', err);
    return [];
  }
};

const baseUrl = apiClient.getBaseURL();
const newUrl = baseUrl.replace(/\/api\/?$/, "");

const Avatar = ({ userId, url, avatarVersion }: any) => {
  const [localUri, setLocalUri] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const img = await getAvatar(userId, url, avatarVersion);
      if (mounted) {
        setLocalUri(img);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [userId, url, avatarVersion]);

  return localUri ? (
    <FastImage source={{ uri: localUri }} style={styles.avatar} />
  ) : (
    <View style={styles.avatarFallback}>
      <Icon name="account" size={22} color="#cbd5e1" />
    </View>
  );
};

// --- Sub-component for Swipeable Row ---
const ChatRowItem = ({ item, navigation, onHideRequest, onCallRequest }: any) => {
  const swipeRef = useRef<Swipeable>(null);

  // ⚡ Check if this chat is blocked
  const isBlockedChat = item.amIBlocked || item.didIBlock;

  // Swipe Left Action (Hide) -> Dragging Left (dragX is negative)
  const renderRightActions = (progress: any, dragX: any) => {
    const scale = dragX.interpolate({
      inputRange: [-80, 0],
      outputRange: [1, 0.6],
      extrapolate: 'clamp',
    });
    const opacity = dragX.interpolate({
      inputRange: [-80, -40, 0],
      outputRange: [1, 0.5, 0],
      extrapolate: 'clamp',
    });

    return (
      <View style={styles.rightActionContainer}>
        <Animated.View style={{ opacity, transform: [{ scale }], width: 88, alignItems: 'center' }}>
          <Icon name="eye-off-outline" size={28} color="#fff" />
          <Text style={styles.actionText}>Hide</Text>
        </Animated.View>
      </View>
    );
  };

  // Swipe Right Action (Call) -> Dragging Right (dragX is positive)
  const renderLeftActions = (progress: any, dragX: any) => {
    // ⚡ Disable Call swipe UI if blocked
    if (isBlockedChat) return null;

    const scale = dragX.interpolate({
      inputRange: [0, 80],
      outputRange: [0.6, 1],
      extrapolate: 'clamp',
    });
    const opacity = dragX.interpolate({
      inputRange: [0, 40, 80],
      outputRange: [0, 0.5, 1],
      extrapolate: 'clamp',
    });

    return (
      <View style={styles.leftActionContainer}>
        <Animated.View style={{ opacity, transform: [{ scale }], width: 88, alignItems: 'center' }}>
          <Icon name="phone-outline" size={28} color="#fff" />
          <Text style={styles.actionText}>Call</Text>
        </Animated.View>
      </View>
    );
  };

  return (
    <Swipeable 
      ref={swipeRef} 
      renderRightActions={renderRightActions} 
      leftThreshold={75}
      rightThreshold={75}
      onSwipeableLeftWillOpen={() => {
        swipeRef.current?.close(); 
        // ⚡ Ensure call cannot trigger if blocked
        if (!isBlockedChat) {
          onCallRequest(item);
        }       
      }}
      onSwipeableRightWillOpen={() => {
        swipeRef.current?.close(); 
        onHideRequest(item);       
      }}
    >
      <TouchableOpacity
        style={styles.row}
        activeOpacity={1}
        onPress={() =>
          navigation.navigate("chat", {
            conversationId: item.conversationId,
            peerUserId: item.peerUserId,
            peerName: item.peerName,
            peerMood: item.mood,
            peerAvatarUrl: item.peerAvatarUrl,
            // ⚡ Pass Block Flags to ChatScreen
            amIBlocked: item.amIBlocked,
            didIBlock: item.didIBlock,
            tick: item.tick,
            isPremium: item.isPremium
          })
        }
      >
        {/* ⚡ BLOCK LOGIC: Hide DP if blocked */}
        {isBlockedChat ? (
          <View style={styles.avatarFallback}>
            <Icon name="account" size={22} color="#cbd5e1" />
          </View>
        ) : (
          <Avatar
            userId={item.peerUserId}
            url={item.peerAvatarUrl}
            avatarVersion={item.avatarVersion}
          />
        )}
        <View style={styles.rowContent}>
          <View style={styles.rowTop}>
            <View style={styles.nameBadgeContainer}>
              <Text style={styles.peer} numberOfLines={1}>
                {item.peerName}
              </Text>
              
              {/* ⚡ Clean wrapper container for Ticks & Premium Star Badge */}
              <View style={styles.badgesWrapper}>
                {item.tick === "verified" && (
                  <Icon name="check-decagram" size={16} color="#3b82f6" />
                )}
                {item.tick === "golden" && (
                  <Icon name="check-decagram" size={16} color="#fbbf24" />
                )}
                {item?.isPremium && (
                  <Icon name="star-circle" size={16} color="#fbbf24" />
                )}
              </View>
            </View>
            <Text style={styles.time}>{formatLastTime(item.lastAt)}</Text>
          </View>
          <View style={styles.rowTop}>
            {/* ⚡ USE THE formatSnippet HELPER HERE */}
            <Text style={[styles.snippet, isBlockedChat && { color: "#f87171", fontStyle: "italic" }]} numberOfLines={1}>
              {isBlockedChat ? "" : formatSnippet(item.lastText)}
            </Text>
            {item.unread > 0 && !isBlockedChat && (
              <View style={styles.badge}>
                <Text style={styles.badgeText} numberOfLines={1}>
                  {item.unread > 99 ? "99+" : item.unread}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    </Swipeable>
  );
};

export default function ChatListScreen({ navigation }: any) {
  const [myUserId, setMyUserId] = useState("");
  const [userLoaded, setUserLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [hiddenChats, setHiddenChats] = useState<{ [key: string]: string }>({});
  
  const [offline, setOffline] = useState(false);
  const [version, setVersion] = useState(0);
  const [loadingCache, setLoadingCache] = useState(true);
  const [loadingApi, setLoadingApi] = useState(false);

  const [deleteCandidate, setDeleteCandidate] = useState<any>(null);

  const user = useContext(AuthContext);
  const callContext = useContext(CallContext); 

useEffect(() => {
    // ⚡ FIX: Safely extract ID falling back through all possible structures
    const resolvedId = String(
      user?.User?.user?.id || 
      user?.User?.user?._id || 
      user?.User?.id || 
      user?.User?._id || 
      ""
    );
    setMyUserId(resolvedId);
    setUserLoaded(!!resolvedId);
  }, [user]);

  const loadHiddenChatsState = async (userId: string) => {
    try {
      const raw = await AsyncStorage.getItem(`${HIDDEN_CHATS_KEY}:${userId}`);
      if (raw) setHiddenChats(JSON.parse(raw));
    } catch (e) {
      console.log('Error loading hidden chats', e);
    }
  };

  useEffect(() => {
    if (!myUserId) {
      setLoadingCache(false);
      return;
    }
    setLoadingCache(true);
    
    Promise.all([
      loadCache(myUserId),
      loadHiddenChatsState(myUserId)
    ]).then(([cached]) => {
      setRows(cached || []); 
      setLoadingCache(false);
    });
  }, [myUserId]);

  const loadOnline = useCallback(async () => {
    if (!myUserId || offline) return;
    setLoadingApi(true);

    try {
      const [{ data: convRes }, friendsRes] = await Promise.all([
        listConversationPreviewsApi(),
        fetchFriends(),
      ]);

      if (!convRes?.conversations || !Array.isArray(convRes.conversations)) throw new Error("Failed to load conversations");
      if (!friendsRes?.data?.friends || !Array.isArray(friendsRes.data.friends)) throw new Error("Failed to load friends");

      const friends = friendsRes?.data?.friends || [];
      const friendMap = new Map();

      for (const f of friends) {
        friendMap.set(String(f._id), {
          name: String(f.name || f.username || "User"),
          avatarUrl: String(f.avatar || ""),
          avatarVersion: f.avatarVersion,
          tick: f.tick || "none",
          isPremium: !!f.isPremium,
        });
      }

      const convos = convRes?.conversations || [];
      const mapped = convos.map((c: any) => {
        const peerId = String(c.peerUserId);
        const friend = friendMap.get(peerId);

        return {
          conversationId: String(c.conversationId),
          peerUserId: peerId,
          peerName: friend?.name || c.peerName || "User", 
          peerAvatarUrl: String(friend?.avatarUrl || c.peerAvatarUrl || c.avatarUrl || ""), 
          avatarVersion: friend?.avatarVersion || c.avatarVersion,
          mood: c.mood || "",
          lastText: c.lastText || "",
          lastAt: c.lastAt || "",
          tick: friend?.tick || c.tick || "none",
          isPremium: friend?.isPremium ?? c.isPremium ?? false, 
          unread: Number(getUnread(peerId) || c.unread || 0),
          amIBlocked: !!c.amIBlocked,
          didIBlock: !!c.didIBlock,
        };
      });

      mapped.sort((a: any, b: any) => new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime());

      if (mapped.length > 0) {
        setRows(mapped);
        await saveCache(myUserId, mapped);
      }
      setLoadingApi(false);
    } catch (e) {
      setLoadingApi(false);
    }
  }, [myUserId, offline]);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      setOffline(!state.isConnected || state.isInternetReachable === false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (myUserId && !offline) loadOnline();
  }, [loadOnline, version, myUserId, offline]);

  useFocusEffect(
    useCallback(() => {
      if (!myUserId) return;
      Promise.all([
        loadCache(myUserId),
        loadHiddenChatsState(myUserId)
      ]).then(([cached]) => {
        setRows(cached || []);
        setLoadingCache(false);
      });
      loadOnline();
    }, [myUserId, loadOnline])
  );

  useEffect(() => {
    const a = subscribeConversationChanges(() => setVersion((v) => v + 1));
    const b = subscribeUnreadChanges(() => setVersion((v) => v + 1));
    return () => { a(); b(); };
  }, []);

  const visibleFilteredRows = rows.filter((r) => {
    const matchesSearch = String(r.peerName || "").toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;

    const hiddenTimestamp = hiddenChats[r.conversationId];
    if (hiddenTimestamp) {
      const isNewMessage = new Date(r.lastAt || 0).getTime() > new Date(hiddenTimestamp).getTime();
      if (!isNewMessage) return false; 
    }
    return true;
  });

  const handleConfirmHide = async () => {
    if (!deleteCandidate) return;
    const hideTime = deleteCandidate.lastAt || new Date().toISOString();
    const updatedHidden = { ...hiddenChats, [deleteCandidate.conversationId]: hideTime };
    
    setHiddenChats(updatedHidden);
    await AsyncStorage.setItem(`${HIDDEN_CHATS_KEY}:${myUserId}`, JSON.stringify(updatedHidden));
    setDeleteCandidate(null);
  };

  const handleCancelHide = () => setDeleteCandidate(null);

  const handleCallRequest = (item: any) => {
    if (offline) {
      alert("You are offline. Connect to the internet to call.");
      return;
    }
    
    if (callContext) {
      callContext.startCall(
        {
          id: String(item.peerUserId),
          name: item.peerName || "User",
          avatar: newUrl + String(item.peerAvatarUrl || ""),
        }, 
        item.conversationId
      );
    }
  };

  return (
     <MainLayout hideNavBar={true}>
      <View style={styles.root}>
        <View style={styles.baseBackground} />

        <View style={{ flex: 1 }}>
          <View style={styles.topBar}>
            <TouchableOpacity activeOpacity={0.8} style={styles.iconGlass} onPress={() => navigation.goBack()}>
             <Icon name="arrow-left" size={24} color="#E5E7EB" />
           </TouchableOpacity>
            <View>
              <Text style={styles.title}>Chats</Text>
            </View>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => navigation.navigate("NewChat")}
            >
              <Icon name="plus" size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.searchBox}>
            <Icon name="magnify" size={20} color="#94a3b8" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search"
              placeholderTextColor="#94a3b8"
              value={search}
              onChangeText={setSearch}
            />
          </View>

          <FlatList
            data={visibleFilteredRows}
            keyExtractor={(item) => `${item.conversationId}:${item.peerUserId}`}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <ChatRowItem 
                item={item} 
                navigation={navigation} 
                onHideRequest={setDeleteCandidate} 
                onCallRequest={handleCallRequest}
              />
            )}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          />
        </View>

        <Modal
          visible={!!deleteCandidate}
          transparent
          animationType="fade"
          onRequestClose={handleCancelHide}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.glassCard}>
              <View style={styles.glassIconWrapper}>
                <Icon name="eye-off-outline" size={32} color="#a855f7" />
              </View>
              <Text style={styles.modalTitle}>Hide Chat?</Text>
              <Text style={styles.modalSubtitle}>
                {deleteCandidate?.peerName} will be hidden from your list until a new message is sent or received.
              </Text>
              
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalBtnCancel} onPress={handleCancelHide}>
                  <Text style={styles.modalBtnCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalBtnConfirm} onPress={handleConfirmHide}>
                  <Text style={styles.modalBtnConfirmText}>Hide</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </MainLayout>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a", padding: 12 },
  baseBackground: { ...StyleSheet.absoluteFill, backgroundColor: "#020617" },
  glowTop: {
    position: "absolute",
    top: -120,
    left: -40,
    width: 220,
    height: 220,
    borderRadius: 220,
    backgroundColor: "rgba(59, 130, 246, 0.28)",
  },
  glowBottom: {
    position: "absolute",
    bottom: -140,
    right: -40,
    width: 220,
    height: 220,
    borderRadius: 220,
    backgroundColor: "rgba(168, 85, 247, 0.28)",
  },

  row: {
    backgroundColor: "#0f172a", 
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  rowContent: { flex: 1, marginLeft: 10 },

  leftActionContainer: {
    width: "100%", 
    backgroundColor: "#22c55e",
    justifyContent: "center",
    alignItems: "flex-start",
    borderRadius: 12,
  },
  rightActionContainer: {
    width: "100%", 
    backgroundColor: "#ef4444",
    justifyContent: "center",
    alignItems: "flex-end",
    borderRadius: 12,
  },

  actionText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
    marginTop: 4,
  },

  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
  },
  avatarFallback: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
  },

  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  time: { color: "#94a3b8", fontSize: 12, marginLeft: 10 },

  // ⚡ Name and Badge Layout Styling
  nameBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  badgesWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 6,
    gap: 4,
  },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#6366f1",
    alignItems: "center",
    justifyContent: "center",
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    paddingHorizontal: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.3)",
  },
  searchInput: { flex: 1, color: "#fff", paddingVertical: 8, marginLeft: 6 },

  peer: { color: "#fff", fontSize: 16, fontWeight: "700", flexShrink: 1 },
  snippet: { color: "#94a3b8", marginTop: 4, flex: 1, marginRight: 8 },
  badge: {
    marginLeft: 8,
    backgroundColor: "#f43f5e",
    borderRadius: 12,
    minWidth: 22,
    paddingHorizontal: 5,
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
  },
  badgeText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 12,
    textAlign: "center",
    includeFontPadding: false,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  glassCard: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: "rgba(30, 41, 59, 0.75)",
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 5,
  },
  glassIconWrapper: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(168, 85, 247, 0.15)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.3)",
  },
  modalTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
    marginBottom: 8,
  },
  modalSubtitle: {
    color: "#94a3b8",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  modalActions: {
    flexDirection: "row",
    width: "100%",
    justifyContent: "space-between",
  },
  modalBtnCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    marginRight: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  modalBtnCancelText: {
    color: "#cbd5e1",
    fontWeight: "700",
    fontSize: 15,
  },
  iconGlass: {
    width: 40, height: 40, borderRadius: 16,
    backgroundColor: "rgba(15, 23, 42, 0.0)",
    borderWidth: 1, borderColor: "rgba(148, 163, 184, 0.4)",
    justifyContent: "center", alignItems: "center",
    shadowColor: "#000", shadowOpacity: 0.15, shadowOffset: { width: 0, height: 6 },
    shadowRadius: 10, elevation: 4, marginLeft: 12, marginTop: 5,
  },
  modalBtnConfirm: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#ef4444",
    marginLeft: 8,
    alignItems: "center",
    shadowColor: "#ef4444",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  modalBtnConfirmText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
});