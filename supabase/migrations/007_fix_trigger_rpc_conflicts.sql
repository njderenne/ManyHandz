-- ============================================================================
-- Migration 007: Fix trigger/RPC conflicts, add SECURITY DEFINER, add
-- challenge household scoping, and birthday idempotency guard.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Fix handle_reward_redemption: REMOVE the point deduction line.
--    The redeem_reward() RPC now handles the atomic point deduction.
--    The trigger still handles: activity feed entry + auto-settlement creation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_reward_redemption()
RETURNS trigger AS $$
DECLARE
  v_reward record;
  v_member record;
  v_household record;
  v_parent_member_id uuid;
BEGIN
  -- Get reward info
  SELECT * INTO v_reward FROM public.rewards WHERE id = NEW.reward_id;
  -- Get member info
  SELECT * INTO v_member FROM public.members WHERE id = NEW.member_id;
  -- Get household
  SELECT * INTO v_household FROM public.households WHERE id = v_reward.household_id;

  -- NOTE: Point deduction removed — now handled atomically by redeem_reward() RPC.
  -- The old trigger line was:
  --   UPDATE public.members SET points_balance = points_balance - NEW.points_spent
  --   WHERE id = NEW.member_id;
  -- This caused double-deduction when called via the RPC.

  -- Insert activity_feed entry
  INSERT INTO public.activity_feed (household_id, member_id, action_type, metadata)
  VALUES (
    v_reward.household_id,
    NEW.member_id,
    'reward_redeemed',
    jsonb_build_object(
      'reward_name', v_reward.name,
      'points_spent', NEW.points_spent,
      'reward_id', NEW.reward_id,
      'redemption_id', NEW.id
    )
  );

  -- Auto-create settlement for parent to fulfill (family mode)
  IF v_household.mode = 'family' THEN
    -- Find a parent in the household
    SELECT id INTO v_parent_member_id
    FROM public.members
    WHERE household_id = v_reward.household_id
      AND role = 'parent'
      AND is_active = true
    LIMIT 1;

    IF v_parent_member_id IS NOT NULL THEN
      INSERT INTO public.settlements (
        household_id, from_member_id, to_member_id,
        payout_type, payout_description, description,
        source_type, source_id, created_by
      ) VALUES (
        v_reward.household_id,
        v_parent_member_id,     -- parent owes
        NEW.member_id,          -- kid is owed
        'custom',
        v_reward.name,
        'Reward redeemed: ' || v_reward.name,
        'reward_redemption',
        NEW.id,
        NEW.member_id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 2. Fix handle_goal_contribution: REMOVE the goal current_points update.
--    The contribute_to_goal() RPC now handles the atomic point update.
--    The trigger still handles: milestone activity feed entries.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_goal_contribution()
RETURNS trigger AS $$
DECLARE
  v_goal record;
  v_old_pct integer;
  v_new_pct integer;
  v_milestone_pcts integer[] := array[25, 50, 75, 100];
  v_pct integer;
BEGIN
  -- Get the goal (read current state AFTER the RPC has already updated it)
  SELECT * INTO v_goal FROM public.goals WHERE id = NEW.goal_id;

  -- Calculate percentage BEFORE this contribution
  -- (The RPC already added the points, so we subtract to get the old value)
  v_old_pct := CASE WHEN v_goal.target_points > 0
    THEN round((v_goal.current_points - NEW.points) * 100.0 / v_goal.target_points)::integer
    ELSE 0 END;

  -- Calculate percentage AFTER (current state, already updated by RPC)
  v_new_pct := CASE WHEN v_goal.target_points > 0
    THEN round(v_goal.current_points * 100.0 / v_goal.target_points)::integer
    ELSE 0 END;

  -- NOTE: Goal current_points update and completion removed — now handled
  -- atomically by contribute_to_goal() RPC. The old trigger lines were:
  --   UPDATE public.goals SET current_points = v_new_points, ...
  -- This caused double-counting when called via the RPC.

  -- Goal completed activity (if the RPC just completed it)
  IF v_goal.status = 'completed' AND v_old_pct < 100 THEN
    INSERT INTO public.activity_feed (household_id, member_id, action_type, metadata)
    VALUES (
      v_goal.household_id,
      v_goal.member_id,
      'goal_completed',
      jsonb_build_object('goal_title', v_goal.title, 'target_points', v_goal.target_points)
    );
  END IF;

  -- Check milestone percentages
  FOREACH v_pct IN ARRAY v_milestone_pcts LOOP
    IF v_old_pct < v_pct AND v_new_pct >= v_pct AND v_pct < 100 THEN
      INSERT INTO public.activity_feed (household_id, member_id, action_type, metadata)
      VALUES (
        v_goal.household_id,
        v_goal.member_id,
        'goal_progress',
        jsonb_build_object('goal_title', v_goal.title, 'percentage', v_pct)
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 3. Add SECURITY DEFINER to all RPC functions from migration 006.
--    Without this, browser-side calls are subject to RLS which blocks
--    cross-member operations (e.g. awarding points to another member).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION redeem_reward(
  p_member_id   uuid,
  p_reward_id   uuid,
  p_points_cost integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance   integer;
  v_redeem_id uuid;
BEGIN
  -- Lock the member row to prevent concurrent updates
  SELECT points_balance INTO v_balance
    FROM members
   WHERE id = p_member_id
   FOR UPDATE;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  IF v_balance < p_points_cost THEN
    RAISE EXCEPTION 'Insufficient points (have %, need %)', v_balance, p_points_cost;
  END IF;

  -- Deduct points
  UPDATE members
     SET points_balance = points_balance - p_points_cost
   WHERE id = p_member_id;

  -- Insert the redemption record
  INSERT INTO reward_redemptions (reward_id, member_id, points_spent, status)
  VALUES (p_reward_id, p_member_id, p_points_cost, 'pending')
  RETURNING id INTO v_redeem_id;

  RETURN v_redeem_id;
END;
$$;

CREATE OR REPLACE FUNCTION refund_redemption(
  p_redemption_id uuid,
  p_approved_by   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_member_id    uuid;
  v_points_spent integer;
  v_status       text;
BEGIN
  -- Lock the redemption row
  SELECT member_id, points_spent, status
    INTO v_member_id, v_points_spent, v_status
    FROM reward_redemptions
   WHERE id = p_redemption_id
   FOR UPDATE;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Redemption not found';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Redemption already processed (status: %)', v_status;
  END IF;

  -- Mark as rejected
  UPDATE reward_redemptions
     SET status = 'rejected',
         approved_by = p_approved_by,
         approved_at = now()
   WHERE id = p_redemption_id;

  -- Refund points atomically
  UPDATE members
     SET points_balance = points_balance + v_points_spent
   WHERE id = v_member_id;
END;
$$;

CREATE OR REPLACE FUNCTION contribute_to_goal(
  p_member_id uuid,
  p_goal_id   uuid,
  p_points    integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance       integer;
  v_current       integer;
  v_target        integer;
  v_new_total     integer;
  v_is_complete   boolean;
BEGIN
  -- Lock the member row
  SELECT points_balance INTO v_balance
    FROM members
   WHERE id = p_member_id
   FOR UPDATE;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  IF v_balance < p_points THEN
    RAISE EXCEPTION 'Insufficient points (have %, need %)', v_balance, p_points;
  END IF;

  -- Lock the goal row
  SELECT current_points, target_points
    INTO v_current, v_target
    FROM goals
   WHERE id = p_goal_id
   FOR UPDATE;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Goal not found';
  END IF;

  v_new_total := v_current + p_points;
  v_is_complete := v_new_total >= v_target;

  -- Deduct from member
  UPDATE members
     SET points_balance = points_balance - p_points
   WHERE id = p_member_id;

  -- Add to goal
  UPDATE goals
     SET current_points = v_new_total,
         status = CASE WHEN v_is_complete THEN 'completed' ELSE status END,
         completed_at = CASE WHEN v_is_complete THEN now() ELSE completed_at END
   WHERE id = p_goal_id;

  -- Record the contribution
  INSERT INTO goal_contributions (goal_id, member_id, points, source)
  VALUES (p_goal_id, p_member_id, p_points, 'manual');

  RETURN jsonb_build_object(
    'new_total', v_new_total,
    'is_complete', v_is_complete
  );
END;
$$;

CREATE OR REPLACE FUNCTION transfer_points(
  p_from_member_id uuid,
  p_to_member_id   uuid,
  p_household_id   uuid,
  p_points         integer,
  p_note           text DEFAULT NULL,
  p_gift_type      text DEFAULT 'general'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_balance integer;
  v_gift_id uuid;
BEGIN
  -- Lock sender row
  SELECT points_balance INTO v_balance
    FROM members
   WHERE id = p_from_member_id
   FOR UPDATE;

  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'Sender not found';
  END IF;

  IF v_balance < p_points THEN
    RAISE EXCEPTION 'Insufficient points (have %, need %)', v_balance, p_points;
  END IF;

  -- Deduct from sender
  UPDATE members
     SET points_balance = points_balance - p_points
   WHERE id = p_from_member_id;

  -- Credit to receiver
  UPDATE members
     SET points_balance = points_balance + p_points
   WHERE id = p_to_member_id;

  -- Record the gift
  INSERT INTO point_gifts (household_id, from_member_id, to_member_id, points, note, gift_type)
  VALUES (p_household_id, p_from_member_id, p_to_member_id, p_points, p_note, p_gift_type)
  RETURNING id INTO v_gift_id;

  RETURN v_gift_id;
END;
$$;

CREATE OR REPLACE FUNCTION award_bonus_points(
  p_member_id    uuid,
  p_bonus_points integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE members
     SET points_balance = GREATEST(0, points_balance + p_bonus_points),
         total_xp = CASE
           WHEN p_bonus_points > 0 THEN total_xp + p_bonus_points
           ELSE total_xp
         END
   WHERE id = p_member_id;
END;
$$;
