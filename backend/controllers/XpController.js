import mongoose from "mongoose";
import User from "../models/UserSchema.js";
import Habit from "../models/HabitSchema.js";
import Proof from "../models/ProofSchema.js";
import Mood from "../models/MoodSchema.js";
import { calculateXpProgress } from "../helpers/levels.js";

export const HABIT_XP = {
  // MOVEMENT / FITNESS
  pushups: { base: 30, verified: 40 },
  pullups: { base: 35, verified: 45 },
  situps: { base: 25, verified: 35 },
  plank: { base: 20, verified: 30 },
  squats: { base: 30, verified: 40 },
  lunges: { base: 25, verified: 35 },
  deadlifts: { base: 40, verified: 50 },
  bench_press: { base: 40, verified: 50 },
  yoga: { base: 25, verified: 35 },
  meditation: { base: 15, verified: 20 },
  running: { base: 30, verified: 40 },
  jogging: { base: 25, verified: 35 },
  walking: { base: 10, verified: 20 },
  cycling: { base: 30, verified: 40 },
  swimming: { base: 35, verified: 45 },
  jump_rope: { base: 20, verified: 30 },
  stretching: { base: 15, verified: 25 },
  tai_chi: { base: 20, verified: 30 },
  football: { base: 25, verified: 35 },
  basketball: { base: 25, verified: 35 },
  tennis: { base: 25, verified: 35 },
  badminton: { base: 20, verified: 30 },
  table_tennis: { base: 15, verified: 25 },
  boxing: { base: 30, verified: 40 },
  martial_arts: { base: 30, verified: 40 },
  dance_practice: { base: 20, verified: 30 },
  mountain_climbing: { base: 35, verified: 45 },
  canoeing: { base: 25, verified: 35 },
  skating: { base: 20, verified: 30 },
  parkour: { base: 25, verified: 35 },
  hiking: { base: 30, verified: 40 },
  pilates: { base: 25, verified: 35 },
  calisthenics: { base: 25, verified: 35 },
  surfing: { base: 30, verified: 40 },
  climbing: { base: 30, verified: 40 },
  obstacle_course: { base: 30, verified: 40 },
  gymnastics: { base: 30, verified: 40 },
  jumping_jacks: { base: 15, verified: 25 },
  burpees: { base: 20, verified: 30 },
  walk_the_dog: { base: 10, verified: 20 },
  skiing: { base: 25, verified: 35 },
  rowing: { base: 30, verified: 40 },
  parcours: { base: 30, verified: 40 },
  standup_paddle: { base: 20, verified: 30 },
  handstand: { base: 15, verified: 25 },
  park_workout: { base: 25, verified: 35 },

  // HEALTH / NUTRITION
  drink_water: { base: 5, verified: 10 },
  drink_tea: { base: 5, verified: 10 },
  drink_coffee: { base: 5, verified: 10 },
  eat_breakfast: { base: 10, verified: 20 },
  eat_lunch: { base: 10, verified: 20 },
  eat_dinner: { base: 10, verified: 20 },
  eat_snack: { base: 8, verified: 15 },
  eat_fruit: { base: 10, verified: 20 },
  eat_vegetables: { base: 10, verified: 20 },
  no_junk_food: { base: 15, verified: 25 },
  cook_at_home: { base: 15, verified: 25 },
  meal_prep: { base: 20, verified: 30 },
  take_vitamins: { base: 10, verified: 20 },
  brush_teeth: { base: 5, verified: 10 },
  floss_teeth: { base: 5, verified: 10 },
  skincare_routine: { base: 10, verified: 20 },
  weigh_yourself: { base: 5, verified: 10 },
  track_calories: { base: 10, verified: 20 },
  eat_whole_grains: { base: 10, verified: 20 },
  eat_protein: { base: 10, verified: 20 },
  avoid_sugar: { base: 10, verified: 20 },
  hydrate_regularly: { base: 5, verified: 15 },
  eat_nuts: { base: 10, verified: 20 },
  eat_salad: { base: 10, verified: 20 },
  fermented_food: { base: 12, verified: 18 },
  drink_smoothie: { base: 8, verified: 16 },
  eat_fish: { base: 12, verified: 20 },
  meal_log: { base: 10, verified: 20 },

  // SLEEP & RECOVERY
  go_to_bed_early: { base: 20, verified: 0 },
  wake_up_early: { base: 20, verified: 0 },
  power_nap: { base: 10, verified: 0 },
  set_alarm: { base: 5, verified: 0 },
  sleep_stretch: { base: 10, verified: 0 },

  // LEARNING / MENTAL
  reading: { base: 15, verified: 25 },
  study: { base: 20, verified: 30 },
  online_course: { base: 20, verified: 30 },
  language_learning: { base: 20, verified: 30 },
  journal: { base: 10, verified: 20 },
  gratitude_journal: { base: 10, verified: 20 },
  planning_day: { base: 10, verified: 20 },
  coding_practice: { base: 25, verified: 35 },
  music_practice: { base: 20, verified: 30 },
  draw_paint: { base: 15, verified: 25 },
  play_instrument: { base: 15, verified: 25 },
  chess_practice: { base: 12, verified: 20 },
  puzzle_solving: { base: 12, verified: 20 },
  research_topic: { base: 12, verified: 22 },
  memorize: { base: 8, verified: 20 },
  watch_documentary: { base: 12, verified: 22 },
  flashcards: { base: 10, verified: 18 },
  mental_math: { base: 12, verified: 18 },
  visualization: { base: 8, verified: 16 },

  // WORK / PRODUCTIVITY
  deep_work: { base: 25, verified: 35 },
  no_phone_distraction: { base: 15, verified: 25 },
  check_email_once: { base: 10, verified: 20 },
  daily_review: { base: 15, verified: 25 },
  clean_desk: { base: 10, verified: 20 },
  organize_files: { base: 10, verified: 20 },
  clear_inbox: { base: 8, verified: 18 },
  write_report: { base: 12, verified: 22 },
  sync_calendar: { base: 8, verified: 16 },
  backup_files: { base: 8, verified: 12 },
  focus_block: { base: 16, verified: 24 },
  meeting_prep: { base: 12, verified: 18 },
  review_goals: { base: 10, verified: 20 },

  // HOUSEHOLD / CHORES
  clean_room: { base: 15, verified: 25 },
  do_laundry: { base: 15, verified: 25 },
  wash_dishes: { base: 10, verified: 20 },
  make_bed: { base: 10, verified: 20 },
  take_out_trash: { base: 10, verified: 20 },
  grocery_shopping: { base: 15, verified: 25 },
  water_plants: { base: 10, verified: 20 },
  pet_care: { base: 15, verified: 25 },
  vacuum_house: { base: 12, verified: 22 },
  clean_bathroom: { base: 12, verified: 22 },
  dust_furniture: { base: 10, verified: 20 },
  organize_closet: { base: 10, verified: 20 },
  wash_windows: { base: 10, verified: 20 },
  mop_floor: { base: 10, verified: 20 },
  clean_fridge: { base: 10, verified: 20 },
  sort_mail: { base: 8, verified: 16 },
  declutter: { base: 12, verified: 22 },
  wash_car: { base: 10, verified: 20 },
  change_sheets: { base: 8, verified: 16 },
  empty_dishwasher: { base: 8, verified: 16 },

  // SOCIAL / FAMILY
  call_family: { base: 10, verified: 20 },
  meet_friend: { base: 10, verified: 20 },
  play_with_kids: { base: 15, verified: 25 },
  date_night: { base: 15, verified: 25 },
  cook_with_family: { base: 10, verified: 20 },
  eat_together: { base: 8, verified: 16 },
  story_time: { base: 8, verified: 16 },
  board_games: { base: 8, verified: 16 },
  family_walk: { base: 8, verified: 16 },
  send_message: { base: 5, verified: 10 },
  family_game: { base: 8, verified: 16 },
  celebrate: { base: 10, verified: 20 },

  // MINDFULNESS / SELF-CARE
  meditate: { base: 15, verified: 15 },
  breathing_exercise: { base: 10, verified: 15 },
  gratitude_practice: { base: 10, verified: 15 },
  digital_detox: { base: 15, verified: 25 },
  walk_in_nature: { base: 15, verified: 25 },
  mindful_eating: { base: 10, verified: 15 },
  body_scan: { base: 10, verified: 15 },
  hot_bath: { base: 12, verified: 22 },
  self_reflection: { base: 10, verified: 20 },
  read_affirmation: { base: 10, verified: 20 },

  // FINANCE & ADMIN
  track_expenses: { base: 15, verified: 25 },
  budget_review: { base: 15, verified: 25 },
  check_investments: { base: 10, verified: 20 },
  pay_bills: { base: 10, verified: 20 },
  review_transactions: { base: 10, verified: 20 },
  check_credit_score: { base: 8, verified: 16 },
  pay_debt: { base: 10, verified: 20 },
  save_money: { base: 10, verified: 20 },
  expense_report: { base: 8, verified: 16 },
  scan_receipts: { base: 8, verified: 16 },
  donate: { base: 15, verified: 25 },

  // CREATIVE / HOBBIES
  photography_practice: { base: 15, verified: 25 },
  video_editing: { base: 20, verified: 30 },
  gaming: { base: 10, verified: 20 },
  cooking_practice: { base: 15, verified: 25 },
  baking: { base: 15, verified: 25 },
  gardening: { base: 15, verified: 25 },
  art_practice: { base: 15, verified: 25 },
  lego_building: { base: 10, verified: 20 },
  crafts: { base: 12, verified: 22 },
  woodworking: { base: 12, verified: 22 },
  scrapbooking: { base: 10, verified: 20 },
  writing_poetry: { base: 10, verified: 20 },
  paint_miniatures: { base: 10, verified: 20 },
  write_blog: { base: 10, verified: 20 },
  knitting: { base: 10, verified: 20 },
  origami: { base: 10, verified: 20 },

  // COMMUTE / ERRANDS
  bike_to_work: { base: 15, verified: 25 },
  walk_to_work: { base: 10, verified: 20 },
  public_transport: { base: 5, verified: 10 },
  book_appointment: { base: 8, verified: 16 },
  collect_parcel: { base: 8, verified: 16 },
  return_items: { base: 8, verified: 16 },
  fill_gas: { base: 8, verified: 16 },
  maintenance_car: { base: 10, verified: 20 },

  // FAITH / SPIRITUAL
  fajr: { base: 10, verified: 15 },
  dhuhr: { base: 10, verified: 15 },
  asr: { base: 10, verified: 15 },
  maghrib: { base: 10, verified: 15 },
  isha: { base: 10, verified: 15 },
  tahajjud: { base: 12, verified: 20 },
  duha: { base: 12, verified: 20 },
  witr: { base: 12, verified: 20 },
  read_quran: { base: 12, verified: 20 },
  dua: { base: 10, verified: 15 },
  dhikr: { base: 10, verified: 15 },
  friday_prayer: { base: 15, verified: 25 },
  charity: { base: 15, verified: 25 },
  help_others: { base: 12, verified: 20 },
  read_scripture: { base: 15, verified: 25 },
  istikhara: { base: 12, verified: 20 },
  send_salawat: { base: 10, verified: 15 },
  make_wudu: { base: 8, verified: 15 },
  help_mosque: { base: 12, verified: 20 },
  feed_fast: { base: 12, verified: 20 },
  taraweeh: { base: 15, verified: 25 },
  qiyam: { base: 12, verified: 20 },
  eid_prayer: { base: 15, verified: 25 },
  visit_graveyard: { base: 10, verified: 20 },
  learn_dua: { base: 10, verified: 20 },
  teach_quran: { base: 12, verified: 20 },
  help_neighbor: { base: 10, verified: 15 },
  tasbeeh: { base: 10, verified: 15 },
  islamic_lecture: { base: 12, verified: 20 },
  quran_memorization: { base: 15, verified: 25 },
  istighfar: { base: 10, verified: 15 },
  prophet_story: { base: 12, verified: 20 },
  azkar_morning: { base: 8, verified: 15 },
  azkar_evening: { base: 8, verified: 15 },
  family_islamic: { base: 10, verified: 20 },
  fast_voluntary: { base: 12, verified: 20 },
  give_zakat: { base: 15, verified: 25 },
  morning_prayer_christian: { base: 10, verified: 15 },
  read_bible: { base: 12, verified: 20 },
  aarti: { base: 12, verified: 20 },
  read_bhagavad_gita: { base: 12, verified: 20 },
};

export const recalculateXp = async (userId) => {
  const objectId = new mongoose.Types.ObjectId(userId);

  // 1. Fetch user
  const user = await User.findById(objectId);
  if (!user) return null;

  let totalXp = 0;
  let monthlyXp = 0;

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  // ----- PROOFS -----
  const verifiedProofs = await Proof.find({
    user: objectId,
    verified: true,
  }).populate("habit");

  for (const proof of verifiedProofs) {
    // 1) Just read the hardcoded points from the database
    let itemXp = Number(proof.points || 0);

    // 2) Apply premium multiplier if applicable
    if (proof.isPremiumXP) {
      itemXp *= 2;
    }

    // Add to total
    totalXp += itemXp;

    // Add to monthly if it happened this month
    if (new Date(proof.createdAt) >= startOfMonth) {
      monthlyXp += itemXp;
    }
  }

  // ----- MOODS -----
  const moodDayAgg = await Mood.aggregate([
    { $match: { user: objectId } },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
          day: { $dayOfMonth: "$createdAt" },
        },
        createdAt: { $first: "$createdAt" },
        isPremiumXP: { $first: "$isPremiumXP" }, // ⚡ Grab premium flag for this mood
      },
    },
  ]);

  for (const dayMood of moodDayAgg) {
    let moodXp = 10; // Base points for mood

    // ⚡ ONLY MULTIPLY THIS SPECIFIC MOOD IF EARNED WHILE PREMIUM
    if (dayMood.isPremiumXP) {
      moodXp *= 2;
    }

    totalXp += moodXp;
    
    if (new Date(dayMood.createdAt) >= startOfMonth) {
      monthlyXp += moodXp;
    }
  }

  // ⚡ Save directly to database
  user.totalXp = totalXp;
  user.monthlyXp = monthlyXp;
  user.xp = totalXp; 

  // Levels and titles are now calculated using the highly accurate, mixed XP!
  const { level, title } = calculateXpProgress(totalXp);
  user.level = level;
  user.currentTitle = title;

  await user.save();

  return calculateXpProgress(totalXp);
};