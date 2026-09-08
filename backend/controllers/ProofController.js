import Proof from "../models/ProofSchema.js";
import Habit from "../models/HabitSchema.js";
import User from "../models/UserSchema.js";
import axios from "axios";
import { recalculateXp } from "./XpController.js";
import { getTimeSlotForDate } from "../utils/timeSlotCheck.js";
import fs from "fs";
import FormData from "form-data"; 
import { sendFriendBroadcastNotification } from "./NotificationController.js";

export const submitProof = async (req, res) => {
  try {
    // ⚡ 1. Extract caption and visibilityScope from req.body
    const { habitId, userId, caption: userCaption, visibilityScope } = req.body;
    
    if (!habitId || !req.file) {
      return res.status(400).json({ success: false, message: "habitId and proof image required." });
    }

    const habit = await Habit.findOne({ _id: habitId, active: true });
    if (!habit) return res.status(404).json({ success: false, message: "Habit not found." });

    const userDoc = await User.findById(userId);
    const xpMultEnabled = userDoc?.premiumPreferences?.xpMultiplier !== false;
    const isPremiumXP = !!(userDoc?.isPremium && xpMultEnabled);

    const currentSlot = getTimeSlotForDate(new Date());
    const expectedSlot = habit.timeSlot;
    const isTimeValid = !expectedSlot || currentSlot === expectedSlot;

    // ⚡ 2. Format the Final Caption (User's text + Activity Name)
    const habitName = habit.name || habit.title || habit.key; 
    let finalCaption = userCaption ? userCaption.trim() : "";
    
    // Automatically append the activity name so it always shows up in the feed
    if (finalCaption) {
      finalCaption += `\n\n— Activity: ${habitName}`;
    } else {
      finalCaption = `Completed Activity: ${habitName}`;
    }

    // ⚡ 3. Extract Hashtags from the final caption
    let extractedHashtags = [];
    const matches = finalCaption.match(/#[a-z0-9_]+/gi);
    if (matches) {
      // Remove '#' and make lowercase for clean database storage
      extractedHashtags = matches.map(tag => tag.replace('#', '').toLowerCase());
    }

    // ⚡ 4. Determine Privacy Scope (Request overrides default user settings)
    const finalVisibility = visibilityScope || userDoc.postVisibility || "friends";

    const proof = await Proof.create({
      user: userId,
      habit: habit._id,
      imageUrl: `/uploads/${req.file.filename}`, 
      status: "submitted",
      points: 1,
      verified: false,
      timeSlotAtProof: currentSlot,
      isPremiumXP: isPremiumXP,
      
      // ⚡ 5. Save the new social fields
      caption: finalCaption,
      hashtags: extractedHashtags,
      visibilityScope: finalVisibility, 
      city: userDoc.city || "",
      country: userDoc.country || ""
    });

    // Send image to FastAPI AI verification
    const formData = new FormData();
    formData.append("habitKey", habit.key);
    formData.append("image", fs.createReadStream(req.file.path));

    const aiRes = await axios.post("https://api-ai.streaksphere.app/verify", formData, {
      headers: formData.getHeaders(),
    });

    proof.status = aiRes.data.verified ? "verified" : "rejected";
    proof.points = aiRes.data.verified ? 50 : 1;
    proof.verified = !!aiRes.data.verified;
    proof.aiScore = aiRes.data.score;
    if (proof.verified) proof.verifiedAt = new Date();


      // ⚡ NEW: Notify all friends about the new post
      const validFriends = userDoc.friends?.map(f => f.user) || [];
      if (validFriends.length > 0) {
        const userName = userDoc.name || userDoc.username || "A friend";
        sendFriendBroadcastNotification(validFriends, {
          type: 'friend_post',
          title: 'New Post!',
          body: `${userName} uploaded a new post.`,
          postId: String(proof._id),
        }).catch(err => console.error("Push Error:", err));
      }
    

    await proof.save();

    if (proof.verified) await recalculateXp(userId);


    return res.json({
      success: true,
      status: proof.status,
      points: proof.points,
      proofId: proof._id,
      predictedActivity: aiRes.data.predictedActivity,
      predictedScore: aiRes.data.score
    });
  } catch (error) {
    console.error("Submit Proof Error:", error);
    return res.status(500).json({ success: false, message: "Failed to submit proof." });
  }
};