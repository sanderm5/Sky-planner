-- Atomic TOTP attempt counter to prevent race conditions
-- Returns the new attempt count, or NULL if session not found or already at max

CREATE OR REPLACE FUNCTION increment_totp_attempts(
  session_id UUID,
  max_attempts INT DEFAULT 5
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_attempts INT;
BEGIN
  UPDATE totp_pending_sessions
  SET attempts = attempts + 1
  WHERE id = session_id
    AND attempts < max_attempts
  RETURNING attempts INTO new_attempts;

  RETURN new_attempts; -- NULL if no row matched (not found or at max)
END;
$$;
