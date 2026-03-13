-- ============================================================================
-- Migration 006: Atomic point operations
-- Replaces client-side read-then-write patterns with atomic Postgres RPCs
-- to prevent race conditions in concurrent point mutations.
-- ============================================================================

-- 1. Redeem a reward — atomically deducts points and inserts the redemption.
--    Returns the new redemption row or raises an exception on insufficient balance.
CREATE OR REPLACE FUNCTION redeem_reward(
  p_member_id   uuid,
  p_reward_id   uuid,
  p_points_cost integer
)
RETURNS uuid
LANGUAGE plpgsql
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

-- 2. Refund points on rejection — atomically refunds and updates redemption status.
CREATE OR REPLACE FUNCTION refund_redemption(
  p_redemption_id uuid,
  p_approved_by   uuid
)
RETURNS void
LANGUAGE plpgsql
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

-- 3. Contribute points to a goal — atomically deducts from member and adds to goal.
--    Auto-completes the goal if target is reached.
CREATE OR REPLACE FUNCTION contribute_to_goal(
  p_member_id uuid,
  p_goal_id   uuid,
  p_points    integer
)
RETURNS jsonb
LANGUAGE plpgsql
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

-- 4. Transfer points between members (gifting) — atomic deduct + credit.
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

-- 5. Award bonus points — atomic increment (used by cron jobs).
--    Supports negative values for deductions. Floors points_balance at 0.
CREATE OR REPLACE FUNCTION award_bonus_points(
  p_member_id    uuid,
  p_bonus_points integer
)
RETURNS void
LANGUAGE plpgsql
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
