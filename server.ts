import { google } from '@ai-sdk/google'
import { embed } from 'ai'
import 'dotenv/config'
import { pool } from './db/pool'

type FetchHandler = (req: Request) => Promise<Response>

const EMBEDDING_MODEL = google.textEmbeddingModel('text-embedding-004')

const getEmbedding = async (text: string): Promise<string> => {
  const resp = await embed({
    model: EMBEDDING_MODEL,
    value: text
  })
  const arr = resp.embedding as number[]
  return '[' + arr.join(',') + ']'
}

const searchWeather = async (query: string) => {
  const vec = await getEmbedding(query)

  const sql = `
    SELECT 
      city, 
      country, 
      temperature_c,
      humidity_pct,
      wind_kph,
      conditions, 
      embedding <=> $1::vector AS distance
    FROM weather
    ORDER BY embedding <=> $1::vector
    LIMIT 10
  `

  const client = await pool.connect()
  try {
    const res = await client.query(sql, [vec])
    return res.rows
  } finally {
    client.release()
  }
}

const handler: FetchHandler = async req => {
  const url = new URL(req.url)

  if (url.pathname === '/') {
    return new Response(Bun.file('index.html'))
  }

  if (url.pathname === '/search') {
    const q = url.searchParams.get('query') ?? ''
    if (!q) {
      return new Response(JSON.stringify({ error: 'query missing' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    try {
      const results = await searchWeather(q)
      return Response.json(results)
    } catch (error) {
      console.error('Search error:', error)
      return new Response(JSON.stringify({ error: 'Search failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  }

  return new Response('Not found', { status: 404 })
}

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  fetch: handler
})

console.log('Server running at http://localhost:3000')
