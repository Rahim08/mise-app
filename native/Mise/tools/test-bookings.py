#!/usr/bin/env python3
"""Exercise current native Booking loaders, editors and guest RPCs with fake transport.
Run: python3 native/Mise/tools/test-bookings.py. No server, credentials or simulator.
"""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1] / 'Mise'
bookings = (ROOT / 'BookingsView.swift').read_text()
models = (ROOT / 'Models.swift').read_text()
model = bookings[bookings.index('private nonisolated struct BookingDay'):bookings.index('// MARK: - Цель редактора')]
dto = models[models.index('nonisolated struct Booking:'):models.index('nonisolated struct HookahGoal:')]
helpers = (ROOT / 'BookingGuest.swift').read_text()
guests = (ROOT / 'GuestsView.swift').read_text()
aggregation = guests[guests.index('func buildGuestProfiles'):guests.index('// MARK: - GuestsView\n')]
reviews = (ROOT / 'GoogleReviewsView.swift').read_text()
reviews = reviews[reviews.index('private nonisolated struct PlaceIdRow'):reviews.index('struct GoogleReviewsView:')]
detail = guests[guests.index('struct GuestDetailView:'):]
preferred = detail[detail.index('    private var guestName:'):detail.index('    // Телефон для префилла')]
preferred_probe = 'struct GuestNameProbe { let guest: GuestProfile; private var sortedBookings: [Booking] { guest.bookings }; var value: String? { guestName }\n' + preferred + '\n}\n'

transport = r'''
@MainActor func t(_ key:String,_ vars:[String:String]=[:])->String { key }
@MainActor enum Notify {
 static var sent:[[String:String]]=[]
 static var blocked=false
 static var started=false
 static var continuation:CheckedContinuation<Void,Never>?
 static func send(type:String,title:String,body:String,audience:[String:Bool],titleKey:String,bodySegments:[[String:String]]?,data:[String:String]) async {
  sent.append(data);started=true
  if blocked {await withCheckedContinuation {continuation=$0}}
 }
}
@MainActor final class Transport {
 static let shared=Transport()
 var mode=""
 var writes:[[String:Any]]=[]
 var calls:[[String:Any]]=[]
 var records:[[String:Any]]=[]
 var notes:[String:[String:Any]]=[:]
 var failInsertOnce=true
 var failProfile=false
 var failDelete=false
 var profileReads=0
 var freshReads=0
 var blockReads=false
 var readGates:[CheckedContinuation<Void,Never>]=[]
 var serverStatus="new"
 func reset(_ value:String) {mode=value;writes=[];calls=[];records=[];notes=[:];failInsertOnce=true;failProfile=false;failDelete=false;profileReads=0;freshReads=0;serverStatus="new";Notify.sent=[]}
 func read(_ table:String,_ columns:String,_ filters:[String:String],_ orderAsc:Bool,_ limit:Int?,fresh:Bool) async throws->Data {
  if fresh {freshReads += 1}
  if mode=="offline" {throw URLError(.notConnectedToInternet)}
  if mode=="gatedRefresh" && blockReads && table=="bookings" && filters["booking_date"]=="2026-11-13" {await withCheckedContinuation {readGates.append($0)}}
  var rows:[[String:Any]]=[]
  if (mode=="statusnav" || mode=="statusreadrace") && table=="bookings" {
   let day=filters["booking_date"] ?? filters["gte:booking_date"] ?? "2026-11-13"
   try? await Task.sleep(for:.milliseconds(80))
   rows=[["id":"abcdef12-1234-4234-8234-abcdef123456","booking_date":day,"status":"new","guest_name":"Server refresh"]]
  } else if mode=="dayrace" || mode=="rangerace" || mode=="monthrace" {
   let day=filters["booking_date"] ?? filters["gte:booking_date"] ?? "unknown"
   try? await Task.sleep(for:.milliseconds(day.hasPrefix("2026-10") ? 80 : 5))
   rows=[["id":day,"booking_date":day,"booking_time":"19:00","guest_name":day]]
  } else if mode=="reviews" {
   if table=="restaurant_settings" {rows=[["google_place_id":"place"]]}
   if table=="google_rating_snapshots" {
    rows=(1...100).map{["captured_at":String(format:"%03d",$0),"rating":Double($0)/100+3,"ratings_total":$0]}
    if !orderAsc {rows.reverse()}
    if let limit {rows=Array(rows.prefix(limit))}
   }
  } else if table=="guest_notes" {
   if mode=="profileRace" {
    profileReads += 1;let number=profileReads
    try? await Task.sleep(for:.milliseconds(number==1 ? 80 : 5))
    rows=[["note":number==1 ? "old" : "new"]]
   } else if let key=filters["guest_key"],let note=notes[key] {rows=[note]}
  } else if table=="bookings" {rows=records}
  return try JSONSerialization.data(withJSONObject:rows)
 }
 func write(_ table:String,_ op:String,_ values:[String:Any],_ id:String?) async throws->Data {
  if mode=="offline" {throw URLError(.notConnectedToInternet)}
  if mode=="statusrace",table=="bookings",values["status"] as? String=="arrived" {
   try? await Task.sleep(for:.milliseconds(60));throw URLError(.timedOut)
  }
  if (mode=="statusnav" || mode=="statusreadrace") && table=="bookings" && values["status"] != nil { try? await Task.sleep(for:.milliseconds(20)) }
  writes.append(["table":table,"op":op,"values":values])
  var returned=values
  if table=="bookings",op=="insert" {
   guard let key=values["id"] as? String else {fatalError("create omitted stable booking ID")}
   if let existing=records.first(where:{$0["id"] as? String==key}) {returned=existing}
   else {
    returned["guest_key"]=values["guest_key"] ?? "g:11111111-1111-4111-8111-111111111111"
    returned["created_by"]="server-author";returned["created_by_name"]="Server Author"
    returned["status"]=values["status"] ?? "new"
    records.append(returned)
   }
   if failInsertOnce && mode=="insertlost" {failInsertOnce=false;throw URLError(.networkConnectionLost)}
  }
  if table=="bookings",op=="update" {
   if let status=values["status"] as? String {serverStatus=status}
   if let i=records.firstIndex(where:{$0["id"] as? String==id}) {records[i].merge(values){_,new in new};returned=records[i]}
  }
  return try JSONSerialization.data(withJSONObject:returned)
 }
 func rpc(_ payload:[String:Any]) async throws->Data {
  if mode=="offline" {throw URLError(.notConnectedToInternet)}
  calls.append(payload)
  let args=payload["args"] as? [String:Any] ?? [:]
  switch payload["fn"] as? String {
  case "booking_history_page":
   if mode=="historyfailure",args["p_after_date"] != nil {throw URLError(.networkConnectionLost)}
   var sorted=records.sorted { (($0["booking_date"] as? String ?? ""),($0["id"] as? String ?? "")) > (($1["booking_date"] as? String ?? ""),($1["id"] as? String ?? "")) }
   if let date=args["p_after_date"] as? String,let id=args["p_after_id"] as? String,mode != "repeatedcursor" {
    sorted=sorted.filter { (($0["booking_date"] as? String ?? ""),($0["id"] as? String ?? "")) < (date,id) }
   }
   return try JSONSerialization.data(withJSONObject:["data":Array(sorted.prefix(500))])
  case "booking_guest_update":
   if failProfile {throw URLError(.networkConnectionLost)}
   let key=args["p_guest_key"] as! String
   for i in records.indices where records[i]["guest_key"] as? String==key {
    if let value=args["p_name"] {records[i]["guest_name"]=value}
    if let value=args["p_phone"] {records[i]["phone"]=value}
   }
   var note=notes[key] ?? [:]
   if let patch=args["p_profile"] as? [String:Any] {note.merge(patch){_,new in new}}
   notes[key]=note
  case "booking_guest_delete":
   if failDelete {throw URLError(.networkConnectionLost)}
   let key=args["p_guest_key"] as! String
   records.removeAll {$0["guest_key"] as? String==key};notes[key]=nil
  default: fatalError("unexpected RPC")
  }
  return Data("{\"data\":null}".utf8)
 }
}
enum API {static func dbRequest(_ payload:[String:Any]) async throws->Data {try await Transport.shared.rpc(payload)}}
enum DB {static func from(_ table:String)->Query {Query(table)}}
final class Query: @unchecked Sendable {
 let table:String;var columns="*";var filters:[String:String]=[:];var asc=true;var limitN:Int?;var op="select";var values:[String:Any]=[:];var id:String?;var bypass=false
 init(_ table:String){self.table=table}
 @discardableResult func fresh()->Self {bypass=true;return self}
 func select(_ columns:String="*")->Self {self.columns=columns;return self}
 func eq(_ c:String,_ v:String)->Self {filters[c]=v;if c=="id"{id=v};return self}
 func gte(_ c:String,_ v:String)->Self {filters["gte:"+c]=v;return self}
 func lte(_ c:String,_ v:String)->Self {filters["lte:"+c]=v;return self}
 func order(_ c:String,ascending:Bool=true)->Self {asc=ascending;return self}
 func limit(_ n:Int)->Self {limitN=n;return self}
 func insert(_ value:[String:Any])->Self {values=value;op="insert";return self}
 func update(_ value:[String:Any])->Self {values=value;op="update";return self}
 func delete()->Self {op="delete";return self}
 func run() async throws {_ = try await Transport.shared.write(table,op,values,id)}
 func list<T:Decodable>(_ type:T.Type) async throws->[T] {
  try await JSONDecoder().decode([T].self,from:Transport.shared.read(table,columns,filters,asc,limitN,fresh:bypass))
 }
 func single<T:Decodable>(_ type:T.Type) async throws->T? {
  if op=="select" {return try await list(type).first}
  return try await JSONDecoder().decode(T.self,from:Transport.shared.write(table,op,values,id))
 }
}
'''
tests=r'''
@main struct Tests {
 @MainActor static func main() async throws {
  let f=DateFormatter();f.dateFormat="yyyy-MM-dd";f.locale=Locale(identifier:"en_US_POSIX")
  let old=f.date(from:"2026-10-12")!,new=f.date(from:"2026-11-13")!
  let transport=Transport.shared
  transport.reset("dayrace")
  let model=BookingsModel(rid:"fixture")
  let first=Task {await model.selectDay(old)}
  try await Task.sleep(for:.milliseconds(5))
  let second=Task {await model.selectDay(new)}
  await second.value;await first.value
  assert(model.bookings.first?.booking_date=="2026-11-13","older day overwrote current selection")
  transport.reset("rangerace")
  let r1=Task {await model.loadRange(from:old,to:old)}
  try await Task.sleep(for:.milliseconds(5))
  let r2=Task {await model.loadRange(from:new,to:new)}
  await r2.value;await r1.value
  assert(model.rangeBookings.first?.booking_date=="2026-11-13")
  transport.reset("monthrace")
  model.visibleMonth=old;let month1=Task {await model.loadMonth()}
  try await Task.sleep(for:.milliseconds(5))
  model.visibleMonth=new;let month2=Task {await model.loadMonth()}
  await month2.value;await month1.value
  assert(model.monthDays==["2026-11-01"])
  print("PASS native day/range/month response ordering")

  let id="abcdef12-1234-4234-8234-abcdef123456",key="g:11111111-1111-4111-8111-111111111111"
  let booking=Booking(id:id,booking_date:"2026-11-13",booking_time:"19:00",guest_name:"Guest",guests_count:2,phone:"111",table_label:nil,note:nil,status:"new",created_by:"forged",created_by_name:"Forged")
  transport.reset("insertlost")
  do {_ = try await model.save(booking,isNew:true);assertionFailure("lost response not simulated")} catch {}
  let persisted=try await model.save(booking,isNew:true)
  for _ in 0..<8 {await Task.yield()}
  assert(transport.records.count==1 && persisted.id==id && persisted.guest_key==key)
  assert(transport.writes.filter{$0["op"] as? String=="insert"}.allSatisfy{($0["values"] as? [String:Any])?["id"] as? String==id})
  assert(transport.writes.filter{$0["op"] as? String=="insert"}.allSatisfy{($0["values"] as? [String:Any])?["created_by"]==nil})
  assert(Notify.sent.count==1 && Notify.sent[0]["booking_id"]==id)
  transport.reset("notificationPending")
  Notify.blocked=true;Notify.started=false
  var saveCompleted=false
  let quick=BookingsModel(rid:"fixture");quick.currentDate=old
  let pendingNotification=Task {_ = try await quick.save(booking,isNew:true);saveCompleted=true}
  for _ in 0..<30 {if Notify.started {break};try await Task.sleep(for:.milliseconds(1))}
  let completedBeforeNotification=saveCompleted
  Notify.continuation?.resume();Notify.continuation=nil;Notify.blocked=false
  _ = try await pendingNotification.value
  assert(completedBeforeNotification,"notification transport held successful save open")
  transport.mode="gatedRefresh";transport.blockReads=true
  let nonblocking=BookingsModel(rid:"fixture");nonblocking.currentDate=new
  var refreshSaveFinished=false
  let refreshSave=Task {_ = try await nonblocking.save(booking,isNew:true);refreshSaveFinished=true}
  for _ in 0..<100 {if !transport.readGates.isEmpty {break};await Task.yield()}
  assert(!transport.readGates.isEmpty,"controlled refresh did not begin")
  let publishedWhileReadPending=refreshSaveFinished && nonblocking.bookings.first?.id==id
  transport.blockReads=false
  let gates=transport.readGates;transport.readGates=[]
  for gate in gates {gate.resume()}
  _ = try await refreshSave.value
  for _ in 0..<8 {await Task.yield()}
  assert(publishedWhileReadPending,"post-write refresh held save or hid persisted booking")
  transport.mode="insertlost"
  let state=BookingSaveState(),draftId=BookingSaveState().id
  assert(UUID(uuidString:draftId) != nil)
  let stable=state.id
  let failed=await state.perform{throw URLError(.notConnectedToInternet)}
  assert(!failed && !state.saving && state.error != nil && state.id==stable)
  let retried=await state.perform{}
  assert(retried && state.error==nil && state.id==stable)
  transport.failProfile=true
  do {_ = try await model.save(booking,isNew:true,lastName:"Last");assertionFailure("profile error swallowed")} catch {}
  assert(transport.records.count==1)
  transport.failProfile=false
  _ = try await model.save(booking,isNew:true,lastName:"Last")
  assert(transport.records.count==1 && transport.notes[key]?["last_name"] as? String=="Last")
  print("PASS stable create retry, server identity, notification ID and retained save state")

  for _ in 0..<8 {await Task.yield()}
  transport.reset("statusrace")
  model.bookings=[booking];model.rangeBookings=[booking];model.allBookings=[booking];model.allBookingsLoaded=true
  let status1=Task {await model.setStatus(booking,to:"arrived")}
  try await Task.sleep(for:.milliseconds(5))
  await model.setStatus(model.bookings[0],to:"cancelled");await status1.value
  assert(transport.serverStatus=="cancelled" && model.bookings[0].status=="cancelled")
  assert(model.rangeBookings[0].status=="cancelled" && model.allBookings[0].status=="cancelled" && !model.allBookingsLoaded)
  transport.reset("statusnav")
  let navigating=BookingsModel(rid:"fixture")
  navigating.currentDate=old;navigating.bookings=[booking]
  let pendingStatusWrite=Task {await navigating.setStatus(booking,to:"cancelled")}
  try await Task.sleep(for:.milliseconds(5))
  await navigating.selectDay(new);await pendingStatusWrite.value
  assert(navigating.bookings.first?.booking_date=="2026-11-13","status completion discarded navigation response")
  transport.reset("statusreadrace")
  let refreshing=BookingsModel(rid:"fixture")
  refreshing.currentDate=new;refreshing.bookings=[booking]
  let read=Task {await refreshing.load(force:true)}
  try await Task.sleep(for:.milliseconds(5))
  await refreshing.setStatus(booking,to:"cancelled");await read.value
  assert(refreshing.bookings.first?.guest_name=="Server refresh" && refreshing.bookings.first?.status=="cancelled","stale read lost fields or overwrote confirmed status")
  transport.reset("offline")
  let blank=BookingsModel(rid:"fixture");await blank.load();await blank.loadRange(from:new,to:new);await blank.loadAllBookings()
  assert(!blank.loading && blank.dayError != nil && blank.rangeError != nil && blank.guestsError != nil)
  print("PASS ordered status mutations, guest invalidation and explicit initial errors")

  transport.reset("history")
  transport.records=(1...1201).map{["id":String(format:"00000000-0000-4000-8000-%012d",$0),"booking_date":"2001-01-01","guest_name":"Old guest"]}
  let history=BookingsModel(rid:"fixture");await history.loadAllBookings()
  assert(history.allBookingsLoaded && history.allBookings.count==1201 && transport.calls.count==3)
  transport.mode="historyfailure";transport.calls=[]
  await history.loadAllBookings(force:true)
  assert(history.allBookings.count==1201 && history.guestsError != nil)
  transport.mode="repeatedcursor";transport.calls=[]
  await history.loadAllBookings(force:true)
  assert(history.guestsError != nil && transport.calls.count<=3 && history.allBookings.count==1201)
  transport.mode="history";transport.calls=[];transport.records=[]
  await history.loadAllBookings(force:true)
  assert(history.allBookings.isEmpty && history.guestsError==nil && transport.calls.count==1)
  transport.mode="";transport.freshReads=0
  await model.load(force:true);await model.loadRange(from:new,to:new,force:true);await model.loadMonth(force:true)
  assert(transport.freshReads==3)
  print("PASS all-time paged history, partial failure retention, cursor guard and forced reads")

  let today=bookingDateKey(Date())
  var pending=booking;pending.booking_date=today;pending.status="new"
  var arrived=pending;arrived.status="arrived"
  var oldVisit=pending;oldVisit.booking_date="2001-01-01"
  var future=pending;future.booking_date="2099-01-01";future.status="arrived"
  var cancelled=oldVisit;cancelled.status="cancelled"
  assert(!bookingIsVisit(pending,today:today) && bookingIsVisit(arrived,today:today) && bookingIsVisit(oldVisit,today:today) && !bookingIsVisit(future,today:today) && !bookingIsVisit(cancelled,today:today))
  var same=booking;same.guest_key=key;same.phone="222"
  var other=same;other.guest_key=nil;other.phone="222791234567"
  var another=other;another.phone="111791234567"
  assert(bookingGuestKey(same)==key && bookingGuestKey(other) != bookingGuestKey(another))
  var combining=booking;combining.guest_key=nil;combining.phone="0\u{301}1"
  assert(bookingGuestKey(combining)=="phone:01","phone identity retained non-ASCII combining scalar")
  let phoneless1=Booking(id:"a",booking_date:"2001-01-01",booking_time:nil,guest_name:"Same",guests_count:nil,phone:nil,table_label:nil,note:nil,status:nil,created_by:nil,created_by_name:nil)
  let phoneless2=Booking(id:"b",booking_date:"2001-01-01",booking_time:nil,guest_name:"Same",guests_count:nil,phone:nil,table_label:nil,note:nil,status:nil,created_by:nil,created_by_name:nil)
  assert(buildGuestProfiles(from:[phoneless1,phoneless2]).count==2)
  assert(buildGuestProfiles(from:[future])[0].visitCount==0 && buildGuestProfiles(from:[future])[0].lastVisitDate==nil)
  var phoneOnly=booking;phoneOnly.guest_name=nil;phoneOnly.guest_key=key
  let phoneProfile=GuestProfile(id:key,displayName:"+39 123",phone:"+39 123",visitCount:0,lastVisitDate:nil,totalGuests:0,bookings:[phoneOnly])
  assert(GuestNameProbe(guest:phoneProfile).value==nil,"phone-only guest prefilled phone as a name")
  print("PASS canonical/full-phone/per-booking identity and completed-visit semantics")

  transport.reset("profileRace")
  let profile=BookingGuestDetailsModel(key:key)
  let load1=Task {await profile.load()};try await Task.sleep(for:.milliseconds(5))
  let load2=Task {await profile.load()};await load2.value;await load1.value
  assert(profile.loaded && profile.details.note=="new")
  transport.mode="offline";await profile.load()
  assert(!profile.loaded && profile.error != nil)
  transport.reset("guest")
  transport.records=[["id":id,"booking_date":"2001-01-01","guest_name":"Guest","phone":"111","guest_key":key]]
  transport.notes[key]=["note":"VIP","last_name":"Keep","email":"keep@example.test"]
  try await BookingGuestService.update(key:key,phone:"222",profile:["note":"Changed"])
  assert(transport.records[0]["guest_key"] as? String==key && transport.records[0]["phone"] as? String=="222")
  assert(transport.notes[key]?["last_name"] as? String=="Keep" && transport.notes[key]?["note"] as? String=="Changed")
  assert(transport.calls.last?["fn"] as? String=="booking_guest_update" && transport.writes.isEmpty)
  transport.failProfile=true
  let failedProfile=await state.perform{try await BookingGuestService.update(key:key,profile:["note":"Lost"])}
  assert(!failedProfile && transport.notes[key]?["note"] as? String=="Changed")
  transport.failDelete=true
  do {try await BookingGuestService.delete(key:key);assertionFailure("delete error swallowed")} catch {}
  assert(transport.records.count==1 && transport.notes[key] != nil)
  transport.failDelete=false
  try await BookingGuestService.delete(key:key)
  assert(transport.records.isEmpty && transport.notes[key]==nil)
  print("PASS fresh guest metadata, atomic RPC edits/deletes, stable contact identity and failure retention")

  transport.reset("reviews")
  let reviews=GoogleReviewsModel();await reviews.load()
  assert(reviews.snapshots.count==90 && reviews.snapshots.first?.ratings_total==11 && reviews.snapshots.last?.ratings_total==100)
  transport.mode="offline";await reviews.load()
  assert(reviews.error != nil && reviews.snapshots.last?.ratings_total==100)
  print("PASS latest 90 reviews and honest error state")
 }
}
'''
# Booking requires the optional fields explicitly in its existing memberwise initializer.
with tempfile.TemporaryDirectory(prefix='mise-booking-tests-') as folder:
    folder=Path(folder)
    swift=folder/'test.swift'
    swift.write_text('import Foundation\nimport Observation\n'+dto+helpers+model+aggregation+reviews+preferred_probe+transport+tests)
    subprocess.run(['xcrun','swiftc','-parse-as-library','-module-cache-path','/tmp/mise-booking-test-cache',str(swift),'-o',str(folder/'test')],check=True)
    subprocess.run([str(folder/'test')],check=True)
