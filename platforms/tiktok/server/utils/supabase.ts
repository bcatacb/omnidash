import { Pool } from 'pg'
import 'dotenv/config'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function runQuery(text, params = []) {
  try {
    const res = await pool.query(text, params)
    return { data: res.rows, error: null }
  } catch (error) {
    console.error('DB error:', error)
    return { data: null, error }
  }
}

export const supabase = {
  from(table) {
    let selectCols = '*'
    let conditions = []
    let params = []
    let orderBy = ''
    let limitClause = ''
    const builder = {
      select(cols = '*') {
        selectCols = cols
        return builder
      },
      eq(column, value) {
        conditions.push(`${column} = $${params.length + 1}`)
        params.push(value)
        return builder
      },
      order(column, { ascending = true, nullsFirst = false } = {}) {
        const dir = ascending ? 'ASC' : 'DESC'
        orderBy = ` ORDER BY ${column} ${dir}`
        if (nullsFirst) orderBy += ' NULLS FIRST'
        return builder
      },
      limit(n) {
        const v = parseInt(n)
        limitClause = ` LIMIT ${Number.isFinite(v) ? v : 50}`
        return builder
      },
      single() {
        return this.then(r => ({ data: r.data[0] || null, error: r.error }))
      },
      insert(data) {
        const keys = Object.keys(data)
        const vals = Object.values(data)
        const ph = vals.map((_, i) => `$${i + 1}`)
        const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${ph.join(', ')}) RETURNING *`
        return runQuery(sql, vals).then(r => ({ data: r.data[0], error: r.error }))
      },
      upsert(data, opts = {}) {
        const keys = Object.keys(data)
        const vals = Object.values(data)
        const ph = vals.map((_, i) => `$${i + 1}`)
        const conflict = opts.onConflict || 'id'
        const conflictCols = conflict.split(',').map(s => s.trim())
        const updateCols = keys.filter(k => !conflictCols.includes(k))
        const setClause = updateCols.length
          ? `DO UPDATE SET ${updateCols.map(k => `${k} = EXCLUDED.${k}`).join(', ')}`
          : 'DO NOTHING'
        const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${ph.join(', ')}) ON CONFLICT (${conflict}) ${setClause} RETURNING *`
        const p = runQuery(sql, vals)
        // Support both `.upsert(...).select().single()` and bare `await .upsert(...)`.
        const wrap = {
          select() { return wrap },
          single() { return p.then(r => ({ data: r.data && r.data[0] ? r.data[0] : null, error: r.error })) },
          then(cb, eb) { return p.then(r => ({ data: r.data, error: r.error })).then(cb, eb) },
        }
        return wrap
      },
      update(data) {
        const sets = Object.keys(data).map((k, i) => `${k} = $${i + 1}`)
        const vals = Object.values(data)
        return {
          eq(column, value) {
            const allParams = [...vals, value]
            const sql = `UPDATE ${table} SET ${sets.join(', ')} WHERE ${column} = $${vals.length + 1} RETURNING *`
            return runQuery(sql, allParams).then(r => ({ data: r.data[0], error: r.error }))
          }
        }
      },
      delete() {
        return {
          eq(column, value) {
            const sql = `DELETE FROM ${table} WHERE ${column} = $1`
            return runQuery(sql, [value]).then(r => ({ data: r.data, error: r.error }))
          }
        }
      },
      then(onFulfilled) {
        let sql = `SELECT ${selectCols} FROM ${table}`
        if (conditions.length > 0) {
          sql += ` WHERE ${conditions.join(' AND ')}`
        }
        if (orderBy) sql += orderBy
        if (limitClause) sql += limitClause
        return runQuery(sql, params).then(onFulfilled)
      }
    }
    return builder
  }
}
