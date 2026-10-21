import { Pool } from 'pg';

const state = globalThis as typeof globalThis & { starPool?: Pool; starInit?: Promise<void> };
const pool = () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diatur');
  return state.starPool ??= new Pool({connectionString:process.env.DATABASE_URL,max:5});
};
const schema = [
"CREATE TABLE IF NOT EXISTS classes(id TEXT PRIMARY KEY,owner TEXT NOT NULL,teacher TEXT NOT NULL,title TEXT NOT NULL,code TEXT NOT NULL UNIQUE,status TEXT NOT NULL,created BIGINT NOT NULL)",
"CREATE TABLE IF NOT EXISTS participants(id TEXT PRIMARY KEY,class_id TEXT REFERENCES classes(id),name TEXT NOT NULL,normalized TEXT NOT NULL,pin_hash TEXT NOT NULL,salt TEXT NOT NULL,created BIGINT NOT NULL,UNIQUE(class_id,normalized))",
"CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY,participant_id TEXT REFERENCES participants(id),expires BIGINT NOT NULL)",
"CREATE TABLE IF NOT EXISTS stars(id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,participant_id TEXT REFERENCES participants(id),class_id TEXT REFERENCES classes(id),request_id TEXT UNIQUE,created BIGINT NOT NULL,revoked BIGINT,reason TEXT)",
"CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until BIGINT NOT NULL)",
"CREATE TABLE IF NOT EXISTS teacher_sessions(hash TEXT PRIMARY KEY,expires BIGINT NOT NULL,version TEXT NOT NULL)"
];
async function ready(){
  if(!state.starInit) state.starInit=(async()=>{for(const sql of schema) await pool().query(sql)})().catch(e=>{state.starInit=undefined;throw e});
  await state.starInit;
}
const sqlParams=(sql:string)=>{let n=0;return sql.replace(/\?/g,()=>'\u0024'+(++n))};
type Row=Record<string,unknown>;
function prepare(sql:string,values:unknown[]=[]){
  const query=async()=>{await ready();return pool().query(sqlParams(sql),values)};
  return {
    sql,values,
    bind:(...args:unknown[])=>prepare(sql,args),
    first:async<T=Row>():Promise<T|null>=>((await query()).rows[0] as T)||null,
    all:async()=>({results:(await query()).rows}),
    run:async()=>({meta:{changes:(await query()).rowCount||0}})
  };
}
export const database={
  prepare,
  batch:async(items:ReturnType<typeof prepare>[])=>{
    await ready();const client=await pool().connect();
    try{
      await client.query('BEGIN');
      const results=[];
      for(const item of items) results.push({results:(await client.query(sqlParams(item.sql),item.values)).rows});
      await client.query('COMMIT');return results;
    }catch(e){await client.query('ROLLBACK');throw e}
    finally{client.release()}
  }
};
