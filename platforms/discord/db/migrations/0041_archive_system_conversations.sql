-- v2.0.39: archive existing Discord system-account conversations.
--
-- Discord's official system user (643945264868098049) delivers Trust & Safety
-- notices, gift receipts, etc. Those DMs should never sit in the operator's
-- inbox. New conversations are born archived (see upsertConversation); this
-- one-time sweep archives any that already exist.
UPDATE tenant_main.conversations
   SET label = 'archived'
 WHERE peer_discord_user_id = '643945264868098049'
   AND label <> 'archived';
