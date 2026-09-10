import React, { useContext, useEffect, useRef, useState } from 'react';
import {
  View,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  TouchableOpacity,
  Animated,
  Image, // <-- Imported Image
} from 'react-native';
import { TextInput, Text } from 'react-native-paper';
import NetInfo from '@react-native-community/netinfo';
import * as Keychain from 'react-native-keychain';
import AuthContext from '../../../auth/user/UserContext';
import UserStorage from '../../../auth/user/UserStorage';
import { UserLoginResponse } from '../../user/models/UserLoginResponse';
import { setAuthHeaders, setSecretKey } from '../../../auth/api-client/api_client';
import api_Login from '../services/api_Login';
import LoaderKitView from 'react-native-loader-kit';
import AppText from '../../../components/Layout/AppText/AppText';
import { loginStyles } from './Loginstyles';
import DeviceInfo from 'react-native-device-info';
import { BlurView } from '@react-native-community/blur';
import GlassyErrorModal from '../../../shared/components/GlassyErrorModal';
import { CommonActions } from '@react-navigation/native';
import { connectSocket } from '../../../auth/api-client/socket';
import SavedAccountsStorage from '../../../auth/user/SavedAccountsStorage';

const Login = ({ navigation }: any) => {
  const styles = loginStyles();

  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const authContext = useContext(AuthContext);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorVisible, setErrorVisible] = useState(false);
  const [offline, setOffline] = useState(false);

  const showError = (message: string) => {
    setErrorMessage(message);
    setErrorVisible(true);
  };

  const hideError = () => {
    setErrorVisible(false);
    setErrorMessage(null);
  };

  // ---------- NetInfo: connectivity ----------
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const isOffline =
        !state.isConnected || state.isInternetReachable === false;
      setOffline(isOffline);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // ---------- Animated values for glassy background ----------
  const anim1 = useRef(new Animated.Value(0)).current;
  const anim2 = useRef(new Animated.Value(0)).current;
  const anim3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const makeLoop = (animatedValue: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(animatedValue, {
            toValue: 1,
            duration: 9000,
            delay,
            useNativeDriver: true,
          }),
          Animated.timing(animatedValue, {
            toValue: 0,
            duration: 9000,
            useNativeDriver: true,
          }),
        ]),
      );

    makeLoop(anim1, 0).start();
    makeLoop(anim2, 1500).start();
    makeLoop(anim3, 3000).start();
  }, [anim1, anim2, anim3]);

// ---------- Prefill Username if redirected from Saved Accounts ----------
  useEffect(() => {
    // If we were sent here from SavedAccountsScreen because a token expired,
    // prefill the username so the user only has to type their password.
    if (navigation.getState()?.routes) {
      const currentRoute = navigation.getState().routes.find((r: any) => r.name === 'Login');
      if (currentRoute?.params?.prefillUsername) {
        setUsername(currentRoute.params.prefillUsername);
      }
    }
  }, [navigation]);

  // ---------- Email/Password login (ONLY here you hit API) ----------
  const handleSubmit = async (values: { username: string; password: string }) => {
    Keyboard.dismiss();

    if (offline) {
      showError("Please connect to the internet and try again.");
      return;
    }

    if (!values.username || !values.password) {
      showError('Email and Password are required!');
      return;
    }

    setLoading(true);

    try {
      setSecretKey();
      const deviceId = await DeviceInfo.getUniqueId();
      const deviceName = await DeviceInfo.getDeviceName();
      const deviceModel = DeviceInfo.getModel();
      const deviceBrand = DeviceInfo.getBrand();
      const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      
      const response = await api_Login.getLogin(
        values.username,
        values.password,
        deviceId,
        deviceName,
        deviceModel,
        deviceBrand,
        deviceTimezone
      );

      if (!response.ok) {
        await UserStorage.deleteUser();
        authContext?.setUser(null);
        showError(response.data?.message || 'Login failed');
        return;
      }

      const data = response.data as any;

      if (data.requires2fa) {
        navigation.navigate('TwoFA', {
          twoFaToken: data.twoFaToken,
          identifier: values.username,
          pass: values.password
        });
        return;
      }

      const user = data as UserLoginResponse;
      user.UserName = values.username;
      //user.Password = values.password;

      // 1. Save UI metadata to AsyncStorage
await SavedAccountsStorage.save({
  id: user.user.id,
  username: values.username,
  name: user.user.name,
  avatarUrl: user.avatarUrl || null,
  avatarVersion: user.avatarVersion || 1,
});


// 2. Save the refreshToken in the secure hardware keychain
if (user.refreshToken) {
  await Keychain.setGenericPassword(
    user.user.id, 
    user.refreshToken, 
    { service: `auth_token_${user.user.id}` }
  );
}

      setAuthHeaders(user.accessToken);
      authContext?.setUser(user);
      await UserStorage.setUser(user);

      if (user.accessToken) {
        await UserStorage.setAccessToken(user.accessToken);
      }
      if (user.refreshToken) {
        await UserStorage.setRefreshToken(user.refreshToken);
      }
      await connectSocket()
       const isIOS26Plus =
        Platform.OS === 'ios' &&
        parseInt(Platform.Version, 10) >= 26;
      if (isIOS26Plus) {
        navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'AppTabs' }],
        }),
      );
      } else {
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'Drawer' }],
        }),
      )}
    } catch (e) {
      showError('Unexpected error while logging in');
    } finally {
      setLoading(false);
    }
  };

  const blob1Style = {
    transform: [
      { translateX: anim1.interpolate({ inputRange: [0, 1], outputRange: [-40, 40] }) },
      { translateY: anim1.interpolate({ inputRange: [0, 1], outputRange: [0, 30] }) },
    ],
  };

  const blob2Style = {
    transform: [
      { translateX: anim2.interpolate({ inputRange: [0, 1], outputRange: [30, -30] }) },
      { translateY: anim2.interpolate({ inputRange: [0, 1], outputRange: [10, -20] }) },
    ],
  };

  const blob3Style = {
    transform: [
      { translateX: anim3.interpolate({ inputRange: [0, 1], outputRange: [-20, 20] }) },
      { translateY: anim3.interpolate({ inputRange: [0, 1], outputRange: [-30, 10] }) },
    ],
  };

  return (
    <>
      {/* Added flex: 1 to ensure the root container takes up the whole screen */}
      <View style={[styles.root, { flex: 1 }]}>
        <View style={styles.baseBackground} />

        {/* Added flex: 1 so the KeyboardAvoidingView takes the available space above the footer */}
        <KeyboardAvoidingView
          style={[styles.kbWrapper, { flex: 1, justifyContent: 'center' }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.appNameWrapper}>
            {/* --- REPLACED TEXT WITH LOGO IMAGE --- */}
            <Image 
              source={require('../../../shared/bootsplash/logo-bg.png')} // Update this path to match your folder structure
              style={{ width: 180, height: 100, alignSelf: 'center', marginBottom: 0 }}
              resizeMode="contain"
            />
          </View>

          <View style={styles.glassWrapper}>
            <View style={styles.glassContent}>
              <Text style={styles.mainTitle}>Welcome Back</Text>
              <Text style={styles.mainSubtitle}>
                To Login, Enter Credentials Below...
              </Text>

              <TextInput
                placeholder="Username or Email"
                autoCapitalize="none"
                autoCorrect={false}
                value={username}
                onChangeText={setUsername}
                style={styles.input}
                mode="flat"
                underlineColor="transparent"
                activeUnderlineColor="transparent"
                textColor="#fff"
                placeholderTextColor="#94a3b8"
                cursorColor="#fff"
              />

              <TextInput
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCorrect={false}
                autoCapitalize="none"
                textContentType="password"
                autoComplete="password"
                style={styles.passwordInput}
                mode="flat"
                underlineColor="transparent"
                activeUnderlineColor="transparent"
                textColor="#fff"
                placeholderTextColor="#94a3b8"
                cursorColor="#fff"
                right={
                  <TextInput.Icon
                    icon={showPassword ? 'eye-off' : 'eye'}
                    color="#cbd5e1"
                    onPress={() => setShowPassword((prev) => !prev)}
                  />
                }
              />

              {loading ? (
                <View style={styles.loadingOverlay}>
                  <LoaderKitView
                    style={{ width: 20, height: 20 }}
                    name={'BallSpinFadeLoader'}
                    animationSpeedMultiplier={1.0}
                    color={'#FFFFFF'}
                  />
                  <AppText style={styles.loadingText}>Logging in...</AppText>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => handleSubmit({ username, password })}
                  style={styles.primaryButton}
                >
                  <AppText style={styles.primaryButtonText}>Continue</AppText>
                </TouchableOpacity>
              )}

              <View style={{ marginTop: 5, alignItems: 'center' }}>
                <Text style={{ color: '#cbd5e1', fontSize: 13 }}>
                  Want to reset password?{' '}
                  <Text
                    style={{ fontWeight: '700', color: '#fff' }}
                    onPress={() => navigation.navigate('ForgotPass')}
                  >
                    Forget Password
                  </Text>
                </Text>
              </View>

              <Text style={[styles.termsText, { marginTop: 10 }]}>
                By continuing, you agree to our Terms of Service
                and Privacy Policy
              </Text>
            </View>
          </View>
        </KeyboardAvoidingView>

        {/* --- MOVED REGISTRATION TO BOTTOM FOOTER --- */}
        <View style={{ 
            paddingVertical: 20, 
            paddingBottom: Platform.OS === 'ios' ? 40 : 60, 
            alignItems: 'center',
            borderTopWidth: 0.5,
            borderTopColor: 'rgba(255, 255, 255, 0.1)' // subtle separator line 
        }}>
          <Text style={{ color: '#c7cbcf', fontSize: 13 }}>
            Don’t have an account?{' '}
            <Text
              style={{ fontWeight: '700', color: '#fff' }}
              onPress={() => navigation.navigate('Register')}
            >
              Register
            </Text>
          </Text>
        </View>
      </View>

      <GlassyErrorModal
        visible={errorVisible || offline}
        message={
          offline && !errorMessage
            ? "You’re offline. Please connect to the internet and try again."
            : errorMessage || ''
        }
        onClose={hideError}
      />
    </>
  );
};

export default Login;