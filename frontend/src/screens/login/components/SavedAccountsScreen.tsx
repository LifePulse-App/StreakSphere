import React, { useEffect, useState, useContext } from "react";
import { View, TouchableOpacity, ScrollView, StyleSheet, Platform, StatusBar, Image } from "react-native";
import { Text } from "@rneui/themed";
import { CommonActions } from "@react-navigation/native";
import DeviceInfo from "react-native-device-info";
import FastImage from "react-native-fast-image"; 
import Icon from "react-native-vector-icons/MaterialCommunityIcons"; 
import * as Keychain from 'react-native-keychain';
import SavedAccountsStorage, { SavedAccount } from "../../../auth/user/SavedAccountsStorage";
import AuthContext from "../../../auth/user/UserContext";
import api_Login from "../services/api_Login";
import { setAuthHeaders, setSecretKey } from "../../../auth/api-client/api_client";
import UserStorage from "../../../auth/user/UserStorage";
import { loginStyles } from "./Loginstyles";
import { connectSocket } from "../../../auth/api-client/socket";
import { getAvatar } from "../../../storage/AvatarManager";
// ⚡ 1. IMPORT THE ERROR MODAL
import GlassyErrorModal from '../../../shared/components/GlassyErrorModal';
import { logout } from "../../../navigation/main/RootNavigation";

interface SavedAccountWithAvatar extends SavedAccount {
  localAvatarUri?: string | null;
}

const SavedAccountsScreen = ({ navigation }: any) => {
  const styles = loginStyles();
  const localStyles = savedStyles();
  const authContext = useContext(AuthContext);

  const [accounts, setAccounts] = useState<SavedAccountWithAvatar[]>([]);
  
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"login" | "remove" | null>(null);

  // ⚡ 2. ADD ERROR STATE
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorVisible, setErrorVisible] = useState(false);

  const showError = (message: string) => {
    setErrorMessage(message);
    setErrorVisible(true);
  };

  const hideError = () => {
    setErrorVisible(false);
    setErrorMessage(null);
  };

  const getUniqueByUsername = (list: SavedAccount[]) => {
    const seen = new Set<string>();
    const unique: SavedAccount[] = [];

    for (const acc of list) {
      const username = String(acc?.username || "").trim().toLowerCase();
      if (!username) continue;

      if (!seen.has(username)) {
        seen.add(username);
        unique.push(acc);
      }
    }
    return unique;
  };

  const load = async () => {
    const list = await SavedAccountsStorage.getAll();
    const unique = getUniqueByUsername(list);

    const accountsWithAvatars = await Promise.all(
      unique.map(async (acc) => {
        // Handle nested or direct user data
        const userData = (acc as any)?.user?.user || (acc as any)?.user || acc;
        const rawUrl = userData?.avatarUrl || userData?.avatarThumbnailUrl || userData?.avatar || userData?.profile_picture;
        const userId = userData?._id || userData?.id || acc.id; 
        const avatarVersion = userData?.avatarVersion || 1;

        let localUri = null;
        if (rawUrl && rawUrl.trim() !== '' && rawUrl !== 'null' && rawUrl !== 'undefined') {
          localUri = await getAvatar(userId, rawUrl, avatarVersion);
        }

        return {
          ...acc,
          localAvatarUri: localUri, 
        };
      })
    );

    setAccounts(accountsWithAvatars);
  };

  useEffect(() => {
    load();
  }, []);

const handleLogin = async (acc: SavedAccount) => {
    try {
      setLoadingId(acc.id);
      setActionType("login");
      setSecretKey();

      // Retrieve the refresh token securely from the Keychain
      const credentials = await Keychain.getGenericPassword({
        service: `auth_token_${acc.id}`,
      });
      
      if (!credentials) {
        // Token is missing from secure storage, force manual login
        navigation.navigate('Login', { prefillUsername: acc.username });
        return;
      }

      const refreshToken = credentials.password;
      const deviceId = await DeviceInfo.getUniqueId();

      // Authenticate using the switch-account endpoint
      const res = await api_Login.switchAccount({ userId: acc.id, refreshToken, deviceId });

      if (!res.ok) {
        // Token is invalid/revoked on the server. Wipe local traces and force manual login.
        await Keychain.resetGenericPassword({ service: `auth_token_${acc.id}` });
        await SavedAccountsStorage.remove(acc.id);
        await load();
        navigation.navigate('Login', { prefillUsername: acc.username });
        return;
      }

      // ⚡ FIX: Do NOT destructure the inner user object! 
      // Treat the entire response payload as the UserLoginResponse to preserve the structure.
      const fullPayload = res.data as UserLoginResponse;
      fullPayload.UserName = acc.username;

      // Update Keychain with the newly rotated refresh token
      if (fullPayload.refreshToken) {
        await Keychain.setGenericPassword(acc.id, fullPayload.refreshToken, {
          service: `auth_token_${acc.id}`,
        });
      }

      // Setup context and navigate using the FULL payload
      setAuthHeaders(fullPayload.accessToken);
      authContext?.setUser(fullPayload);
      await UserStorage.setUser(fullPayload);
      await UserStorage.setAccessToken(fullPayload.accessToken);
      await UserStorage.setRefreshToken(fullPayload.refreshToken);

      await connectSocket();

      const isIOS26Plus = Platform.OS === 'ios' && parseInt(Platform.Version, 10) >= 26;
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: isIOS26Plus ? 'AppTabs' : 'Drawer' }],
        }),
      );
    } catch (error) {
      console.error("Fast login error:", error);
      showError("Connection failed. Please check your internet or try logging in manually.");
    } finally {
      setLoadingId(null);
      setActionType(null);
    }
  };

  const handleRemove = async (acc: SavedAccount) => {
    try {
      setLoadingId(acc.id); 
      setActionType("remove"); 
      
      // Wipe from secure storage
      await Keychain.resetGenericPassword({ service: `auth_token_${acc.id}` });
      
      // Wipe from AsyncStorage
      await SavedAccountsStorage.remove(acc.id);
      await logout(acc.id)
      await load();
    } catch (error) {
      console.log("Failed to remove account locally:", error);
      // ⚡ 4. OPTIONAL: Show error on remove fail
      showError("Failed to remove account. Please try again.");
    } finally {
      setLoadingId(null);
      setActionType(null);
    }
  };

  return (
    <>
      <View style={styles.root}>
        <View style={styles.baseBackground} />
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

        <View style={styles.kbWrapper}>
          <View style={localStyles.header}>
            <Image 
              source={require('../../../shared/bootsplash/logo-bg.png')}
              style={{ width: 180, height: 100, alignSelf: 'center', marginBottom: 0 }}
              resizeMode="contain"
            />
            <Text style={localStyles.appName}>StreakSphere</Text>
            <Text style={localStyles.subTitle}>Saved Accounts</Text>
          </View>

          <View style={localStyles.card}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {accounts.map((acc) => {
                const isThisLoading = loadingId === acc.id;
                
                // Safely extract data based on old vs new storage formats
                const userData = (acc as any)?.user?.user || (acc as any)?.user || acc;
                const displayName = userData?.name || acc.username || acc.name || "User";
                const finalAvatarUri = acc.localAvatarUri || userData?.avatarUrl || null;

                return (
                  <View key={acc.id} style={localStyles.accountRow}>
                    
                    <View style={localStyles.accountHeader}>
                      {finalAvatarUri ? (
                        <FastImage
                          style={localStyles.avatar}
                          source={{
                            uri: finalAvatarUri,
                            priority: FastImage.priority.high,
                          }}
                          resizeMode={FastImage.resizeMode.cover}
                        />
                      ) : (
                        <View style={localStyles.avatarFallback}>
                          <Icon name="account" size={32} color="#94a3b8" />
                        </View>
                      )}
                      
                      <View style={localStyles.userInfo}>
                        <Text style={localStyles.username}>{displayName}</Text>
                        <Text style={localStyles.smallText}>Tap login to continue</Text>
                      </View>
                    </View>

                    <View style={localStyles.rowActions}>
                      <TouchableOpacity
                        style={localStyles.loginBtn}
                        onPress={() => handleLogin(acc)}
                        disabled={isThisLoading}
                      >
                        <Text style={localStyles.loginText}>
                          {isThisLoading && actionType === "login" ? "Loading..." : "Login"}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={localStyles.removeBtn}
                        onPress={() => handleRemove(acc)}
                        disabled={isThisLoading}
                      >
                        <Text style={localStyles.removeText}>
                          {isThisLoading && actionType === "remove" ? "Removing..." : "Remove"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
        
        <View style={{ 
              paddingVertical: 20, 
              paddingBottom: Platform.OS === 'ios' ? 40 : 60, 
              alignItems: 'center',
              borderTopWidth: 0.5,
              borderTopColor: 'rgba(255, 255, 255, 0.1)' 
          }}>
            <Text style={{ color: '#c7cbcf', fontSize: 13 }}>
              Log in to another account?{' '}
              <Text
                style={{ fontWeight: '700', color: '#fff' }}
                onPress={() => navigation.navigate('Login')}
              >
                Login
              </Text>
            </Text>
          </View>
      </View>

      {/* ⚡ 5. RENDER THE ERROR MODAL */}
      <GlassyErrorModal
        visible={errorVisible}
        message={errorMessage || ''}
        onClose={hideError}
      />
    </>
  );
};

export default SavedAccountsScreen;

const savedStyles = () =>
  StyleSheet.create({
    header: {
      alignItems: "center",
      marginBottom: 18,
    },
    appName: {
      fontSize: 30,
      fontWeight: "800",
      color: "#f9f9f9",
    },
    subTitle: {
      color: "#9CA3AF",
      fontSize: 14,
      marginTop: 4,
    },
    card: {
      width: "100%",
      borderRadius: 24,
      padding: 18,
      backgroundColor: "rgba(255,255,255,0.1)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,1)",
      shadowColor: "#000",
      shadowOpacity: 0.5,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 10 },
      maxHeight: '80%', 
    },
    accountRow: {
      borderWidth: 1.5,
      borderColor: "rgba(255,255,255,0.35)",
      borderRadius: 14,
      padding: 14,
      marginBottom: 12,
    },
    accountHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
    },
    avatar: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: '#1a1a1a', 
      marginRight: 12,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.2)',
      overflow: 'hidden' 
    },
    avatarFallback: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: '#1e293b', 
      marginRight: 12,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.2)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    userInfo: {
      flex: 1,
      justifyContent: 'center',
    },
    username: {
      color: "white",
      fontWeight: "800",
      fontSize: 16,
    },
    smallText: {
      color: "rgba(255,255,255,0.7)",
      fontSize: 12,
      marginTop: 2,
    },
    rowActions: {
      flexDirection: "row",
      gap: 8,
    },
    loginBtn: {
      flex: 1,
      backgroundColor: "#000",
      paddingVertical: 10,
      borderRadius: 12,
      alignItems: "center",
    },
    loginText: {
      color: "#fff",
      fontWeight: "700",
    },
    removeBtn: {
      flex: 1,
      backgroundColor: "#ef4444",
      paddingVertical: 10,
      borderRadius: 12,
      alignItems: "center",
    },
    removeText: {
      color: "#fff",
      fontWeight: "700",
    },
  });