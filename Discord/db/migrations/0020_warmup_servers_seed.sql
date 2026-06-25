-- 0020_warmup_servers_seed.sql
--
-- v0.70: initial seed of public Discord servers for warmup activity. These
-- are large, well-known communities with low moderation barriers, no phone-
-- verification gate at join, and active general-chat channels.
--
-- Invite codes are the path component of discord.gg/<code>. If any one of
-- these servers tightens its join requirements or starts banning fresh
-- accounts en masse, set active=false rather than removing the row — that
-- preserves the audit trail.
--
-- default_channel_id is left NULL initially; operator can populate via
-- /app/warmup admin once an account successfully joins each. The warmup
-- engine's pickRecentChannelForAccount skips servers without it.

INSERT INTO tenant_main.warmup_servers (invite_code, label, category, default_channel_id, notes) VALUES
  ('discord-developers',   'Discord Developers',    'tech',      NULL, 'Discord''s own dev community — large, generally lax'),
  ('python',               'Python',                'tech',      NULL, 'r/python community server'),
  ('javascript',           'JavaScript',            'tech',      NULL, 'JS community'),
  ('reactiflux',           'Reactiflux',            'tech',      NULL, 'React/JS chat'),
  ('rust-lang-community',  'Rust Community',        'tech',      NULL, NULL),
  ('typescript',           'TypeScript',            'tech',      NULL, NULL),
  ('chess',                'Chess',                 'gaming',    NULL, 'Chess.com official'),
  ('minecraft',            'Minecraft',             'gaming',    NULL, 'Official Mojang community'),
  ('valorant',             'VALORANT',              'gaming',    NULL, 'Riot Games official'),
  ('genshinimpact',        'Genshin Impact',        'gaming',    NULL, NULL),
  ('roblox',               'Roblox',                'gaming',    NULL, NULL),
  ('overwatch',            'Overwatch',             'gaming',    NULL, NULL),
  ('crypto',               'Crypto General',        'crypto',    NULL, NULL),
  ('ethereum',             'Ethereum',              'crypto',    NULL, NULL),
  ('solana',               'Solana',                'crypto',    NULL, NULL),
  ('chillzone',            'Chill Zone',            'community', NULL, 'General chat'),
  ('hangout',              'Hangout',               'community', NULL, NULL),
  ('chillchat',            'Chill Chat',            'community', NULL, NULL),
  ('study',                'Study Together',        'community', NULL, NULL),
  ('memes',                'Memes',                 'community', NULL, NULL),
  ('art',                  'Art',                   'community', NULL, NULL),
  ('music',                'Music',                 'community', NULL, NULL),
  ('fitness',              'Fitness',               'community', NULL, NULL),
  ('anime',                'Anime',                 'community', NULL, NULL),
  ('lounge',               'Lounge',                'community', NULL, NULL)
ON CONFLICT (invite_code) DO NOTHING;
