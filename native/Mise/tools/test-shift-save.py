#!/usr/bin/env python3
"""Run the real Manager model with gated financial writes and optional work; no network."""
from pathlib import Path
import subprocess
import tempfile
import sys

root = Path(__file__).resolve().parents[1] / 'Mise'
model = (root/'ManagerView.swift').read_text().split('// MARK: - Экран Manager')[0].replace('import SwiftUI','import Observation')
baseline = '--baseline' in sys.argv
if baseline:
    model = Path('/tmp/mise-shift-save-before-ManagerView.swift').read_text().split('// MARK: - Экран Manager')[0].replace('import SwiftUI','import Observation')
sources = '\n'.join((root/name).read_text() for name in ('Models.swift','CustomExpenses.swift','ShiftForm.swift'))
fixtures = r'''
enum APIError:Error {case http(Int,String?)}
actor CacheStore { static let shared=CacheStore(); func invalidate(table:String) {} }
@MainActor func t(_ key:String,_ vars:[String:String]=[:])->String { key }
@MainActor func aiErrorMessage(_ error:Error)->String { "error" }
enum Money { static let symbol="€"; static func s(_ amount:Double)->String { String(amount) } }
@MainActor enum AppModel { static func businessDate(dayStartHour:Int)->Date { Date(timeIntervalSince1970:1_794_571_200) } }
@MainActor final class InkTopupsModel { init(rid:String) {} }
enum ShiftReminder { static func isEnabled()->Bool { false };static func schedule() {};static func cancel() {} }
@MainActor final class Gate {
 var held=false;var entered=false;var waiters:[CheckedContinuation<Void,Never>]=[]
 func wait() async {entered=true;if held {await withCheckedContinuation {waiters.append($0)}}}
 func release(){held=false;let all=waiters;waiters=[];for waiter in all {waiter.resume()}}
}
@MainActor final class Fixture {
 static var shared=Fixture()
 var expenses:[[String:Any]]=[];var ink:[[String:Any]]=[];var writes:[(String,String,Any?)]=[]
 var reads:[(String,[String:String])]=[];var events:[String]=[];var notifications:[[String:Any]]=[]
 let financial=Gate(),sales=Gate(),push=Gate()
 var saves:[[String:Any]]=[];var failSave:Error?;var delayMs=0;var incompleteChecklist=false
 var shift:[String:Any]=["id":"shift","date":"2026-11-13","status":"open","opening_balance":100]
 func read(_ table:String,_ filters:[String:String]) async throws->Data {
  reads.append((table,filters));events.append("read:"+table)
  if table=="hookah_sales" {await sales.wait()}
  if delayMs>0 {try await Task.sleep(for:.milliseconds(delayMs))}
  var rows=table=="shift_expenses" ? expenses : table=="inkassations" ? ink : table=="shifts" ? [shift] : []
  if table=="shift_checklists" && incompleteChecklist {rows=[["id":"checklist","kind":"shift","type":"close"]]}
  rows=rows.filter {row in filters.allSatisfy { key,value in key=="restaurant_id" || String(describing:row[key] ?? "")==value }}
  return try JSONSerialization.data(withJSONObject:rows)
 }
 func save(_ fn:String,_ args:[String:Any]) async throws->Data {
  let p=args["p"] as! [String:Any]
  saves.append(p);events.append("rpc:"+fn);await financial.wait()
  if delayMs>0 {try await Task.sleep(for:.milliseconds(delayMs))}
  if let failSave {throw failSave}
  return try JSONSerialization.data(withJSONObject:["opening_balance":100,"total_expense":30,"closing_balance":170,"rows":[]])
 }
 func write(_ table:String,_ op:String,_ values:Any?,_ filters:[String:String],_ ids:[String]) async throws {
  if delayMs>0 {try await Task.sleep(for:.milliseconds(delayMs))}
  writes.append((table,op,values));events.append(op+":"+table)
  if table=="shifts",let values=values as? [String:Any] {shift.merge(values){_,new in new}}
  if table=="inkassations",let values=values as? [String:Any] {ink=[values.merging(["id":"ink"]){a,_ in a}]}
  if table=="shift_expenses",op=="delete" {expenses.removeAll {ids.contains($0["id"] as? String ?? "")}}
  if table=="shift_expenses",let rows=values as? [[String:Any]],op=="insert" || op=="upsert" {
   for value in rows {
    var row=value;row["id"]=row["id"] ?? UUID().uuidString
    if op=="upsert" {expenses.removeAll {$0["id"] as? String==row["id"] as? String}}
    expenses.append(row)
   }
  }
 }
}
@MainActor enum Notify {
 static func send(type:String,title:String,body:String,audience:[String:Bool],titleKey:String,bodyKey:String,bodyParams:[String:String],secureBody:String,secureBodySegments:[[String:String]],data:[String:String]) async {
  let fixture=Fixture.shared;await fixture.push.wait()
  fixture.notifications.append(["data":data,"segments":secureBodySegments,"params":bodyParams])
 }
}
enum DB {
 static func from(_ table:String)->Query {Query(table)}
 @MainActor static func rpcRow<T:Decodable>(_ fn:String,args:[String:Any],cacheInvalidate:[String],as type:T.Type) async throws->T {
  let data=try await Fixture.shared.save(fn,args)
  return try JSONDecoder().decode(T.self,from:data)
 }
}
final class Query: @unchecked Sendable {
 let table:String;var op="select";var values:Any?;var filters:[String:String]=[:];var ids:[String]=[]
 init(_ table:String){self.table=table}
 func fresh()->Self {self};func select(_ c:String="*")->Self {self};func order(_ c:String,ascending:Bool=true)->Self {self}
 func eq(_ c:String,_ v:Any)->Self {filters[c]=String(describing:v);return self};func lte(_ c:String,_ v:Any)->Self {self};func limit(_ n:Int)->Self {self}
 func `in`(_ c:String,_ v:[String])->Self {ids=v;return self}
 func insert(_ v:Any)->Self {op="insert";values=v;return self};func upsert(_ v:Any,onConflict:String?=nil)->Self {op="upsert";values=v;return self}
 func update(_ v:Any)->Self {op="update";values=v;return self};func delete()->Self {op="delete";return self}
 func run() async throws {try await Fixture.shared.write(table,op,values,filters,ids)}
 func list<T:Decodable>(_ type:T.Type) async throws->[T] {try await JSONDecoder().decode([T].self,from:Fixture.shared.read(table,filters))}
 func single<T:Decodable>(_ type:T.Type) async throws->T? {try await list(type).first}
}
enum API { static func dbRequest(_ payload:[String:Any]) async throws->Data {Data("{\"data\":[]}".utf8)};static func aiChat(module:String,message:String,context:String) async throws->[String:Any] {[:]}}
'''
tests = r'''
@main struct Tests {
 @MainActor static func waitUntil(_ condition:()->Bool) async throws {
  let deadline=ContinuousClock.now.advanced(by:.seconds(3))
  while !condition() && ContinuousClock.now<deadline {try await Task.sleep(for:.milliseconds(1))}
  assert(condition(),"fixture stage never started")
 }
 @MainActor static func manager()->ManagerModel {
  let m=ManagerModel(rid:"shift-save-test-"+UUID().uuidString)
  m.shift=Shift(id:"shift",date:m.key(m.currentDate),status:"open",opening_balance:100)
  m.income="100";m.incomeCard="20";m.inkSum="10"
  m.categories=[Category(id:"cat",name:"Supplies")];m.catAmounts=["cat":"12.5"]
  m.employees=[Employee(id:"emp",name:"Alex",deduct_per_absence:0)];m.empExtras=["emp":"7.5"]
  return m
 }
 @MainActor static func main() async throws {
  var failures:[String]=[]
  func check(_ condition:Bool,_ message:String){if !condition {failures.append(message);print("FAIL "+message)}}

  Fixture.shared=Fixture();let f=Fixture.shared;let m=manager()
  f.financial.held=true;f.sales.held=true
  var completed=false
  let save=Task {await m.save(force:true);completed=true}
  try await waitUntil {f.financial.entered}
  check(m.saving && !m.locked && !completed,"closure confirmed before all financial writes")
  let blockedDate=m.currentDate
  await m.changeDate(1)
  await m.setDate(Calendar.current.date(byAdding:.day,value:1,to:blockedDate)!)
  check(m.currentDate==blockedDate,"date changed during financial writes")
  await m.save(force:true)
  f.financial.release()
  try await waitUntil {f.sales.entered}
  for _ in 0..<12 {await Task.yield()}
  check(completed && !m.saving && m.locked,"optional sales digest still holds saving open")
  let savedDate=m.key(m.currentDate)
  m.income="999";m.currentDate=Calendar.current.date(byAdding:.day,value:1,to:m.currentDate)!
  f.sales.release();await save.value
  try await waitUntil {!f.notifications.isEmpty}
  let notification=f.notifications[0]
  check((notification["data"] as? [String:String])?["shift_date"]==savedDate,"notification read a later selected date")
  check((notification["segments"] as? [[String:String]])?.first?["value"]=="100.0","notification read later edited revenue")
  check(f.saves.count==1 && f.writes.isEmpty,"shift close must be exactly one atomic operation")
  check((f.saves.first?["rows"] as? [[String:Any]])?.count==2,"payload lost a category/employee row")
  check(m.shift?.closing_balance==170 && m.shift?.total_expense==30,"server totals not applied")
  print("PASS financial gate and captured notification payload checked")

  Fixture.shared=Fixture();let p=Fixture.shared;let pm=manager();p.push.held=true
  var pushSaveDone=false;let pushSave=Task {await pm.save(force:true);pushSaveDone=true}
  try await waitUntil {p.push.entered}
  for _ in 0..<12 {await Task.yield()}
  check(pushSaveDone && !pm.saving && pm.locked,"push delivery still holds saving open")
  p.push.release();await pushSave.value
  print("PASS push gate checked")

  Fixture.shared=Fixture();let bad=Fixture.shared;let bm=manager();bad.failSave=NSError(domain:"offline",code:500)
  await bm.save(force:true)
  check(!bm.locked && !bm.saving && bm.income=="100" && bm.toast != nil,"failed save falsely confirmed closure or lost draft")
  check(bad.notifications.isEmpty,"failed save emitted a success notification")
  await bm.save(force:true)
  bm.income="101";await bm.save(force:true)
  let ops=bad.saves.map {$0["op_id"] as? String ?? ""}
  check(ops.count==3 && ops[0]==ops[1] && ops[1] != ops[2],"retry must reuse op_id, changed form must not")
  print("PASS failure keeps values, sends nothing, retries idempotently")

  Fixture.shared=Fixture();let stale=Fixture.shared;let sm=manager();stale.failSave=APIError.http(400,"shift_changed")
  await sm.save(force:true)
  check(!sm.saving && sm.toast != nil && stale.notifications.isEmpty && stale.reads.contains {$0.0=="shifts"},"stale form must reload and not confirm")
  print("PASS stale form reloads instead of overwriting")

  Fixture.shared=Fixture();let gates=Fixture.shared;let gm=manager();gates.incompleteChecklist=true
  await gm.save()
  check(gm.showChecklistWarn && !gm.saving && !gm.locked && gates.saves.isEmpty,"checklist warning no longer gates financial writes")
  gates.incompleteChecklist=false
  gm.openDebts=[ManagerModel.DebtRow(id:"debt",shiftId:"old",date:"2026-11-12",categoryId:"cat",categoryName:"Supplies",employeeId:nil,amount:1000,note:nil)]
  gm.selectedDebtIds=["debt"]
  await gm.save()
  check(gm.showDebtNegativeWarn && !gm.saving && gates.saves.isEmpty,"negative debt confirmation was bypassed")
  print("PASS checklist and negative-debt confirmations remain before financial writes")

  Fixture.shared=Fixture();let timed=Fixture.shared;timed.delayMs=80;let tm=manager()
  let start=ContinuousClock.now;await tm.save(force:true);let elapsed=start.duration(to:.now)
  print("MEASURE native save 80ms/request: \(elapsed), saves=\(timed.saves.count)")
  if !failures.isEmpty {print("FAILED \(failures.count) regression(s)");exit(1)}
  print("PASS native close performance and financial-boundary regressions")
 }
}
'''
# Interpolation expressions are Swift code, not quoted string content.
tests = tests.replace('\\"', '"')
with tempfile.TemporaryDirectory(prefix='mise-shift-save-') as folder:
    path=Path(folder);file=path/'test.swift';file.write_text(sources+fixtures+model+tests)
    subprocess.run(['xcrun','swiftc','-parse-as-library','-module-cache-path',str(path/'cache'),str(file),'-o',str(path/'test')],check=True)
    subprocess.run([str(path/'test')],check=True)
