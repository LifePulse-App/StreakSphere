import React, { useEffect, useState, useRef, useContext, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Modal,
  SectionList,
  TextInput,
  Platform,
  Image,
  KeyboardAvoidingView,
  ScrollView,
  Text
} from 'react-native';
import ImageResizer from 'react-native-image-resizer';
import { PinchGestureHandler, State } from 'react-native-gesture-handler'; 
import {
  Camera,
  useCameraPermission,
  useCameraDevice,
  usePhotoOutput
} from 'react-native-vision-camera';
import { launchImageLibrary } from 'react-native-image-picker';
import { Image as ImageCompressor } from 'react-native-compressor'; 
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AppActivityIndicator from '../../components/Layout/AppActivityIndicator/AppActivityIndicator';
import AppText from '../../components/Layout/AppText/AppText';
import ProofApi from './api_camera';
import api_profile from '../profile/services/api_profile';
import AuthContext from '../../auth/user/UserContext';
import GlassyErrorModal from '../../shared/components/GlassyErrorModal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';

type Habit = {
  id: string;
  habitName: string;
  label?: string;
  icon?: string;
  time?: string;
  group?: string;
};

type HabitSection = {
  title: string;
  data: Habit[];
};

type ViewState = 'camera' | 'preview' | 'details';

const GLASS_BG = 'rgba(15, 23, 42, 0.65)';
const GLASS_BORDER = 'rgba(148, 163, 184, 0.35)';
const HABITS_CACHE_KEY = "proof:habits:v1";
const APP_BG = '#020617';

const CAPTION_FONT_SIZE = 15;
const CAPTION_LINE_HEIGHT = 20;
const CAPTION_PADDING = 12;

const saveHabitsCache = async (habits: Habit[]) => {
  try {
    await AsyncStorage.setItem(HABITS_CACHE_KEY, JSON.stringify({ ts: Date.now(), habits }));
  } catch {}
};

const loadHabitsCache = async (): Promise<Habit[] | null> => {
  try {
    const raw = await AsyncStorage.getItem(HABITS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return "habits" in parsed ? parsed.habits : null;
  } catch {
    return null;
  }
};

const ProofVisionCameraScreen = ({ navigation }: any) => {
  const authContext = useContext(AuthContext);
  const userId = authContext?.User?.user?.id;

  const [viewState, setViewState] = useState<ViewState>('camera');
  const [mediaUri, setMediaUri] = useState<string | null>(null);
  
  const { hasPermission, requestPermission } = useCameraPermission();
  const [cameraPosition, setCameraPosition] = useState<'back' | 'front'>('back');
  const device = useCameraDevice(cameraPosition);
  const photoOutput = usePhotoOutput();
  const [uploading, setUploading] = useState(false);

  const [zoom, setZoom] = useState(1);
  const baseZoom = useRef(1);

  const [caption, setCaption] = useState('');
  const [privacyScope, setPrivacyScope] = useState('friends');
  const [selectedHabit, setSelectedHabit] = useState<Habit | null>(null);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitSections, setHabitSections] = useState<HabitSection[]>([]);
  const [habitModalVisible, setHabitModalVisible] = useState(false);
  const [search, setSearch] = useState('');
  const [habitsLoading, setHabitsLoading] = useState(false);

  const [modalMessage, setModalMessage] = useState<string | null>(null);
  const offlineRef = useRef(false);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission]);

  useEffect(() => {
    if (device) {
      const initialZoom = device.neutralZoom ?? 1;
      setZoom(initialZoom);
      baseZoom.current = initialZoom;
    }
  }, [device]);

  const onPinchEvent = (event: any) => {
    if (!device) return;
    const scale = event.nativeEvent.scale;
    let newZoom = baseZoom.current * scale;
    
    const minZoom = device.minZoom ?? 1;
    const maxZoom = Math.min(device.maxZoom ?? 10, 10);
    
    newZoom = Math.max(minZoom, Math.min(newZoom, maxZoom));
    setZoom(newZoom);
  };

  const onPinchStateChange = (event: any) => {
    if (event.nativeEvent.state === State.END) {
      baseZoom.current = zoom;
    }
  };

  const groupHabits = (items: Habit[]): HabitSection[] => {
    const byGroup: Record<string, Habit[]> = {};
    items.forEach(h => {
      const groupName = h.group || 'Other';
      if (!byGroup[groupName]) byGroup[groupName] = [];
      byGroup[groupName].push(h);
    });
    return Object.keys(byGroup)
      .sort()
      .map(title => ({
        title,
        data: byGroup[title].sort((a, b) =>
          (a.label || a.habitName).localeCompare(b.label || b.habitName),
        ),
      }));
  };

  const fetchHabits = useCallback(async (query: string = '') => {
    setHabitsLoading(true);
    try {
      const res = await ProofApi.GetHabits(query || undefined);
      const data = (res as any).data?.habits ?? (res as any).habits ?? [];
      const normalized: Habit[] = data.map((h: any) => ({
        id: h.id || h._id?.toString(),
        habitName: h.habitName,
        label: h.habitName,
        icon: h.icon,
        group: h.group,
      }));

      if (normalized.length > 0) {
        setHabits(normalized);
        setHabitSections(groupHabits(normalized));
        await saveHabitsCache(normalized);
      }
    } catch (err) {
      console.log('Failed to fetch habits');
    } finally {
      setHabitsLoading(false);
    }
  }, []);

  useEffect(() => {
    NetInfo.fetch().then((state) => {
      offlineRef.current = !(state.isConnected && state.isInternetReachable !== false);
    });

    (async () => {
      const cached = await loadHabitsCache();
      if (cached) {
        setHabits(cached);
        setHabitSections(groupHabits(cached));
      }
      if (!offlineRef.current) {
        fetchHabits('');
        try {
          const pRes = await api_profile.getActivityPrivacy();
          if (pRes.data?.defaultVisibilityScope) {
            setPrivacyScope(pRes.data.defaultVisibilityScope);
          }
        } catch (e) {}
      }
    })();
  }, [fetchHabits]);

  const handleTakePhoto = async () => {
    try {
      const photo = await photoOutput.capturePhoto({ flashMode: 'off' }, {});
      
      // 1. Capture dimensions safely before disposing
      const imgWidth = photo.width;
      const imgHeight = photo.height;
      const rawPath = await photo.saveToTemporaryFileAsync();
      
      if (photo.dispose) photo.dispose();
      
      let finalUri = `file://${rawPath}`;

      if (Platform.OS === 'android') {
        // 2. If Width > Height, the physical pixels are horizontal
        const isLandscape = imgWidth > imgHeight;
        
        if (isLandscape) {
          // "left" means it needs to be rotated 90 degrees to be upright
          const rotationDegrees = cameraPosition === 'front' ? 270 : 90;
          
          // 3. Physically rotate the pixels
          const resized = await ImageResizer.createResizedImage(
            finalUri,
            1080,
            1080,
            'JPEG',
            90,
            rotationDegrees
          );
          
          finalUri = resized.uri;
        }
      } else {
        // iOS natively respects EXIF, so we just compress it normally
        finalUri = await ImageCompressor.compress(finalUri, {
          compressionMethod: 'auto',
          maxWidth: 1080,   
          maxHeight: 1080,
          quality: 0.9,     
          returnableOutputType: 'uri'
        });
      }

      setMediaUri(finalUri);
      setViewState('preview');
      
    } catch (err: any) { 
      console.error("Capture Error:", err);
      setModalMessage(`Capture failed: ${err.message || 'Unknown error'}`); 
    }
  };

  const openGallery = async () => {
    const result = await launchImageLibrary({ 
      mediaType: 'photo', 
      selectionLimit: 1,
      maxWidth: 1080, 
      maxHeight: 1080,
      quality: 0.9 
    });
    
    if (result.assets && result.assets.length > 0 && result.assets[0].uri) {
      setMediaUri(result.assets[0].uri);
      setViewState('preview');
    }
  };

  const handlePost = () => {
    if (!selectedHabit) return setModalMessage("Please select an activity first.");
    if (!mediaUri) return;

    setUploading(true);
    navigation.goBack(); 

    (async () => {
      try {
        const formData = new FormData();
        formData.append('proof', {
          uri: mediaUri,
          name: 'photo.jpg',
          type: 'image/jpeg',
        } as any);
        formData.append('habitId', selectedHabit.id);
        formData.append('userId', userId);
        formData.append('caption', caption);
        
        await ProofApi.SubmitProof(formData);
        console.log("Post uploaded successfully in the background.");
      } catch (err) {
        console.error("Background upload failed:", err);
      }
    })();
  };

  if (viewState === 'camera') {
    return (
      <View style={styles.root}>
        {device && hasPermission ? (
          <PinchGestureHandler
            onGestureEvent={onPinchEvent}
            onHandlerStateChange={onPinchStateChange}
          >
            <View style={StyleSheet.absoluteFill}>
              <Camera 
                style={StyleSheet.absoluteFill} 
                device={device} 
                isActive={true} // 🚨 Reverted back to true so capture doesn't crash
                outputs={[photoOutput]} 
                photo={true} 
                zoom={zoom} 
                orientation="portrait" // 🚨 MAGIC FIX: Locks the Android hardware buffer upright!
              />
            </View>
          </PinchGestureHandler>
        ) : (
          <View style={styles.center}><AppActivityIndicator /></View>
        )}
        
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconGlass}>
            <Icon name="arrow-left" size={24} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setCameraPosition(p => p === 'back' ? 'front' : 'back')} style={styles.iconGlass}>
            <Icon name="camera-flip" size={24} color="#FFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.cameraBottomBar}>
          <TouchableOpacity onPress={openGallery} style={styles.galleryBtn}>
            <Icon name="image-multiple" size={24} color="#FFF" />
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.shutterOuterGlass} onPress={handleTakePhoto} activeOpacity={0.8}>
            <View style={styles.shutterInner} />
          </TouchableOpacity>
          
          <View style={{ width: 44 }} />
        </View>
        <GlassyErrorModal visible={!!modalMessage} message={modalMessage || ''} onClose={() => setModalMessage(null)} />
      </View>
    );
  }

  if (viewState === 'preview') {
    return (
      <View style={styles.root}>
        <Image source={{ uri: mediaUri! }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => setViewState('camera')} style={styles.iconGlass}>
            <Icon name="close" size={24} color="#FFF" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.nextArrowBtn} onPress={() => setViewState('details')} activeOpacity={0.8}>
          <Icon name="arrow-right" size={28} color="#0F172A" />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.topBarDetails}>
        <TouchableOpacity onPress={() => setViewState('preview')} style={styles.iconGlass}>
          <Icon name="arrow-left" size={24} color="#FFF" />
        </TouchableOpacity>
        <AppText style={{ color: '#F9FAFB', fontSize: 18, fontWeight: '700' }}>New Post</AppText>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAvoidingView 
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
      >
        <ScrollView 
          contentContainerStyle={{ flexGrow: 1, padding: 20 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.captionContainer}>
            <Image source={{ uri: mediaUri! }} style={styles.thumbImage} />
            
            <View style={styles.captionWrapper}>
              <Text style={styles.captionOverlay} pointerEvents="none">
                {caption.length === 0 ? (
                  <Text style={styles.captionPlaceholder}>Write a caption... add hashtags!</Text>
                ) : (
                  caption.split(/(#[a-zA-Z0-9_]+)/g).map((part, i) =>
                    part.startsWith('#') ? (
                      <Text key={i} style={styles.hashtagText}>{part}</Text>
                    ) : (
                      <Text key={i} style={styles.plainCaptionText}>{part}</Text>
                    )
                  )
                )}
              </Text>

              <TextInput
                style={styles.captionInput}
                value={caption}
                onChangeText={setCaption}
                multiline
                placeholder=""
                placeholderTextColor="rgba(255,255,255,0)"
                cursorColor="#F8FAFC"
                selectionColor="#fff"
                underlineColorAndroid="transparent"
                autoCorrect={false} 
                spellCheck={false}
              />
            </View>
          </View>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.detailRow} onPress={() => setHabitModalVisible(true)} activeOpacity={0.7}>
            <View style={styles.detailIconCircle}>
              <Icon name={selectedHabit ? (selectedHabit.icon || 'check') : 'format-list-checks'} size={20} color="#C4B5FD" />
            </View>
            <AppText style={styles.detailRowText}>
              {selectedHabit ? (selectedHabit.habitName || selectedHabit.label) : "Select Activity (Required)"}
            </AppText>
            <Icon name="chevron-right" size={24} color="#64748B" />
          </TouchableOpacity>

          <View style={styles.detailRow}>
            <View style={[styles.detailIconCircle, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
              <Icon name="eye-outline" size={20} color="#38BDF8" />
            </View>
            <AppText style={styles.detailRowText}>Visible to: <AppText style={{fontWeight: '700', color: '#E5E7EB'}}>{privacyScope.toUpperCase()}</AppText></AppText>
          </View>

          <TouchableOpacity 
            style={[styles.postButton, !selectedHabit && { backgroundColor: '#334155', shadowOpacity: 0 }]} 
            disabled={!selectedHabit || uploading} 
            onPress={handlePost}
            activeOpacity={0.8}
          >
            {uploading ? (
              <AppActivityIndicator color="#FFF" size={24} />
            ) : (
              <AppText style={{ color: '#FFF', fontWeight: 'bold', fontSize: 16 }}>Share Post</AppText>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={habitModalVisible} transparent animationType="slide">
        <View style={styles.modalContainer}>
          <View style={styles.modalGlassCard}>
            <AppText style={styles.modalTitle}>Select Activity</AppText>
            <View style={styles.searchWrapper}>
              <Icon name="magnify" size={18} color="#6B7280" style={{ marginRight: 6 }} />
              <TextInput
                style={styles.searchBar}
                value={search}
                onChangeText={(txt) => {
                  setSearch(txt);
                  fetchHabits(txt);
                }}
                placeholder="Search activity..."
                placeholderTextColor="#6B7280"
              />
            </View>
            
            {habitsLoading ? (
              <View style={styles.modalLoading}><AppActivityIndicator /></View>
            ) : (
              <SectionList
                sections={habitSections}
                keyExtractor={item => item.id}
                renderSectionHeader={({ section }) => (
                  <View style={styles.sectionHeader}>
                    <AppText style={styles.sectionHeaderText}>{section.title}</AppText>
                  </View>
                )}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.habitItem}
                    onPress={() => {
                      setSelectedHabit(item);
                      setHabitModalVisible(false);
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={styles.habitIconCircle}>
                        <Icon name={item.icon || 'check'} size={20} color="#C4B5FD" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <AppText style={styles.habitNameText}>{item.label || item.habitName}</AppText>
                        {item.time && <AppText style={styles.habitTimeText}>{item.time}</AppText>}
                      </View>
                    </View>
                  </TouchableOpacity>
                )}
                contentContainerStyle={{ paddingBottom: 12 }}
                showsVerticalScrollIndicator={false}
              />
            )}
            <TouchableOpacity style={styles.modalClose} onPress={() => setHabitModalVisible(false)}>
              <AppText style={styles.modalCloseText}>Cancel</AppText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <GlassyErrorModal visible={!!modalMessage} message={modalMessage || ''} onClose={() => setModalMessage(null)} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: APP_BG },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  
  topBar: { position: 'absolute', top: Platform.OS === 'ios' ? 50 : 50, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between' },
  topBarDetails: {marginTop:15 , flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 50 : 30, paddingBottom: 15, backgroundColor: APP_BG },
  iconGlass: { width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(15, 23, 42, 0.4)', borderWidth: 1, borderColor: 'rgba(148, 163, 184, 0.4)', justifyContent: 'center', alignItems: 'center' },

  cameraBottomBar: { position: 'absolute', bottom: 40, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  galleryBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(15, 23, 42, 0.6)', borderWidth: 1, borderColor: 'rgba(148, 163, 184, 0.4)', justifyContent: 'center', alignItems: 'center' },
  shutterOuterGlass: { width: 78, height: 78, borderRadius: 39, borderWidth: 3, borderColor: 'rgba(191, 219, 254, 0.8)', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15, 23, 42, 0.7)', shadowColor: '#60A5FA', shadowOpacity: 0.6, shadowOffset: { width: 0, height: 12 }, shadowRadius: 24, elevation: 10 },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#F9FAFB' },

  nextArrowBtn: { position: 'absolute', bottom: 40, right: 30, width: 60, height: 60, borderRadius: 30, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowOffset: { width: 0, height: 5 }, shadowRadius: 10, elevation: 8 },

  captionContainer: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20 },
  thumbImage: { width: 80, height: 100, borderRadius: 12, backgroundColor: '#1E293B', borderWidth: 1, borderColor: 'rgba(148, 163, 184, 0.3)' },

  captionWrapper: { 
    flex: 1, 
    marginLeft: 16, 
    minHeight: 100,
    position: 'relative',
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
  },
  captionOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    padding: CAPTION_PADDING,
    fontSize: CAPTION_FONT_SIZE,
    lineHeight: CAPTION_LINE_HEIGHT,
    margin: 0,
    includeFontPadding: false,
    zIndex: 2,
    elevation: 2,
  },
  captionPlaceholder: {
    color: '#94A3B8',
    fontSize: CAPTION_FONT_SIZE,
    lineHeight: CAPTION_LINE_HEIGHT,
  },
  hashtagText: {
    fontWeight: 'bold',
    color: '#C4B5FD',
    fontSize: CAPTION_FONT_SIZE,
    lineHeight: CAPTION_LINE_HEIGHT,
  },
  plainCaptionText: {
    color: '#F8FAFC',
    fontSize: CAPTION_FONT_SIZE,
    lineHeight: CAPTION_LINE_HEIGHT,
  },
  captionInput: {
    flex: 1,
    minHeight: 100,
    fontSize: CAPTION_FONT_SIZE,
    lineHeight: CAPTION_LINE_HEIGHT,
    textAlignVertical: 'top',
    padding: CAPTION_PADDING,
    margin: 0,
    includeFontPadding: false,
    color: 'rgba(255, 255, 255, 0.02)',
    backgroundColor: 'transparent',
    zIndex: 1,
    elevation: 1,
  },

  divider: { height: 1, backgroundColor: 'rgba(148, 163, 184, 0.15)', marginBottom: 20 },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(148, 163, 184, 0.15)' },
  detailIconCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(139, 92, 246, 0.15)', justifyContent: 'center', alignItems: 'center' },
  detailRowText: { flex: 1, marginLeft: 14, color: '#9CA3AF', fontSize: 15 },
  postButton: { backgroundColor: '#7C3AED', paddingVertical: 16, borderRadius: 16, alignItems: 'center', marginTop: 40, shadowColor: '#7C3AED', shadowOpacity: 0.4, shadowOffset: { width: 0, height: 6 }, shadowRadius: 12, elevation: 8 },

  modalContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 16, paddingBottom: 50 },
  modalGlassCard: { width: '100%', maxHeight: '75%', borderRadius: 24, padding: 16, backgroundColor: GLASS_BG, borderWidth: 1, borderColor: GLASS_BORDER },
  modalTitle: { color: '#F9FAFB', fontSize: 18, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  searchWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.9)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(148,163,184,0.6)', marginBottom: 10 },
  searchBar: { flex: 1, color: '#F9FAFB', fontSize: 14, paddingVertical: 6 },
  modalLoading: { alignItems: 'center', paddingVertical: 20 },
  sectionHeader: { paddingVertical: 8, backgroundColor: 'transparent' },
  sectionHeaderText: { color: '#9CA3AF', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  habitItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(148, 163, 184, 0.1)" },
  habitIconCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(55,65,81,0.9)', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  habitNameText: { color: '#E5E7EB', fontSize: 15, fontWeight: '600' },
  habitTimeText: { color: '#9CA3AF', fontSize: 12, marginTop: 2 },
  modalClose: { marginTop: 12, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 999, backgroundColor: 'rgba(239, 68, 68, 0.15)', borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.4)' },
  modalCloseText: { color: '#FCA5A5', fontSize: 14, fontWeight: '600' },
});

export default ProofVisionCameraScreen;