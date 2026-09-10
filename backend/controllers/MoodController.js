import Mood from "../models/MoodSchema.js";
import User from "../models/UserSchema.js";
import Location from "../models/LocationSchema.js";
import { sendFriendBroadcastNotification } from "./NotificationController.js";

// POST /api/moods
// body: { mood: string }
const MOOD_TTL_MS = 24 * 60 * 60 * 1000;

export const createMood = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { mood } = req.body;

    if (!mood) {
      return res
        .status(400)
        .json({ success: false, message: "Mood is required" });
    }

    // ⚡ FIX: Select name, username, and friends!
    const user = await User.findById(userId).select("name username friends");
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const moodDoc = await Mood.create({
      user: userId,
      mood,
      expiresAt: new Date(Date.now() + MOOD_TTL_MS),
    });

    const location = await Location.findOne({ user: userId });

if (location?.coords) {
    req.io.emit("mood:update", {
        mood: moodDoc.mood,
        coords: location.coords,
        createdAt: moodDoc.createdAt,
        expiresAt: moodDoc.expiresAt,
    });
}

// ⚡ NEW: Send Push Notification to all friends
    const validFriends = user.friends?.map(f => f.user) || [];
    if (validFriends.length > 0) {
      const userName = user.name || user.username || "A friend";
      sendFriendBroadcastNotification(validFriends, {
        type: 'friend_mood',
        title: 'Mood Update 💭',
        body: `${userName} updated their mood.`,
      }).catch(err => console.error("Push Error:", err));
    }

    return res.status(201).json({
      success: true,
      message: "Mood logged successfully",
      data: {
        id: moodDoc._id,
        mood: moodDoc.mood,
        createdAt: moodDoc.createdAt,
        expiresAt: moodDoc.expiresAt,
      },
    });
  } catch (err) {
    console.error("Error creating mood:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to log mood" });
  }
};

export const getWorldMoods = async (req, res) => {
  try {
    const activeMoods = await Mood.find({
      expiresAt: { $gt: new Date() },
    }).select("user mood createdAt expiresAt");

    const userIds = activeMoods.map((m) => m.user);

    const locations = await Location.find({ user: { $in: userIds } })
      .select("user coords updatedAt")
      .sort({ updatedAt: -1 });

    const locMap = new Map();
    for (const loc of locations) {
      if (!locMap.has(String(loc.user))) {
        locMap.set(String(loc.user), loc);
      }
    }

    const data = activeMoods
      .map((m) => {
        const loc = locMap.get(String(m.user));
        if (!loc?.coords) return null;
        return {
          mood: m.mood,
          coords: loc.coords, // { lng, lat }
          createdAt: m.createdAt,
          expiresAt: m.expiresAt,
        };
      })
      .filter(Boolean);

    return res.json({ success: true, data });
  } catch (err) {
    console.error("Error fetching world moods:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to load moods" });
  }
};