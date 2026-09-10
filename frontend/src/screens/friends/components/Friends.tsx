import React, { useState, useEffect, useMemo, useContext, useCallback, useRef } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ScrollView,
  Platform,
  StatusBar,
  Image,
  ActivityIndicator, // ⚡ ADDED: For the loading spinner
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { Text } from "@rneui/themed";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import MainLayout from "../../../shared/components/MainLayout";
import AppScreen from "../../../components/Layout/AppScreen/AppScreen";
import socialApi from "../services/api_friends";
import AuthContext from "../../../auth/user/UserContext";
import { UserProfile, FollowRequest } from "../models/FriendModel";
import apiClient from "../../../auth/api-client/api_client";

import { getAvatar } from "../../../storage/AvatarManager";

const GLASS_BG = "rgba(15, 23, 42, 0.65)";
const GLASS_BORDER = "rgba(148, 163, 184, 0.35)";
const ICON_GLASS_BG = "rgba(15, 23, 42, 0)";

const CACHE_PREFIX = "friends_cache_v1";

const GlassNotification = ({ visible, type, message, onDismiss }: any) => {
  if (!visible) return null;
  return (
    <View style={styles.notificationCard}>
      <Icon name={type === "success" ? "check-circle" : "close-circle"} size={20} color="#fff" />
      <Text style={styles.notificationText}>{message}</Text>
      <TouchableOpacity onPress={onDismiss}>
        <Icon name="close" size={21} color="#F9FAFB" style={{ marginLeft: 8 }} />
      </TouchableOpacity>
    </View>
  );
};

const GlassConfirmModal = ({
  visible,
  message,
  onCancel,
  onRemove,
}: {
  visible: boolean;
  message: string;
  onCancel: () => void;
  onRemove: () => void;
}) => {
  if (!visible) return null;
  return (
    <View style={styles.modalOverlay}>
      <View style={styles.modalCard}>
        <Icon name="help-circle-outline" size={32} color="#ccc" style={{ marginBottom: 8 }} />
        <Text style={styles.modalMessage}>{message}</Text>
        <View style={{ flexDirection: "row", marginTop: 14 }}>
          <TouchableOpacity
            style={[styles.modalBtn, { backgroundColor: "#A3A3A3", marginRight: 10 }]}
            onPress={onCancel}
          >
            <Text style={styles.modalBtnText}>Keep</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.modalBtn, { backgroundColor: "#EF4444" }]} onPress={onRemove}>
            <Text style={styles.modalBtnText}>Remove</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

// ⚡ ADDED: Helper to detect when ScrollView hits the bottom
const isCloseToBottom = ({ layoutMeasurement, contentOffset, contentSize }: any) => {
  const paddingToBottom = 50; // trigger a bit before they hit the absolute bottom
  return layoutMeasurement.height + contentOffset.y >= contentSize.height - paddingToBottom;
};

const Friends = ({ navigation }: any) => {
  const authContext = useContext(AuthContext);
  const currentUserId = authContext?.User?.user?._id || authContext?.User?.user?.id;

  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<UserProfile[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [friendRequests, setFriendRequests] = useState<FollowRequest[]>([]);
  const [showAllRequests, setShowAllRequests] = useState(false);
  const [loadingActions, setLoadingActions] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [showRemoveModal, setShowRemoveModal] = useState<{ user: UserProfile | null } | null>(null);
  const [avatarMap, setAvatarMap] = useState<Record<string, string | null>>({});

  // ⚡ ADDED: Pagination State
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const isSearching = search.trim().length > 0;
  const offlineRef = useRef(false);
  const [offline, setOffline] = useState(false);

  const cacheKeys = useMemo(() => {
    const uid = String(currentUserId || "anon");
    return {
      suggestions: `${CACHE_PREFIX}:${uid}:suggestions`,
      friendRequests: `${CACHE_PREFIX}:${uid}:friendRequests`,
      search: (q: string) => `${CACHE_PREFIX}:${uid}:search:${q.trim().toLowerCase()}`,
    };
  }, [currentUserId]);

  const saveCache = async (key: string, value: any) => {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch {}
  };

  const loadCache = async <T,>(key: string): Promise<T | null> => {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    NetInfo.fetch().then((state) => {
      const isOffline = !(state.isConnected && state.isInternetReachable !== false);
      offlineRef.current = isOffline;
      setOffline(isOffline);
    });

    const unsub = NetInfo.addEventListener((state) => {
      const isOffline = !(state.isConnected && state.isInternetReachable !== false);
      offlineRef.current = isOffline;
      setOffline(isOffline);
    });
    return () => unsub();
  }, []);

  const openProfilePreview = (u: any) => {
    if (!u?._id) return;
    navigation.navigate("ProfilePreview", {
      userId: u._id,
      name: u.name,
      username: u.username,
    });
  };

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 2300);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    (async () => {
      const [cachedSuggestions, cachedRequests] = await Promise.all([
        loadCache<UserProfile[]>(cacheKeys.suggestions),
        loadCache<FollowRequest[]>(cacheKeys.friendRequests),
      ]);
      if (cachedSuggestions) setSuggestions(cachedSuggestions);
      if (cachedRequests) setFriendRequests(cachedRequests);
    })();
  }, [cacheKeys]);

  const fetchRequests = useCallback(async () => {
    if (offlineRef.current) return;
    try {
      const res = await socialApi.getPendingFriendRequests();
      const cleaned = (res?.data?.requests ?? [])
        .map((r: any) => {
          if (r?.user?._id) return r;
          return {
            ...r,
            user: {
              _id: r._id,
              name: r.name,
              username: r.username,
              avatarColor: r.avatarColor,
              avatarUrl: r.avatarUrl,
              avatar: r.avatar,
              isFriend: r.isFriend,
              requestSent: r.requestSent,
              requestIncoming: r.requestIncoming,
            },
            requestedAt: r.requestedAt,
          };
        })
        .filter((r: any) => r?.user?._id);

      setFriendRequests(cleaned);
      await saveCache(cacheKeys.friendRequests, cleaned);
    } catch (e) {
      console.log("[FRIENDS] fetchRequests error:", e);
    }
  }, [cacheKeys]);

  // ⚡ MODIFIED: Accepts pageNum and appends to the list
  const fetchSuggestions = useCallback(async (pageNum = 1) => {
    if (offlineRef.current) return;
    if (pageNum > 1) setLoadingMore(true);

    try {
      // Passes pageNum and limit (10)
      const res = await socialApi.getSuggestedUsers(pageNum, 10);
      const data = (res?.data?.suggestions ?? []).filter((u: any) => u?._id);

      if (pageNum === 1) {
        setSuggestions(data);
        await saveCache(cacheKeys.suggestions, data);
      } else {
        setSuggestions((prev) => {
          const existingIds = new Set(prev.map((p) => p._id));
          const newItems = data.filter((d: any) => !existingIds.has(d._id));
          return [...prev, ...newItems];
        });
      }
      setHasMore(res?.data?.hasMore ?? false);
      setPage(pageNum);
    } catch (e) {
      console.log("[FRIENDS] fetchSuggestions error:", e);
    } finally {
      setLoadingMore(false);
    }
  }, [cacheKeys]);

  // ⚡ ADDED: Load more function triggered by scroll
  const handleLoadMore = () => {
    if (!isSearching && hasMore && !loadingMore && !offline) {
      fetchSuggestions(page + 1);
    }
  };

  const fetchSearch = useCallback(async () => {
    const key = cacheKeys.search(search);
    const cached = await loadCache<UserProfile[]>(key);
    if (cached) setAllUsers(cached);

    if (offlineRef.current) {
      if (!cached) setAllUsers([]);
      return;
    }

    try {
      const res = await socialApi.searchUsers(`q=${encodeURIComponent(search)}`);
      const data = (res?.data?.user ?? []).filter((u: any) => u?._id);
      setAllUsers(data);
      await saveCache(key, data);
    } catch (e) {
      console.log("[FRIENDS] fetchSearch error:", e);
      if (!cached) setAllUsers([]);
    }
  }, [search, cacheKeys]);

  useEffect(() => {
    fetchSuggestions(1); // ⚡ Pass page 1 on mount
    fetchRequests();
  }, [fetchSuggestions, fetchRequests]);

  useEffect(() => {
    if (isSearching) {
      fetchSearch();
    } else {
      setAllUsers([]);
    }
  }, [search, isSearching, fetchSearch]);

  useEffect(() => {
    let isMounted = true;
    const preloadAvatars = async () => {
      const combined = [
        ...suggestions,
        ...allUsers,
        ...friendRequests.map((r) => r.user),
      ].filter((u) => u && u._id);

      const uniqueUsers = Array.from(new Map(combined.map((item) => [item._id, item])).values());
      const entries = await Promise.all(
        uniqueUsers.map(async (u: any) => {
          const raw =
            u.avatarThumbnailUrl ||
            u.avatarUrl ||
            (typeof u.avatar === "string" ? u.avatar : u.avatar?.url) ||
            "";
          const local = await getAvatar(u._id, raw);
          return [u._id, local];
        })
      );
      if (!isMounted) return;
      setAvatarMap(Object.fromEntries(entries));
    };

    if (suggestions.length || allUsers.length || friendRequests.length) {
      preloadAvatars();
    }
    return () => { isMounted = false; };
  }, [suggestions, allUsers, friendRequests]);

  const searchResults = useMemo(() => (isSearching ? allUsers : []), [allUsers, isSearching]);

  const handleAddFriend = async (user: UserProfile) => {
    setLoadingActions(user._id);
    try {
      await socialApi.sendFriendRequest(user._id);
      setNotification({ type: "success", message: `Request sent to ${user.name || user.username}` });
      isSearching ? await fetchSearch() : await fetchSuggestions(1);
      await fetchRequests();
    } catch (e) {
      console.log("[FRIENDS] handleAddFriend error:", e);
      setNotification({ type: "error", message: "Could not send friend request." });
    }
    setLoadingActions(null);
  };

  const handleCancelRequest = async (user: UserProfile) => {
    setLoadingActions(user._id);
    try {
      await socialApi.removeFriendRequest(user._id);
      setNotification({ type: "success", message: `Removed request to ${user.name || user.username}` });
      isSearching ? await fetchSearch() : await fetchSuggestions(1);
      await fetchRequests();
    } catch (e) {
      console.log("[FRIENDS] handleCancelRequest error:", e);
      setNotification({ type: "error", message: "Couldn't remove friend request." });
    }
    setLoadingActions(null);
    setShowRemoveModal(null);
  };

  const [acceptedIds, setAcceptedIds] = useState<string[]>([]);

  const handleAcceptRequest = async (req: FollowRequest) => {
    const id = req?.user?._id;
    if (!id) return;
    setLoadingActions(id);
    try {
      await socialApi.acceptFriendRequest(id);
      setNotification({ type: "success", message: `Accepted request from ${req.user.name}` });
      setAcceptedIds((prev) => [...prev, id]); 
      setFriendRequests((prev) => prev.filter((r) => r.user._id !== id));
      isSearching ? await fetchSearch() : await fetchSuggestions(1);
      await fetchRequests();
    } catch (e) {
      setNotification({ type: "error", message: "Couldn't accept request." });
    }
    setLoadingActions(null);
  };

  const requestListToShow = (showAllRequests
    ? friendRequests
    : friendRequests.slice(0, 3)
  ).filter(r => !acceptedIds.includes(r.user._id));

  const handleRejectRequest = async (req: FollowRequest) => {
    const id = req?.user?._id;
    if (!id) return;
    setLoadingActions(id);
    try {
      await socialApi.removeFriendRequest(id);
      setNotification({ type: "success", message: `Rejected request from ${req.user.name}` });
      setFriendRequests((prev) => prev.filter((r) => r.user._id !== id));
      isSearching ? await fetchSearch() : await fetchSuggestions(1);
      await fetchRequests();
    } catch (e) {
      setNotification({ type: "error", message: "Couldn't reject request." });
    }
    setLoadingActions(null);
  };

  const renderUserItem = ({ item }: { item: UserProfile | FollowRequest }) => {
    const isRequest = (item as FollowRequest).requestedAt !== undefined;
    const user = isRequest ? (item as FollowRequest).user : (item as UserProfile);
    if (!user || !user._id) return null;

    const uri = avatarMap[user._id];

    return (
      <View style={styles.userCard}>
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.userClickable}
          onPress={() => openProfilePreview(user)}
        >
          <View style={styles.avatar}>
            {uri ? (
              <Image source={{ uri }} style={{ width: 40, height: 40, borderRadius: 999 }} resizeMode="cover" />
            ) : (
              <Icon name="account" size={20} color="#E5E7EB" />
            )}
          </View>

          <View style={styles.userInfo}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={styles.userName} numberOfLines={1}>
                {user.name ?? user.username}
              </Text>
              {user.tick === "verified" && (
                <Icon name="check-decagram" size={18} color="#3b82f6" style={{ marginLeft: 6, marginTop: 2 }} />
              )}
              {user.tick === "golden" && (
                <Icon name="check-decagram" size={18} color="#fbbf24" style={{ marginLeft: 6, marginTop: 2 }} />
              )}
              {user?.isPremium && (
                <Icon name="star-circle" size={18} color="#fbbf24" style={{ marginLeft: 3, marginTop: 2.5 }} />
            )}
            </View>
            <Text style={styles.userUsername} numberOfLines={1}>
              {user.username}
            </Text>
          </View>
        </TouchableOpacity>

        {isRequest ? (
          <View style={{ flexDirection: "row" }}>
            <TouchableOpacity
              activeOpacity={0.7}
              style={[
                styles.addBtn,
                { backgroundColor: loadingActions === user._id ? "#d1d5db" : "#22C55E", marginRight: 6 },
              ]}
              onPress={() => handleAcceptRequest(item as FollowRequest)}
              disabled={loadingActions === user._id}
            >
              <Icon name="check" size={18} color="#F9FAFB" />
              <Text style={styles.addBtnText}>
                {loadingActions === user._id ? "Accepting" : "Accept"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.7}
              style={[
                styles.addBtn,
                { backgroundColor: loadingActions === user._id ? "#d1d5db" : "#EF4444" },
              ]}
              onPress={() => handleRejectRequest(item as FollowRequest)}
              disabled={loadingActions === user._id}
            >
              <Icon name="close" size={18} color="#F9FAFB" />
              <Text style={styles.addBtnText}>
                {loadingActions === user._id ? "Rejecting..." : "Reject"}
              </Text>
            </TouchableOpacity>
          </View>
        ) : user.isFriend ? (
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: "#6366f1" }]}
            activeOpacity={0.85}
            onPress={() =>
              
          navigation.navigate("chat", {
            conversationId: user.conversationId,
            peerUserId: user._id,
            peerName: user.name,
            peerAvatarUrl: user.avatar,
            amIBlocked: user.amIBlocked,
            didIBlock: user.didIBlock,
            tick: user.tick,
            isPremium: user.showPremiumBadge
          })
         }
          >
            <Icon name="chat" size={18} color="#F9FAFB" />
            <Text style={styles.addBtnText}>Chat</Text>
          </TouchableOpacity>
        ) : user.requestIncoming ? (
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: "#22C55E" }]}
            activeOpacity={0.85}
            onPress={() => handleAcceptRequest({ user: user as any, requestedAt: new Date().toISOString() } as FollowRequest)}
            disabled={loadingActions === user._id}
          >
            <Icon name="account-arrow-left" size={18} color="#F9FAFB" />
            <Text style={styles.addBtnText}>
              {loadingActions === user._id ? "Accepting" : "Accept"}
            </Text>
          </TouchableOpacity>
        ) : user.requestSent ? (
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: "#9CA3AF" }]}
            activeOpacity={0.85}
            onPress={() => setShowRemoveModal({ user })}
            disabled={loadingActions === user._id}
          >
            <Icon name="check" size={18} color="#F9FAFB" />
            <Text style={styles.addBtnText}>
              {loadingActions === user._id ? "Removing" : "Added"}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.addBtn}
            onPress={() => handleAddFriend(user)}
            disabled={loadingActions === user._id}
          >
            <Icon name="account-plus-outline" size={18} color="#F9FAFB" />
            <Text style={styles.addBtnText}>
              {loadingActions === user._id ? "Adding" : "Add"}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };
  
  const listData = isSearching ? searchResults : suggestions;
  const handleRemoveModalCancel = () => setShowRemoveModal(null);
  const handleRemoveModalRemove = async () => {
    if (showRemoveModal?.user) {
      await handleCancelRequest(showRemoveModal.user);
    }
  };

  return (
    <MainLayout hideNavBar={true}>
      <AppScreen style={styles.root}>
        <GlassConfirmModal
          visible={!!showRemoveModal?.user}
          message={showRemoveModal?.user ? `Remove friend request to ${showRemoveModal.user.name || showRemoveModal.user.username}?` : ""}
          onCancel={handleRemoveModalCancel}
          onRemove={handleRemoveModalRemove}
        />

        <View style={styles.baseBackground} />
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        <View style={styles.overlay}>
          <View style={styles.topBar}>
            <TouchableOpacity activeOpacity={0.8} style={styles.iconGlass} onPress={() => navigation.goBack()}>
              <Icon name="arrow-left" size={22} color="#E5E7EB" />
            </TouchableOpacity>
            <Text style={styles.topTitle}>Add Friends</Text>
            <View style={styles.topRightSpacer} />
          </View>

          <ScrollView 
            contentContainerStyle={styles.scrollContent} 
            showsVerticalScrollIndicator={false}
            // ⚡ ADDED: Trigger pagination when scrolling hits the bottom!
            onScroll={({ nativeEvent }) => {
              if (isCloseToBottom(nativeEvent)) {
                handleLoadMore();
              }
            }}
            scrollEventThrottle={400}
          >
            <View style={styles.searchCard}>
              <Icon name="magnify" size={20} color="#9CA3AF" style={{ marginRight: 8 }} />
              <TextInput
                placeholder="Search users..."
                placeholderTextColor="#6B7280"
                value={search}
                onChangeText={setSearch}
                style={styles.searchInput}
              />
            </View>

            {friendRequests.length > 0 && (
              <View style={styles.userListCard}>
                <View style={styles.sectionHeader}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={styles.sectionTitle}>Friend Requests</Text>
                    {friendRequests.length > 0 && (
                      <View style={styles.badgeBubbleSection}>
                        <Text style={styles.badgeText}>{friendRequests.length}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.sectionHint}>Accept or ignore friend requests</Text>
                </View>

                <FlatList
                  data={requestListToShow}
                  keyExtractor={(item) => (item as any)?.user?._id || (item as any)?._id || Math.random().toString()}
                  renderItem={renderUserItem}
                  scrollEnabled={false}
                  showsVerticalScrollIndicator={false}
                  ItemSeparatorComponent={() => <View style={styles.listSeparator} />}
                  ListFooterComponent={() =>
                    friendRequests.length > 3 && (
                      <TouchableOpacity
                        onPress={() => setShowAllRequests((v) => !v)}
                        style={{ alignItems: "center", marginTop: 10, paddingBottom: 2 }}
                      >
                        <Icon name={showAllRequests ? "chevron-up" : "chevron-down"} size={26} color="#94A3B8" />
                        <Text style={{ color: "#94A3B8", fontSize: 12 }}>
                          {showAllRequests ? "Show Less" : "Show All"}
                        </Text>
                      </TouchableOpacity>
                    )
                  }
                />
              </View>
            )}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{isSearching ? "Search results" : "Suggested for you"}</Text>
              {!isSearching && <Text style={styles.sectionHint}>People you may want to add as friends</Text>}
            </View>

            {listData.length === 0 ? (
              <View style={styles.emptyStateCard}>
                <Icon name="account-search-outline" size={32} color="#6B7280" />
                <Text style={styles.emptyTitle}>No users found</Text>
                {isSearching ? (
                  <Text style={styles.emptyText}>Try a different name or username.</Text>
                ) : (
                  <Text style={styles.emptyText}>We'll show suggestions here when they're available.</Text>
                )}
              </View>
            ) : (
              <View style={styles.userListCard}>
                <FlatList
                  data={listData}
                  keyExtractor={(item) => item._id}
                  renderItem={renderUserItem}
                  showsVerticalScrollIndicator={false}
                  scrollEnabled={false}
                  ItemSeparatorComponent={() => <View style={styles.listSeparator} />}
                />
              </View>
            )}

            {/* ⚡ ADDED: Loading Spinner when fetching next page */}
            {loadingMore && (
              <View style={{ paddingVertical: 20, alignItems: "center" }}>
                <ActivityIndicator size="small" color="#9CA3AF" />
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </AppScreen>
    </MainLayout>
  );
};

const styles = StyleSheet.create({
  notificationCard: { position: "absolute", top: 24, left: 20, right: 20, zIndex: 999, backgroundColor: "rgba(55,209,90,0.87)", borderRadius: 18, borderWidth: 1, borderColor: "rgba(148,163,184,0.4)", paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", shadowColor: "#000", shadowOpacity: 0.12, shadowOffset: { height: 8, width: 0 } },
  notificationText: { color: "#F9FAFB", fontSize: 15, fontWeight: "600", marginLeft: 10, flex: 1 },
  modalOverlay: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(15,23,42,0.43)", zIndex: 9999, justifyContent: "center", alignItems: "center" },
  badgeBubbleSection: { backgroundColor: "#EF4444", borderRadius: 10, minWidth: 18, height: 18, justifyContent: "center", alignItems: "center", paddingHorizontal: 4, marginLeft: 10, marginTop: 2, alignSelf: "flex-start" },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "600", textAlign: "center" },
  modalCard: { backgroundColor: GLASS_BG, borderRadius: 22, borderWidth: 1, borderColor: GLASS_BORDER, padding: 24, alignItems: "center", shadowColor: "#000", shadowOpacity: 0.14, shadowOffset: { height: 12, width: 0 }, width: "82%" },
  modalMessage: { color: "#F9FAFB", fontSize: 16, fontWeight: "600", textAlign: "center", marginBottom: 3 },
  modalBtn: { paddingHorizontal: 22, paddingVertical: 8, borderRadius: 999 },
  modalBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  root: { flex: 1 },
  baseBackground: { ...StyleSheet.absoluteFill, backgroundColor: "#020617" },
  glowTop: { position: "absolute", top: -120, left: -40, width: 260, height: 260, borderRadius: 260, backgroundColor: "rgba(59, 130, 246, 0.35)" },
  glowBottom: { position: "absolute", bottom: -140, right: -40, width: 260, height: 260, borderRadius: 260, backgroundColor: "rgba(168, 85, 247, 0.35)" },
  overlay: { flex: 1, paddingTop: Platform.OS === "android" ? "3%" : "5%", paddingHorizontal: 20 },
  scrollContent: { paddingTop: 8 },
  topBar: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  iconGlass: { width: 40, height: 40, borderRadius: 16, backgroundColor: ICON_GLASS_BG, borderWidth: 1, borderColor: "rgba(148, 163, 184, 0.4)", justifyContent: "center", alignItems: "center", marginRight: 10, shadowColor: "#000", shadowOpacity: 0.25, shadowOffset: { width: 0, height: 10 }, shadowRadius: 20, elevation: 6 },
  topTitle: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "700", color: "#F9FAFB" },
  topRightSpacer: { width: 40, height: 40 },
  searchCard: { flexDirection: "row", alignItems: "center", backgroundColor: GLASS_BG, borderRadius: 999, borderWidth: 1, borderColor: GLASS_BORDER, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 18 },
  searchInput: { flex: 1, color: "#E5E7EB", fontSize: 12 },
  sectionHeader: { marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#F9FAFB" },
  sectionHint: { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  userListCard: { backgroundColor: GLASS_BG, borderRadius: 20, padding: 12, borderWidth: 1, borderColor: GLASS_BORDER, shadowColor: "#000", shadowOpacity: 0.35, shadowOffset: { width: 0, height: 14 }, shadowRadius: 24, elevation: 8, marginBottom: 15 },
  listSeparator: { height: 1, backgroundColor: "rgba(31, 41, 55, 0.9)", marginVertical: 8 },
  userCard: { flexDirection: "row", alignItems: "center" },
  avatar: { width: 40, height: 40, borderRadius: 999, justifyContent: "center", alignItems: "center", marginRight: 10, backgroundColor: "rgba(99, 102, 241, 0.25)", borderWidth: 1, borderColor: "rgba(191, 219, 254, 0.35)", overflow: "hidden" },
  userInfo: { flex: 1 },
  userName: { fontSize: 14, fontWeight: "600", color: "#E5E7EB" },
  userUsername: { fontSize: 12, color: "#9CA3AF" },
  addBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "rgba(30, 64, 175, 0.9)", borderWidth: 1, borderColor: "rgba(191, 219, 254, 0.7)" },
  addBtnText: { color: "#F9FAFB", fontSize: 12, fontWeight: "600", marginLeft: 4 },
  emptyStateCard: { backgroundColor: GLASS_BG, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: GLASS_BORDER, alignItems: "center" },
  emptyTitle: { marginTop: 10, fontSize: 15, fontWeight: "600", color: "#E5E7EB" },
  emptyText: { marginTop: 4, fontSize: 12, color: "#9CA3AF", textAlign: "center" },
  userClickable: { flexDirection: "row", alignItems: "center", flex: 1, marginRight: 10 },
});

export default Friends;