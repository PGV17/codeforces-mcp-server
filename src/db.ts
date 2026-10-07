/**
 * src/db.ts
 *
 * MongoDB connection and Mongoose schemas for caching Codeforces data.
 * Caching TTL: 24 hours.  If a document's `fetchedAt` is older than
 * 24 h the caller should refresh from the live API.
 */

import mongoose, { Document, Schema } from "mongoose";

// ─── Connection ────────────────────────────────────────────────────────────────

export async function connectDB(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set.");
  }

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
    console.log("✅  MongoDB connected:", uri.split("@").pop()); // hide credentials
  }
}

// ─── Constants ─────────────────────────────────────────────────────────────────

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── User Profile Cache ────────────────────────────────────────────────────────

export interface IUserProfileCache extends Document {
  handle: string;
  data: object;
  fetchedAt: Date;
}

const UserProfileCacheSchema = new Schema<IUserProfileCache>({
  handle: { type: String, required: true, unique: true, lowercase: true },
  data: { type: Schema.Types.Mixed, required: true },
  fetchedAt: { type: Date, required: true, default: Date.now },
});

// TTL index — MongoDB automatically removes stale docs after 25 h
UserProfileCacheSchema.index({ fetchedAt: 1 }, { expireAfterSeconds: 90000 });

export const UserProfileCache = mongoose.model<IUserProfileCache>(
  "UserProfileCache",
  UserProfileCacheSchema
);

// ─── Rating History Cache ──────────────────────────────────────────────────────

export interface IRatingHistoryCache extends Document {
  handle: string;
  data: object[];
  fetchedAt: Date;
}

const RatingHistoryCacheSchema = new Schema<IRatingHistoryCache>({
  handle: { type: String, required: true, unique: true, lowercase: true },
  data: { type: [Schema.Types.Mixed], required: true },
  fetchedAt: { type: Date, required: true, default: Date.now },
});

RatingHistoryCacheSchema.index({ fetchedAt: 1 }, { expireAfterSeconds: 90000 });

export const RatingHistoryCache = mongoose.model<IRatingHistoryCache>(
  "RatingHistoryCache",
  RatingHistoryCacheSchema
);
