import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Modal, DeviceEventEmitter, Pressable, Image, AppState } from 'react-native';
import InCallManager from 'react-native-incall-manager';
import { MediaStream } from 'react-native-webrtc';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CallSession, CallUser } from '../types/Call';
import { webRTCService } from '../services/WebRTCService';
import { PermissionService } from '../services/PermissionService';
import { getSocket, setSocketInCallStatus } from '../../../auth/api-client/socket';

import { IncomingCallScreen } from '../components/IncomingCallScreen';
import { VoiceCallScreen } from '../components/VoiceCallScreen';
import { OutgoingCallScreen } from '../components/OutgoingCallScreen';
import { CallComingScreen } from '../components/CallComingScreen'; // ⚡ Imported Full Screen UI
import { CallContext } from './CallContext';
import Sound from 'react-native-sound';
import apiClient from '../../../auth/api-client/api_client';
import notifee from '@notifee/react-native';
import { notificationNavState } from '../../../../index';

const baseUrl = apiClient.getBaseURL();
const newUrl = baseUrl.replace(/\/api\/?$/, "");

Sound.setCategory('PlayAndRecord', true);

const playEndTone = () => {
  const tone = new Sound('endcalltone.mp3', Sound.MAIN_BUNDLE, error => {
    if (!error) tone.play(() => tone.release());
  });
};

const playOutgoingTone = () => {
  const tone = new Sound('outgoingtone.mp3', Sound.MAIN_BUNDLE, error => {
    if (!error) {
      tone.setNumberOfLoops(-1);
      tone.play();
    }
  });
  return tone;
};

const playIncomingTone = () => {
  const tone = new Sound('ringtone.mp3', Sound.MAIN_BUNDLE, error => {
    if (!error) {
      tone.setNumberOfLoops(-1);
      tone.play();
    }
  });
  return tone;
};

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentSession, setCurrentSession] = useState<CallSession | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  
  // ⚡ NEW: Track if we should show Banner (Foreground) or Full Screen (Background)
  const [callPresentation, setCallPresentation] = useState<'banner' | 'fullscreen'>('banner');

  const outgoingToneRef = useRef<Sound | null>(null);
  const incomingToneRef = useRef<Sound | null>(null);
  const [callDuration, setCallDuration] = useState(0);

  useEffect(() => {
    let timer: any;
    if (currentSession?.status === 'connected') {
      timer = setInterval(() => setCallDuration(prev => prev + 1), 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(timer);
  }, [currentSession?.status]);

  const [audioRoute, setAudioRoute] = useState<string>('EARPIECE');
  const [availableRoutes, setAvailableRoutes] = useState<string[]>(['EARPIECE', 'SPEAKER_PHONE']);
  const [routeMenuVisible, setRouteMenuVisible] = useState(false);

  const activeCallIdRef = useRef<string | null>(null);
  const hasHandledOfferRef = useRef(false);

  const stopAllTones = () => {
    if (outgoingToneRef.current) {
      outgoingToneRef.current.stop(() => {
        outgoingToneRef.current?.release();
        outgoingToneRef.current = null;
      });
    }
    if (incomingToneRef.current) {
      incomingToneRef.current.stop(() => {
        incomingToneRef.current?.release();
        incomingToneRef.current = null;
      });
    }
  };

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('onAudioDeviceChanged', (data) => {
      let routes: string[] = [];
      if (typeof data.availableAudioDeviceList === 'string') routes = data.availableAudioDeviceList.split(',');
      else if (Array.isArray(data.availableAudioDeviceList)) routes = data.availableAudioDeviceList;
      
      if (!routes.includes('EARPIECE')) routes.push('EARPIECE');
      if (!routes.includes('SPEAKER_PHONE')) routes.push('SPEAKER_PHONE');
      
      setAvailableRoutes(routes);

      if (routes.includes('BLUETOOTH') && audioRoute !== 'BLUETOOTH') {
        setAudioRoute('BLUETOOTH');
        InCallManager.chooseAudioRoute('BLUETOOTH');
      } else if (routes.includes('WIRED_HEADSET') && audioRoute !== 'WIRED_HEADSET') {
        setAudioRoute('WIRED_HEADSET');
        InCallManager.chooseAudioRoute('WIRED_HEADSET');
      }
    });
    return () => subscription.remove();
  }, [audioRoute]);

  useEffect(() => {
    let socketInterval: ReturnType<typeof setInterval>;

    webRTCService.init(
      (candidate) => {
        if (activeCallIdRef.current) getSocket()?.emit("webrtc:ice-candidate", { callId: activeCallIdRef.current, candidate });
      },
      (stream) => setRemoteStream(stream)
    );

    const attachListeners = (activeSocket: any) => {
      const handleIncomingCall = (payload: any) => {
        activeCallIdRef.current = payload.callId;
        hasHandledOfferRef.current = false;
        
        const rawAvatar = payload.caller?.avatarUrl || payload.caller?.avatar || "";
        const formattedAvatar = rawAvatar ? (rawAvatar.startsWith('http') ? rawAvatar : `${newUrl}${rawAvatar}`) : "";

        // ⚡ INSTAGRAM LOGIC: Banner if open, Fullscreen if in background
        const isForeground = AppState.currentState === 'active';
        setCallPresentation(isForeground ? 'banner' : 'fullscreen');

        setCurrentSession({
          sessionId: payload.callId,
          remoteUser: { id: payload.callerId, name: payload.caller?.name || 'User', avatar: formattedAvatar },
          status: 'ringing',
          isIncoming: true,
        });
        
        stopAllTones();
        incomingToneRef.current = playIncomingTone();
        activeSocket.emit("call:ringing", { callId: payload.callId });
      };

      const handleCallAccepted = async (payload: any) => {
        InCallManager.stopRingback();
        InCallManager.stopRingtone();
        stopAllTones();
        InCallManager.start({ media: 'audio', auto: true, ringback: '' });
        
        let initialRoute = 'EARPIECE';
        if (availableRoutes.includes('BLUETOOTH')) initialRoute = 'BLUETOOTH';
        else if (availableRoutes.includes('WIRED_HEADSET')) initialRoute = 'WIRED_HEADSET';
        
        InCallManager.chooseAudioRoute(initialRoute);
        setAudioRoute(initialRoute);
        setSocketInCallStatus(true);
        setCurrentSession((prev) => prev ? { ...prev, status: 'connected' } : null);

        await webRTCService.setupConnection();

        if (payload.receiverId) {
          const offer = await webRTCService.createOffer();
          activeSocket.emit("webrtc:offer", { callId: payload.callId, offer });
        }
      };

      const handleCallEnd = () => cleanupCallSession();
      const handleNoAnswer = () => {
        setCurrentSession((prev) => prev ? { ...prev, status: 'no-answer' } : null);
        stopAllTones();
        playEndTone();
        setTimeout(() => cleanupCallSession(), 5000);
      };

      activeSocket.on("call:incoming", handleIncomingCall);
      activeSocket.on("call:accepted", handleCallAccepted);
      activeSocket.on("call:rejected", handleCallEnd);
      activeSocket.on("call:ended", handleCallEnd);
      activeSocket.on("call:cancelled", handleCallEnd);
      activeSocket.on("call:no-answer", handleNoAnswer);
      
      activeSocket.on("webrtc:offer", async (p: any) => {
        if (hasHandledOfferRef.current) return; 
        hasHandledOfferRef.current = true; 
        const answer = await webRTCService.handleOffer(p.offer);
        activeSocket.emit("webrtc:answer", { callId: p.callId, answer });
      });
      activeSocket.on("webrtc:answer", async (p: any) => await webRTCService.handleAnswer(p.answer));
      activeSocket.on("webrtc:ice-candidate", async (p: any) => await webRTCService.addIceCandidate(p.candidate));

      return () => {
        activeSocket.off("call:incoming"); activeSocket.off("call:accepted"); activeSocket.off("call:rejected"); activeSocket.off("call:ended");
        activeSocket.off("webrtc:offer"); activeSocket.off("webrtc:answer"); activeSocket.off("webrtc:ice-candidate");
      };
    };

    let cleanupListeners: (() => void) | undefined;
    let isAttached = false;
    const checkSocket = () => {
      const activeSocket = getSocket();
      if (activeSocket && activeSocket.connected && !isAttached) {
        isAttached = true;
        clearInterval(socketInterval);
        cleanupListeners = attachListeners(activeSocket);
      }
    };
    checkSocket();
    socketInterval = setInterval(checkSocket, 500);
    return () => { clearInterval(socketInterval); if (cleanupListeners) cleanupListeners(); };
  }, [availableRoutes, audioRoute]);

  // ⚡ FIX: Instant Global Listener for Background Taps (Auto-Answer)
 // ⚡ FIX: Bulletproof Call Interceptor
  useEffect(() => {
    const checkPendingCalls = async () => {
      // 1. Cold Boot Check (Did the app open from a notification tap?)
      const initial = await notifee.getInitialNotification();
      const initialData = initial?.notification?.data;
      
      let callData = null;
      let autoAccept = false;

      // Determine if we tapped the body or the "Answer" button
      if (initialData?.type === 'incoming_call') {
        callData = initialData;
        autoAccept = initial.pressAction?.id === 'answer_call';
      } else if (notificationNavState.pending?.type === 'incoming_call') {
        callData = notificationNavState.pending;
        autoAccept = !!callData.autoAccept;
      }

      // Inside CallProvider.tsx -> useEffect -> checkPendingCalls

      if (callData) {
        console.log('[CallProvider] Booting directly into call UI:', callData);
        notificationNavState.pending = null; 
        activeCallIdRef.current = callData.callId;
        
        setCallPresentation('fullscreen');
        
        // ⚡ FIX: Properly format the avatar URL for cold boots
        const rawAvatar = callData.avatarUrl || callData.profileImage || '';
        const formattedAvatar = rawAvatar ? (rawAvatar.startsWith('http') ? rawAvatar : `${newUrl}${rawAvatar}`) : "";

        setCurrentSession({
          sessionId: callData.callId,
          remoteUser: { 
            id: callData.callerId, 
            name: callData.callerName || 'User', 
            avatar: formattedAvatar // ⚡ Use formatted avatar here
          },
          status: 'ringing',
          isIncoming: true,
        });

        // ... rest of checkPendingCalls code ...

        stopAllTones();

        if (autoAccept) {
          // ⚡ FIX: Proper Socket Poller + Microphone Permission check
          let attempts = 0;
          const tryAccept = setInterval(async () => {
            const socket = getSocket();
            if (socket?.connected) {
              clearInterval(tryAccept);
              
              // Must check permissions before answering!
              const hasPermission = await PermissionService.checkAndRequestAudioPermission();
              if (hasPermission) {
                socket.emit("call:accept", { callId: callData.callId });
              }
            }
            attempts++;
            if (attempts > 15) clearInterval(tryAccept); // Give up after 7.5 seconds
          }, 500);
        } else {
          incomingToneRef.current = playIncomingTone();
        }
      }
    };

    // Run this instantly when CallProvider mounts
    checkPendingCalls();

    // 2. Handle the case where the app is already running in the background
    const handleBackgroundCall = (data: any) => {
      activeCallIdRef.current = data.callId;
      setCallPresentation('fullscreen');
      
      // ⚡ FIX: Properly format the avatar URL for background taps
      const rawAvatar = data.avatarUrl || data.profileImage || '';
      const formattedAvatar = rawAvatar ? (rawAvatar.startsWith('http') ? rawAvatar : `${newUrl}${rawAvatar}`) : "";

      setCurrentSession({
        sessionId: data.callId,
        remoteUser: { id: data.callerId, name: data.callerName || 'User', avatar: formattedAvatar }, // ⚡ Use formatted avatar here
        status: 'ringing',
        isIncoming: true,
      });

      stopAllTones();

      if (data.autoAccept) {
        const socket = getSocket();
        if (socket?.connected) {
          socket.emit("call:accept", { callId: data.callId });
        } else {
          setTimeout(() => getSocket()?.emit("call:accept", { callId: data.callId }), 1000);
        }
      } else {
        incomingToneRef.current = playIncomingTone();
      }
    };

    const listener = DeviceEventEmitter.addListener('auto_answer_call', handleBackgroundCall);
    const terminateListener = DeviceEventEmitter.addListener('TERMINATE_CALL', (data) => {
        if (activeCallIdRef.current === data.callId) cleanupCallSession();
    });

    return () => { 
      listener.remove(); 
      terminateListener.remove(); 
    };
  }, []);

  const startCall = async (targetUser: CallUser, conversationId: string) => {
    const hasPermission = await PermissionService.checkAndRequestAudioPermission();
    if (!hasPermission) return;
    stopAllTones();
    outgoingToneRef.current = playOutgoingTone();
    setIsMinimized(false);

    InCallManager.start({ media: 'audio', auto: true, ringback: '' });
    InCallManager.chooseAudioRoute('EARPIECE');
    setAudioRoute('EARPIECE');

    setCurrentSession({ sessionId: "pending", remoteUser: targetUser, status: 'initiating', isIncoming: false });

    getSocket()?.emit("call:start", { receiverId: targetUser.id, type: "audio", conversationId }, (response: any) => {
      if (response.success) {
        activeCallIdRef.current = response.callId;
        setCurrentSession((prev) => prev ? { ...prev, sessionId: response.callId, status: response.status || 'ringing' } : null);
      } else if (response.message === "User busy") {
        setCurrentSession((prev) => prev ? { ...prev, status: 'busy' } : null);
        stopAllTones();
        playEndTone();
        setTimeout(() => cleanupCallSession(), 5000);
      } else {
        cleanupCallSession();
      }
    });
  };

  const acceptCall = async () => {
    if (!currentSession || !activeCallIdRef.current) return;
    const hasPermission = await PermissionService.checkAndRequestAudioPermission();
    if (!hasPermission) return; 
    getSocket()?.emit("call:accept", { callId: activeCallIdRef.current });
  };

  const rejectCall = () => {
    if (activeCallIdRef.current) getSocket()?.emit("call:reject", { callId: activeCallIdRef.current });
    cleanupCallSession();
  };

  const endCall = () => {
    if (activeCallIdRef.current) {
      if (currentSession?.status === "ringing" && !currentSession.isIncoming) {
        getSocket()?.emit("call:cancel", { callId: activeCallIdRef.current });
      } else {
        getSocket()?.emit("call:end", { callId: activeCallIdRef.current });
      }
    }
    cleanupCallSession();
  };

  const toggleMute = () => {
    if (webRTCService.localStream) {
      const audioTrack = webRTCService.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const selectAudioRoute = (route: string) => {
    setAudioRoute(route);
    InCallManager.chooseAudioRoute(route);
    InCallManager.setForceSpeakerphoneOn(route === 'SPEAKER_PHONE');
    setRouteMenuVisible(false);
  };

  const handleSpeakerPress = () => {
    if (availableRoutes.length > 2) setRouteMenuVisible(true);
    else selectAudioRoute(audioRoute === 'SPEAKER_PHONE' ? 'EARPIECE' : 'SPEAKER_PHONE');
  };

  const toggleMinimize = () => setIsMinimized(!isMinimized);
  
  const cleanupCallSession = () => {
    InCallManager.stop();
    InCallManager.stopRingtone();
    InCallManager.stopRingback();
    webRTCService.cleanup();
    activeCallIdRef.current = null;
    stopAllTones();
    setCurrentSession(null);
    setRemoteStream(null);
    setIsMuted(false);
    setAudioRoute('EARPIECE');
    setIsMinimized(false);
    setSocketInCallStatus(false); 
  };

  return (
    <CallContext.Provider value={{
      currentSession, remoteStream, isMuted, audioRoute, availableRoutes, isMinimized, callDuration,
      startCall, acceptCall, rejectCall, endCall, toggleMute, handleSpeakerPress, toggleMinimize
    }}>
      <View style={styles.masterWrapper}>
        
        {currentSession && isMinimized && <MinimizedCallBanner />}

        <View style={styles.appContainer}>
          {children}

          {/* 📱 ⚡ GLOBAL CALL OVERLAYS ⚡ */}
          {currentSession && !isMinimized && (
            <View 
              style={[StyleSheet.absoluteFill, { zIndex: 99999 }]} 
              pointerEvents={(currentSession.status === 'ringing' && currentSession.isIncoming && callPresentation === 'banner') ? 'box-none' : 'auto'}
            >
              {(!currentSession.isIncoming && currentSession.status !== 'connected') && (
                <OutgoingCallScreen />
              )}

              {/* ⚡ The WhatsApp/Instagram Toggle */}
              {(currentSession.status === 'ringing' && currentSession.isIncoming) && (
                callPresentation === 'fullscreen' ? <CallComingScreen /> : <IncomingCallScreen />
              )}

              {currentSession.status === 'connected' && (
                <VoiceCallScreen />
              )}
            </View>
          )}
        </View>

        <Modal visible={routeMenuVisible} transparent animationType="fade" onRequestClose={() => setRouteMenuVisible(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setRouteMenuVisible(false)}>
            <View style={styles.modalContainer}>
              <Text style={styles.modalTitle}>Select Audio Route</Text>
              
              {availableRoutes.includes('BLUETOOTH') && (
                <TouchableOpacity style={styles.routeItem} onPress={() => selectAudioRoute('BLUETOOTH')}>
                  <Icon name="bluetooth" size={24} color={audioRoute === 'BLUETOOTH' ? "#6366f1" : "#fff"} />
                  <Text style={[styles.routeText, audioRoute === 'BLUETOOTH' && styles.routeTextActive]}>Bluetooth Device</Text>
                </TouchableOpacity>
              )}

              {availableRoutes.includes('WIRED_HEADSET') && (
                <TouchableOpacity style={styles.routeItem} onPress={() => selectAudioRoute('WIRED_HEADSET')}>
                  <Icon name="headphones" size={24} color={audioRoute === 'WIRED_HEADSET' ? "#6366f1" : "#fff"} />
                  <Text style={[styles.routeText, audioRoute === 'WIRED_HEADSET' && styles.routeTextActive]}>Wired Headset</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={styles.routeItem} onPress={() => selectAudioRoute('SPEAKER_PHONE')}>
                <Icon name="volume-high" size={24} color={audioRoute === 'SPEAKER_PHONE' ? "#6366f1" : "#fff"} />
                <Text style={[styles.routeText, audioRoute === 'SPEAKER_PHONE' && styles.routeTextActive]}>Speaker</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.routeItem} onPress={() => selectAudioRoute('EARPIECE')}>
                <Icon name="phone-in-talk" size={24} color={audioRoute === 'EARPIECE' ? "#6366f1" : "#fff"} />
                <Text style={[styles.routeText, audioRoute === 'EARPIECE' && styles.routeTextActive]}>Phone (Earpiece)</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Modal>

      </View>
    </CallContext.Provider>
  );
};

// ... keep your MinimizedCallBanner and StyleSheet code below this just like before

// ==========================================
// MINIMIZED TOP BLOCK COMPONENT
// ==========================================
const MinimizedCallBanner = () => {
  const callContext = useContext(CallContext);
  const insets = useSafeAreaInsets(); 



  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    
    if (h > 0) {
      return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  if (!callContext?.currentSession) return null;
  const { currentSession, isMuted, toggleMute, endCall, toggleMinimize, audioRoute, callDuration, availableRoutes, handleSpeakerPress } = callContext;

  let routeIcon = "phone-in-talk";
  if (audioRoute === 'BLUETOOTH') routeIcon = "bluetooth-audio";
  else if (audioRoute === 'WIRED_HEADSET') routeIcon = "headphones";
  else if (audioRoute === 'SPEAKER_PHONE') routeIcon = "volume-high";

  let statusText = "Active Call";
  let statusColor = "#22c55e"; 
  
  if (currentSession.status === 'initiating') {
    statusText = "Calling...";
    statusColor = "#94a3b8"; 
  } else if (currentSession.status === 'ringing' && !currentSession.isIncoming) {
    statusText = "Ringing...";
    statusColor = "#22c55e"; 
  } else if (currentSession.status === 'busy') {
    statusText = "User Busy...";
    statusColor = "#ef4444"; 
  } else if (currentSession.status === 'no-answer') {
    statusText = "No Response";
    statusColor = "#ef4444"; 
  } else if (currentSession.status === 'connected') {
    statusText = `${formatTime(callDuration)} • Active Call`;
  }

  

  const safeTopPadding = Math.max(insets.top, 20) + 12;

  return (
    <TouchableOpacity 
      style={[bannerStyles.minimizedContainer, { paddingTop: safeTopPadding }]} 
      activeOpacity={0.9} 
      onPress={toggleMinimize}
    >
      <View style={bannerStyles.leftSection}>
        
        {/* ⚡ THE AVATAR IMAGE FIX */}
    {/* ⚡ THE AVATAR IMAGE FIX */}
        <View style={[bannerStyles.minimizedAvatar, currentSession.remoteUser.avatar ? { backgroundColor: 'transparent' } : null]}>
          {currentSession.remoteUser.avatar ? (
            <Image 
              source={{ uri: currentSession.remoteUser.avatar }} 
              style={bannerStyles.minimizedAvatarImage} 
            />
          ) : (
            <Text style={bannerStyles.minimizedAvatarText}>
              {currentSession.remoteUser.name.charAt(0)}
            </Text>
          )}
        </View>

        <View style={bannerStyles.minimizedInfo}>
          <Text style={bannerStyles.minimizedName} numberOfLines={1}>
            {currentSession.remoteUser.name}
          </Text>
          <Text style={[bannerStyles.minimizedTime, { color: statusColor }]}>
            {statusText}
          </Text>
        </View>
      </View>

      <View style={bannerStyles.rightControls}>
        <TouchableOpacity 
          style={[bannerStyles.actionIconBtn, audioRoute !== 'EARPIECE' && bannerStyles.btnActive]} 
          onPress={handleSpeakerPress}
        >
          <Icon name={routeIcon} size={20} color="#fff" />
          {availableRoutes.length > 2 && (
            <Icon name="chevron-down" size={12} color="#fff" style={bannerStyles.dropdownArrow} />
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          style={[bannerStyles.actionIconBtn, isMuted && bannerStyles.btnMutedActive]} 
          onPress={toggleMute}
        >
          <Icon name={isMuted ? "microphone-off" : "microphone"} size={20} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity style={bannerStyles.minimizedEndBtn} onPress={endCall}>
          <Icon name="phone-hangup" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  masterWrapper: { flex: 1, backgroundColor: '#020617' },
  appContainer: { flex: 1 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalContainer: { backgroundColor: '#1e293b', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalTitle: { color: '#94a3b8', fontSize: 14, fontWeight: '600', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 },
  routeItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  routeText: { color: '#fff', fontSize: 18, marginLeft: 16, fontWeight: '500' },
  routeTextActive: { color: '#6366f1' },
});

const bannerStyles = StyleSheet.create({
  minimizedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0f172a',
    paddingHorizontal: 16,
    paddingBottom: 16, // Added more padding at the bottom for height
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(99,102,241,0.25)',
  },
// ⚡ FIX: Added overflow: 'hidden' to the parent container
  minimizedAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#4f46e5', justifyContent: 'center', alignItems: 'center', marginRight: 12, overflow: 'hidden' },
  
  // ⚡ FIX: Forced the image to stretch and cover the container perfectly
  minimizedAvatarImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  dropdownArrow: { position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 6 },
  leftSection: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  minimizedAvatarText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  minimizedInfo: { flex: 1, marginRight: 8 },
  minimizedName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  minimizedTime: { color: '#22c55e', fontSize: 13, marginTop: 2 },
  rightControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionIconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center', position: 'relative' },
  btnActive: { backgroundColor: '#4f46e5' },
  btnMutedActive: { backgroundColor: '#eab308' },
  minimizedEndBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center' },
});