// src/runner/universe.ts
export type PoolMeta = {
    id: string; base: string; quote: string;
    tvl?: number; vol24h?: number; spreadBps?: number; // may be undefined from source
  };
  
  export class Universe {
    private all: PoolMeta[] = [];
    private active: PoolMeta[] = [];
    private topN = 300;
    private exploreFrac = 0.1;
    private cursor = 0;
  
    constructor(cfg:{topN:number; exploreFrac:number}) {
      this.topN = Math.max(1, cfg.topN|0);
      this.exploreFrac = Math.min(1, Math.max(0, cfg.exploreFrac));
    }
  
    setAll(pools:PoolMeta[]){ this.all = pools || []; this.cursor = 0; }
    getActive(){ return this.active; }
  
    rebuildActive(filters:{minTvl:number; minVol:number; maxSpreadBps:number}){
      const minTvl = Math.max(0, filters.minTvl|0);
      const minVol = Math.max(0, filters.minVol|0);
      const maxSpr = Math.max(0, filters.maxSpreadBps|0);
  
      const filtered = this.all.filter(p =>
        (p.tvl ?? 0) >= minTvl &&
        (p.vol24h ?? 0) >= minVol &&
        (p.spreadBps ?? Infinity) <= maxSpr
      );
  
      // Highest 24h volume first
      const ranked = filtered.sort((a,b)=> (b.vol24h ?? 0) - (a.vol24h ?? 0));
      const top = ranked.slice(0, this.topN);
  
      // Exploration sample from the rest
      const topSet = new Set(top.map(x=>x.id)); // avoids reference issues
      const rest = this.all.filter(p => !topSet.has(p.id));
      const k = Math.max(0, Math.floor(this.topN * this.exploreFrac));
  
      // Fisher–Yates shuffle
      for (let i = rest.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
  
      this.active = [...top, ...rest.slice(0, k)];
    }
  
    nextShard(budget:number){
      const A = this.active; if (!A.length) return [];
      const n = Math.max(1, budget|0);
      const out: PoolMeta[] = [];
      for (let i=0;i<n;i++) out.push(A[(this.cursor+i) % A.length]);
      this.cursor = (this.cursor + n) % A.length;
      return out;
    }
  }
  