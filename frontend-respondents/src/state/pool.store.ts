import { Observable, Listener } from './observable.js';
import { Pool } from '@s3ntiment/shared';
import { loadPoolsFromStorage, savePoolsToStorage } from './storage.js';

export class PoolStore {
  private observable: Observable<Pool[]>;

  constructor() {
    const stored = loadPoolsFromStorage();
    const pools = Object.values(stored).filter(Boolean) as Pool[];
    this.observable = new Observable<Pool[]>(pools);

    this.observable.subscribe((pools) => {
      const map = Object.fromEntries(pools.map(p => [p.id, p]));
      savePoolsToStorage(map);
    });
  }

  get all(): Pool[] {
    return this.observable.get();
  }

  get(id: string): Pool | undefined {
    return this.observable.get().find(p => p.id === id);
  }

  set(pools: Pool[]): void {
    this.observable.set(pools);
  }

  add(pool: Pool): void {
    this.observable.update(current => {
      const index = current.findIndex(p => p.id === pool.id);
      if (index === -1) return [...current, pool];
      const updated = [...current];
      updated[index] = pool;
      return updated;
    });
  }

  remove(id: string): void {
    this.observable.update(current => current.filter(p => p.id !== id));
  }

  clear(): void {
    this.observable.set([]);
  }

  subscribe(listener: Listener<Pool[]>): () => void {
    return this.observable.subscribe(listener);
  }
}