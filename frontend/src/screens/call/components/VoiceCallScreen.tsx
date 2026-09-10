import React, { useContext, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Image } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { CallContext } from '../context/CallContext';

export const VoiceCallScreen = () => {
  const callContext = useContext(CallContext);

const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    
    // If over an hour, show H:MM:SS. Otherwise, show M:SS
    if (h > 0) {
      return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  if (!callContext?.currentSession) return null;
  const { remoteUser } = callContext.currentSession;
  const { audioRoute, availableRoutes, handleSpeakerPress, isMuted, toggleMute, endCall, toggleMinimize, callDuration } = callContext;

  // Determine correct icon for the full screen
  let routeIcon = "phone-in-talk";
  if (audioRoute === 'BLUETOOTH') routeIcon = "bluetooth-audio";
  else if (audioRoute === 'WIRED_HEADSET') routeIcon = "headphones";
  else if (audioRoute === 'SPEAKER_PHONE') routeIcon = "volume-high";

  return (
    <SafeAreaView style={styles.container}>
      {callContext.remoteStream && (
        <RTCView streamURL={callContext.remoteStream.toURL()} style={{ width: 0, height: 0 }} />
      )}

      {/* Top Bar with Minimize Button */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconBtn} onPress={toggleMinimize}>
          <Icon name="chevron-left" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.encryptionText}>
          <Icon name="lock" size={12} color="#94a3b8" /> End-to-end encrypted
        </Text>
        <View style={{ width: 42 }} />
      </View>

      <View style={styles.profileArea}>
        <View style={styles.avatarGlow}>
          {remoteUser.avatar ? (
            <Image source={{ uri: remoteUser.avatar }} style={styles.avatarImage} />
          ) : (
            <Icon name="account" size={80} color="#fff" />
          )}
        </View>
        <Text style={styles.userName}>{remoteUser.name}</Text>
        <Text style={styles.durationText}>{formatTime(callDuration)}</Text>
      </View>

      <View style={styles.floatingBar}>
        <TouchableOpacity 
          style={[styles.controlBtn, isMuted && styles.controlBtnActiveMuted]} 
          onPress={toggleMute}
        >
          <Icon name={isMuted ? "microphone-off" : "microphone"} size={26} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.endCallBtn} onPress={endCall}>
          <Icon name="phone-hangup" size={32} color="#fff" />
        </TouchableOpacity>

        {/* Dynamic Route Button */}
        <TouchableOpacity 
          style={[styles.controlBtn, audioRoute !== 'EARPIECE' && styles.controlBtnActiveRoute]} 
          onPress={handleSpeakerPress}
        >
          <Icon name={routeIcon} size={26} color="#fff" />
          {availableRoutes.length > 2 && (
            <Icon name="chevron-down" size={14} color="#fff" style={{ position: 'absolute', bottom: 6, right: 6 }} />
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020617', justifyContent: 'space-between', marginTop: 30 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20 },
  iconBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center' },
  encryptionText: { color: '#94a3b8', fontSize: 12 },
  profileArea: { alignItems: 'center', flex: 1, justifyContent: 'center', marginTop: -40 },
  avatarGlow: { width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(99,102,241,0.15)', justifyContent: 'center', alignItems: 'center', marginBottom: 24, borderWidth: 1, borderColor: 'rgba(99,102,241,0.3)' },
  avatarImage: { width: 140, height: 140, borderRadius: 70 },
  avatarPlaceholder: { width: 140, height: 140, borderRadius: 70, backgroundColor: '#1e293b', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 54, fontWeight: 'bold' },
  userName: { color: '#fff', fontSize: 32, fontWeight: '700', marginBottom: 8 },
  durationText: { color: '#22c55e', fontSize: 18, fontWeight: '600', letterSpacing: 1 },
  floatingBar: { flexDirection: 'row', backgroundColor: 'rgba(15,23,42,0.85)', marginHorizontal: 30, marginBottom: 40, paddingVertical: 16, paddingHorizontal: 24, borderRadius: 40, justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(148,163,184,0.15)' },
  controlBtn: { width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center', position: 'relative' },
  controlBtnActiveRoute: { backgroundColor: '#4f46e5' },
  controlBtnActiveMuted: { backgroundColor: '#eab308' },
  dropdownArrow: { position: 'absolute', bottom: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 7 },
  endCallBtn: { width: 68, height: 68, borderRadius: 34, backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', shadowColor: '#ef4444', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 8 }
});