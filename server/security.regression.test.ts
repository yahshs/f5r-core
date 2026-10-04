import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app";
import { getDb, resetDbForTests } from "./db/db";
import { signAuthToken } from "./test/authFixture";
import { revokeUserSessions } from "./db/authSessionsRepo";
import { reserveOrderExecution } from "./lib/executionPolicy";
import { upsertOrder, upsertOrderItem } from "./db/ordersRepo";
import { beginProviderSubmission, claimNextFulfillment, createFulfillmentIfMissing, createFulfillmentRetryAttempt, finishProviderSubmission, getFulfillmentById, markFulfillmentSuccess, cancelPendingFulfillmentsByOrderId } from "./db/fulfillmentsRepo";
import { issueCustomerOrderAccess, bindCustomerOrderAccess, hasCustomerOrderAccess } from "./db/customerOrderAccessRepo";
import { getSetting, setSetting, listSettings } from "./db/settingsRepo";
import { assertHostnameResolvesToPublicIp, assertPublicHttpsUrl } from "./lib/ssrf";
import { createSallaAuthState, verifySallaAuthState } from "./lib/sallaAuthState";
import { resolveSession } from "./db/authSessionsRepo";
import { claimNextNotificationJob, insertNotificationJob, markNotificationJobSent } from "./db/notificationJobsRepo";
import { createProvider } from "./db/smmProvidersRepo";
import { encryptSecret } from "./lib/encryption";
import { deleteUser } from "./db/usersRepo";
import { recordFinancialEvent } from "./db/financialEventsRepo";
import { conditionsMatch } from './workers/sallaWebhookWorker';
import { ensureCustomerBotSettings } from './db/customerBotSettingsRepo';
import { reserveCompensationRequest,evaluateCompensationEligibility } from './db/compensationRequestsRepo';

describe("security boundaries", () => {
  beforeEach(()=>{
    resetDbForTests();
    vi.stubEnv("NODE_ENV","test"); vi.stubEnv("DB_PATH",":memory:"); vi.stubEnv("WORKERS_ENABLED","0");
    vi.stubEnv("JWT_SECRET","test-jwt-secret"); vi.stubEnv("SALLA_STATE_SECRET","test-state-secret");
    vi.stubEnv("ENCRYPTION_KEY",Buffer.from("0123456789abcdef0123456789abcdef").toString("hex"));
    vi.stubEnv("BASE_PUBLIC_URL","https://f5r.test");
  });
  afterEach(()=>{resetDbForTests();vi.unstubAllEnvs();});
  const identity = (role: "admin"|"seller"="seller", id=role) => signAuthToken({sub:id,role,email:`${id}@example.com`,name:id});
  const order = (seller="seller",number="1234")=>upsertOrder({sellerId:seller,sallaOrderId:number});
  const job = (orderId: string) => {
    createProvider({id:"provider",sellerId:"seller",name:"fixture",baseUrl:"https://example.com",apiKeyEncrypted:encryptSecret("key"),apiKeyLast4:"key",isActive:true,isDefault:true});
    const item=upsertOrderItem({orderId,sallaProductId:"product",quantity:1,lineKey:"1",targetJson:"{}"});
    return createFulfillmentIfMissing({orderItemId:item.id,providerId:"provider",nextAttemptAtIso:new Date().toISOString()});
  };
  it.each(["disabled","demoted","reset","deleted"])("revokes an administrator session after %s", async change=>{
    const app=await createApp(); const token=identity("admin");
    await request(app).get("/api/admin/summary").auth(token,{type:"bearer"}).expect(200);
    if(change==="disabled") getDb().prepare("UPDATE users SET is_disabled=1 WHERE id='admin'").run();
    if(change==="demoted") getDb().prepare("UPDATE users SET role='seller' WHERE id='admin'").run();
    if(change==="reset") getDb().prepare("UPDATE users SET password_hash='changed' WHERE id='admin'").run();
    if(change==="deleted") getDb().prepare("DELETE FROM users WHERE id='admin'").run();
    await request(app).get("/api/admin/summary").auth(token,{type:"bearer"}).expect(401);
  });
  it("logout revokes the persisted session",async()=>{
    const app=await createApp();const token=identity();
    await request(app).post("/api/auth/logout").auth(token,{type:"bearer"}).expect(200);
    await request(app).get("/api/auth/me").auth(token,{type:"bearer"}).expect(401);
  });
  it('rejects Telegram ingress with a missing or incorrect secret',async()=>{
    const app=await createApp();vi.stubEnv('TELEGRAM_WEBHOOK_SECRET','');
    await request(app).post('/api/webhooks/telegram').send({update_id:1}).expect(503);
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET','configured-secret');
    await request(app).post('/api/webhooks/telegram').set('x-telegram-bot-api-secret-token','incorrect').send({update_id:1}).expect(401);
  });
  it.each(['{','{}','[{"field":"quantity","op":"invalid","value":"1"}]','[{"field":"quantity","op":"equals","value":"2"}]','[{"field":"missing","op":"equals","value":""}]'])('fails closed on nonmatching or malformed conditions %s',conditions=>{
    expect(conditionsMatch({conditions_json:conditions},{quantity:1})).toBe(false);
  });
  it("does not accept an unregistered signed token",async()=>{
    const app=await createApp();const token=identity();revokeUserSessions("seller");
    await request(app).get("/api/seller/orders").auth(token,{type:"bearer"}).expect(401);
  });
  it("counts reservations before success and does not double count an order",async()=>{
    await createApp();identity();vi.stubEnv("SUBSCRIPTION_ORDER_LIMITS",JSON.stringify({basic:1}));
    const first=order();const second=order("seller","5678");
    expect(reserveOrderExecution("seller",first.id)).toBeNull();
    expect(reserveOrderExecution("seller",first.id)).toBeNull();
    expect(reserveOrderExecution("seller",second.id)).toContain("limit");
    getDb().prepare("UPDATE users SET subscription_status='inactive' WHERE id='seller'").run();
    expect(reserveOrderExecution("seller",first.id)).toContain("inactive");
  });
  it("never reclaims an uncertain provider submission",async()=>{
    await createApp();identity();const o=order();const f=job(o.id);const claimed=claimNextFulfillment(new Date().toISOString())!;
    const attempt=beginProviderSubmission(f.id,claimed.lease_id!,{service:1,quantity:100});
    finishProviderSubmission(f.id,attempt,"UNKNOWN");
    expect(claimNextFulfillment("2099-01-01T00:00:00.000Z")).toBeNull();
    expect(()=>createFulfillmentRetryAttempt({orderItemId:f.order_item_id,providerId:f.provider_id,retriedFromFulfillmentId:f.id,nextAttemptAtIso:new Date().toISOString()})).toThrow("reconciliation");
  });
  it('blocks unknown refills until an administrator records provider confirmation',async()=>{
    const app=await createApp();const sellerToken=identity();const adminToken=identity('admin');
    const o=order();const defaults=ensureCustomerBotSettings('seller')!;
    const settings={...defaults,is_enabled:1 as const,compensation_cooldown_hours:0,max_compensations_per_order:5};
    const reserved=reserveCompensationRequest({settings,order:o,chatId:'100',hasProviderOrder:true,nowIso:new Date().toISOString()});
    if(!reserved.ok)throw new Error('Fixture reservation failed');
    getDb().prepare("UPDATE compensation_requests SET status='PARTIAL',last_error='Refill outcome unknown; reconciliation required' WHERE id=?").run(reserved.request.id);
    expect(evaluateCompensationEligibility({settings,order:o,hasProviderOrder:true,nowIso:new Date().toISOString()}).reason).toBe('pending');
    const endpoint=`/api/admin/summary/compensations/${reserved.request.id}/reconcile`;
    const body={outcome:'rejected',evidence:'Provider confirmed no refill was accepted'};
    await request(app).post(endpoint).auth(sellerToken,{type:'bearer'}).send(body).expect(403);
    await request(app).post(endpoint).auth(adminToken,{type:'bearer'}).send(body).expect(200);
    await request(app).post(endpoint).auth(adminToken,{type:'bearer'}).send(body).expect(409);
    expect(getDb().prepare("SELECT status,reconciled_at FROM compensation_requests WHERE id=?").get(reserved.request.id)).toMatchObject({status:'FAILED',reconciled_at:expect.any(String)});
  });
  it('rejects cross-tenant provider reassignment at the database boundary',async()=>{
    await createApp();identity();identity('seller','other');const f=job(order().id);
    createProvider({id:'other-provider',sellerId:'other',name:'other',baseUrl:'https://example.com',apiKeyEncrypted:encryptSecret('key'),apiKeyLast4:'key',isActive:true,isDefault:true});
    expect(()=>getDb().prepare("UPDATE fulfillments SET provider_id='other-provider' WHERE id=?").run(f.id)).toThrow('ownership');
  });
  it("a late result cannot turn a cancelled job into success",async()=>{
    await createApp();identity();const o=order();const f=job(o.id);claimNextFulfillment(new Date().toISOString());
    cancelPendingFulfillmentsByOrderId(o.id,{nowIso:new Date().toISOString()});
    markFulfillmentSuccess(f.id,{providerOrderId:"accepted",nowIso:new Date().toISOString()});
    expect(getFulfillmentById(f.id)?.status).toBe("CANCELLED");
  });
  it("customer access is single-use and scoped to one order and Telegram identity",async()=>{
    await createApp();identity();const o=order();const other=order("seller","9999");
    const link=issueCustomerOrderAccess("seller",o.id);
    expect(bindCustomerOrderAccess(link.token,"100","100")).toBeTruthy();
    expect(bindCustomerOrderAccess(link.token,"200","200")).toBeUndefined();
    expect(hasCustomerOrderAccess("100","100",o.id)).toBe(true);
    expect(hasCustomerOrderAccess("100","200",o.id)).toBe(false);
    expect(hasCustomerOrderAccess("100","100",other.id)).toBe(false);
  });
  it("soft deletion retains orders and rejects re-enabled deleted identities",async()=>{
    const app=await createApp();const token=identity();const o=order();
    const link=issueCustomerOrderAccess('seller',o.id);
    bindCustomerOrderAccess(link.token,'100','100');
    deleteUser('seller');
    getDb().prepare("UPDATE users SET is_disabled=0 WHERE id='seller'").run();
    expect(getDb().prepare('SELECT id FROM orders WHERE id=?').get(o.id)).toBeTruthy();
    expect(hasCustomerOrderAccess('100','100',o.id)).toBe(false);
    await request(app).get('/api/auth/me').auth(token,{type:'bearer'}).expect(401);
  });
  it("rejects an expired grant and a group chat binding",async()=>{
    await createApp();identity();const o=order();const link=issueCustomerOrderAccess('seller',o.id);
    expect(bindCustomerOrderAccess(link.token,'-100','100')).toBeUndefined();
    getDb().prepare("UPDATE customer_order_access SET expires_at='2000-01-01T00:00:00.000Z'").run();
    expect(bindCustomerOrderAccess(link.token,'100','100')).toBeUndefined();
  });
  it("records currency minor units in an immutable financial history",async()=>{
    await createApp();identity();const f=job(order().id);
    recordFinancialEvent({id:'event',fulfillmentId:f.id,eventType:'cost_estimate',amount:1.234,currency:'KWD'});
    expect(getDb().prepare("SELECT amount_minor,amount_basis FROM financial_events WHERE id='event'").get()).toEqual({amount_minor:1234,amount_basis:'estimated'});
    expect(()=>getDb().prepare("UPDATE financial_events SET amount_minor=0").run()).toThrow();
    expect(()=>getDb().prepare("DELETE FROM financial_events").run()).toThrow();
  });
  it("a stale fulfillment lease cannot complete or create a cost event",async()=>{
    await createApp();identity();const f=job(order().id);
    const first=claimNextFulfillment(new Date().toISOString())!;
    const second=claimNextFulfillment('2099-01-01T00:00:00.000Z')!;
    markFulfillmentSuccess(f.id,{leaseId:first.lease_id!,nowIso:new Date().toISOString(),panelCostStore:2,panelCostCurrency:'SAR'});
    expect(getFulfillmentById(f.id)?.status).toBe('SUBMITTED');
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM financial_events').get()).toEqual({c:0});
    markFulfillmentSuccess(f.id,{leaseId:second.lease_id!,nowIso:new Date().toISOString()});
    expect(getFulfillmentById(f.id)?.status).toBe('SUCCESS');
  });
  it("OAuth transactions require the browser and are consumed once",async()=>{
    await createApp();const token=identity();const session=resolveSession(token);
    const state=createSallaAuthState("seller",session.sessionId,"browser");
    expect(()=>verifySallaAuthState(state,"attacker")).toThrow("unavailable");
    expect(verifySallaAuthState(state,"browser").sellerId).toBe("seller");
    expect(()=>verifySallaAuthState(state,"browser")).toThrow("unavailable");
  });
  it("encrypts settings at rest and excludes credentials from listings",async()=>{
    await createApp();setSetting("telegram_bot_token","sensitive-token");
    expect(JSON.stringify(getDb().prepare("SELECT * FROM app_settings").all())).not.toContain("sensitive-token");
    expect(getSetting("telegram_bot_token")?.value).toBe("sensitive-token");
    expect(JSON.stringify(listSettings())).not.toContain("sensitive-token");
  });
  it("expired notification leases recover and reject stale completion",async()=>{
    await createApp();identity();const now=new Date().toISOString();
    const id=insertNotificationJob({sellerId:"seller",channel:"telegram",eventType:"execution_failed",dedupeKey:"one",payloadJson:"{}",nowIso:now});
    const first=claimNextNotificationJob(now)!; const second=claimNextNotificationJob("2099-01-01T00:00:00.000Z")!;
    markNotificationJobSent(id,now,first.lease_id!);
    expect(getDb().prepare("SELECT status FROM notification_jobs WHERE id=?").get(id)).toMatchObject({status:"PROCESSING"});
    markNotificationJobSent(id,now,second.lease_id!);
    expect(getDb().prepare("SELECT status FROM notification_jobs WHERE id=?").get(id)).toMatchObject({status:"SENT"});
  });
  it.each(["https://100.64.1.1","https://192.0.0.1","https://198.18.0.1","https://[::ffff:127.0.0.1]","https://[fe90::1]"])("rejects special network addresses %s",url=>expect(()=>assertPublicHttpsUrl(url)).toThrow());
  it("returns the validated DNS addresses for connection pinning",async()=>expect(await assertHostnameResolvesToPublicIp("example.com")).toEqual([{address:"8.8.8.8",family:4}]));
});
