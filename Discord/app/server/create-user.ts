import { randomBytes, createHash } from 'crypto';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const email = process.argv[2] || 'admin@test.com';
const password = process.argv[3] || 'password123';

const salt = randomBytes(16).toString('hex');
const hash = createHash('sha256').update(salt + ':' + password).digest('hex');
const pwHash = salt + ':' + hash;

pool.query(
  `INSERT INTO public.users (tenant_id, email, password_hash, role)
   SELECT id, $1, $2, 'admin'
   FROM public.tenants WHERE slug = 'main'
   ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
  [email, pwHash]
).then(() => {
  console.log(`User ${email} created with password ${password}`);
  process.exit(0);
}).catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
