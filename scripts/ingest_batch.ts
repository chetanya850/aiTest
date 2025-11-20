// scripts/ingest_batch.ts
import { google } from '@ai-sdk/google'
import { embedMany } from 'ai'
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { pool } from '../db/pool'

if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  throw new Error('Set GOOGLE_GENERATIVE_AI_API_KEY in your environment')
}

const EMBEDDING_MODEL = google.textEmbeddingModel('text-embedding-004')

const BATCH_SIZE = 32

const loadWeatherData = (filePath: any) => {
  if (!fs.existsSync(filePath)) {
    throw new Error('data/weather.json not found')
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

const buildTextForEmbedding = (item: any) => {
  return [
    `City: ${item.city}`,
    `Country: ${item.country}`,
    `TempC: ${item.temperature_c}`,
    `Humidity: ${item.humidity_pct}`,
    `WindKph: ${item.wind_kph}`,
    `Conditions: ${item.conditions}`
  ].join(' • ')
}

const generateEmbeddings = async (texts: string[]) => {
  const allEmbeddings = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)

    const res = await embedMany({
      model: EMBEDDING_MODEL,
      values: batch
    })

    const batchEmbeddings = res.embeddings.map(e => (Array.isArray(e) ? e : e))
    allEmbeddings.push(...batchEmbeddings)
  }

  return allEmbeddings
}

const insertWeatherData = async (items: any[], embeddings: number[][]) => {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const insertSql = `
      INSERT INTO weather
        (city, country, temperature_c, humidity_pct, wind_kph, conditions, metadata, embedding)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector)
      RETURNING id
    `

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const embedding = embeddings[i] || []
      const embeddingLiteral = '[' + embedding.join(',') + ']'

      const values = [
        item.city,
        item.country,
        item.temperature_c,
        item.humidity_pct,
        item.wind_kph,
        item.conditions,
        JSON.stringify(item),
        embeddingLiteral
      ]

      await client.query(insertSql, values)
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

const main = async () => {
  const filePath = path.resolve(process.cwd(), 'data', 'weather.json')
  const items = loadWeatherData(filePath)

  const texts = items.map(buildTextForEmbedding)
  const embeddings = await generateEmbeddings(texts)

  await insertWeatherData(items, embeddings)
  await pool.end()

  console.log('All done!')
}

main().catch(err => {
  console.error('Ingest batch failed:', err)
  process.exit(1)
})
