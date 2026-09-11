import React, { useState, useEffect, useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Share,
  Linking,
  Platform,
  ActivityIndicator,
  Clipboard,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import FastImage from 'react-native-fast-image';
import MainLayout from '../../../shared/components/MainLayout';
import socialApi from '../../friends/services/api_friends';
import { getAvatar } from '../../../storage/AvatarManager';

// ⚡ NEW: Import AuthContext
import AuthContext from '../../../auth/user/UserContext';

const APP_LINK = "https://play.google.com/store/apps/details?id=com.streaksphere";

export default function InviteFriendsScreen() {
  const navigation = useNavigation<any>();
  
  // ⚡ NEW: Pull the username dynamically from your context
  const authContext = useContext(AuthContext);
  const me = socialApi.previewProfile(authContext?.User?.user.id)
  

  // ⚡ NEW: Moved INVITE_TEXT inside so it can use the dynamic 'username' variable
  const INVITE_TEXT = `Hey👋\nI am on StreakSphere as @${me?.username}. Add me on there for new things! Let's explore new Era Of Social Media together: ${APP_LINK}`;

  const [suggestedUsers, setSuggestedUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingActions, setLoadingActions] = useState<string | null>(null);
  const [sentRequests, setSentRequests] = useState<{ [key: string]: boolean }>({});
  const [avatarMap, setAvatarMap] = useState<Record<string, string | null>>({});
  const [copied, setCopied] = useState(false);

  // 1. Fetch Suggestions
  const fetchSuggestions = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await socialApi.getSuggestedUsers(10);
      const data = (res?.data?.suggestions ?? []).filter((u: any) => u?._id);
      setSuggestedUsers(data);
    } catch (e) {
      console.log("[InviteFriends] Failed to fetch suggestions", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSuggestions();
  }, []);

  // 2. Preload Avatars
  useEffect(() => {
    let isMounted = true;
    const preloadAvatars = async () => {
      const entries = await Promise.all(
        suggestedUsers.map(async (u: any) => {
          const raw = u.avatarThumbnailUrl || u.avatarUrl || (typeof u.avatar === "string" ? u.avatar : u.avatar?.url) || "";
          const local = await getAvatar(u._id, raw);
          return [u._id, local];
        })
      );
      if (!isMounted) return;
      setAvatarMap(Object.fromEntries(entries));
    };

    if (suggestedUsers.length > 0) {
      preloadAvatars();
    }
    return () => { isMounted = false; };
  }, [suggestedUsers]);

  // 3. Friend Request Handler
  const sendFriendRequest = async (userId: string) => {
    setLoadingActions(userId);
    try {
      await socialApi.sendFriendRequest(userId);
      setSentRequests(prev => ({ ...prev, [userId]: true }));
    } catch (error) {
      console.log('[InviteFriends] Failed to send friend request', error);
    } finally {
      setLoadingActions(null);
    }
  };

  // 4. External Invite Actions
  const inviteViaWhatsApp = () => {
    const url = `whatsapp://send?text=${encodeURIComponent(INVITE_TEXT)}`;
    Linking.canOpenURL(url).then(supported => {
      if (supported) Linking.openURL(url);
      else openNativeShare();
    });
  };

  const inviteViaSMS = () => {
    const separator = Platform.OS === 'ios' ? '&' : '?';
    const url = `sms:${separator}body=${encodeURIComponent(INVITE_TEXT)}`;
    Linking.openURL(url);
  };

  const openNativeShare = async () => {
    try {
      await Share.share({ message: INVITE_TEXT, title: 'Join StreakSphere' });
    } catch (error) {
      console.log('[InviteFriends] Error sharing', error);
    }
  };

  const copyToClipboard = () => {
    Clipboard.setString(INVITE_TEXT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderSuggestedUser = ({ item }: any) => {
    const isSent = sentRequests[item._id] || item.requestSent;
    const isProcessing = loadingActions === item._id;
    const avatarUri = avatarMap[item._id];

    return (
      <View style={styles.userCard}>
        <TouchableOpacity 
          style={styles.userInfo} 
          activeOpacity={0.8}
          onPress={() => navigation.push("ProfilePreview", { userId: item._id, name: item.name })}
        >
          {avatarUri ? (
            <FastImage source={{ uri: avatarUri }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarText}>{(item.name || item.username || 'U').charAt(0).toUpperCase()}</Text>
            </View>
          )}

          <View style={styles.userTextWrap}>
            <View style={styles.nameRow}>
              <Text style={styles.userName} numberOfLines={1}>{item.name ?? item.username}</Text>
              {item.tick === "golden" ? (
                <Icon name="check-decagram" size={14} color="#FBBF24" style={{ marginLeft: 4 }} />
              ) : item.tick === "verified" || item.isVerified ? (
                <Icon name="check-decagram" size={14} color="#38BDF8" style={{ marginLeft: 4 }} />
              ) : null}
            </View>
            <Text style={styles.userHandle} numberOfLines={1}>@{item.username}</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.addButton, isSent && styles.sentButton]}
          onPress={() => sendFriendRequest(item._id)}
          disabled={isSent || isProcessing}
          activeOpacity={0.8}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Text style={[styles.addButtonText, isSent && styles.sentButtonText]}>
              {isSent ? 'Sent' : 'Add Friend'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <MainLayout hideNavBar={true}>
      {/* Top Header */}
      <View style={styles.topBar}>
        <TouchableOpacity activeOpacity={0.8} style={styles.iconGlass} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={24} color="#E5E7EB" />
        </TouchableOpacity>
        <Text style={styles.pageTitle}>Invite Friends</Text>
        <View style={styles.rightSpacer} />
      </View>

      <FlatList
        data={suggestedUsers}
        keyExtractor={item => item._id}
        renderItem={renderSuggestedUser}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshing={refreshing}
        onRefresh={() => fetchSuggestions(true)}
        ListHeaderComponent={
          <>
            {/* Banner Card */}
            <View style={styles.bannerCard}>
              <View style={styles.bannerIconWrap}>
                <Icon name="account-group" size={32} color="#818CF8" />
              </View>
              <Text style={styles.bannerTitle}>Grow Your Circle</Text>
              <Text style={styles.bannerSubtitle}>
                Invite your contacts to StreakSphere and keep your streaks alive together.
              </Text>

              {/* Copy Invite Link Input */}
              <TouchableOpacity style={styles.copyLinkContainer} activeOpacity={0.85} onPress={copyToClipboard}>
                <Text style={styles.linkText} numberOfLines={1}>{APP_LINK}</Text>
                <View style={styles.copyBadge}>
                  <Icon name={copied ? "check" : "content-copy"} size={14} color="#FFF" />
                  <Text style={styles.copyBadgeText}>{copied ? "Copied" : "Copy"}</Text>
                </View>
              </TouchableOpacity>
            </View>

            {/* External Share Section */}
            <Text style={styles.sectionHeader}>Share Via</Text>
            <View style={styles.socialGrid}>
              <TouchableOpacity style={styles.socialBtn} onPress={inviteViaWhatsApp} activeOpacity={0.8}>
                <View style={[styles.socialIconWrap, { backgroundColor: "rgba(37, 211, 102, 0.15)" }]}>
                  <Icon name="whatsapp" size={24} color="#25D366" />
                </View>
                <Text style={styles.socialLabel}>WhatsApp</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.socialBtn} onPress={inviteViaSMS} activeOpacity={0.8}>
                <View style={[styles.socialIconWrap, { backgroundColor: "rgba(14, 165, 233, 0.15)" }]}>
                  <Icon name="message-text" size={22} color="#0ea5e9" />
                </View>
                <Text style={styles.socialLabel}>Message</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.socialBtn} onPress={openNativeShare} activeOpacity={0.8}>
                <View style={[styles.socialIconWrap, { backgroundColor: "rgba(225, 48, 108, 0.15)" }]}>
                  <Icon name="instagram" size={24} color="#E1306C" />
                </View>
                <Text style={styles.socialLabel}>Instagram</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.socialBtn} onPress={openNativeShare} activeOpacity={0.8}>
                <View style={[styles.socialIconWrap, { backgroundColor: "rgba(148, 163, 184, 0.15)" }]}>
                  <Icon name="share-variant" size={22} color="#CBD5E1" />
                </View>
                <Text style={styles.socialLabel}>More</Text>
              </TouchableOpacity>
            </View>

            {/* Suggestions Header */}
            <View style={styles.suggestedHeaderRow}>
              <Text style={styles.sectionHeader}>People You May Know</Text>
              <TouchableOpacity onPress={() => fetchSuggestions(true)}>
                <Icon name="refresh" size={18} color="#94A3B8" />
              </TouchableOpacity>
            </View>
          </>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator size="small" color="#6366f1" style={{ marginTop: 24 }} />
          ) : (
            <Text style={styles.emptyText}>No suggestions available right now.</Text>
          )
        }
      />
    </MainLayout>
  );
}

const styles = StyleSheet.create({
  // ... (All styles remain exactly the same as your previous code)
  topBar: { 
    flexDirection: "row", 
    alignItems: "center", 
    marginTop: 6,
    marginBottom: 8,
  },
  iconGlass: {
    width: 40, 
    height: 40, 
    borderRadius: 16,
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    borderWidth: 1, 
    borderColor: "rgba(148, 163, 184, 0.25)",
    justifyContent: "center", 
    alignItems: "center",
    marginLeft: 16,
  },
  pageTitle: { 
    flex: 1, 
    textAlign: "center", 
    fontSize: 18, 
    fontWeight: "700", 
    color: "#F9FAFB" 
  },
  rightSpacer: { 
    width: 40, 
    height: 40, 
    marginRight: 16 
  },
  scrollContent: { 
    paddingHorizontal: 16, 
    paddingBottom: 40 
  },

  // Banner
  bannerCard: {
    backgroundColor: "rgba(30, 41, 59, 0.45)",
    borderRadius: 20,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.15)",
    marginTop: 10,
    marginBottom: 20,
  },
  bannerIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(99, 102, 241, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  bannerTitle: {
    color: "#F8FAFC",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 6,
  },
  bannerSubtitle: {
    color: "#94A3B8",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 16,
    paddingHorizontal: 10,
  },
  copyLinkContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.7)",
    borderRadius: 14,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.3)",
    width: "100%",
  },
  linkText: {
    color: "#CBD5E1",
    fontSize: 12,
    flex: 1,
    marginRight: 8,
  },
  copyBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#6366f1",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    gap: 4,
  },
  copyBadgeText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "600",
  },

  // Social Grid
  sectionHeader: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 12,
    marginLeft: 4,
  },
  suggestedHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 20,
    marginBottom: 8,
    marginRight: 4,
  },
  socialGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  socialBtn: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "rgba(30, 41, 59, 0.35)",
    paddingVertical: 12,
    marginHorizontal: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.12)",
  },
  socialIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  socialLabel: {
    color: "#E2E8F0",
    fontSize: 11,
    fontWeight: "600",
  },

  // User List Cards
  userCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "rgba(30, 41, 59, 0.4)",
    padding: 12,
    borderRadius: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.12)",
  },
  userInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 10,
  },
  avatarPlaceholder: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(99, 102, 241, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.4)",
  },
  avatarImage: {
    width: 42,
    height: 42,
    borderRadius: 21,
    marginRight: 12,
  },
  avatarText: {
    color: "#C4B5FD",
    fontWeight: "bold",
    fontSize: 16,
  },
  userTextWrap: {
    flex: 1,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  userName: {
    color: "#F8FAFC",
    fontWeight: "700",
    fontSize: 14,
  },
  userHandle: {
    color: "#94A3B8",
    fontSize: 12,
    marginTop: 2,
  },
  addButton: {
    backgroundColor: "#6366f1",
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 10,
    minWidth: 84,
    alignItems: "center",
  },
  sentButton: {
    backgroundColor: "rgba(148, 163, 184, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.3)",
  },
  addButtonText: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: 12,
  },
  sentButtonText: {
    color: "#94A3B8",
  },
  emptyText: {
    color: "#64748B",
    textAlign: "center",
    fontSize: 13,
    marginTop: 20,
  },
});