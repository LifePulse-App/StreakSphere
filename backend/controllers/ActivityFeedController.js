// controllers/ActivityFeedController.js
import Proof from "../models/ProofSchema.js";
import Comment from "../models/CommentSchema.js";
import User from "../models/UserSchema.js";
import mongoose from "mongoose";
import { sendCommentNotification, sendLikeNotification } from "./NotificationController.js";

// ==========================================
// 1. Fetch Activity Feed
// ==========================================
export const getFeed = async (req, res) => {
  try {
    const { tab = "foryou", page = 1, limit = 10 } = req.query;
    const userId = req.user._id;

    // Get user details including blocked arrays
    const currentUser = await User.findById(userId).select("city country friends blockedUsers blockedBy");
    const friendIds = currentUser?.friends.map(f => f.user) || [];

    // ⚡ Gather all blocked user IDs (both ways)
    const blockedIds = [
      ...(currentUser?.blockedUsers || []),
      ...(currentUser?.blockedBy || [])
    ].map(id => id.toString());

    // Safely filter out blocked friends
    const validFriendIds = friendIds.filter(fId => !blockedIds.includes(fId.toString()));

    // Base query: Only show verified proofs, excluding blocked users entirely
    let query = { 
      verified: true,
      adminRemoved: { $ne: true },
      user: { $nin: blockedIds } // ⚡ Block check applied globally
    };
    let sortLogic = { createdAt: -1 };

    // 🔥 STRICT TAB ROUTING TO PREVENT LEAKS & APPLY CASCADING PRIVACY
    if (tab === "foryou") {
      const forYouConditions = [
        { visibilityScope: { $in: ["world", "foryou"] } }
      ];
      
      if (currentUser?.country) {
        forYouConditions.push({ 
          visibilityScope: "country", 
          country: currentUser.country 
        });
      }
      
      if (currentUser?.city) {
        forYouConditions.push({ 
          visibilityScope: "city", 
          city: currentUser.city 
        });
      }
      
      if (validFriendIds.length > 0) {
        forYouConditions.push({ 
          user: { $in: validFriendIds }, 
          visibilityScope: { $ne: "private" } 
        });
      }

      query.$or = forYouConditions;
      
      // ⚡ FIX: Prioritize newest-to-oldest first, followed by engagement metrics as tie-breakers
      sortLogic = { createdAt: -1, likesCount: -1, commentsCount: -1 };

    } else if (tab === "world") {
      query.visibilityScope = { $in: ["world", "foryou"] };
      sortLogic = { createdAt: -1 };

    } else if (tab === "country") {
      query.country = currentUser?.country;
      // Country tab sees Country, World, and ForYou scopes
      query.visibilityScope = { $in: ["world", "foryou", "country"] };
      sortLogic = { createdAt: -1 };

    } else if (tab === "city") {
      query.city = currentUser?.city;
      // City tab sees City, Country, World, and ForYou scopes (Cascading downwards)
      query.visibilityScope = { $in: ["world", "foryou", "country", "city"] };
      sortLogic = { createdAt: -1 };

    } else if (tab === "friends") {
      query.user = { $in: validFriendIds };
      // Friends can see ANYTHING you post (world, country, city, friends) EXCEPT private
      query.visibilityScope = { $ne: "private" }; 
      sortLogic = { createdAt: -1 };
    }

    const skip = (page - 1) * limit;

    const posts = await Proof.find(query)
      .populate("user", "name username avatarUrl isVerified tick isPremium")
      .populate("adminRemoved")
      .sort(sortLogic)
      .skip(skip)
      .limit(parseInt(limit));

    // Format posts to match your React Native Frontend structure
    const formattedPosts = posts.map(post => {
      const isLiked = post.likes.includes(userId);

      return {
        id: post._id,
        user: {
          id: post.user._id,
          name: post.user.name,
          username: post.user.username,
          avatar: post.user.avatarUrl || "https://via.placeholder.com/150",
          isVerified: post.user.tick === "verified" || post.user.tick === "golden",
          tick: post.user.tick,           
          isPremium: post.user.isPremium, 
          isFriend: friendIds.some(id => id.toString() === post.user._id.toString()),
          requestSent: false 
        },
        mediaUrl: post.imageUrl,
        caption: post.caption || "Verified habit! 💪",
        likesCount: post.likesCount,
        isLiked: isLiked,
        commentsCount: post.commentsCount,
        visibilityScope: post.visibilityScope,
        city: post.city,
        country: post.country,
        isAIVerified: post.verified,
        adminRemoved: post.adminRemoved || false,
        createdAt: post.createdAt
      };
    });

    res.status(200).json({ success: true, posts: formattedPosts });
  } catch (error) {
    console.error("Feed Error:", error);
    res.status(500).json({ success: false, message: "Error fetching feed." });
  }
};

// ==========================================
// 2. Like / Unlike a Post
// ==========================================
export const toggleLikePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user._id;

    const post = await Proof.findById(postId);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });

    // Optional safety check: Prevent liking blocked user's post
    const currentUser = await User.findById(userId).select("blockedUsers blockedBy");
    const blockedIds = [...(currentUser?.blockedUsers || []), ...(currentUser?.blockedBy || [])].map(String);
    if (blockedIds.includes(post.user.toString())) {
      return res.status(403).json({ success: false, message: "Action restricted." });
    }

    const isLiked = post.likes.includes(userId);

    if (isLiked) {
      post.likes = post.likes.filter(id => id.toString() !== userId.toString());
      post.likesCount = Math.max(0, post.likesCount - 1);
    } else {
      post.likes.push(userId);
      post.likesCount += 1;

  // ⚡ NEW: Send Push Notification (Don't notify if liking own post)
      if (post.user.toString() !== userId.toString()) {
        const liker = await User.findById(userId).select("name username");
        const likerName = liker?.name || liker?.username || "Someone";
        // Do not await to avoid blocking the API response
        sendLikeNotification(post.user, likerName, post._id).catch(err => console.error("Push Error:", err));
      }
    }

    await post.save();

    res.status(200).json({ success: true, isLiked: !isLiked, likesCount: post.likesCount });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Error toggling like." });
  }
};

// ==========================================
// 3. Add a Comment (or Reply)
// ==========================================
export const addComment = async (req, res) => {
  try {
    const { postId } = req.params;
    const { text, parentId } = req.body;
    const userId = req.user._id;

    if (!text) return res.status(400).json({ success: false, message: "Comment text required" });

    const post = await Proof.findById(postId);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });

    const currentUser = await User.findById(userId).select("blockedUsers blockedBy");
    const blockedIds = [...(currentUser?.blockedUsers || []), ...(currentUser?.blockedBy || [])].map(String);
    if (blockedIds.includes(post.user.toString())) {
      return res.status(403).json({ success: false, message: "Action restricted." });
    }

    const newComment = await Comment.create({
      post: postId,
      user: userId,
      parentId: parentId || null,
      text: text,
    });

    post.commentsCount += 1;
    await post.save();

    await newComment.populate("user", "username avatarUrl tick isPremium");

    // ⚡ NEW: Send Push Notification (Don't notify if commenting on own post)
    if (post.user.toString() !== userId.toString()) {
      const commenterName = newComment.user.name || newComment.user.username || "Someone";
      sendCommentNotification(post.user, commenterName, post._id, text).catch(err => console.error("Push Error:", err));
    }

    const formattedComment = {
      id: newComment._id,
      postId: newComment.post,
      parentId: newComment.parentId,
      user: {
        id: newComment.user._id,
        username: newComment.user.username,
        avatar: newComment.user.avatarUrl,
        isVerified: newComment.user.tick === "verified" || newComment.user.tick === "golden",
        tick: newComment.user.tick,           
        isPremium: newComment.user.isPremium  
      },
      text: newComment.text,
      likesCount: 0,
      isLiked: false,
      createdAt: newComment.createdAt
    };

    res.status(201).json({ success: true, comment: formattedComment });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error adding comment." });
  }
};

// ==========================================
// 4. Get Post Comments
// ==========================================
export const getComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user._id;

    const currentUser = await User.findById(userId).select("blockedUsers blockedBy");
    const blockedIds = [...(currentUser?.blockedUsers || []), ...(currentUser?.blockedBy || [])].map(String);

    const comments = await Comment.find({ 
      post: postId,
      user: { $nin: blockedIds } // ⚡ Hide comments from blocked users
    })
      .populate("user", "username avatarUrl tick isPremium")
      .sort({ createdAt: -1 });

    const formattedComments = comments.map(c => ({
      id: c._id,
      postId: c.post,
      parentId: c.parentId,
      user: {
        id: c.user._id,
        username: c.user.username,
        avatar: c.user.avatarUrl,
        isVerified: c.user.tick === "verified" || c.user.tick === "golden",
        tick: c.user.tick,           
        isPremium: c.user.isPremium  
      },
      text: c.text,
      likesCount: c.likesCount,
      isLiked: c.likes.includes(userId),
      createdAt: c.createdAt 
    }));

    res.status(200).json({ success: true, comments: formattedComments });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching comments." });
  }
};

// ==========================================
// 5. Delete a Comment
// ==========================================
export const deleteComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user._id;

    const comment = await Comment.findById(commentId);
    if (!comment) return res.status(404).json({ success: false, message: "Comment not found" });

    const post = await Proof.findById(comment.post);

    const isCommentOwner = comment.user.toString() === userId.toString();
    const isPostOwner = post && post.user.toString() === userId.toString();
    const isAdmin = req.user.role === "admin" || req.user.isAdmin;

    if (!isCommentOwner && !isPostOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this comment." });
    }

    await Comment.deleteMany({ $or: [{ _id: commentId }, { parentId: commentId }] });

    if (post) {
      post.commentsCount = Math.max(0, post.commentsCount - 1);
      await post.save();
    }

    res.status(200).json({ success: true, message: "Comment deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting comment." });
  }
};

// ==========================================
// 6. Delete User Post (Profile Screen feature)
// ==========================================
export const deletePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user._id;

    const post = await Proof.findById(postId);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });

    if (post.user.toString() !== userId.toString() && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Not authorized to delete this post." });
    }

    await Proof.findByIdAndDelete(postId);
    await Comment.deleteMany({ post: postId });

    res.status(200).json({ success: true, message: "Post deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting post." });
  }
};

// ==========================================
// 7. Like / Unlike a Comment
// ==========================================
export const toggleLikeComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user._id;

    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }

    const isLiked = comment.likes.includes(userId);

    if (isLiked) {
      comment.likes = comment.likes.filter(id => id.toString() !== userId.toString());
      comment.likesCount = Math.max(0, comment.likesCount - 1);
    } else {
      comment.likes.push(userId);
      comment.likesCount += 1;
    }

    await comment.save();

    res.status(200).json({ 
      success: true, 
      isLiked: !isLiked, 
      likesCount: comment.likesCount 
    });
  } catch (error) {
    console.error("Toggle Like Comment Error:", error);
    res.status(500).json({ success: false, message: "Error toggling like on comment." });
  }
};

// ==========================================
// 8. Get Posts By Specific User (Profile screen)
// ==========================================
// ==========================================
// 8. Get Posts By Specific User (Profile screen)
// ==========================================
export const getUserPosts = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user._id;

    // ⚡ GUARD CLAUSE: Check if userId is a valid MongoDB ObjectId string
    if (!userId || userId === "undefined" || userId === "test123" || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid user ID format." });
    }

    // Get current user's blocked lists to prevent returning posts from/to blocked users
    const currentUser = await User.findById(currentUserId).select("blockedUsers blockedBy");
    const blockedIds = [
      ...(currentUser?.blockedUsers || []),
      ...(currentUser?.blockedBy || [])
    ].map(id => id.toString());

    // If the target user is blocked, return empty
    if (blockedIds.includes(userId)) {
      return res.status(200).json({ success: true, posts: [] });
    }

    // Query all verified posts belonging strictly to this user
    const posts = await Proof.find({ user: userId, verified: true })
      .populate("user", "name username avatarUrl isVerified tick isPremium avatarVersion adminRemoved")
      .sort({ createdAt: -1 });

    const formattedPosts = posts.map(post => {
      const isLiked = post.likes.includes(currentUserId);

      return {
        id: post._id,
        user: {
          id: post.user._id,
          name: post.user.name,
          username: post.user.username,
          avatar: post.user.avatarUrl || "https://via.placeholder.com/150",
          avatarVersion: post.user.avatarVersion || 1,
          adminRemoved: post.adminRemoved,
          isVerified: post.user.tick === "verified" || post.user.tick === "golden",
          tick: post.user.tick,           
          isPremium: post.user.isPremium, 
        },
        mediaUrl: post.imageUrl,
        caption: post.caption || "Verified habit! 💪",
        likesCount: post.likesCount,
        isLiked: isLiked,
        commentsCount: post.commentsCount,
        visibilityScope: post.visibilityScope,
        city: post.city,
        country: post.country,
        isAIVerified: post.verified,
        adminRemoved: post.adminRemoved || false,
        createdAt: post.createdAt
      };
    });

    res.status(200).json({ success: true, posts: formattedPosts });
  } catch (error) {
    console.error("User Posts Error:", error);
    res.status(500).json({ success: false, message: "Error fetching user posts." });
  }
};