import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
  Keyboard,
  StyleSheet,
  TextInput,
} from 'react-native';
import { Text } from '@rneui/themed';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import Clipboard from '@react-native-clipboard/clipboard'; 
import { Linking } from 'react-native';

import api_Login from '../../login/services/api_Login';
import LoaderKitView from 'react-native-loader-kit';
import GlassyErrorModal from '../../../shared/components/GlassyErrorModal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

const TWO_FA_CACHE_KEY = 'settings:2fa:setup:v2';

const Enable2FAScreen = () => {
  const navigation = useNavigation<any>();

  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [isAlreadyEnabled, setIsAlreadyEnabled] = useState(false);

  const [qrImage, setQrImage] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorVisible, setErrorVisible] = useState(false);

  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disableBackupCode, setDisableBackupCode] = useState('');
  const [disableLoading, setDisableLoading] = useState(false);

  const offlineRef = useRef(false);
  const [offline, setOffline] = useState(false);

  const showError = (message: string) => {
    setErrorMessage(message);
    setErrorVisible(true);
  };
  const hideError = () => {
    setErrorVisible(false);
    setErrorMessage(null);
  };

  useEffect(() => {
    NetInfo.fetch().then((state) => {
      const isOffline = !state.isConnected || state.isInternetReachable === false;
      offlineRef.current = isOffline;
      setOffline(isOffline);
    });

    const unsub = NetInfo.addEventListener((state) => {
      const isOffline = !state.isConnected || state.isInternetReachable === false;
      offlineRef.current = isOffline;
      setOffline(isOffline);
    });
    return () => unsub();
  }, []);

  const load2FASetup = useCallback(async () => {
    let hasCachedData = false;
    try {
      const raw = await AsyncStorage.getItem(TWO_FA_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.isAlreadyEnabled) {
          setIsAlreadyEnabled(true);
          hasCachedData = true;
        } else {
          if (parsed?.qrImage) {
            setQrImage(parsed.qrImage);
            hasCachedData = true;
          }
          if (parsed?.manualKey) setManualKey(parsed.manualKey);
          if (parsed?.otpauthUrl) setOtpauthUrl(parsed.otpauthUrl);
        }
        if (hasCachedData) setInitialLoading(false);
      }
    } catch {}

    if (offlineRef.current) {
      if (!hasCachedData) setInitialLoading(false);
      return;
    }

    setInitialLoading(true);
    try {
      const res = await api_Login.init2fa();
      
      if (!res.ok) {
        const msg = (res as any).data?.message || '';
        if (msg.toLowerCase().includes('already enabled') || msg.toLowerCase().includes('already set up')) {
          setIsAlreadyEnabled(true);
          await AsyncStorage.setItem(TWO_FA_CACHE_KEY, JSON.stringify({ isAlreadyEnabled: true, ts: Date.now() }));
          setInitialLoading(false);
          return;
        }

        if (!hasCachedData) {
          showError(msg || 'Failed to start 2FA setup');
        }
        setInitialLoading(false);
        return;
      }

      const data: any = res.data;

      if (data?.alreadyEnabled) {
        setIsAlreadyEnabled(true);
        await AsyncStorage.setItem(TWO_FA_CACHE_KEY, JSON.stringify({ isAlreadyEnabled: true, ts: Date.now() }));
        setInitialLoading(false);
        return;
      }

      if (!data?.qrImageDataUrl && !data?.manualKey) {
        setInitialLoading(false);
        return;
      }

      if (data.qrImageDataUrl) setQrImage(data.qrImageDataUrl);
      if (data.manualKey) setManualKey(data.manualKey);
      if (data.otpauthUrl) setOtpauthUrl(data.otpauthUrl);

      await AsyncStorage.setItem(
        TWO_FA_CACHE_KEY,
        JSON.stringify({
          isAlreadyEnabled: false,
          qrImage: data.qrImageDataUrl,
          manualKey: data.manualKey,
          otpauthUrl: data.otpauthUrl,
          ts: Date.now(),
        })
      );
    } catch (e: any) {
      if (!hasCachedData) {
        showError('Unable to initialize 2FA. Please try again.');
      }
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    load2FASetup();
  }, [load2FASetup]);

  useEffect(() => {
    if (!offline) {
      load2FASetup();
    }
  }, [offline]);

  const handleCopyKey = () => {
    if (manualKey) {
      Clipboard.setString(manualKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenAuthenticator = async () => {
    if (otpauthUrl) {
      try {
        const supported = await Linking.canOpenURL(otpauthUrl);
        if (supported) {
          await Linking.openURL(otpauthUrl);
        } else {
          showError('No authenticator app found to open this link directly.');
        }
      } catch (err) {
        showError('Failed to open authenticator app.');
      }
    }
  };

  const handleConfirm = async () => {
    Keyboard.dismiss();

    if (offline) {
      showError("You're offline. Please connect to the internet to enable 2FA.");
      return;
    }

    if (!code) {
      showError('Please enter the 6-digit code from your authenticator app');
      return;
    }
    setLoading(true);
    try {
      const res = await api_Login.confirm2fa(code);
      if (!res.ok) {
        showError((res as any).data?.message || 'Invalid 2FA code');
        return;
      }
      const data: any = res.data;
      if (data.backupCodes && Array.isArray(data.backupCodes)) {
        setBackupCodes(data.backupCodes);
        await AsyncStorage.setItem(TWO_FA_CACHE_KEY, JSON.stringify({ isAlreadyEnabled: true, ts: Date.now() }));
      }
    } catch {
      showError('Failed to confirm 2FA. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDone = () => {
    navigation.goBack();
  };

  const handleDisable2FA = async () => {
    Keyboard.dismiss();

    if (offline) {
      showError("You're offline. Please connect to the internet to disable 2FA.");
      return;
    }

    if (!disablePassword) {
      showError('Please enter your current password');
      return;
    }
    if (!disableCode && !disableBackupCode) {
      showError('Enter either 6-digit 2FA code or a backup code to disable');
      return;
    }

    setDisableLoading(true);
    try {
      const res = await api_Login.disable2fa(
        disablePassword,
        disableCode || undefined,
        disableBackupCode || undefined,
      );
      if (!res.ok) {
        showError((res as any).data?.message || 'Failed to disable 2FA');
        return;
      }
      await AsyncStorage.removeItem(TWO_FA_CACHE_KEY);
      navigation.goBack();
    } catch {
      showError('Failed to disable 2FA. Please try again.');
    } finally {
      setDisableLoading(false);
    }
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity
        activeOpacity={0.8}
        style={styles.backButton}
        onPress={() => navigation.goBack()}
      >
        <Icon name="arrow-left" size={24} color="#E5E7EB" />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Two-factor Auth</Text>
      <View style={{ width: 40 }} />
    </View>
  );

  const renderOfflineBanner = () => {
    if (!offline) return null;
    return (
      <View style={styles.offlineBanner}>
        <Icon name="wifi-off" size={14} color="#94A3B8" />
        <Text style={styles.offlineText}>Offline — showing cached data</Text>
      </View>
    );
  };

  const renderDisableForm = () => (
    <View style={styles.formContainer}>
      <Text style={styles.instructionText}>
        To disable 2FA, confirm with your password and a 2FA code or backup code.
      </Text>

      <Text style={styles.inputLabel}>Current Password</Text>
      <TextInput
        style={styles.textInput}
        placeholder="Enter password"
        placeholderTextColor="#64748B"
        value={disablePassword}
        onChangeText={setDisablePassword}
        secureTextEntry
      />

      <Text style={styles.inputLabel}>6-digit 2FA code (optional)</Text>
      <TextInput
        style={styles.textInput}
        placeholder="Enter OTP..."
        placeholderTextColor="#64748B"
        value={disableCode}
        onChangeText={setDisableCode}
        keyboardType="numeric"
        maxLength={6}
      />

      <Text style={styles.inputLabel}>Backup code (optional)</Text>
      <TextInput
        style={styles.textInput}
        placeholder="XXXX-XXXX-XX"
        placeholderTextColor="#64748B"
        value={disableBackupCode}
        onChangeText={setDisableBackupCode}
        autoCapitalize="characters"
      />

      <TouchableOpacity
        onPress={handleDisable2FA}
        style={[styles.dangerButton, offline && styles.disabledButton]}
        disabled={disableLoading || offline}
        activeOpacity={offline ? 1 : 0.8}
      >
        {disableLoading ? (
          <LoaderKitView
            style={{ width: 24, height: 24 }}
            name={'BallSpinFadeLoader'}
            color={'#FFFFFF'}
          />
        ) : (
          <Text style={[styles.buttonText, offline && styles.disabledButtonText]}>Confirm Disable 2FA</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  // 1. LOADING STATE
  if (initialLoading && !qrImage && !manualKey && !isAlreadyEnabled) {
    return (
      <View style={styles.root}>
        {renderHeader()}
        <View style={styles.centerContent}>
          <LoaderKitView
            style={{ width: 45, height: 45 }}
            name={'BallSpinFadeLoader'}
            color={'#6366f1'}
          />
          <Text style={styles.loadingText}>Preparing 2FA...</Text>
        </View>
      </View>
    );
  }

  // 2. ALREADY ENABLED STATE
  if (isAlreadyEnabled) {
    return (
      <View style={styles.root}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {renderHeader()}
            {renderOfflineBanner()}
            
            <View style={styles.card}>
              <View style={styles.iconContainer}>
                <Icon name="shield-check" size={56} color="#22C55E" />
              </View>
              <Text style={styles.mainTitle}>2FA is Enabled</Text>
              <Text style={styles.mainSubtitle}>
                Your account is currently protected with Two-Factor Authentication.
              </Text>
              {renderDisableForm()}
            </View>
            <View style={{ height: 100 }} />
          </ScrollView>
        </KeyboardAvoidingView>
        <GlassyErrorModal visible={errorVisible} message={errorMessage || ''} onClose={hideError} />
      </View>
    );
  }

  // 3. SUCCESS / BACKUP CODES STATE
  if (backupCodes) {
    return (
      <View style={styles.root}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {renderHeader()}
          <View style={styles.card}>
            <Text style={styles.mainTitle}>2FA Enabled</Text>
            <Text style={styles.mainSubtitle}>
              Save these backup codes somewhere safe. Each code can be used
              once if you lose access to your authenticator app.
            </Text>

            <View style={styles.backupCodesWrapper}>
              {backupCodes.map((bc, idx) => (
                <View key={idx} style={styles.backupCodePill}>
                  <Text style={styles.backupCodeText}>{bc}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.warningText}>
              You will not be able to see these codes again. Store them securely.
            </Text>

            <TouchableOpacity onPress={handleDone} style={styles.primaryButton}>
              <Text style={styles.buttonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
        <GlassyErrorModal visible={errorVisible} message={errorMessage || ''} onClose={hideError} />
      </View>
    );
  }

  // 4. SETUP STATE (Enable Form)
  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {renderHeader()}
          {renderOfflineBanner()}

          <View style={styles.card}>
            <Text style={styles.mainTitle}>Enable Two-Factor</Text>
            <Text style={styles.mainSubtitle}>
              Scan the QR code below or open it directly in your authenticator app.
            </Text>

            {qrImage && (
              <View style={styles.qrContainer}>
                <Image
                  source={{ uri: qrImage }}
                  style={styles.qrImage}
                  resizeMode="contain"
                />
              </View>
            )}

            {/* ⚡ Direct Link to Authenticator App Button */}
            {otpauthUrl && (
              <TouchableOpacity
                onPress={handleOpenAuthenticator}
                style={styles.actionLinkButton}
              >
                <Icon name="shield-key-outline" size={20} color="#818CF8" style={{ marginRight: 8 }} />
                <Text style={styles.actionLinkText}>Open in Authenticator App</Text>
              </TouchableOpacity>
            )}

            {manualKey && (
              <View style={styles.manualKeyBox}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 6 }}>
                  <Text style={styles.manualKeyLabel}>Or copy key manually:</Text>
                  <TouchableOpacity onPress={handleCopyKey} style={styles.copyBtn}>
                    <Icon name={copied ? "check" : "content-copy"} size={16} color={copied ? "#34D399" : "#E2E8F0"} />
                    <Text style={[styles.copyBtnText, copied && { color: "#34D399" }]}>
                      {copied ? "Copied!" : "Copy"}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text selectable style={styles.manualKeyText}>{manualKey}</Text>
              </View>
            )}

            <View style={styles.formContainer}>
              <Text style={styles.inputLabel}>Enter 6-digit code</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Enter OTP..."
                placeholderTextColor="#64748B"
                value={code}
                onChangeText={setCode}
                keyboardType="numeric"
                maxLength={6}
              />

              <TouchableOpacity 
                onPress={handleConfirm} 
                style={[styles.primaryButton, offline && styles.disabledButton]}
                disabled={loading || offline}
                activeOpacity={offline ? 1 : 0.8}
              >
                {loading ? (
                  <LoaderKitView
                    style={{ width: 24, height: 24 }}
                    name={'BallSpinFadeLoader'}
                    color={'#FFFFFF'}
                  />
                ) : (
                  <Text style={[styles.buttonText, offline && styles.disabledButtonText]}>Confirm & Enable</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
          
          <View style={{ height: 100 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <GlassyErrorModal
        visible={errorVisible}
        message={errorMessage || ''}
        onClose={hideError}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#020617', 
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: Platform.OS === 'android' ? '3%' : '5%',
    paddingBottom: 20, 
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 40,
    marginBottom: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F9FAFB',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 100,
  },
  loadingText: {
    marginTop: 20,
    color: '#94A3B8',
    fontSize: 16,
    fontWeight: '600',
  },
  card: {
    paddingHorizontal: 24,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  mainTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 10,
    textAlign: 'center',
  },
  mainSubtitle: {
    fontSize: 15,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderRadius: 12,
    paddingVertical: 10,
    marginHorizontal: 24,
    marginBottom: 16,
    gap: 8,
  },
  offlineText: {
    color: '#FBBF24',
    fontSize: 13,
    fontWeight: '600',
  },
  qrContainer: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 16,
    marginBottom: 14,
  },
  qrImage: {
    width: 180,
    height: 180,
  },
  actionLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 16,
  },
  actionLinkText: {
    color: '#818CF8',
    fontSize: 15,
    fontWeight: '600',
  },
  manualKeyBox: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  manualKeyLabel: {
    color: '#94A3B8',
    fontSize: 13,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  copyBtnText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  manualKeyText: {
    color: '#F9FAFB',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  formContainer: {
    marginTop: 10,
  },
  instructionText: {
    color: '#94A3B8',
    fontSize: 14,
    marginBottom: 20,
    lineHeight: 20,
  },
  inputLabel: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginLeft: 4,
  },
  textInput: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 20,
    color: '#FFFFFF',
  },
  primaryButton: {
    backgroundColor: '#6366f1',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  dangerButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  disabledButton: {
    backgroundColor: 'rgba(71, 85, 105, 0.4)',
    borderColor: 'rgba(71, 85, 105, 0.6)',
  },
  disabledButtonText: {
    color: '#94A3B8',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  backupCodesWrapper: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 20,
  },
  backupCodePill: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  backupCodeText: {
    color: '#E2E8F0',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 1,
  },
  warningText: {
    color: '#F87171',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 10,
  },
});

export default Enable2FAScreen;