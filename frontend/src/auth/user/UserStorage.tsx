import { Alert } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { UserLoginResponse } from '../../screens/user/models/UserLoginResponse';
import { resetToLogin } from '../../navigation/main/RootNavigation';

const ACCESS_TOKEN_KEY = 'ACCESS_TOKEN';
const REFRESH_TOKEN_KEY = 'REFRESH_TOKEN';

const setUser = async (User: UserLoginResponse) => {
  try {
    await Keychain.setGenericPassword(
      JSON.stringify(User),
      User.Password || 'SECURE_TOKEN_AUTH', // ⚡ FIX: Provide a dummy string instead of ''
    );
  } catch (error: any) {
    console.log('Keychain setUser error:', error);
    // Alert.alert(
    //   'Error',
    //   `Error Storing User: ${String(error?.message || error)}`,
    // );
  }
};

const getUser = async () => {
  try {
    return await Keychain.getGenericPassword();
  } catch (error: any) {
    console.log('Keychain getUser error:', error);

    // 🔴 Key has been invalidated by Android keystore – treat as logged-out
    if (
      String(error?.message || '').includes('Key permanently invalidated') ||
      String(error).includes('CryptoFailedException')
    ) {
      try {
        await Keychain.resetGenericPassword();
        await Keychain.resetInternetCredentials({ service: ACCESS_TOKEN_KEY });
        await Keychain.resetInternetCredentials({ service: REFRESH_TOKEN_KEY });
      } catch (cleanupError) {
        console.log('Keychain cleanup after invalidation error:', cleanupError);
      }

      // No alert needed; just go to Login
      // resetToLogin();
      return null;
    }

    // Alert.alert('Error', 'Error Getting User');
    return null;
  }
};

const deleteUser = async () => {
  try {
    return await Keychain.resetGenericPassword();
  } catch (error: any) {
    console.log('Keychain deleteUser error:', error);
    // Alert.alert('Error', 'Error Deleting User');
  }
};

// Access token
const setAccessToken = async (accessToken: string | null | undefined) => {
  try {
    if (!accessToken) {
      console.log(
        'setAccessToken called with empty token; clearing stored access token',
      );
      await Keychain.resetInternetCredentials({ service: ACCESS_TOKEN_KEY });
      return;
    }

    await Keychain.setInternetCredentials(
      ACCESS_TOKEN_KEY,         // server
      ACCESS_TOKEN_KEY,         // username
      accessToken,              // password
    );
  } catch (error: any) {
    console.log('Keychain setAccessToken error:', error);
    // Alert.alert(
    //   'Error',
    //   `Error storing access token: ${String(error?.message || error)}`,
    // );
  }
};

const getAccessToken = async (): Promise<string | null> => {
  try {
    const creds = await Keychain.getInternetCredentials(ACCESS_TOKEN_KEY);
    return creds?.password || null;
  } catch (error: any) {
    console.log('Keychain getAccessToken error:', error);
    // Alert.alert('Error', 'Error getting access token');
    return null;
  }
};

// Refresh token
const setRefreshToken = async (refreshToken: string | null | undefined) => {
  try {
    if (!refreshToken) {
      console.log(
        'setRefreshToken called with empty token; clearing stored refresh token',
      );
      await Keychain.resetInternetCredentials({ service: REFRESH_TOKEN_KEY });
      return;
    }

    await Keychain.setInternetCredentials(
      REFRESH_TOKEN_KEY,         // server
      REFRESH_TOKEN_KEY,         // username
      refreshToken,              // password
    );
  } catch (error: any) {
    console.log('Keychain setRefreshToken error:', error);
    // Alert.alert(
    //   'Error',
    //   `Error storing refresh token: ${String(error?.message || error)}`,
    // );
  }
};

const getRefreshToken = async (): Promise<string | null> => {
  try {
    const creds = await Keychain.getInternetCredentials(REFRESH_TOKEN_KEY);
    return creds?.password || null;
  } catch (error: any) {
    console.log('Keychain getRefreshToken error:', error);
    // Alert.alert('Error', 'Error getting refresh token');
    return null;
  }
};

// Clear tokens
const clearTokens = async () => {
  try {
    await Keychain.resetInternetCredentials({ service: ACCESS_TOKEN_KEY });
  } catch (error: any) {
    console.log('Keychain reset ACCESS_TOKEN error:', error);
  }

  try {
    await Keychain.resetInternetCredentials({ service: REFRESH_TOKEN_KEY });
  } catch (error: any) {
    console.log('Keychain reset REFRESH_TOKEN error:', error);
  }
};

export default {
  getUser,
  setUser,
  deleteUser,
  setAccessToken,
  setRefreshToken,
  getAccessToken,
  getRefreshToken,
  clearTokens,
};