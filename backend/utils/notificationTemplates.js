export const TEMPLATES = {
  // ── Streaks ──

  STREAK_REMINDER: (name, streak) => ({
    title: `🔥 Keep your ${streak}-day streak alive!`,
    body: `You're doing great, ${name}. Check in today and keep the momentum going.`,
    type: 'streak_reminder',
  }),

  STREAK_ENDING: (name, streak) => ({
    title: `⏰ Last chance, ${name}!`,
    body: `Your ${streak}-day streak expires soon. Open the app before midnight.`,
    type: 'streak_ending',
  }),

  STREAK_LOST: (name) => ({
    title: `💔 Your streak has ended`,
    body: `Every great streak starts with a single day. Start a new one today, ${name}.`,
    type: 'streak_lost',
  }),

  STREAK_MILESTONE: (name, streak) => ({
    title: `🎉 ${streak} days in a row!`,
    body: `Amazing work, ${name}. You're building a powerful habit.`,
    type: 'streak_milestone',
  }),

  // ── Relationships ──

  RELATIONSHIP_REQUEST: (fromName) => ({
    title: `💌 New relationship request`,
    body: `${fromName} wants to start a relationship with you.`,
    type: 'relationship_request',
  }),

  RELATIONSHIP_ACCEPTED: (fromName) => ({
    title: `💖 Relationship started!`,
    body: `${fromName} accepted your relationship request. You both are now in relationship.`,
    type: 'relationship_accepted',
  }),

  RELATIONSHIP_SUSPENDED: (fromName) => ({
    title: `⚠️ Relationship suspended`,
    body: `${fromName} suspended your relationship. You both are now in the grace period.`,
    type: 'relationship_suspended',
  }),

  RELATIONSHIP_ENDED: (fromName) => ({
    title: `💔 Relationship broken`,
    body: `Your relationship with ${fromName} has broken.`,
    type: 'relationship_ended',
  }),

  RELATIONSHIP_RESTORED: (fromName) => ({
    title: `❤️‍🩹 Relationship patched`,
    body: `${fromName} patched relationship with you. Your streak is safe!`,
    type: 'relationship_restored',
  }),

  // ── Leaderboard ──

  LEADERBOARD_REFRESH: () => ({
    title: `🏆 New leaderboard rankings are live`,
    body: `Check your position and see who's leading this month.`,
    type: 'leaderboard_refresh',
  }),

  LEADERBOARD_RANK_UP: (name, oldRank, newRank) => ({
    title: `📈 Nice climb, ${name}!`,
    body: `You moved from #${oldRank} to #${newRank}. Keep pushing higher.`,
    type: 'leaderboard_rank_up',
  }),

  LEADERBOARD_RANK_DOWN: (name, rank) => ({
    title: `📉 You've dropped to #${rank}`,
    body: `A little effort can get you back up the rankings.`,
    type: 'leaderboard_rank_down',
  }),

  // ── Friends ──

  FRIEND_REQUEST_SENT: (fromName) => ({
    title: `👋 New friend request`,
    body: `${fromName} wants to connect with you.`,
    type: 'friend_request',
  }),

  FRIEND_REQUEST_ACCEPTED: (fromName) => ({
    title: `🤝 Friend request accepted`,
    body: `${fromName} and you both are friends now.`,
    type: 'friend_accepted',
  }),

  FRIEND_REQUEST_DECLINED: (fromName) => ({
    title: `Request declined`,
    body: `${fromName} declined your friend request.`,
    type: 'friend_declined',
  }),

  FRIEND_REMOVED: (name) => ({
    title: `Friend removed`,
    body: `${name} is no longer connected with you.`,
    type: 'friend_removed',
  }),

  // ── Mood Map ──

  MOOD_MAP_UPDATE: () => ({
    title: `🌍 Mood Map updated`,
    body: `See how people around the world are feeling right now.`,
    type: 'mood_map',
  }),

  MOOD_MAP_TRENDING: (mood) => ({
    title: `✨ ${mood} is trending`,
    body: `People everywhere are sharing this mood. Explore the Mood Map.`,
    type: 'mood_map_trending',
  }),

  // ── Challenges & Points ──

  DAILY_CHALLENGE: () => ({
    title: `⚡ Daily challenge available`,
    body: `Complete today's challenge and earn extra points.`,
    type: 'daily_challenge',
  }),

  CHALLENGE_COMPLETED: (name, points) => ({
    title: `✅ Challenge completed`,
    body: `Great job, ${name}! You earned ${points} points.`,
    type: 'challenge_completed',
  }),

  POINTS_MILESTONE: (name, points) => ({
    title: `🎯 ${points.toLocaleString()} points reached`,
    body: `Congratulations, ${name}! You've reached a major milestone.`,
    type: 'points_milestone',
  }),

  // ── Weekly ──

  WEEKLY_RECAP: (name, points) => ({
    title: `📊 Your weekly recap`,
    body: `${name}, you earned ${points} points this week. Check your progress.`,
    type: 'weekly_recap',
  }),

  WELCOME_BACK: (name) => ({
    title: `👋 We've missed you, ${name}!`,
    body: `It's been a while. Come back and see what's new.`,
    type: 'welcome_back',
  }),

  // ── Admin ──

  ADMIN_BROADCAST: (title, body) => ({
    title,
    body,
    type: 'admin_broadcast',
  }),

  ADMIN_DIRECT: (title, body) => ({
    title,
    body,
    type: 'admin_direct',
  }),
};