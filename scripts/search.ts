import { google } from '@ai-sdk/google'
import { embed } from 'ai'
import 'dotenv/config'
import { pool } from '../db/pool'

const EMBEDDING_MODEL = google.textEmbeddingModel('text-embedding-004')

const generateQueryEmbedding = async (query: string) => {
  const response = await embed({
    model: EMBEDDING_MODEL,
    value: query
  })

  return '[' + response.embedding.join(',') + ']'
}

const searchWeather = async (embedding: string) => {
  const sql = `
    SELECT city, country, conditions,
           embedding <=> $1::vector AS distance
    FROM weather
    ORDER BY embedding <=> $1::vector
    LIMIT 5;
  `

  const client = await pool.connect()
  try {
    const result = await client.query(sql, [embedding])
    return result.rows
  } finally {
    client.release()
  }
}

const run = async () => {
  const query = process.argv.slice(2).join(' ')

  if (!query) {
    console.log('Usage: bunx tsx scripts/search.ts "sunny weather"')
    return
  }

  console.log('Generating embedding for:', query)
  const embedding = await generateQueryEmbedding(query)

  const results = await searchWeather(embedding)

  console.log('\nTop Results:')
  console.table(results)
}

run().catch(err => {
  console.error('Search failed:', err)
  process.exit(1)
})
