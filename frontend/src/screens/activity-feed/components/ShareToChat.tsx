import React, { useState, useEffect, useContext } from "react";
import {
  View,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  TextInput,
  ActivityIndicator,
  StatusBar,
  Platform,
} from "react-native";
import { Text } from "@rneui/themed";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { v4 as uuidv4 } from "uuid";

// ⚡ IMPORT API CLIENTS
import apiClient from "../../../auth/api-client/api_client";
// ⚡ ADDED `openDirectConversation` so we can message friends we haven't chatted with yet
import { sendMessage, openDirectConversation } from "../../chat/services/api_chat"; 
import AuthContext from "../../../auth/user/UserContext";

const ShareToChatScreen = ({ route, navigation }: any) => {
  const { postId, mediaUrl, postUsername, postCaption, postUserId } = route.params;
  const userContext = useContext(AuthContext);
  const myUserId = userContext?.User?.user?.id || userContext?.User?.user?._id;

  const baseUrl = apiClient.getBaseURL();
  const newUrl = baseUrl.replace(/\/api\/?$/, "");

  const [unifiedList, setUnifiedList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sentList, setSentList] = useState<{ [key: string]: boolean }>({});

  useEffect(() => {
    const fetchShareData = async () => {
      try {
        setLoading(true);

        // 1. Fetch Recent Chats
        const chatsRes = await apiClient.get("/chat/conversations/previews"); 
        const chats = chatsRes.data?.conversations || [];

        // 2. Fetch All Friends 
        // ⚡ WARNING: Update this URL to match your exact friends list endpoint! (e.g. '/friends', '/users/friends')
        const friendsRes = await apiClient.get("/friends/list"); 
        const friends = friendsRes.data?.friends || friendsRes.data || [];

        // 3. Normalize Recent Chats
        const normalizedChats = chats.map((c: any) => ({
          id: c.peerUserId,
          name: c.peerName || "User",
          label: "Recent chat", // Identifier for UI
          avatar: c.peerAvatarUrl,
          tick: c.tick,
          conversationId: c.conversationId,
          isRecent: true,
        }));

        // Keep track of IDs we already added so we don't duplicate them in the friends list
        const recentIds = new Set(normalizedChats.map((c: any) => c.id));

        // 4. Normalize Remaining Friends
        const normalizedFriends = friends
          .filter((f: any) => !recentIds.has(f._id || f.id)) // Skip if already in recent chats
          .map((f: any) => ({
            id: f._id || f.id,
            name: f.name || "User",
            label: `@${f.username}`, // Display username for non-recent friends
            avatar: f.avatarUrl || f.avatar?.url || f.avatar || "",
            tick: f.tick,
            conversationId: null, // We don't have a chat ID for them yet
            isRecent: false,
          }));

        // Combine: Recents strictly on top, followed by the rest
        setUnifiedList([...normalizedChats, ...normalizedFriends]);
      } catch (error) {
        console.error("Error fetching share list:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchShareData();
  }, []);

const handleSend = async (userItem: any) => {
    setSentList((prev) => ({ ...prev, [userItem.id]: true }));

    try {
      let activeConversationId = userItem.conversationId;

      if (!activeConversationId) {
        const convoRes = await openDirectConversation(userItem.id);
        activeConversationId = convoRes.data?.conversation?._id;
        if (!activeConversationId) throw new Error("Could not initialize conversation");
      }

      const clientMessageId = uuidv4();
      
      const safeUsername = postUsername || "user";
      const safeCaption = postCaption?.replace(/\|/g, "") || "Check out this post!";
      
      // ⚡ 2. ADD postUserId TO THE SIGNATURE
      const signatureText = `__SHARED_POST__|${postId}|${postUserId}|${safeUsername}|${safeCaption}`;

      await sendMessage({
        conversationId: String(activeConversationId),
        receiverId: String(userItem.id),
        text: signatureText, 
        messageType: "image", 
        media: { url: mediaUrl },
        clientMessageId: clientMessageId,
        notifyUser: true,
      });

      setTimeout(() => {
        navigation.goBack();
      }, 300);

    } catch (error) {
      console.error("Failed to share post:", error);
      setSentList((prev) => ({ ...prev, [userItem.id]: false }));
    }
  };

  const filteredList = unifiedList.filter((item) =>
    item.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.label?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconGlass} onPress={() => navigation.goBack()}>
          <Icon name="close" size={24} color="#E5E7EB" />
        </TouchableOpacity>
        <Text style={styles.pageTitle}>Share to...</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* POST PREVIEW */}
      <View style={styles.previewContainer}>
        <Image source={{ uri: mediaUrl }} style={styles.previewImage} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.previewText}>Sharing @{postUsername}'s Post</Text>
          <Text style={styles.previewSubText} numberOfLines={1}>Directly to your friends</Text>
        </View>
      </View>

      {/* SEARCH BAR */}
      <View style={styles.searchContainer}>
        <Icon name="magnify" size={20} color="#9CA3AF" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search friends..."
          placeholderTextColor="#9CA3AF"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* COMBINED RECENT CHATS + FRIENDS LIST */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#8B5CF6" />
        </View>
      ) : filteredList.length === 0 ? (
        <View style={styles.center}>
          <Icon name="account-search-outline" size={48} color="#475569" />
          <Text style={{ color: "#9CA3AF", marginTop: 12 }}>No friends or chats found</Text>
        </View>
      ) : (
        <FlatList
          data={filteredList}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
          renderItem={({ item }) => {
            const isSent = sentList[item.id];
            
            const avatarUri = item.avatar?.startsWith("http")
              ? item.avatar
              : `${newUrl}${item.avatar}`;

            return (
              <View style={styles.friendRow}>
                 {avatarUri ? (
                               <Image source={{ uri: avatarUri }} style={styles.avatar} />
                            ) : (
                              <Icon name="account" size={20} color="#E5E7EB" />
                            )}
               
                
                <View style={styles.friendInfo}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={styles.friendName}>{item.name}</Text>
                    {item.tick === "golden" && <Icon name="check-decagram" size={14} color="#FBBF24" style={{ marginLeft: 4 }} />}
                    {item.tick === "verified" && <Icon name="check-decagram" size={14} color="#38BDF8" style={{ marginLeft: 4 }} />}
                  </View>
                  {/* Shows 'Recent chat' OR '@username' based on isRecent flag */}
                  <Text style={styles.friendUsername}>{item.label}</Text>
                </View>

                <TouchableOpacity
                  style={[styles.sendButton, isSent && styles.sentButton]}
                  onPress={() => !isSent && handleSend(item)}
                  disabled={isSent}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.sendButtonText, isSent && styles.sentButtonText]}>
                    {isSent ? "Sent" : "Send"}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#020617" },
  header: { flexDirection: "row", alignItems: "center", marginTop: 10, justifyContent: "space-between", paddingTop: Platform.OS === "ios" ? 50 : 40, paddingHorizontal: 16, paddingBottom: 16 },
  iconGlass: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(30, 41, 59, 0.6)", justifyContent: "center", alignItems: "center" },
  pageTitle: { fontSize: 18, fontWeight: "700", color: "#F9FAFB" },
  previewContainer: { flexDirection: "row", alignItems: "center", padding: 12, backgroundColor: "rgba(30, 41, 59, 0.4)", marginHorizontal: 16, borderRadius: 16, marginBottom: 16, borderWidth: 1, borderColor: "rgba(148, 163, 184, 0.15)" },
  previewImage: { width: 48, height: 48, borderRadius: 8, backgroundColor: "#1E293B" },
  previewText: { color: "#F8FAFC", fontSize: 15, fontWeight: "700" },
  previewSubText: { color: "#94A3B8", fontSize: 12, marginTop: 2 },
  searchContainer: { flexDirection: "row", alignItems: "center", backgroundColor: "#0F172A", marginHorizontal: 16, paddingHorizontal: 14, borderRadius: 12, height: 44, marginBottom: 16, borderWidth: 1, borderColor: "rgba(148, 163, 184, 0.2)" },
  searchInput: { flex: 1, color: "#F8FAFC", fontSize: 14, marginLeft: 8 },
  friendRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "rgba(148, 163, 184, 0.05)" },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#1E293B", borderWidth: 1, borderColor: "rgba(148, 163, 184, 0.2)" },
  friendInfo: { flex: 1, marginLeft: 12 },
  friendName: { color: "#F9FAFB", fontSize: 15, fontWeight: "600" },
  friendUsername: { color: "#64748B", fontSize: 12, marginTop: 2 },
  sendButton: { backgroundColor: "#6366F1", paddingVertical: 8, paddingHorizontal: 22, borderRadius: 20 },
  sentButton: { backgroundColor: "rgba(148, 163, 184, 0.15)", borderWidth: 1, borderColor: "rgba(148, 163, 184, 0.2)" },
  sendButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  sentButtonText: { color: "#94A3B8" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
});

export default ShareToChatScreen;