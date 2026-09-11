import React, { useContext, useRef, useState } from 'react';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import {
  View,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  TouchableOpacity,
  Animated,
  Image,
  StyleSheet,
  Modal, // ⚡ ADDED: Modal for success popup
} from 'react-native';
import { TextInput, Text } from 'react-native-paper';
import AuthContext from '../../../auth/user/UserContext';
import { setSecretKey } from '../../../auth/api-client/api_client';
import api_Login from '../services/api_Login';
import LoaderKitView from 'react-native-loader-kit';
import AppText from '../../../components/Layout/AppText/AppText';
import { loginStyles } from './Loginstyles';
import DeviceInfo from 'react-native-device-info';
import GlassyErrorModal from '../../../shared/components/GlassyErrorModal';

const Register = ({ navigation }: any) => {
  const styles = loginStyles();

  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmpassword, setConfirmPassword] = useState('');
  const authContext = useContext(AuthContext);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorVisible, setErrorVisible] = useState(false);

  // ⚡ ADDED: State to control the Success Modal visibility
  const [successModalVisible, setSuccessModalVisible] = useState(false);

  const showError = (message: string) => {
    setErrorMessage(message);
    setErrorVisible(true);
  };

  const hideError = () => {
    setErrorVisible(false);
    setErrorMessage(null);
  };

  // background animations (same as login)
  const anim1 = useRef(new Animated.Value(0)).current;
  const anim2 = useRef(new Animated.Value(0)).current;
  const anim3 = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
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

  // ⚡ ADDED: Password Complexity Validation Logic
  const validatePassword = (pass: string) => {
    const regex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
    return regex.test(pass);
  };

  // Registration handler
  const handleRegister = async () => {
    Keyboard.dismiss();

    if (!name || !identifier || !password) {
      showError('Name, Email and Password are required to register!');
      return;
    }

    if (password !== confirmpassword) {
      showError('Passwords don`t match!');
      return;
    }

    // ⚡ ADDED: Check against our regex rules before hitting the API
    if (!validatePassword(password)) {
      showError('Password must be at least 8 characters long, include 1 uppercase letter, and 1 number.');
      return;
    }

    setLoading(true);

    try {
      setSecretKey();
      const deviceId = await DeviceInfo.getUniqueId();
      const response = await api_Login.getRegister(name, username, identifier, password, deviceId);      

      if (!response.ok) {
        setLoading(false);
        showError(response.data?.message || 'Registration failed');
        return;
      }

      // ⚡ TRIGGER SUCCESS MODAL INSTEAD OF IMMEDIATE NAVIGATION
      setSuccessModalVisible(true);

    } catch (e) {
      showError('Unexpected error while registering');
    } finally {
      setLoading(false);
    }
  };

  // ⚡ ADDED: Function to handle the "Continue" button on the success modal
  const handleSuccessDismiss = () => {
    setSuccessModalVisible(false);
    navigation.navigate('VerifyOtp', { identifier, username, password });
  };

  return (
    <>
      <View style={styles.root}>
        <View style={styles.baseBackground} />

        <KeyboardAwareScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          enableOnAndroid={true}
          extraScrollHeight={20}
        >
          <KeyboardAvoidingView
            style={styles.kbWrapper}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.appNameWrapper}>
              <Image 
                source={require('../../../shared/bootsplash/logo-bg.png')}
                style={{ width: 180, height: 100, alignSelf: 'center', marginBottom: 0 }}
                resizeMode="contain"
              />
            </View>

            <View style={styles.glassWrapper}>
              <View style={styles.glassContent}>
                <Text style={styles.mainTitle}>Create an account</Text>
                <Text style={styles.mainSubtitle}>
                  Enter your details to sign up for this app
                </Text>

                <TextInput
                  placeholder="Name"
                  value={name}
                  onChangeText={setName}
                  style={styles.input}
                  mode="flat"
                  underlineColor="transparent"
                  activeUnderlineColor="transparent"
                  textColor="#fff"
                  placeholderTextColor="grey"
                  cursorColor='grey'
                />

                <TextInput
                  placeholder="Username"
                  value={username}
                  onChangeText={setUsername}
                  style={styles.input}
                  mode="flat"
                  autoCapitalize="none"
                  underlineColor="transparent"
                  activeUnderlineColor="transparent"
                  textColor="#fff"
                  placeholderTextColor="grey"
                  cursorColor='grey'
                />

                <TextInput
                  placeholder="Email"
                  value={identifier}
                  onChangeText={setIdentifier}
                  style={styles.input}
                  mode="flat"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  underlineColor="transparent"
                  activeUnderlineColor="transparent"
                  textColor="#fff"
                  placeholderTextColor="grey"
                  cursorColor='grey'
                />



                <TextInput
                  placeholder="Password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  style={styles.passwordInput}
                  mode="flat"
                  underlineColor="transparent"
                  activeUnderlineColor="transparent"
                  textColor="#fff"
                  placeholderTextColor="grey"
                  cursorColor='white'
                  right={
                    <TextInput.Icon
                      icon={showPassword ? 'eye-off' : 'eye'}
                      onPress={() => setShowPassword(prev => !prev)}
                    />
                  }
                />

                <TextInput
                  placeholder="Confirm Password"
                  value={confirmpassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPassword}
                  style={styles.passwordInput}
                  mode="flat"
                  underlineColor="transparent"
                  activeUnderlineColor="transparent"
                  textColor="#fff"
                  placeholderTextColor="grey"
                  cursorColor='white'
                  right={
                    <TextInput.Icon
                      icon={showConfirmPassword ? 'eye-off' : 'eye'}
                      onPress={() => setShowConfirmPassword(prev => !prev)}
                    />
                  }
                />
                
                {loading ? (
                  <View style={styles.loadingOverlay}>
                    <LoaderKitView
                      style={{ width: 24, height: 24 }}
                      name={'BallSpinFadeLoader'}
                      animationSpeedMultiplier={1.0}
                      color={'#FFFFFF'}
                    />
                    <AppText style={styles.loadingText}>Creating account...</AppText>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={handleRegister}
                    style={styles.primaryButton}
                  >
                    <AppText style={styles.primaryButtonText}>Continue</AppText>
                  </TouchableOpacity>
                )}

                <Text style={styles.termsText}>
                  By creating an account or continuing, you agree to our Terms of
                  Service and Privacy Policy
                </Text>
              </View>
            </View>
          </KeyboardAvoidingView>
        </KeyboardAwareScrollView>
        
        <View style={{ 
          paddingVertical: 20, 
          paddingBottom: Platform.OS === 'ios' ? 40 : 60, 
          alignItems: 'center',
          borderTopWidth: 0.5,
          borderTopColor: 'rgba(255, 255, 255, 0.1)' 
        }}>
          <Text style={{ color: '#c7cbcf', fontSize: 13 }}>
            Already have an account?{' '}
            <Text
              style={{ fontWeight: '700', color: '#fff' }}
              onPress={() => navigation.navigate('Login')}
            >
              Log in
            </Text>
          </Text>
        </View>
      </View>

      <GlassyErrorModal
        visible={errorVisible}
        message={errorMessage || ''}
        onClose={hideError}
      />

      {/* ⚡ ADDED: Instagram-style Success Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={successModalVisible}
        onRequestClose={handleSuccessDismiss}
      >
        <View style={localStyles.modalBackground}>
          <View style={localStyles.modalContainer}>
            {/* Success Icon */}
            <View style={localStyles.iconCircle}>
               <Text style={localStyles.iconCheckmark}>✓</Text>
            </View>
            
            <Text style={localStyles.modalTitle}>Account Created</Text>
            <Text style={localStyles.modalMessage}>
              You have successfully registered! Please continue to verify your email via the OTP sent to you.
            </Text>

            <TouchableOpacity
              style={localStyles.dismissButton}
              onPress={handleSuccessDismiss}
            >
              <Text style={localStyles.dismissButtonText}>Verify OTP</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </>
  );
};

// ⚡ ADDED: Local styles for the success modal and rule text
const localStyles = StyleSheet.create({
  ruleText: {
    color: '#9CA3AF',
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 5,
    paddingHorizontal: 10,
  },
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)', 
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '80%',
    backgroundColor: '#262626', // Instagram dark mode gray
    borderRadius: 14,
    paddingTop: 24,
    alignItems: 'center',
  },
  iconCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#4ADE80', // Success green
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconCheckmark: {
    color: '#4ADE80',
    fontSize: 24,
    fontWeight: 'bold',
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
  },
  modalMessage: {
    color: '#A8A8A8',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginBottom: 20,
    lineHeight: 20,
  },
  dismissButton: {
    width: '100%',
    borderTopWidth: 0.5,
    borderTopColor: '#363636',
    paddingVertical: 14,
    alignItems: 'center',
  },
  dismissButtonText: {
    color: '#0064E0', // Instagram Blue
    fontSize: 16,
    fontWeight: '600',
  },
});

export default Register;