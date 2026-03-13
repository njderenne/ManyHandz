-- ============================================================================
-- Migration 008: Add missing indexes for frequently queried columns
--
-- These indexes cover columns that are used in WHERE/JOIN/ORDER BY clauses
-- across cron jobs, hooks, and page queries but lacked dedicated indexes.
-- ============================================================================

-- completions: filtered by status in report generation, challenges, and year-in-review
CREATE INDEX IF NOT EXISTS idx_completions_status
  ON public.completions(status);

-- completions: filtered by completed_at range in report generation and year-in-review
CREATE INDEX IF NOT EXISTS idx_completions_completed_at
  ON public.completions(completed_at);

-- bonus_challenges: filtered by status in check-challenges cron
CREATE INDEX IF NOT EXISTS idx_bonus_challenges_status
  ON public.bonus_challenges(status);

-- competitions: filtered by status in check-competitions cron
CREATE INDEX IF NOT EXISTS idx_competitions_status
  ON public.competitions(status);

-- reward_redemptions: filtered by status in use-rewards hook (pending redemptions)
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_status
  ON public.reward_redemptions(status);

-- reward_redemptions: joined/filtered by member_id in redemptions query
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_member
  ON public.reward_redemptions(member_id);

-- rewards: filtered by household_id in use-rewards hook
CREATE INDEX IF NOT EXISTS idx_rewards_household
  ON public.rewards(household_id);

-- goal_contributions: joined by goal_id in use-goals hook
CREATE INDEX IF NOT EXISTS idx_goal_contributions_goal
  ON public.goal_contributions(goal_id);

-- weekly_reports: filtered by household_id in reports page
CREATE INDEX IF NOT EXISTS idx_weekly_reports_household
  ON public.weekly_reports(household_id);

-- weekly_reports: filtered by week_start/week_end for idempotency checks
CREATE INDEX IF NOT EXISTS idx_weekly_reports_week
  ON public.weekly_reports(household_id, week_start, week_end);

-- settlements: filtered by source_type + to_member_id for allowance idempotency
CREATE INDEX IF NOT EXISTS idx_settlements_source_type
  ON public.settlements(source_type);

-- ai_verifications: filtered by assignment_id in completion flow
CREATE INDEX IF NOT EXISTS idx_ai_verifications_assignment
  ON public.ai_verifications(assignment_id);

-- assignments: filtered by rotation_group_id in rotate-assignments cron
CREATE INDEX IF NOT EXISTS idx_assignments_rotation_group
  ON public.assignments(rotation_group_id);
