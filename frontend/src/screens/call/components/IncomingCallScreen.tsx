import React, { useContext, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Image } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { CallContext } from '../context/CallContext';
import apiClient from '../../../auth/api-client/api_client';

  const baseUrl = apiClient.getBaseURL();
  const newUrl = baseUrl.replace(/\/api\/?$/, "");

export const IncomingCallScreen = () => {
  const callContext = useContext(CallContext);
  
  // ⚡ Animations
  const slideAnim = useRef(new Animated.Value(-150)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // 1. Drop down from the top smoothly
    Animated.spring(slideAnim, { 
      toValue: 50, 
      tension: 70, 
      friction: 12, 
      useNativeDriver: true 
    }).start();

    // 2. Make the green accept button "breathe" to draw attention
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.1, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true })
      ])
    ).start();
  }, [slideAnim, pulseAnim]);

  if (!callContext || !callContext.currentSession) return null;
  const { currentSession, acceptCall, rejectCall } = callContext;
  const { remoteUser } = currentSession;

  

  return (
    <Animated.View style={[styles.bannerContainer, { transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.bannerRow}>
        
        {/* ⚡ THE AVATAR (With Image Support) */}
        <View style={[styles.avatarContainer, remoteUser.avatar ? { backgroundColor: 'transparent' } : null]}>
          {remoteUser.avatar ? (
            <Image 
              source={{ uri: remoteUser.avatar }} 
              style={styles.avatarImage} 
            />
          ) : (
            <Icon name="account" size={32} color="#fff" />
          )}
        </View>

        <View style={styles.infoCol}>
          <Text style={styles.userName} numberOfLines={1}>{remoteUser.name}</Text>
          <Text style={styles.statusText}>Incoming Voice Call...</Text>
        </View>

        <View style={styles.actionCol}>
          {/* Decline Button */}
          <TouchableOpacity style={styles.declineBtn} onPress={rejectCall} activeOpacity={0.7}>
            <Icon name="phone-hangup" size={24} color="#fff" />
          </TouchableOpacity>
          
          {/* Accept Button (With Animated Pulse) */}
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity style={styles.acceptBtn} onPress={acceptCall} activeOpacity={0.8}>
              <Icon name="phone" size={24} color="#fff" />
            </TouchableOpacity>
          </Animated.View>
        </View>

      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  // Sleeker background with softer shadow for a premium feel
  bannerContainer: { 
    position: 'absolute', 
    left: 12, 
    right: 12, 
    backgroundColor: 'rgba(15,23,42,0.95)', 
    borderRadius: 20, 
    padding: 16, 
    borderWidth: 1, 
    borderColor: 'rgba(148,163,184,0.15)', 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 12 }, 
    shadowOpacity: 0.4, 
    shadowRadius: 16, 
    elevation: 15, 
    zIndex: 9999 
  },
  bannerRow: { flexDirection: 'row', alignItems: 'center' },
  
  // Larger, beautifully rounded avatar
  avatarContainer: { 
    width: 56, 
    height: 56, 
    borderRadius: 28, 
    backgroundColor: '#4f46e5', 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginRight: 14, 
    overflow: 'hidden' // ⚡ CRITICAL FOR IMAGE
  },
  avatarImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  avatarText: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  
  infoCol: { flex: 1, marginRight: 8 },
  userName: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 2 },
  statusText: { color: '#94a3b8', fontSize: 14, fontWeight: '500' },
  
  // Bigger action buttons (48x48 instead of 44x44)
  actionCol: { flexDirection: 'row', gap: 14 },
  declineBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center' },
  acceptBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#22c55e', justifyContent: 'center', alignItems: 'center', shadowColor: '#22c55e', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 6 },
});