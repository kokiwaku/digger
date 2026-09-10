import { MongoClient } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME ?? "digger";

let client: MongoClient | null = null;

export function getMongoClient(): MongoClient {
  if (!client) {
    client = new MongoClient(MONGODB_URI);
  }
  return client;
}

export async function pingDatabase(): Promise<void> {
  const db = getMongoClient().db(MONGODB_DB_NAME);
  await db.command({ ping: 1 });
}
