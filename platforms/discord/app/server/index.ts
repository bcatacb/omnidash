/**
 * Discord Unibox SaaS - backend skeleton.
 *
 * This file is the result of stripping the Telegram-specific layer out of
 * the original 7500-line index.ts in tg-messaging-saas. It keeps the
 * generic SaaS scaffolding (auth, sessions, settings, api-keys, leads
 * status/CRUD) and exposes stub handlers for the Discord-specific
 * routes that will be wired up by a later agent.
 *
 * Every TODO(discord) comment marks a route surface that existed in the
 * Telegram codebase and needs a Discord-bridge implementation.
 */

import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import http from 'http';
import { statfsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { buildCsv } from './csv';
import { getRuntimeFlags } from './runtime_flags';
import {
  state as discordMockState,
  seed as discordMockSeed,
  createCampaign as mockCreateCampaign,
  startCampaign as mockStartCampaign,
  pauseCampaign as mockPauseCampaign,
  sendMessage as mockSendMessage,
  archiveConversation as mockArchiveConversation,
  createAccount as mockCreateAccount,
  updateAccountLabel as mockUpdateAccountLabel,
  disconnectAccount as mockDisconnectAccount,
  removeAccount as mockRemoveAccount,
  computeAccountAggregates,
  getCampaignDetail,
  createAccountFromQr,
  __rehydrateToken,
} from './discord-mock';
import { sseHandler, publishExternalEvent } from './realtime';
import {
  startSession as startQrSession,
  getSession as getQrSession,
  cancelSession as cancelQrSession,
  consumeCapturedToken,
  subscribe as subscribeQr,
  submitCaptcha as submitQrCaptcha,
} from './discord-remote-auth';
import { verifyDiscordToken } from './discord-token-login';
import { attachLiveAccount, detachLiveAccount } from './discord-live-account';
import { attachGateway, detachGateway, getAccountGuilds } from './discord-gateway';
import { startScheduler as startCampaignScheduler, clearAccountCooldowns, clearCampaignCooldown } from './campaign-engine';
import { listGuilds as listAccountGuilds, scrapeGuildMembers, scrapeGuildMembersSmart, joinByInvite, extractInviteCode } from './discord-scrape';
import { listCategories as listDiscoveryCategories, searchDiscoverableGuilds, joinDiscoverableGuild } from './discord-discovery';
// token-store.ts removed — tokens persisted in postgres since v0.7
import { shutdownTls } from './discord-http';
import { initTelegramNotifier } from './telegram-notifier';
import { closeAllBrowserContexts, browserWaveToUser } from './discord-browser';
import * as db from './db';
import { registerGroupRoutes } from './groups';
import { registerWarmupAdminRoutes } from './warmup-admin';
import { registerFrCampaignRoutes } from './fr-campaign-admin';

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

const UPLOADS_DIR = process.env.NODE_ENV === 'production' ? '/data/gg-api/uploads' : '/tmp/unibox-uploads';
mkdirSync(UPLOADS_DIR, { recursive: true });
// Public — Discord servers need to fetch these without auth headers.
app.use('/api/uploads', express.static(UPLOADS_DIR));

const supabaseUrl = process.env.SUPABASE_URL || 'http://localhost:54321';
const supabaseKey =
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.ANON_KEY ||
  '';

if (!supabaseKey || supabaseKey.includes('...')) {
  // Allow boot without supabase for skeleton compile/dev work, but log loudly.
  console.warn('[boot] SUPABASE key is not configured. Auth/database routes will return errors at runtime.');
}

const supabase = createClient(supabaseUrl, supabaseKey || 'placeholder');

const normalizeEmail = (email: string) => String(email || '').trim().toLowerCase();

const hashPassword = (password: string, salt = crypto.randomBytes(16).toString('hex')) => {
  const hash = crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
  return `${salt}:${hash}`;
};

const verifyPassword = (password: string, stored: string | null | undefined) => {
  if (!stored || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  return hashPassword(password, salt).split(':')[1] === expected;
};

const hashSessionToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const hashApiKeyToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

const DEFAULT_LEAD_STATUS_KEYS = ['lead', 'interested', 'meeting-booked', 'won', 'not-interested', 'wrong-person'];
const DEFAULT_LEAD_STATUS_SET = new Set(DEFAULT_LEAD_STATUS_KEYS);

const normalizeStatusKey = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/_/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'lead';

const formatStatusKeyLabel = (statusKey: string) =>
  normalizeStatusKey(statusKey)
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Lead';

const extractSessionToken = (req: Request) => {
  const headerToken = String(req?.headers?.['x-session-token'] || '').trim();
  if (headerToken) return headerToken;

  const cookieHeader = String(req?.headers?.cookie || '');
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const [rawKey, ...rest] = part.split('=');
      const key = String(rawKey || '').trim();
      if (key !== 'tg_saas_session') continue;
      const value = String(rest.join('=') || '').trim();
      if (!value) continue;
      return decodeURIComponent(value);
    }
  }

  const authHeader = String(req?.headers?.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return '';
};

const extractApiKeyToken = (req: Request) => {
  const headerToken = String(req?.headers?.['x-api-key'] || '').trim();
  if (headerToken) return headerToken;

  const authHeader = String(req?.headers?.authorization || '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) return '';
  const bearerValue = authHeader.slice(7).trim();
  return bearerValue.startsWith('tgsaas_') ? bearerValue : '';
};

const AUTH_PUBLIC_PATHS = new Set([
  '/auth/signin',
  '/auth/signup',
  '/auth/plans',
  '/auth/signout',
  '/auth/logout',
  '/docs',
  '/demo/state', // pingable from empty-state UI before login
]);

const isPublicApiPath = (path: string) => AUTH_PUBLIC_PATHS.has(path);

const SAFE_MESSAGES_PER_ACCOUNT_PER_DAY_MIN = 1;
const SAFE_MESSAGES_PER_ACCOUNT_PER_DAY_MAX = 10;
const SAFE_MESSAGES_MONTH_DAYS = 30;
const PLAN_SLOT_FALLBACKS: Record<string, number | null> = {
  launch: 15,
  growth: 30,
  scale: 45,
  enterprise: null,
};
const DEFAULT_USER_PREFERENCES = {
  plan_recommendations_enabled: true,
};

const normalizePlanFeatures = (features: unknown) =>
  Array.isArray(features) ? features.map((feature) => String(feature)) : [];

const extractAccountSlotLimit = (features: unknown, slug: string) => {
  const featureText = normalizePlanFeatures(features).join(' ');
  const match = featureText.match(/(\d+)\s+connected\s+(?:telegram|discord)\s+accounts/i);
  if (match) return Number(match[1]);
  return PLAN_SLOT_FALLBACKS[slug] ?? null;
};

const buildPlanSummary = (plan: any) => {
  if (!plan?.id || !plan?.slug) return null;
  const features = normalizePlanFeatures(plan.features);
  const accountSlotLimit = extractAccountSlotLimit(features, String(plan.slug));
  const monthlySafeMessagesMin = typeof accountSlotLimit === 'number'
    ? accountSlotLimit * SAFE_MESSAGES_PER_ACCOUNT_PER_DAY_MIN * SAFE_MESSAGES_MONTH_DAYS
    : null;
  const monthlySafeMessagesMax = typeof accountSlotLimit === 'number'
    ? accountSlotLimit * SAFE_MESSAGES_PER_ACCOUNT_PER_DAY_MAX * SAFE_MESSAGES_MONTH_DAYS
    : null;

  return {
    id: String(plan.id),
    slug: String(plan.slug),
    name: String(plan.name || plan.slug),
    price_monthly: Number(plan.price_monthly || 0),
    monthly_message_limit: Number(plan.monthly_message_limit || 0),
    lead_limit: Number(plan.lead_limit || 0),
    description: plan.description ? String(plan.description) : null,
    features,
    account_slot_limit: accountSlotLimit,
    monthly_safe_messages_min: monthlySafeMessagesMin,
    monthly_safe_messages_max: monthlySafeMessagesMax,
    safe_messages_per_account_per_day_min: SAFE_MESSAGES_PER_ACCOUNT_PER_DAY_MIN,
    safe_messages_per_account_per_day_max: SAFE_MESSAGES_PER_ACCOUNT_PER_DAY_MAX,
    is_custom: String(plan.slug) === 'enterprise' || Number(plan.price_monthly || 0) === 0,
  };
};

const loadUserPlanSummary = async (userId: string) => {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('user_subscriptions')
    .select(`
      status,
      current_period_start,
      current_period_end,
      plan:subscription_plans(id, slug, name, price_monthly, monthly_message_limit, lead_limit, description, features, is_active)
    `)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data?.plan) return null;
  const planSummary = buildPlanSummary(data.plan);
  if (!planSummary) return null;

  return {
    ...planSummary,
    subscription_status: data.status ? String(data.status) : 'active',
    current_period_start: data.current_period_start || null,
    current_period_end: data.current_period_end || null,
  };
};

const loadUserPreferences = async (userId: string) => {
  if (!userId) return DEFAULT_USER_PREFERENCES;
  const { data, error } = await supabase
    .from('user_preferences')
    .select('plan_recommendations_enabled')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return DEFAULT_USER_PREFERENCES;
  return {
    plan_recommendations_enabled: data.plan_recommendations_enabled !== false,
  };
};

const decorateAuthUser = async (user: any) => {
  if (!user?.id) return user;
  const [subscription, preferences] = await Promise.all([
    loadUserPlanSummary(String(user.id)),
    loadUserPreferences(String(user.id)),
  ]);

  return {
    ...user,
    subscription,
    preferences,
  };
};

async function resolveUserFromSessionToken(sessionToken: string) {
  if (!sessionToken) return null;

  const { data: session, error: sessionError } = await supabase
    .from('user_sessions')
    .select('user_id, expires_at')
    .eq('token_hash', hashSessionToken(sessionToken))
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (sessionError || !session?.user_id) return null;

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, email, first_name, last_name, is_active, is_admin')
    .eq('id', session.user_id)
    .eq('is_active', true)
    .maybeSingle();
  if (userError || !user) return null;

  return decorateAuthUser(user);
}

async function resolveUserFromApiKey(apiKeyToken: string) {
  if (!apiKeyToken) return null;

  const { data: apiKey, error: apiKeyError } = await supabase
    .from('api_keys')
    .select('id, user_id, revoked_at')
    .eq('token_hash', hashApiKeyToken(apiKeyToken))
    .is('revoked_at', null)
    .maybeSingle();
  if (apiKeyError || !apiKey?.user_id) return null;

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, email, first_name, last_name, is_active, is_admin')
    .eq('id', apiKey.user_id)
    .eq('is_active', true)
    .maybeSingle();
  if (userError || !user) return null;

  void supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', apiKey.id);

  return decorateAuthUser(user);
}

const getAuthUserId = (req: Request) => String(((req as any)?.authUser?.id) || '');


// REST API ENDPOINTS

// v0.7: real Postgres-backed auth. No demo bypass.
app.use('/api', async (req, res, next) => {
  try {
    if (isPublicApiPath(req.path)) return next();

    const sessionToken = extractSessionToken(req);
    if (!sessionToken) return res.status(401).json({ error: 'Authentication required' });

    const sessionUser = await db.getSessionUser(hashSessionToken(sessionToken));
    if (!sessionUser) return res.status(401).json({ error: 'Invalid or expired session' });
    const authUser = {
      id: sessionUser.id,
      email: sessionUser.email,
      role: sessionUser.role,
      tenant_id: sessionUser.tenant_id,
      subscription: { plan: 'main', status: 'active', current_period_end: null },
      preferences: {},
    };
    (req as any).authUser = authUser;
    return next();
    // legacy api-key + session path (unused in v0.7 — kept for future)
    const apiKeyToken = extractApiKeyToken(req);
    if (apiKeyToken) {
      const apiKeyUser = await resolveUserFromApiKey(apiKeyToken);
      if (!apiKeyUser) return res.status(401).json({ error: 'Invalid API key' });
      (req as any).authUser = apiKeyUser;
      return next();
    }

    if (!sessionToken) return res.status(401).json({ error: 'Authentication required' });

    const authUser2 = await resolveUserFromSessionToken(sessionToken);
    if (!authUser2) return res.status(401).json({ error: 'Invalid or expired session' });

    (req as any).authUser = authUser;
    next();
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to validate session' });
  }
});

// --- Auth / plans ---

app.get('/api/auth/plans', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('subscription_plans')
      .select('id, slug, name, price_monthly, monthly_message_limit, lead_limit, description, features')
      .eq('is_active', true)
      .order('price_monthly', { ascending: true });

    if (error) throw error;
    res.json((data || []).map((plan) => buildPlanSummary(plan)).filter(Boolean));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim();
    const planSlug = String(req.body?.plan || 'launch').trim() || 'launch';

    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email is required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    const [firstName, ...lastParts] = name.split(/\s+/).filter(Boolean);
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({
        email,
        username: email,
        password_hash: hashPassword(password),
        first_name: firstName || null,
        last_name: lastParts.join(' ') || null,
        is_active: true,
        is_admin: false,
      })
      .select('id, email, first_name, last_name')
      .single();
    if (userError) throw userError;

    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('id, slug, name')
      .eq('slug', planSlug)
      .maybeSingle();

    if (plan?.id) {
      await supabase
        .from('user_subscriptions')
        .upsert({ user_id: user.id, plan_id: plan.id, status: 'trialing' }, { onConflict: 'user_id' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    await supabase
      .from('user_sessions')
      .insert({
        user_id: user.id,
        token_hash: hashSessionToken(rawToken),
        expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
      });

    res.cookie('tg_saas_session', rawToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30,
      path: '/',
    });

    const decoratedUser = await decorateAuthUser(user);
    res.json({ token: rawToken, user: decoratedUser, plan: plan || null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/signin', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const user = await db.getUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashSessionToken(rawToken);
    const ttl = 1000 * 60 * 60 * 24 * 30; // 30 days
    await db.createSession(user.id, tokenHash, ttl, {
      ua: String(req.headers['user-agent'] || ''),
      ip: String(req.ip || req.socket?.remoteAddress || ''),
    });

    res.cookie('tg_saas_session', rawToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' && process.env.FORCE_SECURE_COOKIE === '1',
      sameSite: 'lax',
      maxAge: ttl,
      path: '/',
    });
    res.json({
      token: rawToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenant_id: user.tenant_id,
        subscription: { plan: 'main', status: 'active', current_period_end: null },
        preferences: {},
      },
    });
  } catch (err: any) {
    console.error('[auth/signin] error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'signin failed' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  const authUser = (req as any).authUser;
  if (!authUser) return res.status(401).json({ error: 'Authentication required' });
  res.json(authUser);
});

const clearUserSession = async (req: Request, res: Response) => {
  const sessionToken = extractSessionToken(req);
  if (sessionToken) {
    await db.deleteSession(hashSessionToken(sessionToken));
  }
  res.clearCookie('tg_saas_session', { path: '/' });
};

app.post('/api/auth/signout', async (req, res) => {
  try {
    await clearUserSession(req, res);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    await clearUserSession(req, res);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/default-user', async (req, res) => {
  try {
    const authUser = (req as any).authUser;
    if (!authUser) return res.status(401).json({ error: 'Authentication required' });
    res.json(authUser);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- Settings / profile / preferences ---

app.patch('/api/settings/profile', async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const fullNameRaw = String(req.body?.fullName || '').trim();
    const emailRaw = normalizeEmail(req.body?.email);

    if (!emailRaw || !emailRaw.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const [firstName, ...lastParts] = fullNameRaw.split(/\s+/).filter(Boolean);
    const updatePayload: Record<string, unknown> = {
      first_name: firstName || null,
      last_name: lastParts.join(' ') || null,
      email: emailRaw,
      username: emailRaw,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('users')
      .update(updatePayload)
      .eq('id', userId);

    if (error) {
      if (String(error.message || '').toLowerCase().includes('duplicate') || String((error as any).code || '') === '23505') {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }
      throw error;
    }

    const { data: updatedUser, error: fetchError } = await supabase
      .from('users')
      .select('id, email, first_name, last_name, is_active, is_admin')
      .eq('id', userId)
      .maybeSingle();

    if (fetchError) throw fetchError;

    const decoratedUser = await decorateAuthUser(updatedUser || {
      id: userId,
      email: emailRaw,
      first_name: firstName || null,
      last_name: lastParts.join(' ') || null,
      is_active: true,
      is_admin: false,
    });

    res.json(decoratedUser);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/settings/preferences', async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    res.json(await loadUserPreferences(userId));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/settings/preferences', async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const nextPreferences = {
      user_id: userId,
      plan_recommendations_enabled: req.body?.plan_recommendations_enabled !== false,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('user_preferences')
      .upsert(nextPreferences, { onConflict: 'user_id' });

    if (error) throw error;
    res.json(await loadUserPreferences(userId));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/settings/api-keys', async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const { data, error } = await supabase
      .from('api_keys')
      .select('id, name, token_prefix, created_at, last_used_at, revoked_at')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings/api-keys', async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const name = String(req.body?.name || '').trim() || 'Default key';
    const rawToken = `tgsaas_${crypto.randomBytes(24).toString('hex')}`;
    const tokenPrefix = `${rawToken.slice(0, 14)}...`;

    const { data, error } = await supabase
      .from('api_keys')
      .insert({
        user_id: userId,
        name,
        token_hash: hashApiKeyToken(rawToken),
        token_prefix: tokenPrefix,
        created_at: new Date().toISOString(),
      })
      .select('id, name, token_prefix, created_at, last_used_at, revoked_at')
      .single();
    if (error) throw error;

    res.json({
      ...data,
      token: rawToken,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/settings/api-keys/:id', async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const { id } = req.params;
    const { error } = await supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/settings/:key', async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const { key } = req.params;
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', key)
      .maybeSingle();

    if (error) throw error;
    res.json(data?.value || null);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings/:key', async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const { key } = req.params;
    const { value } = req.body;

    const { error } = await supabase
      .from('app_settings')
      .upsert({
        user_id: userId,
        key,
        value,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,key' });

    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── Image upload ──────────────────────────────────────────────────────────

app.post('/api/upload', async (req: Request, res: Response) => {
  const { data } = req.body || {};
  if (typeof data !== 'string') return res.status(400).json({ error: 'data required' }) as any;
  const m = data.match(/^data:(image\/(jpeg|jpg|png|gif|webp));base64,(.+)$/);
  if (!m) return res.status(400).json({ error: 'invalid image data URL' }) as any;
  const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 20 * 1024 * 1024) return res.status(400).json({ error: 'file too large (max 20 MB)' }) as any;
  const filename = `${crypto.randomUUID()}.${ext}`;
  await writeFile(path.join(UPLOADS_DIR, filename), buf);
  const proto = (req.get('x-forwarded-proto') || req.protocol) as string;
  const host = req.get('host') || '';
  res.json({ url: `${proto}://${host}/api/uploads/${filename}` });
});

// ── Content library ───────────────────────────────────────────────────────

app.get('/api/library', async (_req, res) => {
  try { res.json(await db.listLibraryItems()); }
  catch (err: any) { res.status(500).json({ error: err?.message || 'failed' }); }
});

app.post('/api/library', async (req, res) => {
  const { title, text_body, image_urls, shortcut } = req.body || {};
  const urls: string[] = Array.isArray(image_urls)
    ? image_urls.map((u: any) => String(u).trim()).filter(Boolean).slice(0, 20)
    : [];
  if (!text_body && urls.length === 0) return res.status(400).json({ error: 'text_body or image_urls required' });
  try {
    const item = await db.createLibraryItem({
      title: typeof title === 'string' ? title.trim() : undefined,
      text_body: typeof text_body === 'string' ? text_body.trim().slice(0, 4000) : undefined,
      image_urls: urls,
      shortcut: typeof shortcut === 'string' ? shortcut.trim().toLowerCase() || undefined : undefined,
    });
    res.status(201).json(item);
  } catch (err: any) { res.status(500).json({ error: err?.message || 'failed' }); }
});

app.patch('/api/library/:id', async (req, res) => {
  const { title, text_body, image_urls, shortcut } = req.body || {};
  const urls: string[] = Array.isArray(image_urls)
    ? image_urls.map((u: any) => String(u).trim()).filter(Boolean).slice(0, 20)
    : [];
  try {
    await db.updateLibraryItem(req.params.id, {
      title: typeof title === 'string' ? title.trim() : undefined,
      text_body: typeof text_body === 'string' ? text_body.trim().slice(0, 4000) : undefined,
      image_urls: urls,
      shortcut: typeof shortcut === 'string' ? shortcut.trim().toLowerCase() || undefined : undefined,
    });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err?.message || 'failed' }); }
});

app.delete('/api/library/:id', async (req, res) => {
  try { await db.deleteLibraryItem(req.params.id); res.json({ ok: true }); }
  catch (err: any) { res.status(500).json({ error: err?.message || 'failed' }); }
});

// ── Warmup bank presets ───────────────────────────────────────────────────

app.get('/api/warmup-bank-presets', async (_req, res) => {
  try { res.json(await db.listWarmupBankPresets()); }
  catch (err: any) { res.status(500).json({ error: err?.message || 'failed' }); }
});

app.put('/api/warmup-bank-presets/:name', async (req, res) => {
  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'messages array required' });
  try {
    const preset = await db.upsertWarmupBankPreset(req.params.name, messages.map(String).filter(Boolean));
    res.json(preset);
  } catch (err: any) { res.status(500).json({ error: err?.message || 'failed' }); }
});

app.delete('/api/warmup-bank-presets/:id', async (req, res) => {
  try { await db.deleteWarmupBankPreset(req.params.id); res.json({ ok: true }); }
  catch (err: any) { res.status(500).json({ error: err?.message || 'failed' }); }
});

// ── Message templates ─────────────────────────────────────────────────────

app.get('/api/templates', async (_req, res) => {
  try {
    res.json(await db.listTemplates());
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'failed' });
  }
});

app.post('/api/templates', async (req, res) => {
  const { name, body } = req.body || {};
  if (!body || typeof body !== 'string' || !body.trim()) {
    return res.status(400).json({ error: 'body required' });
  }
  try {
    const tpl = await db.createTemplate(
      typeof name === 'string' ? name.trim() : '',
      body.trim().slice(0, 2000),
    );
    res.status(201).json(tpl);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'failed' });
  }
});

app.patch('/api/templates/:id', async (req, res) => {
  const { name, body } = req.body || {};
  if (!body || typeof body !== 'string' || !body.trim()) {
    return res.status(400).json({ error: 'body required' });
  }
  try {
    await db.updateTemplate(
      req.params.id,
      typeof name === 'string' ? name.trim() : '',
      body.trim().slice(0, 2000),
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'failed' });
  }
});

app.delete('/api/templates/:id', async (req, res) => {
  try {
    await db.deleteTemplate(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'failed' });
  }
});

// --- Leads (generic CRUD, no platform coupling) ---

app.get('/api/leads/statuses', async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const { data, error } = await supabase
      .from('user_custom_statuses')
      .select('status_key, color, sort_order')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true })
      .order('status_key', { ascending: true });
    if (error) throw error;

    const custom = (data || [])
      .map((row: any) => ({
        status_key: normalizeStatusKey(row.status_key),
        color: row.color || null,
        sort_order: row.sort_order || 0
      }))
      .filter((item: { status_key: string }) => !DEFAULT_LEAD_STATUS_SET.has(item.status_key));

    res.json({
      defaults: DEFAULT_LEAD_STATUS_KEYS,
      custom,
      all: [...DEFAULT_LEAD_STATUS_KEYS, ...custom.map((c: { status_key: string }) => c.status_key)],
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/leads/statuses', async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const statusKey = normalizeStatusKey(req.body?.status || req.body?.status_key);
    const color = String(req.body?.color || '').trim() || null;
    if (!statusKey) return res.status(400).json({ error: 'Status is required' });
    if (DEFAULT_LEAD_STATUS_SET.has(statusKey)) {
      return res.json({ status_key: statusKey, label: formatStatusKeyLabel(statusKey), default: true });
    }

    const { data, error } = await supabase
      .from('user_custom_statuses')
      .upsert({
        user_id: userId,
        status_key: statusKey,
        color,
        created_at: new Date().toISOString(),
      }, { onConflict: 'user_id,status_key' })
      .select('status_key, color')
      .single();
    if (error) throw error;

    res.json({ status_key: normalizeStatusKey(data?.status_key), label: formatStatusKeyLabel(statusKey), color: data?.color, default: false });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/leads/statuses/reorder', async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'Order array required' });

    const promises = order.map((statusKey: unknown, index: number) =>
      supabase
        .from('user_custom_statuses')
        .update({ sort_order: index })
        .eq('user_id', userId)
        .eq('status_key', normalizeStatusKey(statusKey))
    );

    await Promise.all(promises);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const LEAD_EXPORT_HEADERS = [
  'user_id',
  'username',
  'first_name',
  'last_name',
  'phone',
  'bio',
  'status',
];

app.get('/api/leads/export.csv', async (req, res) => {
  try {
    const userId = getAuthUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    // TODO(discord): replace with discord bridge call - join with discord_accounts ownership
    const { data: leads, error } = await supabase
      .from('leads')
      .select('user_id, username, first_name, last_name, phone, bio, status')
      .order('updated_at', { ascending: false });

    if (error) throw error;

    const rows = (leads || []).map((lead: any) => [
      lead?.user_id ?? '',
      lead?.username ?? '',
      lead?.first_name ?? '',
      lead?.last_name ?? '',
      lead?.phone ?? '',
      lead?.bio ?? '',
      lead?.status ?? '',
    ]);

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${stamp}.csv"`);
    res.send(buildCsv(LEAD_EXPORT_HEADERS, rows));
  } catch (error: any) {
    res.status(500).json({ error: error?.message || String(error) });
  }
});

app.get('/api/leads', async (req, res) => {
  try {
    // TODO(discord): replace with discord bridge call - filter leads by discord-account ownership
    const userId = getAuthUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/leads/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    res.json(data || null);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/leads', async (req, res) => {
  try {
    const { user_id, first_name, username, bio, status } = req.body || {};
    const { data, error } = await supabase
      .from('leads')
      .upsert({ user_id, first_name, username, bio, status }, { onConflict: 'user_id' })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/leads/:userId/status', async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body || {};
    const normalizedStatusKey = normalizeStatusKey(status);
    const statusLabel = formatStatusKeyLabel(normalizedStatusKey);

    const { data, error } = await supabase
      .from('leads')
      .update({ status: statusLabel, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// /api/groups/* is wired below (registerGroupRoutes) — backs the
// account-grouping feature for the GG browser extension multi-account flow.

const serializeAccount = (acct: typeof discordMockState.accounts[number]) => {
  const { friendsCount, pendingOutgoing } = computeAccountAggregates(acct.id);
  return { ...acct, friendsCount, pendingOutgoing };
};

app.get('/api/accounts', async (_req, res) => {
  // v0.70 — enrich with warmup_status from DB so the operator can see each
  // account's lifecycle position right from the existing accounts list.
  // v0.76.1 — also enrich with proxyId so the warmup wizard can show
  // same-proxy pair cells as disabled before the operator submits.
  const base = discordMockState.accounts.map(serializeAccount);
  try {
    // Core enrichment — must never fail due to optional columns.
    const rows = await db.query<{ id: string; cached_email: string | null; discord_user_id: string | null }>(
      `SELECT id, cached_email, discord_user_id FROM tenant_main.discord_accounts`,
    );
    const m = new Map(rows.map((r) => [r.id, {
      cachedEmail: r.cached_email || null,
      discordUserId: r.discord_user_id || null,
    }]));

    // has_credentials — depends on migration 0026; degrade gracefully if not applied yet.
    const credMap = new Map<string, boolean>();
    try {
      const credRows = await db.query<{ id: string; has_creds: boolean }>(
        `SELECT id, (password_encrypted IS NOT NULL) AS has_creds FROM tenant_main.discord_accounts`,
      );
      for (const r of credRows) credMap.set(r.id, r.has_creds);
    } catch { /* migration 0026 not applied yet — hasCredentials defaults to false */ }

    const [proxyMap, scraperIds] = await Promise.all([
      db.getAccountProxyMap(),
      db.getScraperAccountIds(),
    ]);
    res.json(base.map((a) => ({
      ...a,
      ...(m.get(a.id) || { cachedEmail: null, discordUserId: null }),
      hasCredentials: credMap.get(a.id) ?? false,
      proxyId: proxyMap.get(a.id) || null,
      hasProxy: proxyMap.has(a.id),
      isScraperDecoy: scraperIds.has(a.id),
    })));
  } catch (err: any) {
    console.warn(`[accounts] warmup enrichment failed: ${err?.message || err}`);
    res.json(base);
  }
});

app.post('/api/accounts', (req, res) => {
  const label = String(req.body?.label || '').trim();
  const username = req.body?.username ? String(req.body.username).trim() : undefined;
  if (!label && !username) return res.status(400).json({ error: 'label or username required' });
  const acct = mockCreateAccount(label || username || 'Account', username);
  res.json(serializeAccount(acct));
});

app.patch('/api/accounts/:id', (req, res) => {
  const acct = mockUpdateAccountLabel(req.params.id, String(req.body?.label || ''));
  if (!acct) return res.status(404).json({ error: 'Account not found' });
  res.json(serializeAccount(acct));
});

app.post('/api/accounts/:id/disconnect', (req, res) => {
  const acct = mockDisconnectAccount(req.params.id);
  if (!acct) return res.status(404).json({ error: 'Account not found' });
  res.json(serializeAccount(acct));
});

// POST /api/accounts/:id/quarantine
// Marks an account as quarantined: sets warmup_status=quarantined and marks it
// dead in every warmup campaign so the engine skips it immediately.
// GET /api/accounts/:id/credentials/reveal — return decrypted credentials for a revoked account.
// Only works when the account status is token_revoked (fallback for when auto-reauth fails).
app.get('/api/accounts/:id/credentials/reveal', async (req, res) => {
  const accountId = req.params.id;
  const acct = discordMockState.accounts.find((a) => a.id === accountId);
  if (!acct) return res.status(404).json({ error: 'Account not found' });
  try {
    const creds = await db.getAccountCredentials(accountId);
    if (!creds) return res.status(404).json({ error: 'No credentials stored for this account' });
    const email = await db.getCachedEmail(accountId);
    res.json({ email, password: creds.password, totpSecret: creds.totpSecret });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'failed to retrieve credentials' });
  }
});


app.post('/api/accounts/:id/quarantine', async (req, res) => {
  const accountId = req.params.id;
  const acct = discordMockState.accounts.find((a) => a.id === accountId);
  if (!acct) return res.status(404).json({ error: 'Account not found' });
  try {
    await db.quarantineAccount(accountId);
    // Reflect in-memory so the accounts page updates without a refresh.
    acct.status = "token_revoked";
    acct.lastStatusAt = new Date().toISOString();
    publishExternalEvent({ type: "account_status", accountId, status: "token_revoked", ts: acct.lastStatusAt });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'quarantine failed' });
  }
});


// POST /api/accounts/credentials/bulk — save credentials for many accounts at once.
// Body: { entries: [{ email, password, totpSecret?, rawLine? }] }
// Primary match: exact cached_email lookup.
// Fallback: prefix-match rawLine against stored emails — handles no-separator
// formats like "user@domain.ruPASSWORD" where email and password are glued together.
app.post('/api/accounts/credentials/bulk', async (req, res) => {
  const entries: Array<{ email: string; password: string; totpSecret?: string; rawLine?: string }> = req.body?.entries || [];
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'entries array required' });
  }
  const accounts = await db.query<{ id: string; cached_email: string | null }>(
    `SELECT id, cached_email FROM tenant_main.discord_accounts`,
  );
  const emailToId = new Map(
    accounts.filter((a) => a.cached_email).map((a) => [a.cached_email!.toLowerCase(), a.id]),
  );
  const results: Array<{ email: string; ok: boolean; error?: string }> = [];
  for (const entry of entries) {
    let email = String(entry.email || '').trim();
    let password = String(entry.password || '').trim();
    const totpSecret = String(entry.totpSecret || '').trim() || null;
    const rawLine = String(entry.rawLine || entry.email || '').trim();

    // Primary: exact email match
    let accountId = password ? emailToId.get(email.toLowerCase()) : undefined;

    // Fallback: prefix-match rawLine against every stored email.
    // Handles no-separator format regardless of what the password starts with.
    if (!accountId || !password) {
      for (const [storedEmail, id] of emailToId) {
        if (rawLine.toLowerCase().startsWith(storedEmail) && rawLine.length > storedEmail.length) {
          const extracted = rawLine.slice(storedEmail.length);
          if (extracted) {
            accountId = id;
            email = storedEmail;
            password = extracted;
            break;
          }
        }
      }
    }

    if (!password)  { results.push({ email: email || rawLine, ok: false, error: 'could not extract password' }); continue; }
    if (!accountId) { results.push({ email: email || rawLine, ok: false, error: 'no account found with this email' }); continue; }
    try {
      await db.setCachedEmail(accountId, email);
      await db.setAccountCredentials(accountId, password, totpSecret);
      results.push({ email, ok: true });
    } catch (err: any) {
      results.push({ email, ok: false, error: err?.message || 'save failed' });
    }
  }
  res.json({ results, saved: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
});

// PUT /api/accounts/:id/credentials — save encrypted email/password/totp for auto-reauth.
// Credentials are AES-256-GCM encrypted at rest; never returned to the frontend.
app.put('/api/accounts/:id/credentials', async (req, res) => {
  const accountId = req.params.id;
  const password   = String(req.body?.password   || '').trim();
  const totpSecret = String(req.body?.totpSecret || '').trim() || null;
  if (!password) return res.status(400).json({ error: 'password required' });
  const email = String(req.body?.email || '').trim();
  try {
    if (email) await db.setCachedEmail(accountId, email);
    await db.setAccountCredentials(accountId, password, totpSecret);
    res.json({ ok: true, hasCredentials: true, hasTotp: !!totpSecret });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'failed to save credentials' });
  }
});

app.delete('/api/accounts/:id', async (req, res) => {
  const accountId = req.params.id;
  // Require typed confirmation in body to prevent accidental DELETEs from curl/scripts.
  const confirm = String(req.body?.confirm || req.query?.confirm || '');
  if (confirm !== accountId) {
    return res.status(400).json({ error: 'confirm payload required — POST body.confirm or ?confirm= must equal account id' });
  }
  const acct = discordMockState.accounts.find((a) => a.id === accountId);
  if (!acct) return res.status(404).json({ error: 'Account not found' });

  // Stop background workers BEFORE we strip state, so nothing fires after this point.
  detachGateway(accountId);
  detachLiveAccount(accountId);

  // Wipe in-memory: conversations, their messages, and campaigns scoped to this account.
  const removedConvs = discordMockState.conversations.filter((c) => c.accountId === accountId);
  for (const c of removedConvs) discordMockState.messages.delete(c.id);
  discordMockState.conversations = discordMockState.conversations.filter((c) => c.accountId !== accountId);
  discordMockState.campaigns = discordMockState.campaigns.filter(
    (camp) => !camp.accountIds.includes(accountId) || camp.accountIds.length > 1,
  );
  // For campaigns that included this account alongside others, remove the id reference.
  for (const camp of discordMockState.campaigns) {
    if (camp.accountIds.includes(accountId)) {
      camp.accountIds = camp.accountIds.filter((id) => id !== accountId);
    }
  }
  mockRemoveAccount(accountId);

  // DB: discord_accounts row → cascades to conversations + messages via FK ON DELETE CASCADE.
  await db.deleteAccount(accountId).catch((err) =>
    console.warn('[delete] DB delete failed:', err?.message || err),
  );

  console.log(`[delete] account=${accountId} username=${acct.username} convs=${removedConvs.length} gateway/poller stopped`);
  res.json({
    ok: true,
    removed: {
      accountId,
      username: acct.username,
      conversationsRemoved: removedConvs.length,
    },
  });
});

// --- QR login (Discord remote-auth) ------------------------------------------------
// Subscribe ONCE at module load so QR lifecycle events flow into the SSE stream
// and the account gets created the moment Discord hands us a token.
subscribeQr((evt) => {
  const ts = new Date().toISOString();
  if (evt.type === 'qr_ready') {
    publishExternalEvent({ type: 'qr_ready', sessionId: evt.sessionId, qrUrl: evt.qrUrl, ts });
  } else if (evt.type === 'qr_user_seen') {
    publishExternalEvent({ type: 'qr_user_seen', sessionId: evt.sessionId, user: evt.user, ts });
  } else if (evt.type === 'qr_authorizing') {
    publishExternalEvent({ type: 'qr_authorizing', sessionId: evt.sessionId, user: evt.user, ts });
  } else if (evt.type === 'qr_captcha_required') {
    publishExternalEvent({
      type: 'qr_captcha_required',
      sessionId: evt.sessionId,
      user: evt.user,
      sitekey: evt.sitekey,
      rqdata: evt.rqdata,
      service: evt.service,
      ts,
    });
  } else if (evt.type === 'qr_failed') {
    publishExternalEvent({ type: 'qr_failed', sessionId: evt.sessionId, reason: evt.reason, ts });
  } else if (evt.type === 'qr_cancelled') {
    publishExternalEvent({ type: 'qr_cancelled', sessionId: evt.sessionId, ts });
  } else if (evt.type === 'qr_authorized') {
    // Discord just confirmed the user authorized us. Pull the token, provision the account.
    const token = consumeCapturedToken(evt.sessionId);
    if (!token) {
      publishExternalEvent({ type: 'qr_failed', sessionId: evt.sessionId, reason: 'token consume failed', ts });
      return;
    }
    const acct = createAccountFromQr(evt.user, token);
    db.upsertDiscordAccount(acct, token, evt.user.id).catch((err) =>
      console.warn('[qr] DB upsert failed:', err?.message || err),
    );
    attachLiveAccount(acct.id);
    attachGateway(acct.id, token);
    publishExternalEvent({
      type: 'qr_authorized',
      sessionId: evt.sessionId,
      user: evt.user,
      accountId: acct.id,
      ts,
    });
  }
});

app.post('/api/accounts/qr/start', (_req, res) => {
  const sess = startQrSession();
  res.json(sess);
});

app.get('/api/accounts/qr/:id', (req, res) => {
  const sess = getQrSession(req.params.id);
  if (!sess) return res.status(404).json({ error: 'session not found or expired' });
  res.json(sess);
});

app.post('/api/accounts/qr/:id/cancel', (req, res) => {
  cancelQrSession(req.params.id);
  res.json({ ok: true });
});

// POST /api/accounts/token — user pasted a Discord user token from their browser.
// We verify it with /users/@me, then provision an account. No captcha involved
// since this isn't an auth endpoint, just a profile fetch with an already-issued token.
app.post('/api/accounts/token', async (req, res) => {
  const token = String(req.body?.token || '').trim();
  const label = String(req.body?.label || '').trim();
  if (!token) return res.status(400).json({ error: 'token required' });

  const result = await verifyDiscordToken(token);
  if (!result.ok || !result.user) {
    return res.status(400).json({ error: result.reason || 'token verification failed' });
  }

  // Provision the account using the same downstream path QR captures use.
  const acct = createAccountFromQr(
    {
      id: result.user.id,
      username: result.user.global_name || result.user.username,
      discriminator: result.user.discriminator,
      avatarHash: result.user.avatarHash,
    },
    token,
    label || undefined,
  );
  // Persist to DB (encrypted token column). Source of truth from v0.7 onward.
  db.upsertDiscordAccount(acct, token, result.user.id).catch((err) =>
    console.warn('[token-login] DB upsert failed:', err?.message || err),
  );
  if (result.user.email) {
    db.setCachedEmail(acct.id, result.user.email).catch(() => {});
  }
  attachLiveAccount(acct.id);
  attachGateway(acct.id, token);
  res.json({ ...acct, user: { id: result.user.id, email: result.user.email, verified: result.user.verified } });
});

// POST /api/accounts/token/bulk — operator pastes multiple Discord user tokens
// (one per line) for batch onboarding. Each token is verified + provisioned in
// parallel (capped at 5 at a time to avoid hammering Discord's /users/@me).
// Returns a per-token result so the UI can show successes + failures inline.
//
// Request:   { tokens: string[] }  OR  { input: "raw\nnewline\nseparated\ntext" }
// Response:  { results: Array<{ token: string; ok: boolean; accountId?: string;
//                               username?: string; error?: string }> }
app.post('/api/accounts/token/bulk', async (req, res) => {
  // Accept either an array OR a raw multiline blob; the operator may paste
  // either way. Strip blanks + trim. Cap at 100 per call to avoid runaway.
  let rawTokens: string[] = [];
  if (Array.isArray(req.body?.tokens)) {
    rawTokens = req.body.tokens.map((t: any) => String(t || '').trim()).filter(Boolean);
  } else if (typeof req.body?.input === 'string') {
    rawTokens = req.body.input
      .split(/[\r\n]+/)
      .map((line: string) => line.trim())
      .filter(Boolean);
  }
  if (rawTokens.length === 0) return res.status(400).json({ error: 'no tokens provided' });
  if (rawTokens.length > 100) return res.status(400).json({ error: 'max 100 tokens per call; split into batches' });

  // Process in parallel with a concurrency cap so we don't hammer Discord. 5
  // is conservative; each /users/@me round-trip is ~1–2s through the proxy.
  const CONCURRENCY = 5;
  const queue = rawTokens.map((tok, idx) => ({ tok, idx }));
  const results: Array<{ token: string; ok: boolean; accountId?: string; username?: string; error?: string }> =
    new Array(rawTokens.length);

  async function worker() {
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) break;
      const { tok, idx } = job;
      try {
        const verify = await verifyDiscordToken(tok);
        if (!verify.ok || !verify.user) {
          results[idx] = { token: tok.slice(0, 12) + '…', ok: false, error: verify.reason || 'verification failed' };
          continue;
        }
        const acct = createAccountFromQr(
          {
            id: verify.user.id,
            username: verify.user.global_name || verify.user.username,
            discriminator: verify.user.discriminator,
            avatarHash: verify.user.avatarHash,
          },
          tok,
        );
        db.upsertDiscordAccount(acct, tok, verify.user.id).catch((err: any) =>
          console.warn('[token-bulk] DB upsert failed:', err?.message || err),
        );
        if (verify.user.email) {
          db.setCachedEmail(acct.id, verify.user.email).catch(() => {});
        }
        attachLiveAccount(acct.id);
        attachGateway(acct.id, tok);
        results[idx] = { token: tok.slice(0, 12) + '…', ok: true, accountId: acct.id, username: acct.username };
      } catch (err: any) {
        results[idx] = { token: tok.slice(0, 12) + '…', ok: false, error: err?.message || String(err) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rawTokens.length) }, () => worker()));

  const successes = results.filter((r) => r.ok).length;
  console.log(`[token-bulk] processed ${rawTokens.length} tokens · ${successes} ok · ${rawTokens.length - successes} failed`);
  res.json({ results });
});

// POST /api/fr/leads/:leadId/captcha — operator solved the hCaptcha in the app UI.
// Body: { captcha_key: string, captcha_rqtoken?: string }
// Retries the PUT /relationships directly with the solved token.
app.post('/api/fr/leads/:leadId/captcha', async (req, res) => {
  const captchaKey = String(req.body?.captcha_key || '').trim();
  const captchaRqtoken = String(req.body?.captcha_rqtoken || '').trim();
  if (!captchaKey) return res.status(400).json({ error: 'captcha_key required' });

  const lead = await db.getFrLead(req.params.leadId).catch(() => null);
  if (!lead) return res.status(404).json({ error: 'lead not found' });

  const accountId = lead.assigned_account_id;
  if (!accountId) return res.status(400).json({ error: 'lead has no assigned account' });

  const allAccts = await db.loadAllAccounts() as Array<{ account: { id: string }; token: string | null }>;
  const token = allAccts.find((a) => a.account.id === accountId)?.token ?? null;
  if (!token) return res.status(400).json({ error: 'account token not found' });

  const { tlsFetch, discordHeaders } = await import('./discord-http');
  const body: any = { captcha_key: captchaKey };
  if (captchaRqtoken) body.captcha_rqtoken = captchaRqtoken;

  const r = await tlsFetch(
    `https://discord.com/api/v9/users/@me/relationships/${lead.discord_user_id}`,
    { method: 'PUT', headers: await discordHeaders(token, true, undefined, accountId), body: JSON.stringify(body), timeoutMs: 15_000, accountId },
  );

  if (r.ok || r.status === 200 || r.status === 204) {
    await db.updateFrLead(lead.id, { status: 'fr_sent', assigned_account_id: accountId, fr_sent_at: new Date().toISOString(), next_eligible_at: null });
    return res.json({ ok: true });
  }

  const errText = await r.text().catch(() => '');
  return res.status(400).json({ ok: false, error: `HTTP ${r.status}: ${errText.slice(0, 100)}` });
});

// POST /api/accounts/qr/:id/captcha — user solved the hCaptcha in the modal.
// Body: { captcha_key: string }. We retry the login with the captcha_key.
app.post('/api/accounts/qr/:id/captcha', async (req, res) => {
  const captchaKey = String(req.body?.captcha_key || '').trim();
  if (!captchaKey) return res.status(400).json({ error: 'captcha_key required' });
  const result = await submitQrCaptcha(req.params.id, captchaKey);
  if (result.ok) return res.json({ ok: true, status: result.status });
  return res.status(400).json({ ok: false, status: result.status, error: result.error });
});
// ----------------------------------------------------------------------------------

// ───── Campaigns — v0.8 DB-backed real engine ─────────────────────────────────
const campaignRowToApi = (c: db.CampaignRow) => ({
  id: c.id,
  name: c.name,
  accountIds: c.accountIds,
  templates: c.templates,
  template: c.templates[0] || '',         // legacy shim for any old caller
  rateLimit: { perHour: c.ratePerHour, perDay: c.ratePerDay },
  minInterSendSeconds: c.minInterSendSeconds,
  minGlobalSpacingSeconds: c.minGlobalSpacingSeconds ?? 300,
  status: c.status,
  mode: c.mode,
  createdAt: c.createdAt,
  totals: c.totals,
});

const leadRowToApi = (l: db.LeadRow) => ({
  id: l.id,
  campaignId: l.campaignId,
  discordUserId: l.discordUserId,
  displayName: l.displayName,
  avatarUrl: null,
  status: l.status,
  source: l.source,
  assignedAccountId: l.assignedAccountId,
  sentAt: l.sentAt,
  createdAt: l.createdAt,
});

app.get('/api/campaigns', async (_req, res) => {
  const list = await db.listCampaigns();
  res.json(list.map(campaignRowToApi));
});


app.get('/api/campaigns/:id', async (req, res) => {
  const c = await db.getCampaign(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });
  const leads = await db.listLeadsByCampaign(req.params.id);
  res.json({ ...campaignRowToApi(c), leads: leads.map(leadRowToApi) });
});

app.post('/api/campaigns', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.name || typeof body.name !== 'string') {
      return res.status(400).json({ error: 'name required' });
    }
    const accountIds: string[] = Array.isArray(body.accountIds) ? body.accountIds.map(String) : [];
    const inputLeads: Array<{ discordUserId: string; displayName?: string }> = Array.isArray(body.leads) ? body.leads : [];
    const rateHour = Number(body?.rateLimit?.perHour) || 5;
    const rateDay = Number(body?.rateLimit?.perDay) || 30;

    const mode: 'fr' | 'dm' | 'both' =
      body.mode === 'dm' ? 'dm' : body.mode === 'both' ? 'both' : 'fr';
    // Accept either `templates: string[]` (v0.11+) or legacy `template: string`.
    const rawTemplates: string[] = Array.isArray(body.templates)
      ? body.templates.map((t: any) => String(t || '').trim()).filter((t: string) => t.length > 0)
      : [];
    if (rawTemplates.length === 0 && body.template) rawTemplates.push(String(body.template).trim());
    const templates = rawTemplates.map((t) => t.slice(0, 2000)).slice(0, 50); // cap 50 variants

    // Inter-send cooldown. Clamp to sane bounds; default by mode if not set.
    // 'both' uses the DM default (1800s) — DM is the dominant ban-risk action.
    const defaultSpacing = mode === 'dm' || mode === 'both' ? 1800 : 600;
    const rawSpacing = Number(body?.minInterSendSeconds);
    const minInterSendSeconds = Number.isFinite(rawSpacing) && rawSpacing > 0
      ? Math.max(30, Math.min(rawSpacing, 24 * 3600))
      : defaultSpacing;

    const rawGlobal = Number(body?.minGlobalSpacingSeconds);
    const minGlobalSpacingSeconds = Number.isFinite(rawGlobal) && rawGlobal >= 0
      ? Math.min(rawGlobal, 24 * 3600)
      : 300; // default 5 min

    const id = `camp_${crypto.randomBytes(4).toString('hex')}`;
    await db.createCampaign({
      id,
      name: String(body.name).slice(0, 200),
      accountIds,
      templates,
      ratePerHour: rateHour,
      ratePerDay: rateDay,
      minInterSendSeconds,
      minGlobalSpacingSeconds,
      guildId: body.guildId ? String(body.guildId).trim() : null,
      status: 'draft',
      mode,
      createdAt: new Date().toISOString(),
      totals: { queued: inputLeads.length, sent: 0, replied: 0, failed: 0 },
    });

    // Insert all leads with pre-assigned account.
    // v0.56 — hard per-account cap. The wizard sends `leadsPerAccount`; when
    // set, no account receives more than that many leads, period. If every
    // eligible account is already at the cap, the lead is dropped from
    // insertion entirely (no orphan rows clogging the table). This guarantees
    // the per-account split the operator sees in the wizard is what they get.
    const validLeads = inputLeads.filter((l) => l && /^\d{15,22}$/.test(String(l.discordUserId || '')));
    const rawCap = Number(body?.leadsPerAccount);
    const cap = Number.isFinite(rawCap) && rawCap > 0 ? Math.floor(rawCap) : Infinity;
    // Round-robin across campaign accounts. No eligibility filter — if an account
    // scraped users from a server it's already in that server, so the check is
    // redundant and caused leads to be orphaned when only one account had scrape data.
    const load = new Map<string, number>();
    for (const a of accountIds) load.set(a, 0);
    const leadRows: Array<{
      id: string; campaignId: string; discordUserId: string;
      displayName: string | null; source: string; assignedAccountId: string | null;
    }> = [];
    let droppedCap = 0;
    for (const l of validLeads) {
      const uid = String(l.discordUserId);
      let assigned: string | null = null;
      let bestN = Infinity;
      for (const a of accountIds) {
        const n = load.get(a) || 0;
        if (n >= cap) continue;
        if (n < bestN) { bestN = n; assigned = a; }
      }
      if (!assigned && Number.isFinite(cap)) {
        droppedCap += 1;
        continue;
      }
      if (assigned) load.set(assigned, (load.get(assigned) || 0) + 1);
      leadRows.push({
        id: `lead_${crypto.randomBytes(4).toString('hex')}`,
        campaignId: id,
        discordUserId: uid,
        displayName: l.displayName ? String(l.displayName).slice(0, 120) : null,
        source: String(body.source || 'manual').slice(0, 512),
        assignedAccountId: assigned,
      });
    }
    if (droppedCap > 0) {
      console.log(`[campaign-create] ${id} dropped ${droppedCap} leads (per-account cap=${cap} reached)`);
    }
    await db.bulkInsertLeads(leadRows);

    const created = await db.getCampaign(id);
    res.json(campaignRowToApi(created!));
  } catch (err: any) {
    console.error('[campaign] create error:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Failed to create campaign' });
  }
});

app.post('/api/campaigns/:id/start', async (req, res) => {
  const c = await db.getCampaign(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });
  if (c.accountIds.length === 0) return res.status(400).json({ error: 'Campaign has no accounts' });
  await db.setCampaignStatus(req.params.id, 'running');
  const updated = await db.getCampaign(req.params.id);
  res.json(campaignRowToApi(updated!));
});

app.post('/api/campaigns/:id/pause', async (req, res) => {
  const c = await db.getCampaign(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });
  await db.setCampaignStatus(req.params.id, 'paused');
  const updated = await db.getCampaign(req.params.id);
  res.json(campaignRowToApi(updated!));
});

// GET /api/campaigns/:id/account-stats — per-account queued/sent/replied/failed
// plus suspension state. Backs the per-account table on the campaign detail
// page. Cheap aggregate query; safe to poll.
app.get('/api/campaigns/:id/account-stats', async (req, res) => {
  const c = await db.getCampaign(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });
  const stats = await db.getCampaignAccountStats(req.params.id);
  const suspensions = await db.listSuspensions(req.params.id);
  const suspensionByAccount = new Map(suspensions.map((s) => [s.accountId, s]));
  // Make sure every campaign account is represented even if it has 0 leads.
  const byAccount = new Map(stats.map((s) => [s.accountId, s]));
  for (const accountId of c.accountIds) {
    if (!byAccount.has(accountId)) {
      byAccount.set(accountId, { accountId, queued: 0, sent: 0, replied: 0, failed: 0 });
    }
  }
  const out = Array.from(byAccount.values()).map((s) => {
    if (!s.accountId) {
      return { ...s, accountId: '', suspended: false, suspensionReason: null, unassigned: true };
    }
    const susp = suspensionByAccount.get(s.accountId);
    return {
      ...s,
      suspended: !!susp,
      suspensionReason: susp?.reason || null,
      unassigned: false,
    };
  });
  res.json({ stats: out });
});

// POST /api/campaigns/:id/accounts/:accountId/resume — clear suspension so this
// account is eligible to receive newly-assigned leads again. Existing leads
// that were rebalanced AWAY from this account stay where they are; this is a
// one-way valve. Operator must re-run the wizard to re-balance leads back.
app.post('/api/campaigns/:id/accounts/:accountId/resume', async (req, res) => {
  const c = await db.getCampaign(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });
  await db.clearSuspension(req.params.id, req.params.accountId);
  res.json({ ok: true });
});

// Wave endpoint removed — wave-first approach has been replaced by direct DM
// sending through existing channels. Channels are opened organically via the
// extension or operator's Discord client; the campaign engine sends through them.

// GET /api/campaigns/:id/wave-queue — leads grouped by cold/warm/sent/failed.
// "Cold" = pending lead with no existing DM channel between any campaign account
// and the recipient. The operator manually opens cold leads in real Discord
// (which creates a real channel server-side); our REST poller imports the
// channel within ~60s and the lead flips Cold → Warm. The campaign engine then
// sends through that warm channel cleanly.
app.get('/api/campaigns/:id/wave-queue', async (req, res) => {
  const c = await db.getCampaign(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });
  const leads = await db.listLeadsByCampaign(req.params.id);
  const enriched = await Promise.all(leads.map(async (l) => {
    // v0.33: each lead is pre-assigned to a specific account. Warm-channel
    // check MUST be against THAT account — otherwise a wave via the wrong
    // account would mark the lead "warm" but the scheduler (which uses
    // lead.assignedAccountId) can't actually send through it.
    let warmChannelId: string | null = null;
    if (l.assignedAccountId) {
      warmChannelId = await db.findWarmDmChannel(l.assignedAccountId, l.discordUserId);
    }
    return {
      id: l.id,
      discordUserId: l.discordUserId,
      displayName: l.displayName,
      status: l.status,
      sentAt: l.sentAt,
      isWarm: !!warmChannelId,
      warmChannelId,
      assignedAccountId: l.assignedAccountId,
    };
  }));
  const counts = {
    cold: enriched.filter((l) => !l.isWarm && l.status === 'pending').length,
    warm: enriched.filter((l) => l.isWarm && l.status === 'pending').length,
    sent: enriched.filter((l) => l.status === 'sent').length,
    failed: enriched.filter((l) => l.status === 'failed').length,
  };
  res.json({ leads: enriched, counts });
});

// (v0.71.3: POST /api/campaigns/:id/wave-queue/prepare deleted entirely.
// Warmup engine + extension handle channel creation now. Restore from git
// history if ever needed.)

app.delete('/api/campaigns/:id', async (req, res) => {
  // v0.64 — cleanup-on-delete: drop pending (un-waved) leads + their empty DM
  // conversations, preserve sent/replied leads as already-contacted history.
  // Operator request: "any needs-wave from this campaign which we haven't sent
  // a wave to should be removed from there and db should not record them and
  // skip them on the next scrape."
  const before = await db.getCampaign(req.params.id);
  const result = await db.deleteCampaignAndCleanup(req.params.id);
  // Pull the deleted convs out of the in-memory mock state too, so the Unibox
  // store doesn't keep them around for tabs that haven't refreshed yet.
  if (result.conversationIds.length) {
    const dropSet = new Set(result.conversationIds);
    discordMockState.conversations = discordMockState.conversations.filter((c) => !dropSet.has(c.id));
    for (const convId of result.conversationIds) {
      publishExternalEvent({
        type: 'conversation_removed',
        conversationId: convId,
        ts: new Date().toISOString(),
      });
    }
  }
  clearCampaignCooldown(req.params.id);
  if (before?.accountIds?.length) clearAccountCooldowns(new Set(before.accountIds));
  console.log(`[campaign-delete] id=${req.params.id} cleanup pendingDeleted=${result.pendingLeadsDeleted} convsDeleted=${result.conversationIds.length} sentPreserved=${result.sentLeadsPreserved}`);
  res.json({ ok: true, ...result });
});

// v0.43 — PATCH /api/accounts/:id/profile — update display name + avatar via
// Discord's PATCH /users/@me. Username changes require a password and are
// rate-limited 2/hr/account, so we exclude them. Display name (global_name)
// and avatar require no password and update instantly. Body shape:
//   { displayName?: string, avatarDataUrl?: 'data:image/...;base64,...' }
app.patch('/api/accounts/:id/profile', async (req, res) => {
  const acct = discordMockState.accounts.find((a) => a.id === req.params.id);
  if (!acct) return res.status(404).json({ error: 'Account not found' });
  const token = require('./discord-mock')._getCapturedToken(req.params.id);
  if (!token) return res.status(400).json({ error: 'No captured token for this account' });

  const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim().slice(0, 32) : undefined;
  const avatarDataUrl = typeof req.body?.avatarDataUrl === 'string' && req.body.avatarDataUrl.startsWith('data:')
    ? req.body.avatarDataUrl
    : undefined;
  // v0.45 — captcha-retry path. The frontend solves Discord's hCaptcha via
  // the same widget the QR-login flow uses, then re-POSTs with `captchaKey`
  // (and optionally `captchaRqtoken`). We pass those to Discord which then
  // accepts the profile change.
  const captchaKey = typeof req.body?.captchaKey === 'string' ? req.body.captchaKey : undefined;
  const captchaRqtoken = typeof req.body?.captchaRqtoken === 'string' ? req.body.captchaRqtoken : undefined;

  if (displayName === undefined && avatarDataUrl === undefined) {
    return res.status(400).json({ error: 'displayName or avatarDataUrl required' });
  }

  const body: any = {};
  if (displayName !== undefined) body.global_name = displayName;
  if (avatarDataUrl !== undefined) body.avatar = avatarDataUrl;
  if (captchaKey) body.captcha_key = captchaKey;
  if (captchaRqtoken) body.captcha_rqtoken = captchaRqtoken;

  const { tlsFetch, discordHeaders } = require('./discord-http');
  let r: any;
  try {
    r = await tlsFetch('https://discord.com/api/v9/users/@me', {
      method: 'PATCH',
      headers: await discordHeaders(token, true, undefined, req.params.id),
      body: JSON.stringify(body),
      timeoutMs: 15_000,
      accountId: req.params.id,
    });
  } catch (e: any) {
    return res.status(502).json({ error: `Discord request failed: ${e?.message || e}` });
  }
  const txt = await r.text();
  if (!r.ok) {
    // v0.45: detect captcha challenges and return a structured prompt so the
    // frontend can render hCaptcha. Discord's response on a captcha challenge:
    //   { captcha_key: ["You need to update..."], captcha_sitekey: "...",
    //     captcha_service: "hcaptcha", captcha_rqdata: "...", captcha_rqtoken: "..." }
    let parsed: any = null;
    try { parsed = JSON.parse(txt); } catch {}
    if (r.status === 400 && parsed?.captcha_sitekey) {
      console.log(`[profile-edit] acct=${acct.id} captcha challenge sitekey=${parsed.captcha_sitekey.slice(0, 8)}…`);
      return res.status(400).json({
        captcha: {
          sitekey: String(parsed.captcha_sitekey),
          rqdata: String(parsed.captcha_rqdata || ''),
          rqtoken: String(parsed.captcha_rqtoken || ''),
          service: String(parsed.captcha_service || 'hcaptcha'),
        },
      });
    }
    console.warn(`[profile-edit] acct=${acct.id} HTTP ${r.status} body=${txt.slice(0, 200)}`);
    return res.status(r.status).json({ error: `Discord rejected: HTTP ${r.status}: ${txt.slice(0, 200)}` });
  }
  let updated: any = {};
  try { updated = JSON.parse(txt); } catch {}

  // Sync local state. Discord returns:
  //   global_name: the new display name
  //   avatar: the new avatar hash (we build the CDN URL ourselves)
  //   username: the (unchanged) Discord handle
  if (typeof updated.global_name === 'string') acct.label = updated.global_name;
  if (typeof updated.avatar === 'string' && updated.id) {
    acct.avatarUrl = `https://cdn.discordapp.com/avatars/${updated.id}/${updated.avatar}.png?size=128`;
  }
  acct.lastStatusAt = new Date().toISOString();
  try {
    await db.updateAccountStats(acct.id, acct.friendsCount, acct.pendingOutgoing, acct.status);
    // Also persist label + avatar via the existing rename/avatar helper if any.
    // Simplest: direct UPDATE.
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('UPDATE tenant_main.discord_accounts SET label = $2, avatar_url = $3 WHERE id = $1',
      [acct.id, acct.label, acct.avatarUrl]);
    await pool.end();
  } catch (e: any) {
    console.warn(`[profile-edit] DB persist failed: ${e?.message || e}`);
  }
  console.log(`[profile-edit] acct=${acct.id} updated displayName=${displayName ?? '(unchanged)'} avatar=${avatarDataUrl ? 'updated' : '(unchanged)'}`);
  res.json(acct);
});

// /api/groups/* — account-grouping CRUD + token-bundle endpoint for the GG
// browser extension to switch the operator's real Chrome between captured
// Discord accounts.
registerGroupRoutes(app);
registerWarmupAdminRoutes(app);
registerFrCampaignRoutes(app);

// POST /api/admin/enable-friend-requests
// Patches privacy settings on all accounts to accept FRs from everyone.
// Run this once before bulk-friend-all.
app.post('/api/admin/enable-friend-requests', async (req, res) => {
  const allAccts = await db.loadAllAccounts() as Array<{ account: { id: string; username: string }; token: string | null }>;
  const eligible = allAccts.filter((a) => a.token);
  res.json({ started: true, accounts: eligible.length });
  (async () => {
    let ok = 0; let failed = 0;
    const { tlsFetch, discordHeaders } = await import('./discord-http');
    for (const acct of eligible) {
      try {
        const r = await tlsFetch('https://discord.com/api/v9/users/@me/settings', {
          method: 'PATCH',
          headers: await discordHeaders(acct.token!, true, undefined, acct.account.id),
          body: JSON.stringify({ friend_source_flags: { all: true, mutual_friends: true, mutual_guilds: true } }),
          timeoutMs: 10_000,
          accountId: acct.account.id,
        });
        if (r.status === 200) { ok++; console.log(`[enable-fr] ${acct.account.username} OK`); }
        else { failed++; const t = await r.text().catch(() => ''); console.warn(`[enable-fr] ${acct.account.username} HTTP ${r.status} ${t.slice(0, 100)}`); }
      } catch (err: any) {
        failed++;
        console.warn(`[enable-fr] ${acct.account.username} threw: ${err?.message || err}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log(`[enable-fr] DONE ok=${ok} failed=${failed}`);
  })().catch((err) => console.warn('[enable-fr] fatal:', err?.message || err));
});

// POST /api/admin/bulk-friend-all
// Sends one-direction FR from each account to every other account.
// The gateway auto-accepts any incoming FR from an own account, so one
// direction is enough to establish the friendship.
// Staggered at 90s per send to stay well under Discord's rate limits.
// Returns immediately; runs async in the background.
app.post('/api/admin/bulk-friend-all', async (req, res) => {
  const allAccts = await db.loadAllAccounts() as Array<{ account: { id: string; username: string }; token: string | null; discordUserId?: string | null }>;
  const eligible = allAccts.filter((a) => a.token && a.discordUserId);
  if (eligible.length < 2) return res.status(400).json({ error: 'Need at least 2 accounts with tokens and discord user IDs' });

  // One-direction pairs only: A→B where A comes before B in the list.
  const pairs: Array<{ sender: typeof eligible[number]; target: typeof eligible[number] }> = [];
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      pairs.push({ sender: eligible[i]!, target: eligible[j]! });
    }
  }
  const estimatedMinutes = Math.ceil(pairs.length * 90 / 60);
  res.json({ started: true, accounts: eligible.length, pairs: pairs.length, estimatedMinutes });

  (async () => {
    let ok = 0; let failed = 0;
    const deadSenders = new Set<string>();
    for (const { sender, target } of pairs) {
      // Skip sender entirely if its token is already known dead.
      if (deadSenders.has(sender.account.id)) {
        failed++;
        continue;
      }
      try {
        const { tlsFetch, discordHeaders } = await import('./discord-http');
        const headers = { ...await discordHeaders(sender.token!, true, undefined, sender.account.id), 'x-context-properties': 'eyJsb2NhdGlvbiI6IkFkZCBGcmllbmQifQ==' };
        const r = await tlsFetch(
          `https://discord.com/api/v9/users/@me/relationships/${target.discordUserId}`,
          { method: 'PUT', headers, body: JSON.stringify({}), timeoutMs: 10_000, accountId: sender.account.id },
        );
        if (r.status === 204 || r.status === 200) {
          ok++;
          console.log(`[bulk-friend] ${sender.account.username} → ${target.account.username} OK (${ok}/${pairs.length})`);
        } else if (r.status === 401) {
          failed++;
          deadSenders.add(sender.account.id);
          console.warn(`[bulk-friend] ${sender.account.username} token dead (401) — skipping all remaining sends from this account`);
        } else if (r.status === 403) {
          // Target has FRs disabled — try the reverse direction (target → sender).
          const t = await r.text().catch(() => '');
          if (t.includes('disabled') && target.token && !deadSenders.has(target.account.id)) {
            try {
              const rh = { ...await (await import('./discord-http')).discordHeaders(target.token!, true, undefined, target.account.id), 'x-context-properties': 'eyJsb2NhdGlvbiI6IkFkZCBGcmllbmQifQ==' };
              const rev = await (await import('./discord-http')).tlsFetch(
                `https://discord.com/api/v9/users/@me/relationships/${sender.discordUserId}`,
                { method: 'PUT', headers: rh, body: JSON.stringify({}), timeoutMs: 10_000, accountId: target.account.id },
              );
              if (rev.status === 204 || rev.status === 200) { ok++; console.log(`[bulk-friend] ${target.account.username} → ${sender.account.username} OK (reversed, ${ok}/${pairs.length})`); }
              else { failed++; console.warn(`[bulk-friend] ${target.account.username} → ${sender.account.username} reversed HTTP ${rev.status}`); }
            } catch { failed++; }
          } else {
            failed++;
            console.warn(`[bulk-friend] ${sender.account.username} → ${target.account.username} HTTP 403 ${t.slice(0, 120)}`);
          }
        } else {
          failed++;
          const t = await r.text().catch(() => '');
          console.warn(`[bulk-friend] ${sender.account.username} → ${target.account.username} HTTP ${r.status} ${t.slice(0, 120)}`);
        }
      } catch (err: any) {
        failed++;
        console.warn(`[bulk-friend] ${sender.account.username} → ${target.account.username} threw: ${err?.message || err}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 90_000));
    }
    console.log(`[bulk-friend] DONE ok=${ok} failed=${failed} total=${pairs.length} deadAccounts=${deadSenders.size}`);
  })().catch((err) => console.warn('[bulk-friend] fatal:', err?.message || err));
});
import("./warmup-campaign-routes").then(({ registerWarmupCampaignRoutes }) => {
  registerWarmupCampaignRoutes(app);
});

app.get('/api/unibox/conversations', async (req, res) => {
  // Paginated. Frontend hits limit=100 initially, then offset=100/200/... on scroll.
  // Hard-cap at 500 per request so a malformed query can't dump everything.
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  // Initial requests include a lightweight `summary` array (one row per
  // conversation in the entire dataset) so the filter chips can show real
  // totals, not just the count of LOADED conversations. Follow-up loadMore
  // requests pass summary=0 to skip the (now-unchanged) summary payload.
  const includeSummary = req.query.summary !== "0";

  // Sort: newest activity first. Only real conversations — pending leads are
  // managed by the campaign engine and shown on the campaign detail page.
  // Exclude conversations with no messages yet (empty wave-prepared channels)
  // — they show as blank rows and are noise. Empty preview = no message landed.
  const sorted = [...discordMockState.conversations]
    .filter((c) => !!c.lastMessagePreview && c.lastMessagePreview.trim() !== "")
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  const total = sorted.length;
  const pageSlice = sorted.slice(offset, offset + limit);

  // Decorate with per-conv inbound/outbound counts AND last-message direction.
  try {
    const [counts, directions] = await Promise.all([
      db.loadConversationMessageCounts(),
      db.loadConversationLastDirections(),
    ]);
    const decorate = (c: any) => {
      const k = counts.get(c.id);
      return {
        ...c,
        inboundCount: k?.inbound ?? 0,
        outboundCount: k?.outbound ?? 0,
        lastMessageDirection: directions.get(c.id) ?? null,
      };
    };
    const items = pageSlice.map(decorate);
    // Summary: only the fields ConvList needs to compute filter-chip counts
    // across the full set. Keeps the payload small (~70 bytes/row vs ~500 for
    // a full Conversation) so 1000+ conversations is still <100KB.
    const summary = includeSummary
      ? sorted.map((c) => {
          const k = counts.get(c.id);
          return {
            id: c.id,
            accountId: c.accountId,
            label: c.label,
            inboundCount: k?.inbound ?? 0,
            outboundCount: k?.outbound ?? 0,
            lastMessageDirection: directions.get(c.id) ?? null,
            interested: !!c.interested,
            lastMessagePreview: c.lastMessagePreview || '',
            // v0.48: surface peer ID so the frontend can exclude Discord
            // system DMs (user id 643945264868098049 — "Discord Safety" /
            // T&S notices) from the Needs reply filter + chip count.
            peerDiscordUserId: c.peer?.discordUserId || '',
          };
        })
      : null;
    return res.json({ items, total, hasMore: offset + limit < total, summary });
  } catch {
    return res.json({ items: pageSlice, total, hasMore: offset + limit < total, summary: null });
  }
});

app.get('/api/unibox/conversations/:id', (req, res) => {
  const conv = discordMockState.conversations.find((c) => c.id === req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  res.json(conv);
});

// Find a conversation by the peer's Discord user ID (for navigating from FR leads to Unibox).
app.get('/api/unibox/by-peer/:discordUserId', (req, res) => {
  const conv = discordMockState.conversations.find(
    (c) => c.peer?.discordUserId === req.params.discordUserId,
  );
  if (!conv) return res.status(404).json({ error: 'no conversation' });
  res.json({ conversationId: conv.id });
});

// Wave to the peer of a conversation via Discord's native wave button.
// Times out at 30s — if Discord shows a captcha, it waits indefinitely otherwise.
app.post('/api/unibox/conversations/:id/wave', async (req, res) => {
  const conv = discordMockState.conversations.find((c) => c.id === req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  const token: string | null = require('./discord-mock')._getCapturedToken(conv.accountId);
  if (!token) return res.status(400).json({ error: 'account not connected' });
  try {
    const result = await Promise.race([
      browserWaveToUser(conv.accountId, token, conv.id, conv.peer?.displayName ?? undefined),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('wave timeout')), 30_000)),
    ]);
    if (!result.ok) return res.status(500).json({ error: `HTTP ${result.status}` });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'wave failed' });
  }
});

// GET /api/proxy-audio?url=https://cdn.discordapp.com/...
// Proxies Discord CDN audio through our server so the browser loads it from
// the same origin, bypassing CORS/CORP headers on the CDN. Also transcodes
// to MP3 (libmp3lame) for universal browser playback including Safari.
app.get('/api/proxy-audio', async (req, res) => {
  const url = String(req.query?.url || '').trim();
  if (!url.startsWith('https://cdn.discordapp.com/') && !url.startsWith('https://media.discordapp.net/')) {
    return res.status(400).json({ error: 'only Discord CDN URLs are allowed' });
  }
  try {
    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).end();
    const inputBuffer = Buffer.from(await r.arrayBuffer());
    // Transcode to MP3 for universal compatibility (Safari doesn't play OGG/WebM).
    const result = spawnSync('ffmpeg', [
      '-i', 'pipe:0',
      '-c:a', 'libmp3lame',
      '-b:a', '96k',
      '-f', 'mp3',
      'pipe:1',
    ], { input: inputBuffer, maxBuffer: 20 * 1024 * 1024, timeout: 30_000 });
    if (result.status === 0 && result.stdout?.length) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(result.stdout);
    }
    // ffmpeg failed — serve raw with original content type.
    res.setHeader('Content-Type', r.headers.get('content-type') || 'audio/ogg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(inputBuffer);
  } catch (err: any) {
    res.status(502).json({ error: err?.message || 'proxy failed' });
  }
});

app.get('/api/unibox/conversations/:id/messages', async (req, res) => {
  const conv = discordMockState.conversations.find((c) => c.id === req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  let msgs = discordMockState.messages.get(req.params.id);
  if (!msgs || msgs.length === 0) {
    // Lazy-load from DB on first access (post-restart).
    try {
      msgs = await db.loadMessagesForConversation(req.params.id);
      if (msgs.length) discordMockState.messages.set(req.params.id, msgs);
    } catch { msgs = []; }
  }
  conv.unreadCount = 0;
  db.upsertConversation(conv).catch(() => {});
  res.json(msgs || []);
});

app.post('/api/unibox/conversations/:id/send', async (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'body required' });
  const convId = req.params.id;

  // Lookup the conversation + extract channel_id (live convs are `live_<channelId>`).
  const conv = discordMockState.conversations.find((c) => c.id === convId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  // For live convs, actually POST to Discord. Otherwise fall back to the in-memory mock (legacy demo).
  if (convId.startsWith('live_')) {
    const channelId = convId.slice('live_'.length);
    const acct = discordMockState.accounts.find((a) => a.id === conv.accountId);
    if (!acct) return res.status(400).json({ error: 'Account for this conversation not found' });
    const token = require('./discord-mock')._getCapturedToken(conv.accountId);
    if (!token) return res.status(400).json({ error: 'No captured token for this account — re-add it' });

    // For Unibox ongoing conversations use direct TLS send — much faster than driving the full browser UI.
    // (browser path is still available for cold/warmup where extra stealth or manual captcha handling may be wanted)
    const { tlsSendWithCaptcha } = require('./discord-send');
    const result = await tlsSendWithCaptcha(conv.accountId, token, channelId, body);
    if (!result.ok) {
      console.warn(`[send] Discord rejected acct=${conv.accountId} channel=${channelId} status=${result.httpStatus} err=${result.error}`);
      return res.status(result.httpStatus || 502).json({ error: result.error || 'Discord rejected the message' });
    }

    // Optimistically store the message ourselves (the gateway WS will also echo it back via MESSAGE_CREATE).
    const msg = {
      id: `live_msg_${result.discordMessageId}`,
      conversationId: convId,
      direction: 'out' as const,
      body: result.body || body,
      sentAt: result.sentAt || new Date().toISOString(),
      authorName: acct.username,
      authorAvatarUrl: acct.avatarUrl,
    };
    const msgs = discordMockState.messages.get(convId) || [];
    if (!msgs.some((m) => m.id === msg.id)) {
      msgs.push(msg);
      discordMockState.messages.set(convId, msgs);
    }
    conv.lastMessagePreview = msg.body.slice(0, 80);
    conv.lastMessageAt = msg.sentAt;
    db.insertMessage(msg).catch(() => {});
    db.upsertConversation(conv).catch(() => {});
    publishExternalEvent({ type: 'message_out', conversationId: convId, message: msg, ts: msg.sentAt });
    return res.json(msg);
  }

  // Legacy / demo conv path (shouldn't be hit in v0.7+ but keeping for back-compat).
  const msg = mockSendMessage(convId, body);
  if (!msg) return res.status(404).json({ error: 'Conversation not found' });
  res.json(msg);
});

// POST /api/unibox/conversations/:id/send-image
// Body: { imageBase64: string, filename: string, mimeType: string, caption?: string }
app.post('/api/unibox/conversations/:id/send-image', async (req, res) => {
  const { imageBase64, filename, mimeType, caption } = req.body || {};
  if (!imageBase64 || !filename || !mimeType) {
    return res.status(400).json({ error: 'imageBase64, filename, mimeType required' });
  }
  const convId = req.params.id;
  const conv = discordMockState.conversations.find((c) => c.id === convId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  if (!convId.startsWith('live_')) return res.status(400).json({ error: 'Image sending only works on live conversations' });

  const channelId = convId.slice('live_'.length);
  const token = require('./discord-mock')._getCapturedToken(conv.accountId);
  if (!token) return res.status(400).json({ error: 'No token for this account' });

  const fileBuffer = Buffer.from(imageBase64, 'base64');
  const { sendDiscordFile } = require('./discord-http');
  const result = await sendDiscordFile(conv.accountId, token, channelId, fileBuffer, mimeType, filename, caption || '');
  if (!result.ok) return res.status(result.httpStatus || 502).json({ error: result.error || 'Discord rejected the upload' });

  const acct = discordMockState.accounts.find((a) => a.id === conv.accountId);
  // Encode the CDN URL into the body using the [img:URL] convention so ChatPane renders it as an image.
  const imgTag = result.attachmentUrl ? `[img:${result.attachmentUrl}]` : `[img:${filename}]`;
  const body = caption ? `${caption}\n${imgTag}` : imgTag;
  const msg = {
    id: `live_msg_${result.discordMessageId}`,
    conversationId: convId,
    direction: 'out' as const,
    body,
    sentAt: new Date().toISOString(),
    authorName: acct?.username || '',
    authorAvatarUrl: acct?.avatarUrl || null,
  };
  const msgs = discordMockState.messages.get(convId) || [];
  if (!msgs.some((m) => m.id === msg.id)) { msgs.push(msg); discordMockState.messages.set(convId, msgs); }
  conv.lastMessagePreview = caption || `[image]`;
  conv.lastMessageAt = msg.sentAt;
  db.insertMessage(msg).catch(() => {});
  db.upsertConversation(conv).catch(() => {});
  publishExternalEvent({ type: 'message_out', conversationId: convId, message: msg, ts: msg.sentAt });
  res.json(msg);
});

// POST /api/unibox/conversations/:id/send-voice
// Body: { audioBase64: string, mimeType: string, durationSecs: number }
app.post('/api/unibox/conversations/:id/send-voice', async (req, res) => {
  const { audioBase64, mimeType, durationSecs } = req.body || {};
  if (!audioBase64 || !mimeType) {
    return res.status(400).json({ error: 'audioBase64 and mimeType required' });
  }
  const convId = req.params.id;
  const conv = discordMockState.conversations.find((c) => c.id === convId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  if (!convId.startsWith('live_')) return res.status(400).json({ error: 'Voice messages only work on live conversations' });

  const channelId = convId.slice('live_'.length);
  const token = require('./discord-mock')._getCapturedToken(conv.accountId);
  if (!token) return res.status(400).json({ error: 'No token for this account' });

  const audioBuffer = Buffer.from(audioBase64, 'base64');
  const dur = Number(durationSecs) || 1;
  const { sendDiscordVoice } = require('./discord-http');
  const result = await sendDiscordVoice(conv.accountId, token, channelId, audioBuffer, mimeType, dur);
  if (!result.ok) return res.status(result.httpStatus || 502).json({ error: result.error || 'Discord rejected the voice message' });

  const acct = discordMockState.accounts.find((a) => a.id === conv.accountId);
  const voiceTag = result.attachmentUrl ? `[voice:${result.attachmentUrl}]` : '[voice message]';
  const msg = {
    id: `live_msg_${result.discordMessageId}`,
    conversationId: convId,
    direction: 'out' as const,
    body: voiceTag,
    sentAt: new Date().toISOString(),
    authorName: acct?.username || '',
    authorAvatarUrl: acct?.avatarUrl || null,
  };
  const msgs = discordMockState.messages.get(convId) || [];
  if (!msgs.some((m) => m.id === msg.id)) { msgs.push(msg); discordMockState.messages.set(convId, msgs); }
  conv.lastMessagePreview = '[voice message]';
  conv.lastMessageAt = msg.sentAt;
  db.insertMessage(msg).catch(() => {});
  db.upsertConversation(conv).catch(() => {});
  publishExternalEvent({ type: 'message_out', conversationId: convId, message: msg, ts: msg.sentAt });
  res.json(msg);
});

// DELETE /api/unibox/conversations/:id/messages/:messageId
// Deletes a message both on Discord and locally (for own outgoing messages).
app.delete('/api/unibox/conversations/:id/messages/:messageId', async (req, res) => {
  const convId = req.params.id;
  const messageId = req.params.messageId;
  const conv = discordMockState.conversations.find((c) => c.id === convId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  if (convId.startsWith('live_')) {
    const channelId = convId.slice('live_'.length);
    const token = require('./discord-mock')._getCapturedToken(conv.accountId);
    if (!token) return res.status(400).json({ error: 'No token for this account' });

    const { tlsFetch, discordHeaders } = await import('./discord-http');

    // live_msg_xxx ids wrap the real Discord message id
    let discordMsgId = messageId;
    if (messageId.startsWith('live_msg_')) discordMsgId = messageId.slice(9);

    const url = `https://discord.com/api/v9/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(discordMsgId)}`;
    const r = await tlsFetch(url, {
      method: 'DELETE',
      headers: await discordHeaders(token, false, undefined, conv.accountId),
      timeoutMs: 15000,
      accountId: conv.accountId,
    });
    if (!r.ok && r.status !== 404) {
      const txt = await r.text();
      return res.status(r.status || 502).json({ error: txt.slice(0, 200) || 'Discord delete failed' });
    }

    // remove locally
    const msgs = discordMockState.messages.get(convId) || [];
    const filtered = msgs.filter((m) => m.id !== messageId);
    discordMockState.messages.set(convId, filtered);

    await db.deleteMessage(convId, messageId).catch(() => {});
    await db.updateConversationLastMessage(convId).catch(() => {});

    // Update in-memory conv preview
    const remaining = filtered;
    if (conv) {
      if (remaining.length > 0) {
        const last = remaining.reduce((a, b) => new Date(a.sentAt) > new Date(b.sentAt) ? a : b);
        conv.lastMessagePreview = last.body.slice(0, 80);
        conv.lastMessageAt = last.sentAt;
      } else {
        conv.lastMessagePreview = '';
        conv.lastMessageAt = null as any;
      }
    }

    publishExternalEvent({ type: 'message_deleted', conversationId: convId, messageId, ts: new Date().toISOString() } as any);
    return res.json({ ok: true });
  }

  // demo path
  const msgs = discordMockState.messages.get(convId) || [];
  const filtered = msgs.filter((m) => m.id !== messageId);
  discordMockState.messages.set(convId, filtered);
  await db.deleteMessage(convId, messageId).catch(() => {});
  await db.updateConversationLastMessage(convId).catch(() => {});
  res.json({ ok: true });
});

// POST /api/unibox/bulk-send  (v0.34)
//
// Fire a randomly-picked template variant to every selected conversation.
// Sequential with light spacing (500ms) so we don't burst-trigger Discord's
// rate limiter; per-conversation result captured. Does NOT honor the per-
// account 6/day campaign cap — this is operator-initiated, they own the risk.
//
// Body: { conversationIds: string[], templates: string[] }
// Resp: { ok, sent, failed, perAccount: [{accountId, sent, failed}], failures: [...] }
app.post('/api/unibox/bulk-send', async (req, res) => {
  const conversationIds: string[] = Array.isArray(req.body?.conversationIds) ? req.body.conversationIds.map(String) : [];
  const templates: string[] = Array.isArray(req.body?.templates)
    ? req.body.templates.map((t: any) => String(t || '').trim()).filter((t: string) => t.length > 0)
    : [];
  // v0.39 — operator-configurable per-send spacing. Default 3000ms, range 500–30000ms.
  const rawSpacing = Number(req.body?.spacingMs);
  const spacingMs = Number.isFinite(rawSpacing) && rawSpacing > 0
    ? Math.max(500, Math.min(30000, Math.round(rawSpacing)))
    : 3000;
  if (conversationIds.length === 0) return res.status(400).json({ error: 'conversationIds required' });
  if (templates.length === 0) return res.status(400).json({ error: 'templates required' });
  if (conversationIds.length > 500) return res.status(400).json({ error: 'max 500 conversations per request' });

  const { _getCapturedToken } = require('./discord-mock');
  const { sendDiscordMessage } = require('./discord-send');

  let sent = 0;
  let failed = 0;
  const perAccountMap = new Map<string, { sent: number; failed: number }>();
  const failures: { conversationId: string; error: string }[] = [];

  for (const convId of conversationIds) {
    const conv = discordMockState.conversations.find((c) => c.id === convId);
    if (!conv) {
      failed += 1;
      failures.push({ conversationId: convId, error: 'conversation not found' });
      continue;
    }
    if (!convId.startsWith('live_')) {
      failed += 1;
      failures.push({ conversationId: convId, error: 'not a live conversation' });
      continue;
    }
    const channelId = convId.slice('live_'.length);
    const acct = discordMockState.accounts.find((a) => a.id === conv.accountId);
    if (!acct) {
      failed += 1;
      failures.push({ conversationId: convId, error: 'account missing' });
      continue;
    }
    const token = _getCapturedToken(conv.accountId);
    if (!token) {
      failed += 1;
      failures.push({ conversationId: convId, error: 'no captured token' });
      continue;
    }

    // Pick a random variant, then render simple template tokens against the
    // peer's display name. Same substitution set the campaign engine uses.
    const variant = templates[Math.floor(Math.random() * templates.length)];
    const peerName = conv.peer?.displayName || '';
    const body = variant
      .replace(/\{\{firstName\}\}/g, peerName)
      .replace(/\{\{username\}\}/g, peerName);

    const result = await sendDiscordMessage(conv.accountId, token, channelId, body, {
      recipientUserId: conv.peer?.discordUserId,
      recipientDisplayName: conv.peer?.displayName,
    });
    const bucket = perAccountMap.get(conv.accountId) || { sent: 0, failed: 0 };
    if (result.ok) {
      sent += 1;
      bucket.sent += 1;
      // Optimistically store the message + bump conversation state, mirroring
      // the per-conversation /send endpoint so the unibox refresh shows it.
      const msg = {
        id: `live_msg_${result.discordMessageId}`,
        conversationId: convId,
        direction: 'out' as const,
        body: result.body || body,
        sentAt: result.sentAt || new Date().toISOString(),
        authorName: acct.username,
        authorAvatarUrl: acct.avatarUrl,
      };
      const msgs = discordMockState.messages.get(convId) || [];
      if (!msgs.some((m) => m.id === msg.id)) {
        msgs.push(msg);
        discordMockState.messages.set(convId, msgs);
      }
      conv.lastMessagePreview = msg.body.slice(0, 80);
      conv.lastMessageAt = msg.sentAt;
      db.insertMessage(msg).catch((err) => console.warn(`[bulk-send] insertMessage failed: ${err?.message || err}`));
      db.upsertConversation(conv).catch((err) => console.warn(`[bulk-send] upsertConversation failed: ${err?.message || err}`));
      publishExternalEvent({ type: 'message_out', conversationId: convId, message: msg, ts: msg.sentAt });
      // v0.42 — bulk-send is now the "real" outreach path. When we send a
      // template to a conversation that has a matching pending lead in any
      // campaign, mark it sent so the campaign detail view + per-account
      // stats + suspensions all reflect reality. Without this, totals_sent
      // stays 0 forever and "Waved" filters never clear.
      try {
        const lead = await db.findPendingLeadByDiscordUserId(conv.accountId, String(conv.peer?.discordUserId || ''));
        if (lead && lead.status === 'pending') {
          await db.setLeadStatus(lead.id, 'sent', conv.accountId);
          await db.bumpCampaignTotal(lead.campaignId, 'sent');
          publishExternalEvent({ type: 'dm_sent', campaignId: lead.campaignId, leadId: lead.id, ts: msg.sentAt });
          console.log(`[bulk-send] marked lead=${lead.id} campaign=${lead.campaignId} as sent (via bulk-send to ${convId})`);
        }
      } catch (err: any) {
        console.warn(`[bulk-send] lead-progression failed for conv=${convId}: ${err?.message || err}`);
      }
    } else {
      failed += 1;
      bucket.failed += 1;
      failures.push({ conversationId: convId, error: result.error || `HTTP ${result.httpStatus}` });
    }
    perAccountMap.set(conv.accountId, bucket);
    // v0.39: operator-controlled spacing (default 3s). Discord's anti-spam
    // dislikes bursty sends from a single proxy IP, so default a bit slow.
    await new Promise((r) => setTimeout(r, spacingMs));
  }

  const perAccount = Array.from(perAccountMap.entries()).map(([accountId, b]) => ({
    accountId,
    accountUsername: discordMockState.accounts.find((a) => a.id === accountId)?.username || accountId,
    sent: b.sent,
    failed: b.failed,
  }));
  console.log(`[bulk-send] sent=${sent} failed=${failed} convs=${conversationIds.length} variants=${templates.length} spacing=${spacingMs}ms`);
  res.json({ ok: true, sent, failed, perAccount, failures });
});

// ───── Discord Explore (Discovery) ───────────────────────────────────────────
// Browses Discord's official server directory through a captured account's token
// via the residential proxy. Returns the same data Discord's in-app Explore uses.

// GET /api/discord/discover/categories?accountId=...
app.get('/api/discord/discover/categories', async (req, res) => {
  const accountId = String(req.query.accountId || '');
  if (!accountId) return res.status(400).json({ error: 'accountId required' });
  const token = require('./discord-mock')._getCapturedToken(accountId);
  if (!token) return res.status(400).json({ error: 'No token for account' });
  const cats = await listDiscoveryCategories(token);
  res.json({ categories: cats });
});

// GET /api/discord/discover?accountId=&category=&q=&offset=&limit=
app.get('/api/discord/discover', async (req, res) => {
  const accountId = String(req.query.accountId || '');
  if (!accountId) return res.status(400).json({ error: 'accountId required' });
  const token = require('./discord-mock')._getCapturedToken(accountId);
  if (!token) return res.status(400).json({ error: 'No token for account' });
  const result = await searchDiscoverableGuilds(token, {
    categoryId: req.query.category ? Number(req.query.category) : undefined,
    query: req.query.q ? String(req.query.q) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
  });
  res.json(result);
});

// POST /api/accounts/:id/join-discoverable  body: { guildId }
app.post('/api/accounts/:id/join-discoverable', async (req, res) => {
  const acct = discordMockState.accounts.find((a) => a.id === req.params.id);
  if (!acct) return res.status(404).json({ error: 'Account not found' });
  const token = require('./discord-mock')._getCapturedToken(req.params.id);
  if (!token) return res.status(400).json({ error: 'No token for account' });
  const guildId = String(req.body?.guildId || '').trim();
  if (!guildId) return res.status(400).json({ error: 'guildId required' });
  const result = await joinDiscoverableGuild(token, guildId);
  if (!result.ok) {
    console.warn(`[discover] join account=${req.params.id} guild=${guildId} status=${result.httpStatus} err=${result.error}`);
    return res.status(result.httpStatus || 400).json({ error: result.error });
  }
  console.log(`[discover] joined account=${req.params.id} guild=${guildId}`);
  res.json({ ok: true });
});

// POST /api/accounts/:id/join-invite — join a Discord server using an invite code/URL.
// v0.46: surfaces Discord captcha challenges so the operator can solve via the
// hCaptcha widget and retry with captchaKey + captchaRqtoken in the body.
app.post('/api/accounts/:id/join-invite', async (req, res) => {
  const acct = discordMockState.accounts.find((a) => a.id === req.params.id);
  if (!acct) return res.status(404).json({ error: 'Account not found' });
  const token = require('./discord-mock')._getCapturedToken(req.params.id);
  if (!token) return res.status(400).json({ error: 'No token for this account' });
  const invite = String(req.body?.invite || '').trim();
  if (!invite) return res.status(400).json({ error: 'invite required' });
  const captchaKey = typeof req.body?.captchaKey === 'string' ? req.body.captchaKey : undefined;
  const captchaRqtoken = typeof req.body?.captchaRqtoken === 'string' ? req.body.captchaRqtoken : undefined;
  const captchaSessionId = typeof req.body?.captchaSessionId === 'string' ? req.body.captchaSessionId : undefined;
  const result = await joinByInvite(token, invite, captchaKey, captchaRqtoken, captchaSessionId, req.params.id);
  if (result.captcha) {
    console.log(`[join-invite] account=${req.params.id} captcha challenge sitekey=${result.captcha.sitekey.slice(0,8)}…`);
    return res.status(400).json({ captcha: result.captcha });
  }
  if (!result.ok) {
    console.warn(`[join-invite] account=${req.params.id} → ${invite}: ${result.error}`);
    return res.status(result.httpStatus || 400).json({ error: result.error });
  }
  db.logActivity(req.params.id, 'server_join', {
    guildId: result.guildId,
    guildName: result.guildName,
    inviteCode: extractInviteCode(invite) || invite,
    manual: true,
  });
  console.log(`[join-invite] account=${req.params.id} joined guild=${result.guildId} name=${result.guildName}`);
  res.json(result);
});

// POST /api/groups/:id/bulk-join — bulk-join every captured account in a group
// to a Discord server via an invite link. Processes accounts sequentially with
// ~3s spacing. Returns a per-account result array including any captcha
// challenges so the operator can solve them one at a time via the modal.
// Body: { invite: string }
app.post('/api/groups/:id/bulk-join', async (req, res) => {
  const group = await db.getGroup(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const invite = String(req.body?.invite || '').trim();
  if (!invite) return res.status(400).json({ error: 'invite required' });

  const { _getCapturedToken } = require('./discord-mock');
  type Row = { accountId: string; accountUsername: string; ok: boolean; guildId?: string; guildName?: string; error?: string; captcha?: any };
  const results: Row[] = [];
  for (const m of group.members) {
    const acct = discordMockState.accounts.find((a) => a.id === m.accountId);
    const accountUsername = acct?.username || m.accountId;
    const token = _getCapturedToken(m.accountId);
    if (!token) {
      results.push({ accountId: m.accountId, accountUsername, ok: false, error: 'no captured token' });
      continue;
    }
    const r = await joinByInvite(token, invite, undefined, undefined, undefined, m.accountId);
    if (r.captcha) {
      results.push({ accountId: m.accountId, accountUsername, ok: false, captcha: r.captcha });
    } else if (r.ok) {
      db.logActivity(m.accountId, 'server_join', {
        guildId: r.guildId,
        guildName: r.guildName,
        inviteCode: extractInviteCode(invite) || invite,
        via: 'bulk-join',
      });
      results.push({ accountId: m.accountId, accountUsername, ok: true, guildId: r.guildId, guildName: r.guildName });
    } else {
      results.push({ accountId: m.accountId, accountUsername, ok: false, error: r.error || `HTTP ${r.httpStatus}` });
    }
    // Light spacing — joins from the same proxy IP within seconds spike risk.
    await new Promise((res) => setTimeout(res, 3000));
  }
  console.log(`[bulk-join] group=${group.id} invite=${invite} results=${results.filter((x) => x.ok).length}/${results.length}`);
  res.json({ ok: true, results });
});

// POST /api/accounts/bulk-import-tokens — accept many tokens, verify each, provision sequentially.
// Body: { tokens: string[], label?: string }
// Returns: { results: Array<{ token_preview, ok, accountId?, error? }> }
app.post('/api/accounts/bulk-import-tokens', async (req, res) => {
  const tokens: string[] = Array.isArray(req.body?.tokens) ? req.body.tokens.map(String) : [];
  if (!tokens.length) return res.status(400).json({ error: 'tokens[] required' });
  const labelPrefix = String(req.body?.label || '').trim();

  const results: Array<{ tokenPreview: string; ok: boolean; accountId?: string; username?: string; error?: string }> = [];
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i].trim();
    const preview = raw.slice(0, 10) + '…' + raw.slice(-4);
    if (!raw) {
      results.push({ tokenPreview: '(empty)', ok: false, error: 'empty token' });
      continue;
    }
    const verify = await verifyDiscordToken(raw);
    if (!verify.ok || !verify.user) {
      results.push({ tokenPreview: preview, ok: false, error: verify.reason || 'verification failed' });
      continue;
    }
    const label = labelPrefix ? `${labelPrefix} ${i + 1}` : (verify.user.global_name || verify.user.username);
    const acct = createAccountFromQr(
      {
        id: verify.user.id,
        username: verify.user.global_name || verify.user.username,
        discriminator: verify.user.discriminator,
        avatarHash: verify.user.avatarHash,
      },
      raw,
      label,
    );
    db.upsertDiscordAccount(acct, raw, verify.user.id).catch(() => {});
    attachLiveAccount(acct.id);
    attachGateway(acct.id, raw);
    results.push({ tokenPreview: preview, ok: true, accountId: acct.id, username: acct.username });
  }
  res.json({ results, summary: { total: tokens.length, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length } });
});

// GET /api/accounts/:id/guilds — list of servers this account is a member of.
// Uses the in-memory gateway state captured at READY (instant). Falls back to
// a live Discord API call only if the gateway hasn't connected yet.
app.get('/api/accounts/:id/guilds', async (req, res) => {
  const acct = discordMockState.accounts.find((a) => a.id === req.params.id);
  if (!acct) return res.status(404).json({ error: 'Account not found' });
  const cached = getAccountGuilds(req.params.id);
  if (cached.length > 0) return res.json({ guilds: cached });
  const token = require('./discord-mock')._getCapturedToken(req.params.id);
  if (!token) return res.json({ guilds: [] });
  const guilds = await listAccountGuilds(token);
  res.json({ guilds });
});

// POST /api/accounts/:id/guilds/:guildId/scrape — try OP 8 first (small guilds, fast),
// auto-fall-back to OP 14 LAZY_GUILD_REQUEST for larger ones.
// Returns { members: ScrapedMember[], truncated: bool, chunks: number, via: 'op8'|'op14', cached?: bool, scrapedAt?: string }.
//
// Cache behavior (v0.20+):
//   - Default: if we have a cached scrape for this (account, guild), return that.
//   - ?force=1 in the query string OR `force: true` in the JSON body: bypass cache, scrape fresh.
app.post('/api/accounts/:id/guilds/:guildId/scrape', async (req, res) => {
  const acct = discordMockState.accounts.find((a) => a.id === req.params.id);
  if (!acct) return res.status(404).json({ error: 'Account not found' });
  const token = require('./discord-mock')._getCapturedToken(req.params.id);
  if (!token) return res.status(400).json({ error: 'No token for this account' });

  const force = req.query.force === '1' || req.body?.force === true;
  // v0.55: filter already-contacted leads so the operator doesn't re-message
  // someone with a different account. The default is ON. Pass
  // `?includeContacted=1` (or `{ includeContacted: true }`) to opt out.
  const includeContacted = req.query.includeContacted === '1' || req.body?.includeContacted === true;
  const contacted = includeContacted ? new Set<string>() : await db.getAlreadyContactedDiscordUserIds();
  const filterContacted = (members: any[]): { kept: any[]; excluded: number } => {
    if (contacted.size === 0) return { kept: members, excluded: 0 };
    const kept = members.filter((m) => !contacted.has(String(m?.id)));
    return { kept, excluded: members.length - kept.length };
  };

  // v0.58 — read fanout targets early so we can mirror cache-hits too.
  const applyToAccountIdsEarly: string[] = Array.isArray(req.body?.applyToAccountIds)
    ? req.body.applyToAccountIds.map(String).filter((x: string) => x && x !== req.params.id)
    : [];

  if (!force) {
    const cached = await db.getCachedGuildScrape(req.params.id, req.params.guildId);
    if (cached) {
      // Mirror to any paired accounts that don't already have this scrape.
      for (const otherAccountId of applyToAccountIdsEarly) {
        const existing = await db.getCachedGuildScrape(otherAccountId, req.params.guildId);
        if (!existing) {
          db.saveScrapedGuildMembers({
            accountId: otherAccountId,
            guildId: req.params.guildId,
            guildName: cached.guildName || req.body?.guildName || null,
            members: cached.members,
            via: `${cached.via || 'cache'}+fanout`,
            truncated: cached.truncated,
          }).catch((e: any) => console.warn(`[scrape-fanout-cache] save failed acct=${otherAccountId}: ${e?.message || e}`));
        }
      }
      const { kept, excluded } = filterContacted(cached.members);
      console.log(`[scrape] account=${req.params.id} guild=${req.params.guildId} returning cache (${cached.memberCount} members, ${excluded} excluded as already-contacted, fanout=${applyToAccountIdsEarly.length}, scraped ${cached.scrapedAt})`);
      return res.json({
        members: kept,
        truncated: cached.truncated,
        chunks: 0,
        via: cached.via || 'cache',
        cached: true,
        scrapedAt: cached.scrapedAt,
        excludedAlreadyContacted: excluded,
      });
    }
  }

  const approxFromBody = req.body?.approximateMemberCount;
  const approx = typeof approxFromBody === 'number' ? approxFromBody : null;
  // v0.58: fan-out the scrape result to additional accounts that are ALSO in
  // this server. The wizard deduplicates scraping (v0.53) so only one account
  // does the heavy member fetch — but eligibility is keyed by account_id, so
  // we need rows in `scraped_guild_members` for every account the operator
  // paired with this guild. The wizard sends `applyToAccountIds: string[]`
  // (the other paired accounts) so we mirror the scrape under each one.
  const applyToAccountIds: string[] = Array.isArray(req.body?.applyToAccountIds)
    ? req.body.applyToAccountIds.map(String).filter((x: string) => x && x !== req.params.id)
    : [];
  try {
    // Try the primary account first, then applyToAccountIds, then any other account
    // whose gateway is actually OPEN and has joined this guild. This handles the case
    // where the selected account's WebSocket has dropped but other accounts are live.
    const { isGatewayOpen: gwOpen, getAccountGuilds: gwGuilds, gatewayStatus: gwStatus } = require('./discord-gateway');
    const { _getCapturedToken: getToken } = require('./discord-mock');

    let result = null as Awaited<ReturnType<typeof scrapeGuildMembersSmart>> | null;
    let usedAccountId = req.params.id;
    let usedToken = token;

    // Build candidate list: primary first, then applyToAccountIds, then any other open account in the guild.
    const broadFallbacks: string[] = gwStatus()
      .filter((s: any) => gwOpen(s.accountId) && s.accountId !== req.params.id && !applyToAccountIds.includes(s.accountId))
      .filter((s: any) => gwGuilds(s.accountId).some((g: any) => g.id === req.params.guildId))
      .map((s: any) => s.accountId);
    const candidates = [req.params.id, ...applyToAccountIds, ...broadFallbacks];

    for (const candidateId of candidates) {
      const candidateToken = candidateId === req.params.id ? token : getToken(candidateId);
      if (!candidateToken) continue;
      try {
        result = await scrapeGuildMembersSmart(candidateId, req.params.guildId, approx, candidateToken);
        usedAccountId = candidateId;
        usedToken = candidateToken;
        if (candidateId !== req.params.id) {
          console.log(`[scrape] primary acct=${req.params.id} gateway down — scraped via ${candidateId}`);
        }
        break;
      } catch (e: any) {
        if (e?.message !== "gateway not connected for this account") throw e; // real error — surface it
        // gateway not connected for this candidate — try next
      }
    }
    if (!result) throw new Error("No account with an open gateway connection is in this server");
    console.log(`[scrape] account=${usedAccountId} guild=${req.params.guildId} via=${result.via} members=${result.members.length} chunks=${result.chunks} truncated=${result.truncated} fanout=${applyToAccountIds.length}`);
    // Persist under all paired accounts (actual scraper + fanout).
    for (const saveId of [req.params.id, ...applyToAccountIds]) {
      db.saveScrapedGuildMembers({
        accountId: saveId,
        guildId: req.params.guildId,
        guildName: req.body?.guildName || null,
        members: result.members,
        via: saveId === usedAccountId ? result.via : `${result.via}+fanout`,
        truncated: result.truncated,
      }).catch((e: any) => console.warn(`[scrape] cache save failed acct=${saveId}: ${e?.message || e}`));
    }
    const { kept, excluded } = filterContacted(result.members);
    if (excluded > 0) console.log(`[scrape] account=${req.params.id} guild=${req.params.guildId} excluded ${excluded} already-contacted leads`);
    res.json({ ...result, members: kept, excludedAlreadyContacted: excluded, cached: false });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'scrape failed' });
  }
});

// GET /api/accounts/:id/guilds/:guildId/scraped-cache — peek at cached scrape
// without triggering a fresh one. Used by the wizard to show "X members
// already scraped Y ago, re-scrape?" before hitting Discord.
app.get('/api/accounts/:id/guilds/:guildId/scraped-cache', async (req, res) => {
  const cached = await db.getCachedGuildScrape(req.params.id, req.params.guildId);
  if (!cached) return res.json({ cached: false });
  res.json({
    cached: true,
    memberCount: cached.memberCount,
    scrapedAt: cached.scrapedAt,
    via: cached.via,
    truncated: cached.truncated,
  });
});

// GET /api/accounts/:id/log — aggregated activity log for an account.
// Returns up to 200 entries from outreach campaign sends, warmup messages,
// and key status events (dead_since, token_revoked) so the operator can
// trace what happened before a revocation.
app.get('/api/accounts/:id/log', async (req, res) => {
  const accountId = req.params.id;
  try {
    const [outreach, warmup, warmupDeadSince] = await Promise.all([
      // Outreach campaign sends (sent + failed) by this account
      db.query<{
        ts: string; campaign_name: string; lead_discord_id: string;
        status: string; error: string | null; http_status: number | null;
      }>(
        `SELECT l.dm_sent_at AS ts, c.name AS campaign_name,
                l.discord_user_id AS lead_discord_id, l.status,
                l.dm_error AS error, NULL::integer AS http_status
           FROM tenant_main.leads l
           JOIN tenant_main.campaigns c ON c.id = l.campaign_id
          WHERE l.assigned_account_id = $1
            AND l.dm_sent_at IS NOT NULL
          ORDER BY l.dm_sent_at DESC
          LIMIT 100`,
        [accountId],
      ),
      // Warmup messages sent by this account
      db.query<{
        ts: string; campaign_id: string; recipient_id: string;
        ok: boolean; http_status: number | null; error: string | null; content: string;
      }>(
        `SELECT wm.sent_at AS ts, wm.campaign_id, wm.recipient_account_id AS recipient_id,
                wm.ok, wm.http_status, wm.error, LEFT(wm.content, 80) AS content
           FROM tenant_main.warmup_campaign_messages wm
          WHERE wm.sender_account_id = $1
          ORDER BY wm.sent_at DESC
          LIMIT 100`,
        [accountId],
      ),
      // Account dead_since per warmup campaign (when token went bad)
      db.query<{ campaign_id: string; dead_since: string | null }>(
        `SELECT campaign_id, dead_since
           FROM tenant_main.warmup_campaign_accounts
          WHERE account_id = $1 AND dead_since IS NOT NULL`,
        [accountId],
      ),
    ]);

    // Merge into a unified timeline, newest first
    const entries: Array<{
      ts: string; kind: string; ok: boolean; summary: string; detail?: string;
    }> = [];

    for (const r of outreach) {
      entries.push({
        ts: r.ts,
        kind: 'outreach',
        ok: r.status === 'sent' || r.status === 'replied',
        summary: r.status === 'sent' || r.status === 'replied'
          ? `Sent outreach DM in "${r.campaign_name}"`
          : `Outreach failed in "${r.campaign_name}"`,
        detail: r.error || undefined,
      });
    }

    for (const r of warmup) {
      entries.push({
        ts: r.ts,
        kind: 'warmup',
        ok: r.ok,
        summary: r.ok ? `Warmup message sent` : `Warmup send failed (HTTP ${r.http_status ?? '?'})`,
        detail: r.ok ? r.content : (r.error || r.content),
      });
    }

    for (const r of warmupDeadSince) {
      if (r.dead_since) {
        entries.push({
          ts: r.dead_since,
          kind: 'status',
          ok: false,
          summary: 'Token marked as revoked (401 from Discord)',
          detail: `Campaign ${r.campaign_id}`,
        });
      }
    }

    // Also include current account status
    const acct = discordMockState.accounts.find((a) => a.id === accountId);
    if (acct?.status === 'token_revoked' && acct.lastStatusAt) {
      entries.push({
        ts: acct.lastStatusAt,
        kind: 'status',
        ok: false,
        summary: 'Gateway closed with code 4004 — token revoked by Discord',
      });
    }

    entries.sort((a, b) => b.ts.localeCompare(a.ts));
    res.json({ entries: entries.slice(0, 200) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'failed' });
  }
});

// POST /api/accounts/sync-emails — backfill cached_email for every account that has a token
// but no email stored. Runs the same per-account fetch as GET /api/accounts/:id/email,
// 1 req/s to stay clear of Discord rate limits.
app.post('/api/accounts/sync-emails', async (_req, res) => {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM tenant_main.discord_accounts WHERE cached_email IS NULL AND token_encrypted IS NOT NULL`,
  );
  if (rows.length === 0) return res.json({ synced: 0, skipped: 0 });
  // Fire-and-forget background loop; respond immediately so the client isn't blocked.
  res.json({ started: true, total: rows.length });
  void (async () => {
    const { tlsFetch, discordHeaders } = await import('./discord-http');
    let synced = 0;
    for (const row of rows) {
      try {
        const token = require('./discord-mock')._getCapturedToken(row.id);
        if (!token) continue;
        const r = await tlsFetch('https://discord.com/api/v9/users/@me', {
          method: 'GET',
          headers: await discordHeaders(token, false, undefined, row.id),
          timeoutMs: 10_000,
          accountId: row.id,
        });
        if (r.ok) {
          const j = JSON.parse(await r.text());
          if (j.email) { await db.setCachedEmail(row.id, j.email); synced++; }
        }
      } catch { /* dead token or network — skip */ }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    console.log(`[sync-emails] done — ${synced}/${rows.length} synced`);
  })();
});

// GET /api/accounts/:id/email — fetch email from Discord /users/@me, with DB cache fallback.
app.get('/api/accounts/:id/email', async (req, res) => {
  const accountId = req.params.id;
  const token = require('./discord-mock')._getCapturedToken(accountId);

  if (token) {
    try {
      const { tlsFetch, discordHeaders } = require('./discord-http');
      const r = await tlsFetch('https://discord.com/api/v9/users/@me', {
        method: 'GET',
        headers: await discordHeaders(token, false, undefined, accountId),
        timeoutMs: 10_000,
        accountId,
      });
      const text = await r.text();
      if (r.ok) {
        const j = JSON.parse(text);
        const email: string | null = j.email || null;
        // Persist so it survives token revocation.
        if (email) db.setCachedEmail(accountId, email).catch(() => {});
        return res.json({ email, verified: j.verified ?? null, source: 'live' });
      }
      // Token is dead (401) or other Discord error — fall through to cache.
    } catch { /* fall through */ }
  }

  // No token or live fetch failed — return cached value.
  const cached = await db.getCachedEmail(accountId).catch(() => null);
  if (cached) return res.json({ email: cached, verified: null, source: 'cached' });
  res.status(400).json({ error: 'No token and no cached email for this account' });
});

// GET /api/accounts/:id/relationships — full friend list + pending FRs (live).
app.get('/api/accounts/:id/relationships', async (req, res) => {
  const acct = discordMockState.accounts.find((a) => a.id === req.params.id);
  if (!acct) return res.status(404).json({ error: 'Account not found' });
  const token = require('./discord-mock')._getCapturedToken(req.params.id);
  if (!token) return res.status(400).json({ error: 'No token for this account' });
  const { fetchRelationships } = require('./discord-send');
  const rels = await fetchRelationships(token, req.params.id);
  const friends = rels.filter((r: any) => r.type === 'friend');
  const incoming = rels.filter((r: any) => r.type === 'incoming');
  const outgoing = rels.filter((r: any) => r.type === 'outgoing');
  const blocked = rels.filter((r: any) => r.type === 'blocked');
  // Update the account-card stats in passing.
  acct.friendsCount = friends.length;
  acct.pendingOutgoing = outgoing.length;
  db.updateAccountStats(acct.id, friends.length, outgoing.length, acct.status).catch(() => {});
  res.json({ friends, incoming, outgoing, blocked, total: rels.length });
});

// ───── Operator-driven browser (v0.27) ─────────────────────────────────────
// "Open this account in a remote Chromium I can see via noVNC." Used for
// manual warm-up, FR accepts, mass-wave-by-hand, captcha rescue, etc. The
// same noVNC iframe powers the auto-captcha-solve flow; here the operator
// just drives the whole browser.

app.post('/api/accounts/:id/browser/open', async (req, res) => {
  const acct = discordMockState.accounts.find((a) => a.id === req.params.id);
  if (!acct) return res.status(404).json({ error: 'Account not found' });
  const token = require('./discord-mock')._getCapturedToken(req.params.id);
  if (!token) return res.status(400).json({ error: 'No token for this account' });
  const path = typeof req.body?.path === 'string' ? req.body.path : '/channels/@me';
  try {
    const { browserOpenForOperator } = require('./discord-browser');
    await browserOpenForOperator(req.params.id, token, path);
    res.json({
      ok: true,
      // noVNC iframe URL — same path the captcha-required modal uses. Behind
      // Traefik /vnc/* → gg-api:6080 → websockify → x11vnc → DISPLAY :99.
      vncUrl: `/vnc/vnc.html?autoconnect=1&resize=scale&path=vnc/websockify`,
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/api/accounts/:id/browser/navigate', async (req, res) => {
  const acct = discordMockState.accounts.find((a) => a.id === req.params.id);
  if (!acct) return res.status(404).json({ error: 'Account not found' });
  const token = require('./discord-mock')._getCapturedToken(req.params.id);
  if (!token) return res.status(400).json({ error: 'No token for this account' });
  const path = typeof req.body?.path === 'string' ? req.body.path : null;
  if (!path) return res.status(400).json({ error: 'Missing path' });
  try {
    const { browserOpenForOperator } = require('./discord-browser');
    // browserOpenForOperator both creates the context (if missing) and navs,
    // so we can reuse it. The "operator" semantics are: just drive there;
    // don't try to scrape or send.
    await browserOpenForOperator(req.params.id, token, path);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.post('/api/accounts/:id/browser/close', async (req, res) => {
  try {
    const { closeAccountContext } = require('./discord-browser');
    await closeAccountContext(req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /api/unibox/mark-all-read — zero out unread counts for all conversations
// optionally filtered to a specific accountId.
app.post('/api/unibox/mark-all-read', async (req, res) => {
  const accountId: string | undefined = req.body?.accountId || undefined;
  const convs = discordMockState.conversations.filter((c) =>
    accountId ? c.accountId === accountId : true,
  );
  for (const c of convs) {
    if (c.unreadCount > 0) {
      c.unreadCount = 0;
      db.upsertConversation(c).catch(() => {});
    }
  }
  // No SSE event needed — the store updates optimistically.
  res.json({ ok: true, cleared: convs.length });
});

app.post('/api/unibox/conversations/:id/archive', async (req, res) => {
  const conv = mockArchiveConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  db.upsertConversation(conv).catch(() => {});
  // Broadcast so all open tabs remove the conversation from their inbox immediately.
  publishExternalEvent({
    type: 'conversation_updated',
    conversationId: req.params.id,
    conversation: conv,
    ts: new Date().toISOString(),
  });
  res.json(conv);
});

app.post('/api/unibox/conversations/:id/mark-read', async (req, res) => {
  const id = String(req.params.id);
  const conv = discordMockState.conversations.find((c) => c.id === id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  conv.unreadCount = 0;
  db.query(
    `UPDATE tenant_main.conversations SET unread_count = 0 WHERE id = $1`,
    [id],
  ).catch(() => {});
  res.json({ ok: true });
});

app.delete('/api/unibox/conversations/:id', async (req, res) => {
  const id = String(req.params.id);
  const idx = discordMockState.conversations.findIndex((c) => c.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Conversation not found' });
  discordMockState.conversations.splice(idx, 1);
  discordMockState.messages.delete(id);
  db.deleteConversation(id).catch((err) =>
    console.warn(`[unibox] deleteConversation ${id} failed: ${err?.message || err}`),
  );
  publishExternalEvent({ type: 'conversation_removed', conversationId: id, ts: new Date().toISOString() });
  res.json({ ok: true });
});

app.put('/api/unibox/conversations/:id/interested', async (req, res) => {
  const id = String(req.params.id);
  const interested = Boolean(req.body?.interested);
  const conv = discordMockState.conversations.find((c) => c.id === id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  conv.interested = interested;
  try { await db.setConversationInterested(id, interested); } catch (err: any) {
    console.warn('[interested] DB write failed:', err?.message || err);
  }
  publishExternalEvent({
    type: 'conversation_updated',
    conversationId: id,
    conversation: conv,
    ts: new Date().toISOString(),
  });
  res.json(conv);
});

app.get('/api/realtime', sseHandler);

app.get('/health', async (_req, res) => {
  let dbOk = false;
  try { await db.query('SELECT 1'); dbOk = true; } catch {}
  let diskFreeGB = 0, diskUsedPct = 0;
  try {
    const st = statfsSync('/');
    const total = st.blocks * st.bsize;
    const free  = st.bavail * st.bsize;
    diskFreeGB  = Math.round(free / 1e9 * 10) / 10;
    diskUsedPct = Math.round((1 - free / total) * 100);
  } catch {}
  const status = dbOk ? 200 : 503;
  res.status(status).json({ ok: dbOk, db: dbOk, diskFreeGB, diskUsedPct });
});

app.get('/api/dashboard', async (req, res) => {
  const window = String(req.query.window || '24h');
  const windowMs = window === '7d' ? 7 * 86400_000 : window === 'all' ? Number.MAX_SAFE_INTEGER : 86400_000;
  const sinceMs = Date.now() - windowMs;
  const sinceIso = new Date(sinceMs).toISOString();

  const [dmsSent, replies, pendingLeads, campaignList] = await Promise.all([
    db.countMessagesSince('out', sinceIso),
    db.countMessagesSince('in', sinceIso),
    db.countAllPendingLeads(),
    db.listCampaigns(),
  ]);

  const accountList = discordMockState.accounts;
  const activeAccounts = accountList.filter((a) => a.status === 'connected').length;
  const totalAccounts = accountList.length;
  const replyRatePct = dmsSent > 0 ? Math.round((replies / dmsSent) * 100) : 0;

  const alerts: Array<{ severity: 'info' | 'warn' | 'error'; kind: string; message: string; linkTo?: string }> = [];
  for (const a of accountList) {
    if (a.status === 'disconnected' || a.status === 'banned') {
      alerts.push({
        severity: 'warn', kind: 'token-revoked',
        message: `${a.username} needs re-auth (${a.status})`,
        linkTo: '/app/accounts',
      });
    }
  }
  for (const c of campaignList) {
    if (c.status === 'paused') {
      alerts.push({
        severity: 'warn', kind: 'captcha-paused',
        message: `Campaign "${c.name}" is paused`,
        linkTo: `/app/campaigns/${c.id}`,
      });
    }
  }

  const recent = await db.recentMessagesSince(sinceIso, 50);
  const recentActivity = recent.map((m: any) => ({
    ts: m.sent_at instanceof Date ? m.sent_at.toISOString() : String(m.sent_at),
    accountUsername: '',
    leadName: m.peer_display_name || '',
    campaignName: '',
    campaignId: '',
    type: m.direction === 'in' ? 'replied' : 'sent',
  }));

  const campaigns = campaignList
    .filter((c) => c.status !== 'finished')
    .map((c) => ({
      id: c.id, name: c.name, status: c.status,
      todaySent: c.totals.sent,
      repliedTotal: c.totals.replied,
      progressPct: c.totals.queued > 0
        ? Math.round(((c.totals.sent + c.totals.failed) / c.totals.queued) * 100)
        : 0,
      accountCount: c.accountIds.length,
    }));

  const waveCampaigns = campaignList.filter((c) => c.status === 'waving');
  const waveQueueSummary = [];
  for (const c of waveCampaigns) {
    const leads = await db.listLeadsByCampaign(c.id);
    const cold = leads.filter((l) => l.status === 'waving' || l.status === 'pending').length;
    const firstAcct = accountList.find((a) => c.accountIds.includes(a.id));
    waveQueueSummary.push({
      campaignId: c.id, campaignName: c.name, cold,
      accountUsername: firstAcct?.username || '',
    });
  }

  res.json({
    kpis: {
      dmsSent, dmsSentTrendPct: 0,
      repliesReceived: replies, replyRatePct,
      pendingLeads,
      activeAccounts, totalAccounts,
    },
    alerts,
    recentActivity,
    campaigns,
    waveQueueSummary,
    quickStats: {
      friendsTotal: accountList.reduce((sum, a) => sum + (a.friendsCount || 0), 0),
      conversationsTotal: discordMockState.conversations.length,
      accountsInGroups: 0,
      accountsTotal: totalAccounts,
    },
  });
});

// --- API docs (now minimal) ---
app.get('/api/docs', async (_req, res) => {
  res.json({
    name: 'Discord Unibox SaaS API',
    version: '0.1-skeleton',
    baseUrl: '/api',
    notes: ['Auth + settings endpoints are wired. Discord-specific routes return 501 until the bridge ships.'],
  });
});

const server = http.createServer(app);
const PORT = Number(process.env.PORT || 4000);
const runtimeFlags = getRuntimeFlags(process.env);
void runtimeFlags;

initTelegramNotifier();

// v0.7: NO demo seed. Empty state on first boot, then hydrate from Postgres.
(async () => {
  // Disk space guard — warns before the disk fills and crashes postgres.
  function checkDisk() {
    try {
      const st = statfsSync('/');
      const freeMB = Math.round(st.bavail * st.bsize / (1024 * 1024));
      if (freeMB < 500)       console.error(`[disk] CRITICAL: only ${freeMB}MB free — run: docker system prune -af`);
      else if (freeMB < 1500) console.warn(`[disk] WARNING: only ${freeMB}MB free`);
    } catch {}
  }
  checkDisk();
  setInterval(checkDisk, 30 * 60_000);

  const ready = await db.checkDbReady();
  if (!ready) {
    console.warn('[boot] DB not reachable — accounts/convs/messages will not persist this session');
    return;
  }
  // Run pending migrations before hydrating so schema is always up to date.
  try {
    await db.runMigrations();
  } catch (err: any) {
    console.error(`[boot] FATAL: migration failed — ${err?.message || err}`);
    process.exit(1);
  }
  try {
    const accounts = await db.loadAllAccounts();
    const tokenAccounts = [];
    for (const entry of accounts) {
      const exists = discordMockState.accounts.find((a) => a.id === entry.account.id);
      if (!exists) discordMockState.accounts.push({ ...entry.account });
      if (entry.token) {
        __rehydrateToken(entry.account.id, entry.token);
        tokenAccounts.push(entry);
      }
      console.log(`[boot] hydrated account id=${entry.account.id} username=${entry.account.username}`);
    }
    // Stagger gateway connections — connecting all accounts simultaneously
    // looks like a bot farm to Discord. Spread logins over 3-8s each.
    for (let i = 0; i < tokenAccounts.length; i++) {
      const entry = tokenAccounts[i]!;
      const delayMs = i * (3_000 + Math.floor(Math.random() * 5_000));
      setTimeout(() => {
        attachGateway(entry.account.id, entry.token!);
        attachLiveAccount(entry.account.id);
        console.log(`[boot] gateway attached account=${entry.account.id} (stagger ${Math.round(delayMs / 1000)}s)`);
      }, delayMs);
    }

    const convs = await db.loadAllConversations();
    for (const c of convs) {
      const exists = discordMockState.conversations.find((x) => x.id === c.id);
      if (!exists) discordMockState.conversations.push(c);
      // Lazy-load messages on first access via the API; no upfront load for now.
    }
    console.log(`[boot] hydrated ${accounts.length} account(s), ${convs.length} conversation(s) from DB`);

    // Proxy audit — warn about accounts with no proxy so the operator can assign them.
    void (async () => {
      try {
        const proxyMap = await db.getAccountProxyMap();
        const noProxy = accounts.filter((a) => a.token && !proxyMap.has(a.account.id));
        if (noProxy.length > 0) {
          console.warn(
            `[boot] PROXY WARNING: ${noProxy.length} account(s) have no proxy assigned — ` +
            `traffic will go direct through the VPS IP. Assign a dedicated proxy per account: ` +
            noProxy.map((a) => a.account.username || a.account.id).join(", "),
          );
        }
      } catch { /* non-fatal */ }
    })();

    // Background: cache emails for any account that has a token but no cached_email yet.
    // Runs after hydration so tokens are available. Fire-and-forget, 1 per second so
    // we don't burst Discord on restart.
    void (async () => {
      try {
        const needsEmail = await db.query<{ id: string }>(
          `SELECT id FROM tenant_main.discord_accounts WHERE cached_email IS NULL AND token_encrypted IS NOT NULL`,
        );
        if (needsEmail.length === 0) return;
        console.log(`[boot] backfilling emails for ${needsEmail.length} account(s) with no cached email…`);
        const { tlsFetch, discordHeaders } = await import('./discord-http');
        for (const row of needsEmail) {
          try {
            const token = require('./discord-mock')._getCapturedToken(row.id);
            if (!token) continue;
            const r = await tlsFetch('https://discord.com/api/v9/users/@me', {
              method: 'GET',
              headers: await discordHeaders(token, false, undefined, row.id),
              timeoutMs: 10_000,
              accountId: row.id,
            });
            if (r.ok) {
              const j = JSON.parse(await r.text());
              if (j.email) {
                await db.setCachedEmail(row.id, j.email);
                console.log(`[boot] cached email for account ${row.id}`);
              }
            }
          } catch { /* token dead or network error — skip */ }
          await new Promise((res) => setTimeout(res, 1_000)); // 1 req/s
        }
      } catch (err: any) {
        console.warn('[boot] email backfill failed:', err?.message || err);
      }
    })();
  } catch (err: any) {
    console.warn('[boot] DB hydration failed:', err?.message || err);
  }
})();

const _gitCommit = process.env.GIT_COMMIT || (() => {
  try { return spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim() || 'unknown'; }
  catch { return 'unknown'; }
})();
const _gitDate = process.env.GIT_DATE || (() => {
  try { return spawnSync('git', ['log', '-1', '--format=%ci'], { encoding: 'utf8' }).stdout.trim() || ''; }
  catch { return ''; }
})();
const _appVersion: string = (() => {
  try {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const pkg = JSON.parse(readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    return pkg.version || '';
  } catch { return ''; }
})();
app.get('/api/version', (_req, res) => res.json({ version: _appVersion, commit: _gitCommit, date: _gitDate }));

server.listen(PORT, () => {
  console.log(`Discord Unibox skeleton listening on port ${PORT}`);
  console.log(`[demo] mode=demo seededAt=${discordMockState.seededAt} accounts=${discordMockState.accounts.length} conversations=${discordMockState.conversations.length}`);
  console.log('Discord bridge integration: TODO (see TODO(discord) markers).');
  startCampaignScheduler();
  import("./warmup-campaign-engine").then(({ startWarmupCampaignEngine }) => {
    startWarmupCampaignEngine();
  });
  import("./fr-campaign-engine").then(({ startFrCampaignEngine }) => {
    startFrCampaignEngine();
  });
  import("./member-scraper-engine").then(({ startMemberScraperEngine }) => {
    startMemberScraperEngine();
  });
  import("./server-join-engine").then(({ startJoinEngine }) => {
    startJoinEngine();
  });
});

// ───── Server Join Campaigns ─────────────────────────────────────────────────

// Unauthenticated invite preview — resolves guild name, icon, member count.
app.get('/api/invite-info', async (req, res) => {
  const raw = typeof req.query.code === 'string' ? req.query.code.trim() : '';
  if (!raw) return res.status(400).json({ error: 'code required' });
  const code = raw.replace(/^https?:\/\/(www\.)?(discord\.(gg|com\/invite))\//i, '').split(/[/?&#]/)[0];
  if (!code || code.length < 2) return res.status(400).json({ error: 'could not parse invite code' });
  try {
    const r = await fetch(
      `https://discord.com/api/v9/invites/${encodeURIComponent(code)}?with_counts=true&with_expiration=true`,
      { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36' } },
    );
    if (!r.ok) {
      const j: any = await r.json().catch(() => null);
      if (r.status === 404) return res.status(404).json({ error: 'invite not found or expired' });
      return res.status(r.status).json({ error: j?.message || `HTTP ${r.status}` });
    }
    const j: any = await r.json();
    if (!j.guild) return res.status(400).json({ error: 'not a guild invite' });
    res.json({
      code,
      guildId: j.guild.id,
      guildName: j.guild.name,
      guildIcon: j.guild.icon ?? null,
      approximateMemberCount: j.approximate_member_count ?? 0,
      channelName: j.channel?.name ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'failed to resolve invite' });
  }
});

// Which accounts (by ID) are already in a given guild per gateway cache.
app.get('/api/guild-member-accounts', (req, res) => {
  const guildId = typeof req.query.guild_id === 'string' ? req.query.guild_id : '';
  if (!guildId) return res.status(400).json({ error: 'guild_id required' });
  const accountIds = discordMockState.accounts
    .filter((a) => getAccountGuilds(a.id).some((g) => g.id === guildId))
    .map((a) => a.id);
  res.json({ accountIds });
});

app.get('/api/join-campaigns', async (_req, res) => {
  try { res.json(await db.listJoinCampaigns()); }
  catch (err: any) { res.status(500).json({ error: err?.message }); }
});

app.post('/api/join-campaigns', async (req, res) => {
  try {
    const { guild_id, guild_name, guild_icon, invite_codes, joins_per_day, min_account_age_days, post_join_action, account_ids } = req.body;
    if (!guild_id || !Array.isArray(invite_codes) || invite_codes.length === 0) {
      return res.status(400).json({ error: 'guild_id and invite_codes[] required' });
    }
    if (!Array.isArray(account_ids) || account_ids.length === 0) {
      return res.status(400).json({ error: 'account_ids[] required' });
    }
    const campaign = await db.createJoinCampaign({ guild_id, guild_name, guild_icon, invite_codes, joins_per_day, min_account_age_days, post_join_action });
    const queued = await db.populateJoinQueue(campaign.id, { accountIds: account_ids, inviteCodes: invite_codes, joinsPerDay: joins_per_day ?? 10 });
    res.json({ campaign, queued });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

app.patch('/api/join-campaigns/:id', async (req, res) => {
  try {
    const { status, joins_per_day, invite_codes } = req.body;
    await db.updateJoinCampaign(req.params.id, { status, joins_per_day, invite_codes });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err?.message }); }
});

app.post('/api/join-campaigns/:id/add-accounts', async (req, res) => {
  try {
    const campaign = await db.getJoinCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'campaign not found' });
    const { account_ids } = req.body;
    if (!Array.isArray(account_ids) || account_ids.length === 0) return res.status(400).json({ error: 'account_ids[] required' });
    const added = await db.addToCampaignQueue(req.params.id, { accountIds: account_ids, inviteCodes: campaign.invite_codes, joinsPerDay: campaign.joins_per_day });
    res.json({ added });
  } catch (err: any) { res.status(500).json({ error: err?.message }); }
});

app.delete('/api/join-campaigns/:id', async (req, res) => {
  try { await db.deleteJoinCampaign(req.params.id); res.json({ ok: true }); }
  catch (err: any) { res.status(500).json({ error: err?.message }); }
});

app.get('/api/join-campaigns/:id/queue', async (req, res) => {
  try { res.json(await db.getJoinQueueForCampaign(req.params.id)); }
  catch (err: any) { res.status(500).json({ error: err?.message }); }
});

// ───── Saved Invite Groups ───────────────────────────────────────────────────
// Persistent, reusable groups of invite codes, keyed by server name.
// Used when starting new join campaigns.

app.get('/api/saved-invite-groups', async (_req, res) => {
  try { res.json(await db.listSavedInviteGroups()); }
  catch (err: any) { res.status(500).json({ error: err?.message }); }
});

app.post('/api/saved-invite-groups', async (req, res) => {
  try {
    const { name, guild_id, guild_name, guild_icon, codes } = req.body;
    if (!name || !guild_id || !Array.isArray(codes) || codes.length === 0) {
      return res.status(400).json({ error: 'name, guild_id, codes[] required' });
    }
    const group = await db.createSavedInviteGroup({ name, guild_id, guild_name, guild_icon, codes });
    res.json(group);
  } catch (err: any) { res.status(500).json({ error: err?.message }); }
});

app.patch('/api/saved-invite-groups/:id', async (req, res) => {
  try {
    const { name, codes } = req.body;
    await db.updateSavedInviteGroup(req.params.id, { name, codes });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err?.message }); }
});

app.delete('/api/saved-invite-groups/:id', async (req, res) => {
  try { await db.deleteSavedInviteGroup(req.params.id); res.json({ ok: true }); }
  catch (err: any) { res.status(500).json({ error: err?.message }); }
});

// ───── Account health / activity log ─────────────────────────────────────────

app.get('/api/account-health', async (_req, res) => {
  try {
    const rows = await db.getAccountHealthSummary();
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.post('/api/accounts/:id/quarantine', async (req, res) => {
  try {
    await db.quarantineAccount(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// Rest: temporary operator-triggered pause. Does NOT revoke token or close gateway.
// The account is simply excluded from all send engines until /unrest is called.
app.post('/api/accounts/:id/rest', async (req, res) => {
  try {
    await db.restAccount(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.post('/api/accounts/:id/unrest', async (req, res) => {
  try {
    await db.unrestAccount(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// ───── Member scraper routes ─────────────────────────────────────────────────

app.get('/api/scraper/jobs', async (_req, res) => {
  try {
    const jobs = await db.listScraperJobs();
    res.json(jobs);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.post('/api/scraper/jobs', async (req, res) => {
  try {
    const { account_id, guild_id, guild_name, interval_minutes } = req.body;
    if (!account_id || !guild_id) return res.status(400).json({ error: 'account_id and guild_id required' });
    const job = await db.createScraperJob({ account_id, guild_id, guild_name, interval_minutes });
    res.json(job);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.patch('/api/scraper/jobs/:id', async (req, res) => {
  try {
    const { status, interval_minutes, guild_name } = req.body;
    const patch: any = {};
    if (status !== undefined) patch.status = status;
    if (interval_minutes !== undefined) patch.interval_minutes = interval_minutes;
    if (guild_name !== undefined) patch.guild_name = guild_name;
    // When starting, clear next_scrape_at so it runs immediately
    if (status === 'running') patch.next_scrape_at = null;
    await db.updateScraperJob(req.params.id, patch);
    const updated = await db.getScraperJob(req.params.id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.delete('/api/scraper/jobs/:id', async (req, res) => {
  try {
    await db.deleteScraperJob(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get('/api/scraper/guilds', async (_req, res) => {
  try {
    res.json(await db.listScrapedMemberGuilds());
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get('/api/scraper/stats', async (req, res) => {
  try {
    const guild_id = typeof req.query.guild_id === 'string' ? req.query.guild_id : undefined;
    const counts = await db.countScrapedMembersByStatus(guild_id);
    res.json(counts);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get('/api/scraper/members/export.csv', async (req, res) => {
  try {
    const rawIds = typeof req.query.ids === 'string' ? req.query.ids : '';
    const ids = rawIds ? rawIds.split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0) : undefined;
    const guild_id = typeof req.query.guild_id === 'string' ? req.query.guild_id : undefined;
    const fr_status = typeof req.query.fr_status === 'string' ? req.query.fr_status : undefined;
    const members = await db.exportScrapedMembers({ ids, guild_id, fr_status });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="members-${stamp}.csv"`);
    res.send(buildCsv(
      ['discord_user_id', 'username', 'display_name', 'fr_status', 'first_seen_at', 'guild_id', 'guild_name'],
      members.map((m) => [m.discord_user_id, m.username, m.global_name, m.fr_status, m.first_seen_at, m.guild_id ?? '', m.guild_name ?? '']),
    ));
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'export failed' });
  }
});

app.get('/api/scraper/members', async (req, res) => {
  try {
    const guild_id = typeof req.query.guild_id === 'string' ? req.query.guild_id : undefined;
    const fr_status = typeof req.query.fr_status === 'string' ? req.query.fr_status : undefined;
    const limit = Math.min(500, Number(req.query.limit) || 200);
    const offset = Number(req.query.offset) || 0;
    const members = await db.listScrapedMembers({ guild_id, fr_status, limit, offset });
    res.json(members);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.post('/api/scraper/members/push-to-campaign', async (req, res) => {
  try {
    const { campaign_id, guild_id, limit } = req.body;
    if (!campaign_id) return res.status(400).json({ error: 'campaign_id required' });
    const pushed = await db.pushMembersToFrCampaign({ campaign_id, guild_id, limit: Math.min(2000, Number(limit) || 500) });
    res.json({ pushed });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// Graceful shutdown so cycletls's Go sidecar exits cleanly and Playwright
// closes every per-account Chromium context (otherwise zombie chrome procs
// linger and dirty Discord's session telemetry).
let shuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[index] ${signal} received, shutting down`);
  try { await shutdownTls(); } catch (e: any) { console.warn('[index] shutdownTls failed:', e?.message || e); }
  try { await closeAllBrowserContexts(); } catch (e: any) { console.warn('[index] closeAllBrowserContexts failed:', e?.message || e); }
  process.exit(0);
}
process.on('SIGTERM', () => { gracefulShutdown('SIGTERM').catch(() => process.exit(1)); });
process.on('SIGINT', () => { gracefulShutdown('SIGINT').catch(() => process.exit(1)); });
