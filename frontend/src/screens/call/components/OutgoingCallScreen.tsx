import React, { useContext, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Image, Animated, Easing } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { CallContext } from '../context/CallContext';

export const OutgoingCallScreen = () => {
  const callContext = useContext(CallContext);
  const pulseAnim = useRef(new Animated.Value(0)).current;

  // ⚡ 1. Let the animation loop continuously
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  if (!callContext || !callContext.currentSession) return null;
  const { currentSession, endCall, toggleMinimize, audioRoute, availableRoutes, handleSpeakerPress } = callContext;
  const { remoteUser, status } = currentSession;
  

  // ⚡ 2. Group 'busy' and 'no-answer' into one error state
  const isError = status === 'busy' || status === 'no-answer';

  let statusText = "Calling...";
  let statusColor = "#94a3b8"; 
  if (status === 'ringing') {
    statusText = "Ringing...";
    statusColor = "#22c55e"; 
  } else if (status === 'busy') {
    statusText = "User Busy";
    statusColor = "#ef4444"; 
  } else if (status === 'no-answer') {
    statusText = "No Response";
    statusColor = "#ef4444"; 
  } else if (status === 'rejected') {
    // ⚡ FIX 3B: Add the rejected UI state!
    statusText = "Call Declined";
    statusColor = "#ef4444"; // Red
  }

  let routeIcon = "phone-in-talk";
  if (audioRoute === 'BLUETOOTH') routeIcon = "bluetooth-audio";
  else if (audioRoute === 'WIRED_HEADSET') routeIcon = "headphones";
  else if (audioRoute === 'SPEAKER_PHONE') routeIcon = "volume-high";

  const pulseScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.6], 
  });

  const pulseOpacity = pulseAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.6, 0.3, 0], 
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconBtn} activeOpacity={0.7} onPress={toggleMinimize}>
          <Icon name="chevron-left" size={32} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.encryptionText}>
          <Icon name="lock" size={12} color="#94a3b8" /> End-to-end encrypted
        </Text>
        <View style={{ width: 46 }} />
      </View>

      <View style={styles.profileArea}>
        <View style={styles.avatarContainer}>
          
          {/* ⚡ 3. Apply the red color override to the animated pulse if error */}
          <Animated.View 
            style={[
              styles.pulseRing, 
              isError && { backgroundColor: 'rgba(239,68,68,0.2)', borderColor: 'rgba(239,68,68,0.4)' },
              {
                transform: [{ scale: pulseScale }],
                opacity: pulseOpacity,
              }
            ]} 
          />

          {/* ⚡ 4. Apply the red color override to the static glow if error */}
         
<View style={[styles.avatarGlow, isError && { borderColor: 'rgba(239,68,68,0.5)', backgroundColor: 'rgba(239,68,68,0.2)' }]}>
  {remoteUser.avatar ? (
    <Image source={{ uri: remoteUser.avatar }} style={styles.avatarImage} />
  ) : (
    <View style={styles.avatarPlaceholder}>
      <Icon name="account" size={80} color="#fff" /> {/* ⚡ CHANGED TO MATCH OTHER SCREENS */}
    </View>
  )}
</View>
        </View>

        <Text style={styles.userName} numberOfLines={1}>{remoteUser.name}</Text>
        <Text style={[styles.statusText, { color: statusColor }]}>{statusText}</Text>
      </View>

      <View style={styles.floatingBar}>
        <View style={{ width: 58 }} /> 

        <TouchableOpacity 
          style={[styles.endCallBtn, isError && { opacity: 0.5 }]} 
          activeOpacity={0.8}
          onPress={isError ? undefined : endCall}
        >
          <Icon name="phone-hangup" size={36} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.controlBtn, audioRoute !== 'EARPIECE' && styles.controlBtnActiveRoute]} 
          activeOpacity={0.7}
          onPress={handleSpeakerPress}
        >
          <Icon name={routeIcon} size={28} color="#fff" />
          {availableRoutes.length > 2 && (
            <Icon name="chevron-down" size={14} color="#fff" style={styles.dropdownArrow} />
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020617', justifyContent: 'space-between', marginTop: 30 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20 },
  iconBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center' },
  encryptionText: { color: '#94a3b8', fontSize: 13, fontWeight: '500', letterSpacing: 0.5 },
  
  profileArea: { alignItems: 'center', flex: 1, justifyContent: 'center', marginTop: -40 },
  
  avatarContainer: { width: 170, height: 170, justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  
  pulseRing: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(99,102,241,0.2)', // Default Indigo
    borderWidth: 2,
    borderColor: 'rgba(99,102,241,0.4)',
  },

  avatarGlow: { width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', zIndex: 10 },
  avatarImage: { width: 150, height: 150, borderRadius: 75 },
  avatarPlaceholder: { width: 150, height: 150, borderRadius: 75, backgroundColor: '#1e293b', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 60, fontWeight: 'bold' },
  
  userName: { color: '#fff', fontSize: 34, fontWeight: '700', marginBottom: 8, paddingHorizontal: 20, textAlign: 'center' },
  statusText: { fontSize: 18, letterSpacing: 1, fontWeight: '600' },
  
  floatingBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 40, marginBottom: 50 },
  endCallBtn: { width: 74, height: 74, borderRadius: 37, backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', shadowColor: '#ef4444', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 8 },
  controlBtn: { width: 58, height: 58, borderRadius: 29, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center', position: 'relative' },
  controlBtnActiveRoute: { backgroundColor: '#4f46e5' },
  dropdownArrow: { position: 'absolute', bottom: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 7 },
});