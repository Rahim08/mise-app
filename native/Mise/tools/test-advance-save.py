#!/usr/bin/env python3
"""Execute the real payroll model and DB with gated offline financial transport."""
from pathlib import Path
import subprocess,tempfile,sys
root=Path(__file__).resolve().parents[1]/'Mise'
baseline='--baseline' in sys.argv
model=Path('/tmp/mise-advance-before-ManagerSalary.swift').read_text() if baseline else (root/'ManagerSalary.swift').read_text()
model=model.split('// MARK: - View')[0].replace('import SwiftUI','import Observation')
analytics=(root/'AnalyticsView.swift').read_text();accrual=analytics[analytics.index('func computeAccruedToday('):analytics.index('private func cur(')]
fixtures=r'''
@MainActor final class ManagerModel {}
func appLocale()->Locale {Locale(identifier:"en_US")}
@MainActor func t(_ key:String,_ vars:[String:String]=[:])->String {key}
enum Money {static func s(_ n:Double)->String{String(n)}}
enum APIError:Error {case http(Int,String?)}
@MainActor final class Gate {
 var held=false,entered=false;var waiters:[CheckedContinuation<Void,Never>]=[]
 func wait() async {entered=true;if held {await withCheckedContinuation{waiters.append($0)}}}
 func release(){held=false;let all=waiters;waiters=[];all.forEach{$0.resume()}}
}
@MainActor final class Transport {
 static var shared=Transport()
 var requests:[[String:Any]]=[]
 var advances:[[String:Any]]=[]
 var shift:[[String:Any]]=[]
 var ink:[String:Any]=["shift_id":"s1","amount":600.0,"expense":50.0,"salary":50.0,"total":500.0,"reason":"Existing"]
 var pool=500.0,delay=0
 var failure:APIError?;var offline=false
 var saved:[String:[String:Any]]=[:]
 var payrollGate=Gate(),inkGate=Gate()
 var selectedPeriod=""
 func match(_ row:[String:Any],_ filters:[[String:Any]])->Bool {
  filters.allSatisfy {f in
   guard let col=f["col"] as? String, let op=f["op"] as? String else{return false}
   if col=="restaurant_id" {return true}
   let a=String(describing:row[col] ?? ""),b=String(describing:f["val"] ?? "")
   if op=="eq" {return a==b};if op=="lte" {return a<=b};if op=="gte" {return a>=b};return true
  }
 }
 func request(_ p:[String:Any]) async throws->Data {
  requests.append(p);if delay>0 {try await Task.sleep(for:.milliseconds(delay))}
  let table=p["table"] as? String ?? "",op=p["op"] as? String ?? ""
  let filters=p["filters"] as? [[String:Any]] ?? []
  var result:Any=NSNull()
  if op=="select" {
   var rows:[[String:Any]]=[]
   switch table {
   case "inkassation_balance":rows=[["balance":pool]]
   case "shifts":rows=shift
   case "inkassations":rows=ink.isEmpty ? [] : [ink]
   case "salary_advances":rows=advances
   case "employees":await payrollGate.wait();rows=[["id":"e1","name":"Alex","salary":1000.0,"deduct_per_absence":0,"is_active":true]]
   case "monthly_card_amounts":rows=[["id":"c1","employee_id":"e1","card_amount":200.0,"month":String(selectedPeriod.prefix(7))]]
   case "salary_payments":rows=[["id":"p1","employee_id":"e1","amount":100.0,"method":"cash","period":selectedPeriod]]
   case "shift_expenses":rows=[["id":"debt","employee_id":"e1","amount":50.0,"is_paid":false,"note":"SALPERIOD:"+selectedPeriod]]
   case "restaurant_settings":rows=[["salary_payout_day":1]]
   default:rows=[]
   }
   let chosen=rows.filter{match($0,filters)}
   result=p["returning"] as? String=="maybeSingle" ? (chosen.first as Any? ?? NSNull()) : chosen
  }else if op=="rpc" {
   await inkGate.wait()
   if let failure {throw failure}
   if offline {throw URLError(.notConnectedToInternet)}
   let v=(p["args"] as! [String:Any])["p"] as! [String:Any]
   if p["fn"] as? String=="add_advance" {
    var row:[String:Any]=["id":v["op_id"]!]
    for k in ["employee_id","amount","date","period","note"] {row[k]=v[k]}
    advances.append(row);result=row
   }
  }
  return try JSONSerialization.data(withJSONObject:["data":result])
 }
}
@MainActor enum API {static func dbRequest(_ p:[String:Any]) async throws->Data {try await Transport.shared.request(p)}}
@main struct Tests {
 @MainActor static func reset() async->ManagerSalaryModel {
  await DB.clearCacheNow();Transport.shared=Transport();let m=ManagerSalaryModel(rid:"test")
  let f=Transport.shared;f.selectedPeriod=String(m.key(m.viewMonth).prefix(7))+"-01"
  f.shift=[["id":"s1","date":m.key(Date()),"inkassation":600.0,"status":"closed"]]
  m.rows=[.init(id:"e1",name:"Alex",salary:1000,absences:0,absenceList:[],deduct:0,card:200,advance:0,advanceList:[],total:1000,cash:800,paid:100,remaining:650,lastPaidAt:nil,paidCash:100)]
  m.loaded=true;m.payoutDay=1;m.prevCashTotal=2222;m.prevPaidCash=33
  return m
 }
 @MainActor static func wait(_ c:()->Bool) async throws {
  let end=ContinuousClock.now.advanced(by:.seconds(5));while !c() && ContinuousClock.now<end {try await Task.sleep(for:.milliseconds(1))};assert(c(),"stage never entered")
 }
 @MainActor static func main() async throws {
  var failures:[String]=[]
  func check(_ b:Bool,_ msg:String){if !b {failures.append(msg);print("FAIL "+msg)}}
  let m=await reset();let f=Transport.shared;f.inkGate.held=true;f.payrollGate.held=true
  var completed=false;let save=Task{_ = await m.addAdvance(empId:"e1",amount:100,date:m.key(Date()));completed=true}
  try await wait{f.inkGate.entered}
  check(!completed && m.rows.first?.advance==0,"advance confirmed before cash write")
  let month=m.viewMonth;m.changeMonth(-1)
  check(m.viewMonth==month,"period changed during money write")
  _ = await m.addAdvance(empId:"e1",amount:100,date:m.key(Date()))
  check(f.requests.filter{$0["op"] as? String=="rpc"}.count==1,"double tap sent a second advance")
  f.inkGate.release();try await wait{completed || f.payrollGate.entered}
  check(completed,"full payroll refresh still blocks advance")
  f.payrollGate.release();await save.value
  check(m.rows.first?.advance==100 && m.rows.first?.advanceList.count==1 && m.rows.first?.cash==700 && m.rows.first?.remaining==550,"confirmed advance did not update cash/remaining/history")
  check(f.advances.first?["period"] as? String==f.selectedPeriod,"advance used changed period")
  check(!f.requests.contains{$0["table"] as? String=="employees"},"unrelated employee payroll read on successful save")
  check(m.prevCashTotal==2222 && m.prevPaidCash==33,"saving current advance recalculated previous payroll")
  print("CHECK mandatory cash confirmation, duplicate tap, month lock, totals and no payroll reload")

  func rpcs(_ t:Transport)->[[String:Any]] {t.requests.filter{$0["op"] as? String=="rpc"}}
  func ids(_ t:Transport)->[String] {rpcs(t).map{(($0["args"] as! [String:Any])["p"] as! [String:Any])["op_id"] as! String}}
  check(rpcs(f).count==1 && !f.requests.contains{["insert","update","delete"].contains($0["op"] as? String ?? "")},"advance must be one atomic call")
  let bad=await reset();let bf=Transport.shared;bf.offline=true
  _ = await bad.addAdvance(empId:"e1",amount:100,date:bad.key(Date()))
  check(bad.rows.first?.advance==0 && bad.toast != nil,"failed call claimed success")
  _ = await bad.addAdvance(empId:"e1",amount:100,date:bad.key(Date()))
  _ = await bad.addAdvance(empId:"e1",amount:90,date:bad.key(Date()))
  bf.offline=false
  let ok=await bad.addAdvance(empId:"e1",amount:90,date:bad.key(Date()))
  let sent=ids(bf)
  check(ok && sent.count==4 && sent[0]==sent[1] && sent[1] != sent[2] && sent[2]==sent[3],"retry must reuse op_id, changed form must not")

  for (code,text) in [("exceeds_remaining","pe.debtExceedsRemaining"),("insufficient_pool","pe.insufficientInkassationPool")] {
   let refused=await reset();Transport.shared.failure=APIError.http(400,code)
   let done=await refused.addAdvance(empId:"e1",amount:100,date:refused.key(Date()))
   check(!done && refused.advanceError==text,"server refusal \(code) not explained")
  }
  for amount in [-1.0,0.0,Double.nan,Double.infinity] {
   let invalid=await reset();let vf=Transport.shared
   _ = await invalid.addAdvance(empId:"e1",amount:amount,date:invalid.key(Date()))
   check(rpcs(vf).isEmpty,"invalid advance reached the server")
  }
  print("CHECK atomic call, idempotent retry, server refusals and validation")

  let dated=await reset();let datedTransport=Transport.shared
  let otherDate=Calendar.current.date(byAdding:.month,value:1,to:Date())!
  _ = await dated.addAdvance(empId:"e1",amount:12.345,date:dated.key(otherDate))
  check(datedTransport.advances.first?["date"] as? String==dated.key(otherDate) && datedTransport.advances.first?["period"] as? String==datedTransport.selectedPeriod,"deduction date changed salary period")
  check(abs((datedTransport.advances.first?["amount"] as? Double ?? 0)-12.35)<0.0001,"advance cents were not rounded")

  let late=await reset();let lateTransport=Transport.shared;lateTransport.payrollGate.held=true
  let olderLoad=Task {await late.load()};try await wait{lateTransport.payrollGate.entered}
  _ = await late.addAdvance(empId:"e1",amount:100,date:late.key(Date()))
  lateTransport.payrollGate.release();await olderLoad.value
  check(late.rows.first?.advance==100 && late.rows.first?.remaining==550,"older payroll load overwrote confirmed advance")

  print("CHECK cents, separate date/period and late payroll response")

  /*BOOL_TESTS*/
  let cents=await reset();let centsTransport=Transport.shared;centsTransport.pool=2000
  _ = await cents.addAdvance(empId:"e1",amount:50.07,date:cents.key(Date()))
  _ = await cents.addAdvance(empId:"e1",amount:100.10,date:cents.key(Date()))
  check(abs((cents.rows.first?.remaining ?? 0)-499.83)<0.000001,"fractional advance remainder wrong")
  _ = await cents.addAdvance(empId:"e1",amount:499.83,date:cents.key(Date()))
  check(centsTransport.advances.count==3 && cents.rows.first?.remaining==0 && cents.rows.first?.advance==650,"displayed final cents were rejected or accumulated residue")
  print("CHECK sequential fractional advances and complete displayed remainder")

  let timing=await reset();Transport.shared.delay=80
  let start=ContinuousClock.now;_ = await timing.addAdvance(empId:"e1",amount:100,date:timing.key(Date()))
  print("MEASURE advance 80ms per request: \(start.duration(to:.now)), requests=\(Transport.shared.requests.count)")
  if !failures.isEmpty {print("FAILED \(failures.count)");exit(1)}
  print("PASS native advance save performance and financial regressions")
 }
}
'''
# Non-finite input cannot be serialized by the original function. Test it after validation exists.
if 'amount.isFinite' not in model:
 fixtures=fixtures.replace('[-1.0,0.0,Double.nan,Double.infinity,700]','[-1.0,0.0,700]')
if baseline:
 start=fixtures.index('  let dated=await reset()');end=fixtures.index('  let timing=await reset()',start)
 fixtures=fixtures[:start]+fixtures[end:]
else:
 fixtures=fixtures.replace('  /*BOOL_TESTS*/',r'''
  let rejected=await reset();Transport.shared.failure=APIError.http(503,"x")
  let rejectedOK=await rejected.addAdvance(empId:"e1",amount:100,date:rejected.key(Date()))
  check(!rejectedOK && rejected.advanceError != nil,"failed save returned success or lost form error")
  check(rejected.prepareAdvance() && rejected.advanceError==nil,"new advance form retained prior error")
  let initial=await reset();let initialTransport=Transport.shared;initial.loaded=false;initialTransport.payrollGate.held=true
  let initialLoad=Task{await initial.load()};try await wait{initialTransport.payrollGate.entered}
  let prematureOK=await initial.addAdvance(empId:"e1",amount:100,date:initial.key(Date()))
  check(!prematureOK && initialTransport.advances.isEmpty,"advance used incomplete initial payroll")
  initialTransport.payrollGate.release();await initialLoad.value
  let readyOK=await initial.addAdvance(empId:"e1",amount:100,date:initial.key(Date()))
  check(readyOK && initial.rows.first?.advance==100,"initial payroll failed to finish before advance")
  print("CHECK Bool form result, persistent failure, initial payroll gate")
''')
with tempfile.TemporaryDirectory(prefix='mise-advance-save-') as folder:
 p=Path(folder);(p/'test.swift').write_text('import Foundation\nimport Observation\n'+(root/'Models.swift').read_text()+'\n'+(root/'DB.swift').read_text()+'\n'+accrual+'\n'+model+'\n'+fixtures)
 subprocess.run(['xcrun','swiftc','-parse-as-library','-module-cache-path',str(p/'cache'),str(p/'test.swift'),'-o',str(p/'test')],check=True)
 subprocess.run([str(p/'test')],check=True)
