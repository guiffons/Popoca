/**
 * Popoca Streaming - Cloud Sync Service (Backend)
 * Sincronização em nuvem e entre dispositivos com persistência no banco de dados SQLite.
 */

import { db, SafeDbUser } from './database.ts';

export interface UserSyncData {
  userId: string;
  email: string;
  lastUpdated: number;
  watchHistory: any[];
  ratings: Record<string | number, any>;
  watched: any[];
  watchlist: any[];
  liked: any[];
  customLists: any[];
  profile: any;
}

class CloudSyncService {
  public normalizeId(id: string): string {
    return (id || '').trim().toLowerCase();
  }

  public getUser(userId: string): UserSyncData | null {
    const user = db.getUserById(userId);
    if (!user) return null;

    const data = db.getUserData(user.id);
    return {
      userId: user.id,
      email: user.email,
      lastUpdated: user.updated_at,
      watchHistory: data?.watch_history || [],
      ratings: data?.ratings || {},
      watched: data?.watched || [],
      watchlist: data?.watchlist || [],
      liked: data?.liked || [],
      customLists: data?.custom_lists || [],
      profile: {
        username: user.username,
        handle: user.handle,
        bio: user.bio,
        avatarUrl: user.avatar_url,
        bannerUrl: user.banner_url,
        joinedAt: user.created_at
      }
    };
  }

  public syncUserData(userId: string, clientData: any): UserSyncData {
    return db.syncUserData(userId, clientData);
  }

  public generatePairCode(userId: string): string {
    return db.generatePairCode(userId);
  }

  public redeemPairCode(code: string): { user: SafeDbUser; token: string; data: any } | null {
    return db.redeemPairCode(code);
  }
}

export const syncService = new CloudSyncService();
