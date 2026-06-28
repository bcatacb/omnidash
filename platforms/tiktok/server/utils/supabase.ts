// utils/supabase.ts — pg-backed shim implementing the subset of the supabase-js
// query builder this app uses, over a LOCAL Postgres DB (DATABASE_URL).
// Replaces @supabase/supabase-js: no network/REST — talks straight to Postgres.
// (Interim data layer; the project plan migrates DB→D1 + storage→R2 later.)
import 'dotenv/config'
import pg from 'pg'

const connectionString =
  process.env.TIKTOK_DATABASE_URL || process.env.DATABASE_URL || ''
if (!connectionString) console.warn('[supabase-shim] no DATABASE_URL set — DB calls will fail')
const pool = new pg.Pool({ connectionString, max: 10 })

// Columns that are jsonb (must be JSON.stringified) vs text[]/uuid[] (pass JS array through).
const JSONB_COLS = new Set([
  'session_data', 'steps', 'target_filters', 'trigger', 'conditions', 'actions', 'actions_taken',
])

type Result = { data: any; error: { message: string } | null; count: number | null }
type Filter =
  | { kind: 'cmp'; col: string; op: string; val: any }
  | { kind: 'in'; col: string; val: any[] }
  | { kind: 'is'; col: string; val: any; negate: boolean }
  | { kind: 'ilike'; col: string; val: string }

function coerce(col: string, val: any): any {
  if (val !== null && typeof val === 'object' && JSONB_COLS.has(col)) return JSON.stringify(val)
  return val
}

class QB implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
  private cols = '*'
  private filters: Filter[] = []
  private orders: string[] = []
  private _limit: number | null = null
  private _offset: number | null = null
  private payload: any = null
  private onConflict: string | null = null
  private wantCount = false
  private headOnly = false
  private wantSingle = false
  constructor(private table: string) {}

  select(cols = '*', opts?: { count?: string; head?: boolean }) {
    if (this.op === 'select') this.cols = cols || '*'
    if (opts?.count) this.wantCount = true
    if (opts?.head) this.headOnly = true
    return this
  }
  insert(payload: any) { this.op = 'insert'; this.payload = payload; return this }
  update(payload: any) { this.op = 'update'; this.payload = payload; return this }
  delete() { this.op = 'delete'; return this }
  upsert(payload: any, opts?: { onConflict?: string }) {
    this.op = 'upsert'; this.payload = payload; this.onConflict = opts?.onConflict ?? 'id'; return this
  }
  eq(col: string, val: any) { this.filters.push({ kind: 'cmp', col, op: '=', val }); return this }
  neq(col: string, val: any) { this.filters.push({ kind: 'cmp', col, op: '<>', val }); return this }
  lt(col: string, val: any) { this.filters.push({ kind: 'cmp', col, op: '<', val }); return this }
  lte(col: string, val: any) { this.filters.push({ kind: 'cmp', col, op: '<=', val }); return this }
  gt(col: string, val: any) { this.filters.push({ kind: 'cmp', col, op: '>', val }); return this }
  gte(col: string, val: any) { this.filters.push({ kind: 'cmp', col, op: '>=', val }); return this }
  in(col: string, val: any[]) { this.filters.push({ kind: 'in', col, val }); return this }
  is(col: string, val: any) { this.filters.push({ kind: 'is', col, val, negate: false }); return this }
  not(col: string, op: string, val: any) {
    if (op === 'is') this.filters.push({ kind: 'is', col, val, negate: true })
    else this.filters.push({ kind: 'cmp', col, op: '<>', val })
    return this
  }
  ilike(col: string, val: string) { this.filters.push({ kind: 'ilike', col, val }); return this }
  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    const dir = opts?.ascending === false ? 'DESC' : 'ASC'
    const nulls = opts?.nullsFirst === true ? ' NULLS FIRST' : opts?.nullsFirst === false ? ' NULLS LAST' : ''
    this.orders.push(`${col} ${dir}${nulls}`)
    return this
  }
  limit(n: number) { this._limit = n; return this }
  range(from: number, to: number) { this._offset = from; this._limit = to - from + 1; return this }
  single() { this.wantSingle = true; return this }
  maybeSingle() { this.wantSingle = true; return this }

  private where(params: any[]): string {
    const parts: string[] = []
    for (const f of this.filters) {
      if (f.kind === 'in') { params.push(f.val); parts.push(`${f.col} = ANY($${params.length})`) }
      else if (f.kind === 'is') {
        const lit = f.val === null ? 'NULL' : f.val ? 'TRUE' : 'FALSE'
        parts.push(`${f.col} IS ${f.negate ? 'NOT ' : ''}${lit}`)
      }
      else if (f.kind === 'ilike') { params.push(f.val); parts.push(`${f.col} ILIKE $${params.length}`) }
      else { params.push(f.val); parts.push(`${f.col} ${f.op} $${params.length}`) }
    }
    return parts.length ? ' WHERE ' + parts.join(' AND ') : ''
  }

  private finish(rows: any[], count: number | null): Result {
    if (this.wantSingle) {
      if (rows.length === 1) return { data: rows[0], error: null, count }
      if (rows.length === 0) return { data: null, error: { message: 'No rows found' }, count }
      return { data: null, error: { message: 'Multiple rows returned' }, count }
    }
    return { data: rows, error: null, count }
  }

  private async run(): Promise<Result> {
    try {
      const params: any[] = []
      if (this.op === 'select') {
        const where = this.where(params)
        let count: number | null = null
        if (this.wantCount) {
          const cr = await pool.query(`SELECT count(*)::int AS c FROM ${this.table}${where}`, params)
          count = cr.rows[0].c
          if (this.headOnly) return { data: [], error: null, count }
        }
        let sql = `SELECT ${this.cols} FROM ${this.table}${where}`
        if (this.orders.length) sql += ` ORDER BY ${this.orders.join(', ')}`
        if (this._limit != null) sql += ` LIMIT ${this._limit}`
        if (this._offset != null) sql += ` OFFSET ${this._offset}`
        const r = await pool.query(sql, params)
        return this.finish(r.rows, count)
      }
      if (this.op === 'insert' || this.op === 'upsert') {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload]
        if (rows.length === 0) return { data: [], error: null, count: 0 }
        const cols = Object.keys(rows[0])
        const tuples: string[] = []
        for (const row of rows) {
          const ph = cols.map((c) => { params.push(coerce(c, row[c])); return `$${params.length}` })
          tuples.push(`(${ph.join(', ')})`)
        }
        let sql = `INSERT INTO ${this.table} (${cols.join(', ')}) VALUES ${tuples.join(', ')}`
        if (this.op === 'upsert') {
          const conflict = this.onConflict || 'id'
          const keys = conflict.split(',').map((s) => s.trim())
          const upd = cols.filter((c) => !keys.includes(c))
          const set = (upd.length ? upd : [cols[0]]).map((c) => `${c} = EXCLUDED.${c}`).join(', ')
          sql += ` ON CONFLICT (${conflict}) DO UPDATE SET ${set}`
        }
        sql += ` RETURNING *`
        const r = await pool.query(sql, params)
        return this.finish(r.rows, null)
      }
      if (this.op === 'update') {
        const cols = Object.keys(this.payload)
        const sets = cols.map((c) => { params.push(coerce(c, this.payload[c])); return `${c} = $${params.length}` })
        const sql = `UPDATE ${this.table} SET ${sets.join(', ')}${this.where(params)} RETURNING *`
        const r = await pool.query(sql, params)
        return this.finish(r.rows, null)
      }
      if (this.op === 'delete') {
        const sql = `DELETE FROM ${this.table}${this.where(params)} RETURNING *`
        const r = await pool.query(sql, params)
        return this.finish(r.rows, null)
      }
      return { data: null, error: { message: `unsupported op ${this.op}` }, count: null }
    } catch (e: any) {
      return { data: null, error: { message: e.message }, count: null }
    }
  }

  then<T1 = Result, T2 = never>(
    onF?: ((v: Result) => T1 | PromiseLike<T1>) | null,
    onR?: ((reason: any) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return this.run().then(onF, onR)
  }
}

export const supabase = {
  from(table: string) { return new QB(table) },
}
