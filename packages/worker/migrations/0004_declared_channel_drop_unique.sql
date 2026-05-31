-- Discord-first redesign: a user's per-period payments can share ONE screenshot (one
-- settlement covers all their subscriptions), so screenshot_key is no longer unique.
-- Add the user-declared channel (declared at submit; verified channel is set on review).

ALTER TABLE payments ADD COLUMN declared_channel_tag_id INTEGER REFERENCES channel_tags(id);

-- Multiple payments may now legitimately point at the same screenshot_key.
DROP INDEX idx_payments_screenshot_key;
