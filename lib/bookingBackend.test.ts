/* eslint-disable @typescript-eslint/no-explicit-any -- In-memory transport fixture models heterogeneous Supabase tables and fluent queries. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Only the external database, auth provider and push transport are replaced. Requests
// exercise the actual gateway, caller resolution, role decisions and payload handling.
const fixture = vi.hoisted(() => ({ tables: {} as Record<string, any[]>, calls: [] as any[], pushes: [] as any[], rateAllowed: true, reviewWriteFails: false, claimFails: false, dispatchFails: false }))
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  from(table: string) {
    let op = 'select', values: any, single = false, maximum = Infinity
    const filters: ((row: any) => boolean)[] = []
    const q: any = {
      select() { return q }, eq(key: string, value: any) { filters.push(row => row[key] === value); return q },
      neq(key: string, value: any) { filters.push(row => row[key] != null && row[key] !== value); return q },
      is(key: string, value: any) { filters.push(row => value === null ? row[key] == null : row[key] === value); return q },
      in(key: string, values: any[]) { filters.push(row => values.includes(row[key])); return q },
      or(expression: string) { filters.push(row => expression.split(',').some(part => { const [key,op,...rest] = part.split('.'); return op === 'is' ? row[key] == null : row[key] != null && row[key] !== rest.join('.') })); return q },
      single() { single = true; return q }, maybeSingle() { single = true; return q }, limit(value: number) { maximum = value; return q }, order() { return q },
      update(value: any) { op='update'; values=value; return q }, delete() { op='delete'; return q }, insert(value: any) { op='insert'; values=value; return q }, upsert(value: any) { op='upsert'; values=value; return q },
      then(resolve: any, reject: any) {
        fixture.calls.push({table,op,values})
        const rows = fixture.tables[table] ?? []
        const matches = (row: any) => filters.every(filter => filter(row))
        let result = rows.filter(matches).slice(0,maximum)
        let error: any = null
        if (op === 'update') result.forEach(row => Object.assign(row, values))
        if (op === 'delete') fixture.tables[table] = rows.filter(row => !matches(row))
        if (op === 'insert' || op === 'upsert') {
          const incoming = Array.isArray(values) ? values : [values]
          if (fixture.reviewWriteFails && table.startsWith('google_')) error = { code: 'XX000', message: 'fixture write failure' }
          else if (incoming.some(row => row.id && rows.some(existing => existing.id === row.id))) error = { code:'23505', message:'duplicate id' }
          else { fixture.tables[table] = [...rows,...incoming.map(row=>({...row}))];result = incoming }
        }
        return Promise.resolve({data:error?null:(single?(result[0]??null):result),error}).then(resolve,reject)
      }
    }; return q
  },
  async rpc(fn: string,args: any) {
    fixture.calls.push({fn,args})
    if (fn === 'booking_rows_update') {
      const rows = fixture.tables.bookings.filter(row => row.restaurant_id === args.p_restaurant_id && args.p_ids.includes(row.id))
      if (rows.length !== args.p_ids.length) return {data:null,error:{code:'P0002',message:'Missing booking'}}
      if (!args.p_official && rows.some(row => row.created_by !== args.p_actor_id)) return {data:null,error:{code:'42501',message:'Forbidden'}}
      const digits = String(args.p_values.phone ?? '').replace(/\D/g,'')
      if (Object.prototype.hasOwnProperty.call(args.p_values,'phone') && digits && rows.some(row=>fixture.tables.bookings.some(other=>other.restaurant_id===args.p_restaurant_id && other.guest_key!==row.guest_key && String(other.phone??'').replace(/\D/g,'')===digits))) return {data:null,error:{code:'23505',message:'Phone conflict'}}
      rows.forEach(row=>Object.assign(row,args.p_values))
      return {data:rows.map(row=>({...row})),error:null}
    }
    if (fn === 'booking_notification_claim') {
      if (fixture.claimFails) return {data:null,error:{code:'XX000',message:'fixture claim failure'}}
      const row = fixture.tables.bookings.find(row=>row.id===args.p_booking_id && row.restaurant_id===args.p_restaurant_id)
      if (!row || row.notification_claimed_at) return {data:false,error:null}
      if (row.notification_dispatched_at) return {data:false,error:null}
      row.notification_claimed_at = '2026-11-13T00:00:00Z'
      row.notification_claim_token = args.p_claim_token
    }
    if (fn === 'booking_notification_finish') {
      const row = fixture.tables.bookings.find(row=>row.id===args.p_booking_id && row.restaurant_id===args.p_restaurant_id)
      if (!row || row.notification_claim_token !== args.p_claim_token) return {data:false,error:null}
      if (args.p_success) row.notification_dispatched_at = '2026-11-13T00:00:00Z'
      row.notification_claimed_at = null; row.notification_claim_token = null
    }
    return {data:true,error:null}
  }
}) }))
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: async () => fixture.rateAllowed, rateLimitKey: (_req: any,prefix: string) => prefix }))
vi.mock('@/lib/notify', () => ({ dispatchNotification: async (...args: any[]) => { if (fixture.dispatchFails) throw new Error('fixture journal unavailable'); fixture.pushes.push(args);return {inserted:1,push:0} } }))
import { POST as dbPost } from '@/app/api/db/route'
import { POST as notifyPost } from '@/app/api/notify/route'
import { issueStaffToken } from '@/lib/staffToken'
import { resolveCaller } from '@/lib/apiAuth'
import { syncRestaurantReviews } from '@/lib/googleReviews'
const rid = '11111111-1111-4111-8111-111111111111'
const sid = '22222222-2222-4222-8222-222222222222'
const other = '33333333-3333-4333-8333-333333333333'
const bookingId = '44444444-4444-4444-8444-444444444444'
const foreign = '55555555-5555-4555-8555-555555555555'
const guest = 'g:66666666-6666-4666-8666-666666666666'
function request(body: any,owner = false) {
  const token = issueStaffToken({rid,sid:owner?'owner':sid,owner,apps:['stash']})
  return new NextRequest('http://fixture.invalid/api/db',{method:'POST',headers:{'content-type':'application/json',cookie:`mise_staff_token=${token}`},body:JSON.stringify(body)})
}
const filter = (id = bookingId) => [{col:'id',op:'eq',val:id}]
const create = (patch = {}) => ({table:'bookings',op:'insert',values:{id:bookingId,booking_date:'2026-11-13',booking_time:'19:00',guest_name:'Guest',guests_count:2,...patch}})
beforeEach(() => {
  vi.stubEnv('MISE_TOKEN_SECRET','offline-booking-regression-secret')
  fixture.tables = { restaurants:[{id:rid,subscription_status:'active',subscription_plan:'business',name:'Venue'}],staff:[{id:sid,restaurant_id:rid,is_active:true,apps:['stash'],role:'waiter',name:'Current Staff'}],bookings:[],guest_notes:[] }
  fixture.calls=[];fixture.pushes=[];fixture.rateAllowed=true;fixture.reviewWriteFails=false;fixture.claimFails=false;fixture.dispatchFails=false
})
describe('booking gateway authorization and validation',()=>{
  it('rejects a mixed-author mutation before changing any booking',async()=>{
    fixture.tables.bookings=[{id:bookingId,restaurant_id:rid,created_by:sid,status:'new'},{id:other,restaurant_id:rid,created_by:other,status:'new'}]
    const response=await dbPost(request({table:'bookings',op:'update',values:{status:'cancelled'},filters:[{col:'id',op:'in',val:[bookingId,other]}]}))
    expect(response.status).toBe(403);expect(fixture.tables.bookings.map(row=>row.status)).toEqual(['new','new'])
  })
  it('allows the author and officials while retaining forced tenant scope',async()=>{
    fixture.tables.bookings=[{id:bookingId,restaurant_id:rid,created_by:sid,status:'new'},{id:other,restaurant_id:foreign,created_by:sid,status:'new'}]
    expect((await dbPost(request({table:'bookings',op:'update',values:{status:'arrived'},filters:filter()}))).status).toBe(200)
    expect(fixture.tables.bookings[0].status).toBe('arrived')
    fixture.tables.staff[0].role='manager';fixture.tables.bookings[0].created_by=other
    expect((await dbPost(request({table:'bookings',op:'delete',filters:filter()}))).status).toBe(200)
    expect(fixture.tables.bookings.map(row=>row.id)).toEqual([other])
  })
  it('stamps live author identity and freezes authorship on updates',async()=>{
    const response=await dbPost(request(create({created_by:'owner',created_by_name:'Forged'})))
    expect(response.status).toBe(200)
    expect(fixture.tables.bookings[0]).toMatchObject({created_by:sid,created_by_name:'Current Staff',restaurant_id:rid})
    expect((await dbPost(request({table:'bookings',op:'update',values:{note:'changed',created_by:other,created_by_name:'Forged again'},filters:filter()}))).status).toBe(200)
    expect(fixture.tables.bookings[0]).toMatchObject({created_by:sid,created_by_name:'Current Staff',note:'changed'})
  })
  it.each([{guests_count:-1},{guests_count:0},{guests_count:1.5},{booking_time:'99:99'},{booking_time:'1:30'},{status:'unknown'},{booking_date:'2026-02-30'},{note:'x'.repeat(4001)}])('rejects invalid booking input %j before writes',async patch=>{
    expect((await dbPost(request(create(patch)))).status).toBe(400)
    expect(fixture.tables.bookings).toEqual([])
  })
  it('enforces Booking entitlement for active Starter and owner sessions too',async()=>{
    fixture.tables.restaurants[0].subscription_plan='starter'
    expect((await dbPost(request(create()))).status).toBe(403)
    expect((await dbPost(request(create(),true))).status).toBe(403)
    expect(fixture.tables.bookings).toEqual([])
  })
  it('uses current staff apps instead of old token grants',async()=>{
    fixture.tables.staff[0].apps=[]
    expect((await resolveCaller(request({})))?.apps).toEqual([])
    expect((await dbPost(request({table:'guest_notes',op:'select'}))).status).toBe(403)
  })
  it('makes same-payload retries idempotent and rejects conflicting reuse',async()=>{
    expect((await dbPost(request(create()))).status).toBe(200)
    expect((await dbPost(request(create()))).status).toBe(200)
    expect(fixture.tables.bookings).toHaveLength(1)
    expect((await dbPost(request(create({guests_count:5})))).status).toBe(409)
    expect(fixture.tables.bookings[0].guests_count).toBe(2)
  })
  it('protects guest profile mutations when any source booking has another author',async()=>{
    fixture.tables.bookings=[{id:bookingId,restaurant_id:rid,guest_key:guest,created_by:other}]
    fixture.tables.guest_notes=[{id:other,restaurant_id:rid,guest_key:guest,note:'private'}]
    expect((await dbPost(request({table:'guest_notes',op:'update',values:{note:'overwritten'},filters:[{col:'guest_key',op:'eq',val:guest}]}))).status).toBe(403)
    expect(fixture.tables.guest_notes[0].note).toBe('private')
  })
  it('authorizes atomic guest RPCs and forces the session tenant',async()=>{
    fixture.tables.bookings=[{id:bookingId,restaurant_id:rid,guest_key:guest,created_by:sid}]
    const response=await dbPost(request({op:'rpc',fn:'booking_guest_update',args:{p_restaurant_id:foreign,p_guest_key:guest,p_profile:{note:'new'}}}))
    expect(response.status).toBe(200)
    expect(fixture.calls.find(call=>call.fn==='booking_guest_update')?.args).toMatchObject({p_restaurant_id:rid,p_guest_key:guest,p_profile:{note:'new'}})
    fixture.tables.bookings[0].created_by=other
    expect((await dbPost(request({op:'rpc',fn:'booking_guest_delete',args:{p_guest_key:guest}}))).status).toBe(403)
  })
})
describe('booking notifications',()=>{
  it('refuses fabricated and non-author booking events',async()=>{
    const payload={type:'booking',title:'Booking',titleKey:'notify.bookingTitle',audience:{managers:true},data:{booking_id:bookingId}}
    expect((await notifyPost(request(payload))).status).toBe(404)
    fixture.tables.bookings=[{id:bookingId,restaurant_id:rid,created_by:other}]
    expect((await notifyPost(request(payload))).status).toBe(403)
    expect(fixture.pushes).toEqual([])
  })
  it('derives an event from the stored booking and deduplicates retry dispatches',async()=>{
    fixture.tables.bookings=[{id:bookingId,restaurant_id:rid,created_by:sid,guest_name:'Stored Guest',booking_date:'2026-11-13',booking_time:'19:00',guests_count:2,notification_claimed_at:null}]
    const payload={type:'booking',title:'Fake',body:'Untrusted',audience:{all:true},data:{booking_id:bookingId}}
    expect((await notifyPost(request(payload))).status).toBe(200)
    expect(fixture.pushes).toHaveLength(1)
    expect(fixture.pushes[0][2]).toMatchObject({titleKey:'notify.bookingTitle',audience:{managers:true},data:{booking_id:bookingId,booking_date:'2026-11-13'}})
    expect(fixture.pushes[0][2].bodySegments).toContainEqual({value:'Stored Guest'})
    // Database claim is represented by conditional update on the booking in this fixture.
    expect((await notifyPost(request(payload))).status).toBe(200)
    expect(fixture.pushes).toHaveLength(1)
  })
  it('rate limits booking notifications before sending',async()=>{
    fixture.rateAllowed=false
    expect((await notifyPost(request({type:'booking',title:'Booking',audience:{managers:true},data:{booking_id:bookingId}}))).status).toBe(429)
    expect(fixture.pushes).toEqual([])
  })
})
it('does not report review synchronization success when database writes fail',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({rating:4.2,reviews:[{name:'r1',rating:4}]}),{status:200})))
  fixture.reviewWriteFails=true
  const {createClient}=await import('@supabase/supabase-js')
  const result=await syncRestaurantReviews(createClient('fixture','fixture'),rid,'fixture','fixture')
  expect(result.ok).toBe(false)
  vi.unstubAllGlobals()
})

describe('booking gateway edge boundaries',()=>{
  it('checks every matched author including missing authors before delete',async()=>{
    fixture.tables.bookings=[{id:bookingId,restaurant_id:rid,created_by:sid},{id:other,restaurant_id:rid,created_by:null}]
    expect((await dbPost(request({table:'bookings',op:'delete',filters:[{col:'id',op:'in',val:[bookingId,other]}]}))).status).toBe(403)
    expect(fixture.tables.bookings).toHaveLength(2)
  })
  it('deduplicates concurrent same-payload inserts but refuses another author',async()=>{
    const responses=await Promise.all([dbPost(request(create())),dbPost(request(create()))])
    expect(responses.map(response=>response.status)).toEqual([200,200])
    expect(fixture.tables.bookings).toHaveLength(1)
    fixture.tables.bookings[0].created_by=other
    expect((await dbPost(request(create()))).status).toBe(409)
  })
  it('ignores forged author privilege arguments on atomic guest mutations',async()=>{
    fixture.tables.bookings=[{id:bookingId,restaurant_id:rid,guest_key:guest,created_by:sid}]
    expect((await dbPost(request({op:'rpc',fn:'booking_guest_update',args:{p_guest_key:guest,p_actor_id:'owner',p_official:true,p_profile:{note:'new'}}}))).status).toBe(200)
    expect(fixture.calls.find(call=>call.fn==='booking_guest_update').args).toMatchObject({p_actor_id:sid,p_official:false})
  })
  it.each([{p_after_date:'2026-11-13'},{p_after_id:bookingId},{p_limit:0},{p_limit:501},{p_after_date:'2026-02-30',p_after_id:bookingId}])('rejects invalid history cursor %j',async args=>{
    expect((await dbPost(request({op:'rpc',fn:'booking_history_page',args}))).status).toBe(400)
    expect(fixture.calls.some(call=>call.fn==='booking_history_page')).toBe(false)
  })
  it('supports default history page without client-supplied arguments',async()=>{
    expect((await dbPost(request({op:'rpc',fn:'booking_history_page'}))).status).toBe(200)
    expect(fixture.calls.find(call=>call.fn==='booking_history_page').args).toMatchObject({p_limit:500,p_after_date:null,p_after_id:null,p_restaurant_id:rid})
  })
  it('does not label a staff author with an empty live name as the owner',async()=>{
    fixture.tables.staff[0].name=''
    expect((await dbPost(request(create()))).status).toBe(200)
    expect(fixture.tables.bookings[0].created_by_name).toBe('Staff')
  })
})

it('fails closed when the notification claim cannot be persisted',async()=>{
  fixture.tables.bookings=[{id:bookingId,restaurant_id:rid,created_by:sid}]
  fixture.claimFails=true
  expect((await notifyPost(request({type:'booking',title:'Booking',data:{booking_id:bookingId}}))).status).toBe(503)
  expect(fixture.pushes).toEqual([])
})
it('keeps internal guest identity migration fields server-managed',async()=>{
  fixture.tables.bookings=[{id:bookingId,restaurant_id:rid,guest_key:guest,created_by:sid}]
  expect((await dbPost(request({table:'guest_notes',op:'upsert',onConflict:'restaurant_id,guest_key',values:{guest_key:guest,note:'legitimate',canonical_guest_key:guest,identity_migration_checked:true}}))).status).toBe(400)
  expect(fixture.tables.guest_notes).toEqual([])
})
it.each([{email:'invalid'},{birthday:'2026-02-30'},{note:'x'.repeat(4001)},{unknown:'field'}])('rejects invalid profile patch %j',async profile=>{
  fixture.tables.bookings=[{id:bookingId,restaurant_id:rid,guest_key:guest,created_by:sid}]
  expect((await dbPost(request({op:'rpc',fn:'booking_guest_update',args:{p_guest_key:guest,p_profile:profile}}))).status).toBe(400)
  expect(fixture.calls.some(call=>call.fn==='booking_guest_update')).toBe(false)
})
it('does not report an update or delete of a missing booking as saved',async()=>{
  expect((await dbPost(request({table:'bookings',op:'update',values:{status:'arrived'},filters:filter()}))).status).toBe(404)
  expect((await dbPost(request({table:'bookings',op:'delete',filters:filter()}))).status).toBe(404)
})
it('accepts a legacy create without an ID but rejects a malformed supplied ID',async()=>{
  const legacy=create();delete (legacy.values as Record<string,unknown>).id
  expect((await dbPost(request(legacy))).status).toBe(200)
  expect(fixture.tables.bookings[0].id).toMatch(/^[0-9a-f-]{36}$/)
  expect((await dbPost(request(create({id:'malformed'})))).status).toBe(400)
})

describe('atomic reservation contact updates',()=>{
  it('rejects a phone assigned to another guest without changing either booking',async()=>{
    fixture.tables.bookings=[{id:bookingId,restaurant_id:rid,guest_key:guest,created_by:sid,phone:'1111111111'},
      {id:other,restaurant_id:rid,guest_key:'g:77777777-7777-4777-8777-777777777777',created_by:other,phone:'+39 2222222222'}]
    const response=await dbPost(request({table:'bookings',op:'update',values:{phone:'392222222222'},filters:filter()}))
    expect(response.status).toBe(409)
    expect(fixture.tables.bookings.map(row=>row.phone)).toEqual(['1111111111','+39 2222222222'])
  })
  it('uses pinned tenant-scoped IDs and forced actor for the atomic write',async()=>{
    fixture.tables.bookings=[{id:bookingId,restaurant_id:rid,guest_key:guest,created_by:sid,phone:'1111111111'},
      {id:other,restaurant_id:foreign,created_by:sid,phone:'9999999999'}]
    const response=await dbPost(request({table:'bookings',op:'update',values:{phone:'1234567890',created_by:'owner',notification_claimed_at:null},filters:[{col:'id',op:'in',val:[bookingId,other]}],returning:'single'}))
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({id:bookingId,phone:'1234567890'})
    expect(fixture.calls.find(call=>call.fn==='booking_rows_update')?.args).toEqual({p_restaurant_id:rid,p_ids:[bookingId],p_values:{phone:'1234567890'},p_actor_id:sid,p_official:false})
    expect(fixture.calls.some(call=>call.table==='bookings'&&call.op==='update')).toBe(false)
    expect(fixture.tables.bookings[1].phone).toBe('9999999999')
  })
  it('rejects oversized matched sets instead of silently truncating authorization',async()=>{
    fixture.tables.bookings=Array.from({length:101},(_,index)=>({id:`88888888-8888-4888-8888-${String(index).padStart(12,'0')}`,restaurant_id:rid,created_by:sid,status:'new'}))
    const response=await dbPost(request({table:'bookings',op:'update',values:{status:'arrived'},filters:[{col:'created_by',op:'eq',val:sid}]}))
    expect(response.status).toBe(400)
    expect(fixture.calls.some(call=>call.fn==='booking_rows_update')).toBe(false)
    expect(fixture.tables.bookings.every(row=>row.status==='new')).toBe(true)
  })
})

describe('retryable booking notification leases',()=>{
  it('passes an unguessable lease token and stable event key, then marks completion',async()=>{
    fixture.tables.bookings=[{id:bookingId,restaurant_id:rid,created_by:sid,notification_claimed_at:null}]
    expect((await notifyPost(request({type:'booking',title:'Booking',data:{booking_id:bookingId}}))).status).toBe(200)
    const claim=fixture.calls.find(call=>call.fn==='booking_notification_claim')
    expect(claim.args.p_claim_token).toMatch(/^[0-9a-f-]{36}$/)
    expect(fixture.pushes[0][2].eventKey).toBe(`booking:${bookingId}`)
    expect(fixture.calls.find(call=>call.fn==='booking_notification_finish')?.args).toMatchObject({p_claim_token:claim.args.p_claim_token,p_success:true})
    expect(fixture.tables.bookings[0].notification_dispatched_at).toBeTruthy()
  })
  it('releases a failed dispatch lease so the persisted reservation can retry',async()=>{
    fixture.tables.bookings=[{id:bookingId,restaurant_id:rid,created_by:sid,notification_claimed_at:null,guest_name:'Reserved Guest'}]
    const payload={type:'booking',title:'Booking',data:{booking_id:bookingId}}
    fixture.dispatchFails=true
    const errorLog=vi.spyOn(console,'error').mockImplementation(()=>{})
    try { expect((await notifyPost(request(payload))).status).toBe(503) }
    finally { errorLog.mockRestore() }
    expect(fixture.tables.bookings[0]).toMatchObject({guest_name:'Reserved Guest',notification_claimed_at:null})
    expect(fixture.calls.some(call=>call.fn==='booking_notification_finish'&&call.args.p_success===false)).toBe(true)
    fixture.dispatchFails=false
    expect((await notifyPost(request(payload))).status).toBe(200)
    expect(fixture.pushes).toHaveLength(1)
    expect(fixture.tables.bookings).toHaveLength(1)
  })
})
