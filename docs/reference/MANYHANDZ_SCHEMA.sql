-- ============================================================================
-- ManyHandz — Complete Database Schema
-- ============================================================================
-- Copy this file to: supabase/migrations/001_initial_schema.sql
-- This creates all tables, indexes, functions, triggers, RLS policies,
-- and seed data for the ManyHandz application.
-- ============================================================================

-- Enable required extensions
create extension if not exists "pgcrypto";

-- ============================================================================
-- TABLES
-- ============================================================================

-- profiles (extends Supabase auth.users)
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  full_name text,
  avatar_url text,
  stripe_customer_id text unique,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- webauthn_credentials (passkeys per user)
create table public.webauthn_credentials (
  id text primary key,                          -- credential ID (base64url)
  user_id uuid references auth.users(id) on delete cascade not null,
  public_key bytea not null,
  counter bigint default 0 not null,
  device_type text,                             -- 'singleDevice' | 'multiDevice'
  backed_up boolean default false,
  transports text[],                            -- e.g. ['internal', 'hybrid']
  friendly_name text,                           -- user-assigned name: "MacBook Touch ID"
  created_at timestamptz default now() not null,
  last_used_at timestamptz
);

-- webauthn_challenges (ephemeral challenge storage)
create table public.webauthn_challenges (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  challenge text not null,
  type text not null check (type in ('registration', 'authentication')),
  created_at timestamptz default now() not null,
  expires_at timestamptz default (now() + interval '5 minutes') not null
);

-- households
create table public.households (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  mode text not null default 'family' check (mode in ('family', 'roommate', 'office')),
  invite_code text unique not null default substring(md5(random()::text), 1, 8),
  timezone text not null default 'America/New_York',
  require_photo_proof boolean not null default false,
  require_approval boolean not null default true,
  leaderboard_visible boolean not null default true,
  allow_kid_gifting boolean not null default true,
  allow_kid_challenges boolean not null default false,
  allow_kid_competitions boolean not null default true,
  max_kid_competition_stakes integer not null default 50,
  ai_verification_enabled boolean not null default false,
  ai_verification_provider text default 'openai' check (ai_verification_provider in ('openai', 'anthropic')),
  ai_auto_approve_threshold integer not null default 85,
  ai_auto_reject_threshold integer not null default 40,
  ai_monthly_cost_cap_cents integer not null default 500,
  health_score integer not null default 100 check (health_score between 0 and 100),
  health_score_updated_at timestamptz default now() not null,
  created_by uuid references public.profiles(id) not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- members (junction between profiles and households)
create table public.members (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  display_name text not null,
  avatar_url text,
  bio text,
  birthday date,
  favorite_color text not null default '#6366f1',
  role text not null default 'roommate' check (role in ('parent', 'kid', 'roommate', 'manager', 'colleague')),
  points_balance integer not null default 0,
  total_xp integer not null default 0,
  current_level integer not null default 1,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  venmo_handle text,
  paypal_handle text,
  cashapp_handle text,
  apple_cash_phone text,
  is_active boolean not null default true,
  away_until date,
  away_reason text,
  mute_celebrations boolean not null default false,
  allowance_enabled boolean not null default false,
  allowance_payout_type text not null default 'money' check (allowance_payout_type in ('money', 'treat', 'gift', 'privilege', 'experience', 'custom')),
  allowance_amount_cents integer not null default 0,
  allowance_reward_description text,
  allowance_threshold_pct integer not null default 80 check (allowance_threshold_pct between 0 and 100),
  joined_at timestamptz default now() not null,
  unique(household_id, user_id)
);

-- chore_categories
create table public.chore_categories (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade,
  name text not null,
  icon text not null default 'home',
  color text not null default '#7aa8ff',
  is_default boolean not null default false
);

-- chores
create table public.chores (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade not null,
  category_id uuid references public.chore_categories(id) on delete set null,
  name text not null,
  description text,
  difficulty integer not null default 3 check (difficulty between 1 and 5),
  estimated_minutes integer not null default 15,
  icon text not null default 'sparkles',
  reference_photo_url text,
  ai_verification_enabled boolean not null default false,
  checklist jsonb not null default '[]',
  is_active boolean not null default true,
  created_by uuid references public.members(id) not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- rotation_groups
create table public.rotation_groups (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade not null,
  chore_id uuid references public.chores(id) on delete cascade not null,
  member_order jsonb not null default '[]',
  current_index integer not null default 0,
  rotation_type text not null default 'round_robin' check (rotation_type in ('round_robin', 'fixed')),
  frequency text not null default 'weekly' check (frequency in ('daily', 'weekly', 'biweekly', 'monthly')),
  start_date date not null default current_date,
  is_active boolean not null default true,
  created_at timestamptz default now() not null
);

-- assignments
create table public.assignments (
  id uuid default gen_random_uuid() primary key,
  chore_id uuid references public.chores(id) on delete cascade not null,
  household_id uuid references public.households(id) on delete cascade not null,
  assigned_to uuid references public.members(id) on delete cascade not null,
  rotation_group_id uuid references public.rotation_groups(id) on delete set null,
  due_date date not null,
  due_time time,
  original_due_date date,
  snooze_count integer not null default 0,
  checklist_progress jsonb not null default '[]',
  status text not null default 'pending' check (status in ('pending', 'completed', 'overdue', 'skipped', 'in_progress', 'snoozed_pending_approval')),
  skip_reason text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- completions
create table public.completions (
  id uuid default gen_random_uuid() primary key,
  assignment_id uuid references public.assignments(id) on delete cascade not null,
  completed_by uuid references public.members(id) on delete cascade not null,
  completed_at timestamptz default now() not null,
  before_photo_url text,
  after_photo_url text,
  extra_photo_urls jsonb not null default '[]',
  notes text,
  points_earned integer not null default 0,
  speed_bonus integer not null default 0,
  actual_minutes integer,
  approved_by uuid references public.members(id),
  approved_at timestamptz,
  rejection_reason text,
  needs_approval boolean not null default false,
  ai_verification_id uuid,
  status text not null default 'approved' check (status in ('pending_approval', 'approved', 'rejected', 'ai_approved'))
);

-- rewards
create table public.rewards (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade not null,
  name text not null,
  description text,
  icon text not null default 'gift',
  points_cost integer not null check (points_cost > 0),
  is_active boolean not null default true,
  created_by uuid references public.members(id) not null,
  created_at timestamptz default now() not null
);

-- reward_redemptions
create table public.reward_redemptions (
  id uuid default gen_random_uuid() primary key,
  reward_id uuid references public.rewards(id) on delete cascade not null,
  member_id uuid references public.members(id) on delete cascade not null,
  points_spent integer not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  redeemed_at timestamptz default now() not null,
  approved_by uuid references public.members(id),
  approved_at timestamptz
);

-- achievements
create table public.achievements (
  id uuid default gen_random_uuid() primary key,
  member_id uuid references public.members(id) on delete cascade not null,
  badge_key text not null,
  earned_at timestamptz default now() not null,
  unique(member_id, badge_key)
);

-- activity_feed
create table public.activity_feed (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade not null,
  member_id uuid references public.members(id) on delete set null,
  action_type text not null check (action_type in (
    'chore_completed', 'chore_assigned', 'chore_swapped', 'reward_redeemed',
    'member_joined', 'achievement_earned', 'streak_milestone', 'goal_progress',
    'goal_completed', 'level_up', 'payment_sent', 'announcement_posted',
    'points_gifted', 'birthday', 'household_milestone', 'challenge_created',
    'challenge_completed', 'competition_created', 'competition_accepted',
    'competition_completed', 'ai_verified', 'speed_bonus_earned',
    'settlement_created', 'settlement_settled', 'settlement_forgiven',
    'custom_badge_earned', 'bundle_completed', 'referral_reward',
    'quick_task_completed', 'assignment_snoozed', 'snooze_approved',
    'snooze_denied', 'poll_created', 'poll_closed'
  )),
  metadata jsonb not null default '{}',
  reactions jsonb not null default '{}',
  created_at timestamptz default now() not null
);

-- subscriptions (Stripe subscription state)
create table public.subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null unique,
  household_id uuid references public.households(id) on delete cascade not null,
  stripe_subscription_id text unique,
  stripe_customer_id text,
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete')),
  price_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_start timestamptz default now(),
  trial_end timestamptz default (now() + interval '14 days'),
  cancel_at_period_end boolean default false,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- goals (big-ticket goals that members work toward)
create table public.goals (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade not null,
  member_id uuid references public.members(id) on delete cascade not null,
  title text not null,
  description text,
  icon text not null default 'target',
  target_points integer not null check (target_points > 0),
  current_points integer not null default 0,
  monetary_value numeric(10,2),
  auto_contribute_enabled boolean not null default false,
  auto_contribute_percentage integer not null default 25 check (auto_contribute_percentage in (10, 25, 50, 75, 100)),
  status text not null default 'active' check (status in ('active', 'completed', 'canceled')),
  completed_at timestamptz,
  created_by uuid references public.members(id) not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- goal_contributions (tracks point deposits toward a goal)
create table public.goal_contributions (
  id uuid default gen_random_uuid() primary key,
  goal_id uuid references public.goals(id) on delete cascade not null,
  member_id uuid references public.members(id) on delete cascade not null,
  points integer not null check (points > 0),
  source text not null check (source in ('chore_completion', 'bonus', 'manual', 'transfer')),
  source_id uuid,
  created_at timestamptz default now() not null
);

-- push_subscriptions (Web Push API subscriptions per user)
create table public.push_subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz default now() not null
);

-- notification_preferences
create table public.notification_preferences (
  id uuid default gen_random_uuid() primary key,
  member_id uuid references public.members(id) on delete cascade not null unique,
  daily_reminder boolean not null default true,
  overdue_alerts boolean not null default true,
  chore_completed boolean not null default true,
  weekly_digest boolean not null default true,
  reward_notifications boolean not null default true,
  goal_milestones boolean not null default true,
  swap_requests boolean not null default true,
  announcements boolean not null default true,
  birthday_notifications boolean not null default true,
  gift_received boolean not null default true,
  challenge_notifications boolean not null default true,
  competition_notifications boolean not null default true,
  ai_verification_notifications boolean not null default true,
  weekly_report boolean not null default true,
  settlement_notifications boolean not null default true,
  comment_notifications boolean not null default true,
  shopping_list_notifications boolean not null default false,
  push_enabled boolean not null default false,
  email_enabled boolean not null default true,
  reminder_time time not null default '08:00',
  updated_at timestamptz default now() not null
);

-- point_gifts (member-to-member point gifting)
create table public.point_gifts (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade not null,
  from_member_id uuid references public.members(id) on delete cascade not null,
  to_member_id uuid references public.members(id) on delete cascade not null,
  points integer not null check (points > 0),
  note text,
  gift_type text not null default 'general' check (gift_type in ('general', 'birthday', 'thank_you', 'bonus')),
  created_at timestamptz default now() not null
);

-- bonus_challenges (limited-time household challenges)
create table public.bonus_challenges (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade not null,
  title text not null,
  description text,
  challenge_type text not null check (challenge_type in ('double_points', 'complete_count', 'no_overdue', 'custom')),
  target_value integer,
  bonus_points integer not null default 0,
  points_multiplier numeric(3,1) not null default 1.0,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'completed', 'failed', 'expired')),
  created_by uuid references public.members(id) not null,
  created_at timestamptz default now() not null
);

-- household_milestones (household-level achievement tracking)
create table public.household_milestones (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade not null,
  milestone_key text not null,
  earned_at timestamptz default now() not null,
  unique(household_id, milestone_key)
);

-- competitions (head-to-head challenges between two members)
create table public.competitions (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade not null,
  challenger_id uuid references public.members(id) on delete cascade not null,
  opponent_id uuid references public.members(id) on delete cascade not null,
  title text not null,
  competition_type text not null check (competition_type in ('most_points', 'most_completions', 'first_to_target', 'specific_chore_race')),
  target_value integer,
  chore_id uuid references public.chores(id) on delete set null,
  stakes_points integer not null default 0,
  stakes_description text,
  challenger_progress integer not null default 0,
  opponent_progress integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'active', 'completed', 'declined', 'expired')),
  winner_id uuid references public.members(id),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_at timestamptz default now() not null
);

-- ai_verifications (AI-powered photo analysis results)
create table public.ai_verifications (
  id uuid default gen_random_uuid() primary key,
  completion_id uuid references public.completions(id) on delete cascade not null,
  provider text not null default 'openai' check (provider in ('openai', 'anthropic')),
  model text not null,
  confidence_score numeric(5,2) not null check (confidence_score between 0 and 100),
  reference_match_score numeric(5,2) check (reference_match_score between 0 and 100),
  reasoning text not null,
  reference_comparison text,
  decision text not null check (decision in ('auto_approved', 'flagged_for_review', 'auto_rejected')),
  before_analysis text,
  after_analysis text,
  raw_response jsonb,
  cost_cents integer,
  created_at timestamptz default now() not null
);

-- weekly_reports (auto-generated weekly summaries)
create table public.weekly_reports (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade not null,
  week_start date not null,
  week_end date not null,
  report_data jsonb not null default '{}',
  ai_suggestions jsonb,
  mvp_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz default now() not null,
  unique(household_id, week_start)
);
-- report_data jsonb contains: per-member stats (completions, points, streak, grade,
-- fairness_delta, star_chore), household totals, milestones earned that week,
-- challenges completed.

-- settlements (ledger tracking who owes whom — money AND non-monetary)
create table public.settlements (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade not null,
  from_member_id uuid references public.members(id) on delete cascade not null,
  to_member_id uuid references public.members(id) on delete cascade not null,
  payout_type text not null default 'money' check (payout_type in ('money', 'treat', 'gift', 'privilege', 'experience', 'custom')),
  amount_cents integer check (amount_cents > 0),
  payout_description text,
  description text not null,
  source_type text not null check (source_type in ('goal_payout', 'competition', 'reward_redemption', 'allowance', 'manual')),
  source_id uuid,
  status text not null default 'pending' check (status in ('pending', 'settled', 'forgiven', 'declined')),
  settled_at timestamptz,
  settled_via text check (settled_via in ('venmo', 'paypal', 'cashapp', 'apple_cash', 'cash', 'in_person', 'other')),
  settled_note text,
  created_by uuid references public.members(id) not null,
  created_at timestamptz default now() not null
);
-- from_member_id = who OWES; to_member_id = who is OWED
-- amount_cents is nullable — only required for payout_type = 'money'
-- payout_description describes WHAT is owed in human terms

-- shopping_lists (shared household shopping/supply lists)
create table public.shopping_lists (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade not null,
  name text not null default 'Groceries',
  icon text not null default 'shopping-cart',
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  recurring_items jsonb not null default '[]',
  created_by uuid references public.members(id) not null,
  created_at timestamptz default now() not null
);
-- recurring_items stores auto-add rules:
-- [{"item_name": "Milk", "category": "dairy", "frequency_days": 5, "last_added": "2026-03-09"}, ...]

-- shopping_items (individual items within a shopping list)
create table public.shopping_items (
  id uuid default gen_random_uuid() primary key,
  list_id uuid references public.shopping_lists(id) on delete cascade not null,
  household_id uuid references public.households(id) on delete cascade not null,
  name text not null,
  quantity text,
  category text check (category in ('produce', 'dairy', 'meat', 'bakery', 'frozen', 'pantry', 'beverages', 'snacks', 'cleaning', 'household', 'personal', 'pets', 'other')),
  note text,
  is_checked boolean not null default false,
  checked_by uuid references public.members(id),
  checked_at timestamptz,
  assigned_to uuid references public.members(id),
  added_by uuid references public.members(id) not null,
  created_at timestamptz default now() not null
);

-- snooze_requests (approval-gated postpone requests for assignments)
create table public.snooze_requests (
  id uuid default gen_random_uuid() primary key,
  assignment_id uuid references public.assignments(id) on delete cascade not null,
  household_id uuid references public.households(id) on delete cascade not null,
  requested_by uuid references public.members(id) on delete cascade not null,
  reason text not null check (char_length(reason) <= 300),
  new_due_date date not null,
  new_due_time time,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  reviewed_by uuid references public.members(id),
  reviewed_at timestamptz,
  denial_reason text,
  created_at timestamptz default now() not null
);

-- assignment_comments (threaded comments on individual assignments)
create table public.assignment_comments (
  id uuid default gen_random_uuid() primary key,
  assignment_id uuid references public.assignments(id) on delete cascade not null,
  household_id uuid references public.households(id) on delete cascade not null,
  member_id uuid references public.members(id) on delete set null not null,
  body text not null check (char_length(body) <= 500),
  created_at timestamptz default now() not null
);

-- custom_badges (parent-created custom achievements)
create table public.custom_badges (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade not null,
  name text not null,
  description text not null,
  icon text not null default 'award',
  color text not null default '#f59e0b',
  criteria_type text not null check (criteria_type in ('manual', 'chore_count', 'category_count', 'streak', 'speed_bonus_count', 'points_total')),
  criteria_target integer,
  criteria_category_id uuid references public.chore_categories(id),
  is_active boolean not null default true,
  created_by uuid references public.members(id) not null,
  created_at timestamptz default now() not null
);

-- custom_badge_awards (tracking who earned which custom badge)
create table public.custom_badge_awards (
  id uuid default gen_random_uuid() primary key,
  badge_id uuid references public.custom_badges(id) on delete cascade not null,
  member_id uuid references public.members(id) on delete cascade not null,
  awarded_by uuid references public.members(id),
  awarded_at timestamptz default now() not null,
  unique(badge_id, member_id)
);

-- chore_bundles (grouping multiple chores into a single assignable unit)
create table public.chore_bundles (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade not null,
  name text not null,
  description text,
  icon text not null default 'layers',
  is_active boolean not null default true,
  created_by uuid references public.members(id) not null,
  created_at timestamptz default now() not null
);

-- chore_bundle_items (which chores belong to a bundle)
create table public.chore_bundle_items (
  id uuid default gen_random_uuid() primary key,
  bundle_id uuid references public.chore_bundles(id) on delete cascade not null,
  chore_id uuid references public.chores(id) on delete cascade not null,
  sort_order integer not null default 0,
  unique(bundle_id, chore_id)
);

-- quick_tasks (lightweight one-off to-dos, not structured chores)
create table public.quick_tasks (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade not null,
  title text not null,
  note text,
  assigned_to uuid references public.members(id),
  due_date date,
  due_time time,
  is_completed boolean not null default false,
  completed_by uuid references public.members(id),
  completed_at timestamptz,
  created_by uuid references public.members(id) not null,
  created_at timestamptz default now() not null
);

-- household_polls (quick votes / household polls)
create table public.household_polls (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade not null,
  question text not null check (char_length(question) <= 200),
  options jsonb not null default '[]',
  votes jsonb not null default '{}',
  allow_multiple boolean not null default false,
  is_anonymous boolean not null default false,
  closes_at timestamptz,
  is_closed boolean not null default false,
  created_by uuid references public.members(id) not null,
  created_at timestamptz default now() not null
);
-- options: [{"id": "uuid", "text": "Pizza"}, {"id": "uuid", "text": "Tacos"}, ...] (2-6 options)
-- votes: {"option_id_1": ["member_id_a", "member_id_b"], ...}

-- referral_codes (referral program tracking)
create table public.referral_codes (
  id uuid default gen_random_uuid() primary key,
  referrer_household_id uuid references public.households(id) on delete cascade not null,
  code text not null unique,
  uses integer not null default 0,
  max_uses integer not null default 10,
  is_active boolean not null default true,
  created_at timestamptz default now() not null
);

-- referral_redemptions (tracking who used which referral code)
create table public.referral_redemptions (
  id uuid default gen_random_uuid() primary key,
  referral_code_id uuid references public.referral_codes(id) on delete cascade not null,
  referred_household_id uuid references public.households(id) on delete cascade not null,
  referrer_credit_applied boolean not null default false,
  referred_credit_applied boolean not null default false,
  created_at timestamptz default now() not null,
  unique(referral_code_id, referred_household_id)
);

-- swap_requests (chore trade/swap system)
create table public.swap_requests (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade not null,
  requester_assignment_id uuid references public.assignments(id) on delete cascade not null,
  target_assignment_id uuid references public.assignments(id) on delete cascade,
  requester_id uuid references public.members(id) on delete cascade not null,
  target_id uuid references public.members(id) on delete cascade not null,
  message text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  created_at timestamptz default now() not null,
  resolved_at timestamptz
);

-- announcements (household pinned messages)
create table public.announcements (
  id uuid default gen_random_uuid() primary key,
  household_id uuid references public.households(id) on delete cascade not null,
  author_id uuid references public.members(id) on delete set null not null,
  title text not null,
  body text,
  priority text not null default 'normal' check (priority in ('normal', 'important', 'urgent')),
  pinned boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz default now() not null
);


-- ============================================================================
-- INDEXES
-- ============================================================================

create index idx_webauthn_user on public.webauthn_credentials(user_id);
create index idx_webauthn_challenge_user on public.webauthn_challenges(user_id);
create index idx_members_household on public.members(household_id);
create index idx_members_user on public.members(user_id);
create index idx_chores_household on public.chores(household_id);
create index idx_assignments_household on public.assignments(household_id);
create index idx_assignments_assigned_to on public.assignments(assigned_to);
create index idx_assignments_due_date on public.assignments(due_date);
create index idx_assignments_status on public.assignments(status);
create index idx_completions_assignment on public.completions(assignment_id);
create index idx_completions_completed_by on public.completions(completed_by);
create index idx_activity_feed_household on public.activity_feed(household_id);
create index idx_activity_feed_created on public.activity_feed(created_at);
create index idx_goals_household on public.goals(household_id);
create index idx_goals_member on public.goals(member_id);
create index idx_competitions_household on public.competitions(household_id);
create index idx_settlements_household on public.settlements(household_id);
create index idx_settlements_status on public.settlements(status);
create index idx_shopping_items_list on public.shopping_items(list_id);
create index idx_snooze_requests_assignment on public.snooze_requests(assignment_id);
create index idx_assignment_comments_assignment on public.assignment_comments(assignment_id);
create index idx_quick_tasks_household on public.quick_tasks(household_id);
create index idx_polls_household on public.household_polls(household_id);
create index idx_swap_requests_household on public.swap_requests(household_id);
create index idx_announcements_household on public.announcements(household_id);
create index idx_subscriptions_household on public.subscriptions(household_id);
create index idx_rotation_groups_household on public.rotation_groups(household_id);
create index idx_bonus_challenges_household on public.bonus_challenges(household_id);
create index idx_custom_badges_household on public.custom_badges(household_id);
create index idx_chore_bundles_household on public.chore_bundles(household_id);
create index idx_point_gifts_household on public.point_gifts(household_id);


-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Returns all household IDs the current user belongs to (RLS helper)
create or replace function public.user_household_ids()
returns uuid[] as $$
  select array_agg(household_id)
  from public.members
  where user_id = auth.uid() and is_active = true;
$$ language sql security definer stable;

-- Checks if a household has an active subscription (RLS helper)
create or replace function public.household_has_active_subscription(hid uuid)
returns boolean as $$
  select exists (
    select 1 from public.subscriptions
    where household_id = hid
      and (
        status in ('active', 'trialing')
        or (status = 'trialing' and trial_end > now())
      )
  );
$$ language sql security definer stable;

-- Returns effective permissions for a user in a household (RLS helper)
-- Implementation: look up the member's role and the household's mode,
-- then return a permissions record. Used by RLS policies.
create or replace function public.get_member_permissions(uid uuid, hid uuid)
returns jsonb as $$
declare
  member_role text;
  household_mode text;
begin
  select m.role, h.mode into member_role, household_mode
  from public.members m
  join public.households h on h.id = m.household_id
  where m.user_id = uid and m.household_id = hid and m.is_active = true;

  if member_role is null then return null; end if;

  return jsonb_build_object(
    'role', member_role,
    'mode', household_mode,
    'is_admin', (member_role in ('parent', 'manager')),
    'can_create_chores', (member_role not in ('kid', 'colleague')),
    'can_approve', (member_role in ('parent', 'manager')),
    'needs_approval', (household_mode = 'family' and member_role = 'kid')
  );
end;
$$ language plpgsql security definer stable;

-- Fairness scores for a date range
create or replace function public.get_fairness_scores(
  hid uuid, start_date date, end_date date
)
returns table (
  member_id uuid, display_name text, total_points bigint,
  percentage numeric, chore_count bigint
) as $$
  with member_points as (
    select
      a.assigned_to as member_id,
      sum(c.points_earned) as total_points,
      count(c.id) as chore_count
    from public.assignments a
    join public.completions c on c.assignment_id = a.id
    where a.household_id = hid
      and a.due_date between start_date and end_date
      and c.status in ('approved', 'ai_approved')
    group by a.assigned_to
  )
  select
    mp.member_id,
    m.display_name,
    mp.total_points,
    case when (select sum(total_points) from member_points) > 0
      then round(mp.total_points * 100.0 / (select sum(total_points) from member_points), 1)
      else 0
    end as percentage,
    mp.chore_count
  from member_points mp
  join public.members m on m.id = mp.member_id;
$$ language sql security definer stable;

-- Calculate level from XP
create or replace function public.calculate_level(xp integer)
returns integer as $$
begin
  return case
    when xp >= 80000 then 50
    when xp >= 45000 then 40
    when xp >= 22000 then 30
    when xp >= 14000 then 25
    when xp >= 8000 then 20
    when xp >= 4000 then 15
    when xp >= 1700 then 10
    when xp >= 1300 then 9
    when xp >= 1000 then 8
    when xp >= 700 then 7
    when xp >= 500 then 6
    when xp >= 350 then 5
    when xp >= 200 then 4
    when xp >= 120 then 3
    when xp >= 50 then 2
    else 1
  end;
end;
$$ language plpgsql immutable;


-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================
-- Enable RLS on EVERY table. Implement policies per the rules below.
-- Key principles:
--   1. Users can only access data for households they belong to
--   2. Family mode: parents have full admin; kids have restricted access
--   3. Roommate mode: all roommates are equal peers
--   4. Subscription-gated writes use household_has_active_subscription()
--   5. Use user_household_ids() for efficient household membership checks

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.webauthn_credentials enable row level security;
alter table public.webauthn_challenges enable row level security;
alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.chore_categories enable row level security;
alter table public.chores enable row level security;
alter table public.rotation_groups enable row level security;
alter table public.assignments enable row level security;
alter table public.completions enable row level security;
alter table public.rewards enable row level security;
alter table public.reward_redemptions enable row level security;
alter table public.achievements enable row level security;
alter table public.activity_feed enable row level security;
alter table public.subscriptions enable row level security;
alter table public.goals enable row level security;
alter table public.goal_contributions enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.point_gifts enable row level security;
alter table public.bonus_challenges enable row level security;
alter table public.household_milestones enable row level security;
alter table public.competitions enable row level security;
alter table public.ai_verifications enable row level security;
alter table public.weekly_reports enable row level security;
alter table public.settlements enable row level security;
alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;
alter table public.snooze_requests enable row level security;
alter table public.assignment_comments enable row level security;
alter table public.custom_badges enable row level security;
alter table public.custom_badge_awards enable row level security;
alter table public.chore_bundles enable row level security;
alter table public.chore_bundle_items enable row level security;
alter table public.quick_tasks enable row level security;
alter table public.household_polls enable row level security;
alter table public.referral_codes enable row level security;
alter table public.referral_redemptions enable row level security;
alter table public.swap_requests enable row level security;
alter table public.announcements enable row level security;

-- ============================================================================
-- RLS POLICY RULES (implement as CREATE POLICY statements):
--
-- PROFILES: readable by household co-members only. Users can update own profile.
--
-- WEBAUTHN_CREDENTIALS: users can only CRUD their own (user_id = auth.uid())
-- WEBAUTHN_CHALLENGES: users can only CRUD their own. Periodically clean expired.
--
-- HOUSEHOLDS: readable by members. Writable by admins (parent/manager) or any roommate.
--
-- MEMBERS: readable by household co-members. Insertable on join. Updatable by
--   self (profile fields) or admins (role changes). Deletable by admins.
--
-- CHORES, ROTATION_GROUPS: readable by household members. Writable by admins
--   (family) or any roommate. INSERT/UPDATE gated by household_has_active_subscription().
--
-- ASSIGNMENTS: readable by household members. Writable by admins or roommates.
--   INSERT/UPDATE gated by subscription. Kids can update their own (status, checklist_progress).
--
-- COMPLETIONS: readable by household members. Insertable by the assigned member
--   on their own assignments. Updatable by admins (approve/reject).
--
-- REWARDS, REWARD_REDEMPTIONS: readable by household members. Rewards writable
--   by parents only. Redemptions insertable by any member (family mode).
--   INSERT gated by subscription.
--
-- GOALS, GOAL_CONTRIBUTIONS: readable by household members. Goals writable by
--   admins; members can create goals for themselves. Contributions insertable
--   by the goal's member. INSERT gated by subscription.
--
-- SETTLEMENTS: readable by household members. In family mode, only parents create
--   (except auto-created via triggers). In roommate mode, any member. Only
--   from_member can mark settled; only to_member or parent can forgive.
--
-- SHOPPING_LISTS/ITEMS: all household members can read/write. Family mode: only
--   parents delete entire lists. INSERT gated by subscription.
--
-- ASSIGNMENT_COMMENTS: all household members can read/insert. Only author or
--   parent/admin can delete.
--
-- CUSTOM_BADGES/AWARDS: readable by household members. Family: only parents
--   create/manage. Roommate: any member (if achievements enabled).
--
-- CHORE_BUNDLES/ITEMS: readable by household members. Writable by parents or
--   roommates. INSERT gated by subscription.
--
-- QUICK_TASKS: all household members can CRUD. INSERT gated by subscription.
--
-- SNOOZE_REQUESTS: readable by household members. Insertable by assigned member.
--   Family mode: only parents approve/deny. Roommate: auto-approved.
--
-- HOUSEHOLD_POLLS: readable by household members. Family: parents create/close.
--   Roommate: any member. INSERT gated by subscription.
--
-- REFERRAL_CODES/REDEMPTIONS: readable by household members. Managed by system.
--
-- ACTIVITY_FEED: readable by household members. Insertable by system/triggers.
--   Reactions (jsonb update) by any household member.
--
-- SUBSCRIPTIONS: readable by the subscription owner. Writable by system only
--   (webhook handler uses service client).
--
-- PUSH_SUBSCRIPTIONS, NOTIFICATION_PREFERENCES: users can only CRUD their own.
--
-- COMPETITIONS, BONUS_CHALLENGES, HOUSEHOLD_MILESTONES, AI_VERIFICATIONS,
-- WEEKLY_REPORTS, ACHIEVEMENTS, POINT_GIFTS, SWAP_REQUESTS, ANNOUNCEMENTS:
--   readable by household members. Writable per mode/role rules.
--   INSERT gated by subscription where applicable.
-- ============================================================================

-- Implement all policies above as CREATE POLICY statements.
-- Pattern for household-scoped read:
--   CREATE POLICY "members_select" ON public.members FOR SELECT
--     USING (household_id = ANY(user_household_ids()));
--
-- Pattern for subscription-gated write:
--   CREATE POLICY "chores_insert" ON public.chores FOR INSERT
--     WITH CHECK (
--       household_id = ANY(user_household_ids())
--       AND household_has_active_subscription(household_id)
--     );


-- ============================================================================
-- TRIGGERS
-- ============================================================================
-- Implement each trigger as a PL/pgSQL function + trigger statement.
-- See MANYHANDZ_SPEC.md "Triggers" section for full behavioral specs.
--
-- Required triggers:
--
-- 1. on auth.users INSERT → auto-create profiles row
--
-- 2. on completions INSERT →
--    - Update member points_balance AND total_xp
--    - Update assignment status to 'completed'
--    - Check/update current_streak and longest_streak
--    - Check for level-ups (calculate_level)
--    - Insert activity_feed entry
--    - Check for achievement unlocks
--    - Auto-contribute to active goals if member has auto-save enabled
--    - If active double_points challenge, multiply points by multiplier
--    - Check household total completions against milestone thresholds
--    - Check if member has active competitions; update progress
--    - Check custom badges with automatic criteria types
--
-- 3. on reward_redemptions INSERT →
--    - Deduct points from member
--    - Insert activity_feed entry
--    - Auto-create settlement for parent to fulfill (family mode)
--
-- 4. on assignments UPDATE (status → overdue) →
--    - Insert activity_feed entry
--    - Reset member current_streak to 0
--
-- 5. on goal_contributions INSERT →
--    - Update goal current_points
--    - Check if goal completed
--    - Insert activity_feed for milestones (25%, 50%, 75%, 100%)
--
-- 6. on members INSERT → create default notification_preferences row
--
-- 7. on households INSERT →
--    - Auto-generate referral code (MANYHANDZ- + 4 random chars)
--    - Auto-create default shopping list ("Groceries")
--
-- 8. on point_gifts INSERT →
--    - Deduct from sender, add to receiver
--    - Insert activity_feed entry
--
-- 9. on ai_verifications INSERT →
--    - Update linked completion status based on AI decision
--    - If auto_approved: award points
--    - If flagged: set pending_approval
--    - If auto_rejected: set rejected with reasoning
--
-- 10. on settlements INSERT → insert activity_feed entry, push notification
-- 11. on settlements UPDATE (→ settled) → activity_feed + push
-- 12. on settlements UPDATE (→ forgiven) → activity_feed + push
-- 13. on custom_badge_awards INSERT → activity_feed + push
-- 14. on quick_tasks UPDATE (is_completed → true) → activity_feed
-- 15. on assignment_comments INSERT → push notification
-- 16. on snooze_requests INSERT (pending) → push to parents
-- 17. on snooze_requests UPDATE (→ approved) → update assignment, activity_feed, push
-- 18. on snooze_requests UPDATE (→ denied) → activity_feed, push with reason
-- 19. on household_polls INSERT → activity_feed + push
-- 20. on household_polls UPDATE (is_closed → true) → activity_feed with results
-- 21. on bundle last item completed → activity_feed + 10% bonus points


-- ============================================================================
-- SEED DATA
-- ============================================================================

-- Default chore categories (global, household_id = null)
insert into public.chore_categories (id, household_id, name, icon, color, is_default) values
  (gen_random_uuid(), null, 'Kitchen',      'utensils',    '#f59e0b', true),
  (gen_random_uuid(), null, 'Bathroom',     'bath',        '#3b82f6', true),
  (gen_random_uuid(), null, 'Living Areas', 'sofa',        '#8b5cf6', true),
  (gen_random_uuid(), null, 'Bedroom',      'bed-double',  '#ec4899', true),
  (gen_random_uuid(), null, 'Outdoor',      'trees',       '#22c55e', true),
  (gen_random_uuid(), null, 'Laundry',      'shirt',       '#06b6d4', true),
  (gen_random_uuid(), null, 'Pets',         'dog',         '#f97316', true),
  (gen_random_uuid(), null, 'General',      'home',        '#6b7280', true);
