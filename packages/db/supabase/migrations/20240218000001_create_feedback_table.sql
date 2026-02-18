-- Create feedback table
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Allow anyone (authenticated or anonymous) to submit feedback
CREATE POLICY "Anyone can insert feedback"
  ON feedback
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Allow service role full access (for admin review)
CREATE POLICY "Service role full access"
  ON feedback
  TO service_role
  USING (true)
  WITH CHECK (true);
