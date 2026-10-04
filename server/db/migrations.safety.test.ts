import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {getDb,resetDbForTests} from "./db";
import {runMigrations} from "./migrations";
import {ensureTestUser} from "../test/authFixture";
import {upsertOrder,upsertOrderItem} from "./ordersRepo";
import {createFulfillmentIfMissing} from "./fulfillmentsRepo";
import {createTelegramActionSession} from "./telegramActionSessionsRepo";
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {encryptSecret,decryptSecret} from '../lib/encryption';
describe("populated migration safety",()=>{
 beforeEach(()=>{resetDbForTests();vi.stubEnv("DB_PATH",":memory:");});
 afterEach(()=>{resetDbForTests();vi.unstubAllEnvs();});
 it("preserves dependent Telegram sessions through historical table rebuilds",()=>{
   const db=getDb();runMigrations(db,{through:"024_zz.sql"});ensureTestUser("seller");
   const o=upsertOrder({sellerId:"seller",sallaOrderId:"1234"});
   const i=upsertOrderItem({orderId:o.id,sallaProductId:"product",quantity:1,lineKey:"1"});
   const f=createFulfillmentIfMissing({orderItemId:i.id,providerId:"provider",nextAttemptAtIso:new Date().toISOString()});
   const session=createTelegramActionSession({sellerId:"seller",chatId:"100",actionType:"await_new_link",fulfillmentId:f.id,expiresAtIso:"2099-01-01T00:00:00.000Z"});
   runMigrations(db);
   expect(db.prepare("SELECT id FROM telegram_action_sessions WHERE id=?").get(session.id)).toEqual({id:session.id});
   expect(db.pragma("foreign_key_check")).toEqual([]);
   expect(db.pragma("foreign_keys",{simple:true})).toBe(1);
 });
 it("detects an altered applied migration",()=>{
   const db=getDb();runMigrations(db);db.prepare("UPDATE migrations SET checksum='modified' WHERE id=(SELECT MIN(id) FROM migrations)").run();
   expect(()=>runMigrations(db)).toThrow("checksum mismatch");
 });
 it('restores a consistent backup with encrypted credentials',async()=>{
   vi.stubEnv('ENCRYPTION_KEY',Buffer.from('0123456789abcdef0123456789abcdef').toString('hex'));
   const db=getDb();runMigrations(db);ensureTestUser('seller');
   const encrypted=encryptSecret('restore-fixture-secret');
   db.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES('telegram_bot_token',?,?)").run(`enc:${encrypted}`,new Date().toISOString());
   const directory=fs.mkdtempSync(path.join(os.tmpdir(),'f5r-restore-'));
   const filename=path.join(directory,'backup.sqlite');
   let restored:Database.Database|undefined;
   try {
     await db.backup(filename);restored=new Database(filename);
     restored.pragma('foreign_keys=ON');
     expect(restored.pragma('integrity_check')).toEqual([{integrity_check:'ok'}]);
     expect(restored.pragma('foreign_key_check')).toEqual([]);
     const row=restored.prepare("SELECT value FROM app_settings WHERE key='telegram_bot_token'").get() as {value:string};
     expect(decryptSecret(row.value.slice(4))).toBe('restore-fixture-secret');
   } finally {restored?.close();fs.rmSync(directory,{recursive:true,force:true});}
 });
});
