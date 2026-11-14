#!/usr/bin/env python3
"""Execute actual StashModel + DB against controlled transport, with no network."""
from pathlib import Path
import subprocess,tempfile,sys
root=Path(__file__).resolve().parents[1]/'Mise'
baseline='--baseline' in sys.argv
model=Path('/tmp/mise-stash-save-before-StashView.swift').read_text() if baseline else (root/'StashView.swift').read_text()
model=model.split('// MARK: - Экран Stash')[0].replace('import SwiftUI','import Observation')
a=model.index('private func hideKeyboard()');b=model.index('// eur()',a);model=model[:a]+model[b:]
a=model.index('    func stockColor(');b=model.index('    var inStock:',a);model=model[:a]+model[b:]
db=Path('/tmp/mise-stash-save-before-DB.swift').read_text() if baseline else (root/'DB.swift').read_text()
fixture=r'''
@MainActor func t(_ key:String,_ vars:[String:String]=[:])->String {key}
@MainActor func aiErrorMessage(_ error:Error)->String {"error"}
@MainActor enum Notify {static func send(type:String,title:String,body:String,audience:[String:Bool],titleKey:String,bodyKey:String,bodyParams:[String:String]) async {}}
enum APIError:Error {case http(Int,String?)}
@MainActor final class Gate {
 var held=false,entered=false;var continuations:[CheckedContinuation<Void,Never>]=[]
 func wait() async {entered=true;if held {await withCheckedContinuation{continuations.append($0)}}}
 func release(){held=false;let all=continuations;continuations=[];all.forEach{$0.resume()}}
}
@MainActor final class Transport {
 static var shared=Transport()
 var stock:[[String:Any]]=(0..<6).map{["id":"s\($0)","brand":"A","flavor":"F\($0)","quantity_g":1000.0,"min_quantity_g":50.0]}
 var movements:[[String:Any]]=[]
 var requests:[[String:Any]]=[]
 var failInsert=false,failRPC=false,arrayRPC=false,invalidRPC=false
 var rpcGate=Gate(),historyGate=Gate()
 var delay=0
 var pastGrams=0.0
 func request(_ p:[String:Any]) async throws->Data {
  requests.append(p)
  if delay>0 {try await Task.sleep(for:.milliseconds(delay))}
  let op=p["op"] as? String ?? "",table=p["table"] as? String ?? ""
  var result:Any=NSNull()
  if op=="rpc" {
   await rpcGate.wait()
   if failRPC {throw APIError.http(503,"stock failed")}
   let args=p["args"] as! [String:Any],id=args["p_id"] as! String
   let i=stock.firstIndex{$0["id"] as? String==id}!
   // Another device has added 7g since the preflight read. The response is authoritative.
   stock[i]["quantity_g"]=max(0,(stock[i]["quantity_g"] as! Double)+(args["p_delta"] as! Double)+7)
   if invalidRPC {result=[]} else if arrayRPC {result=[stock[i]]} else {result=stock[i]}
  }else if op=="select" {
   if table=="tobacco_movements" || table=="hookah_sales" {await historyGate.wait()}
   if table=="tobacco_stock" {result=stock}
   else if table=="tobacco_movements" {result=movements.filter{r in (p["filters"] as? [[String:Any]] ?? []).allSatisfy {($0["col"] as? String != "type") || r["type"] as? String == $0["val"] as? String}}}
   else if table=="hookah_types" {result=[["id":"h1","name":"Classic","price":10,"portion_g":20]]}
   else if table=="hookah_sales",pastGrams>0 {result=[["date":"2000-01-01","quantity":1,"portion_g":pastGrams]]}
   else {result=[]}
  }else if op=="insert" {
   if table=="tobacco_movements" && failInsert {throw APIError.http(503,"movement failed")}
   let values=(p["values"] as? [[String:Any]]) ?? [p["values"] as! [String:Any]]
   let inserted=values.map {r -> [String:Any] in var r=r;r["id"]=r["id"] ?? UUID().uuidString;r["created_at"]=r["created_at"] ?? "2026-11-13T12:00:00Z";return r}
   if table=="tobacco_movements" {movements+=inserted}else if table=="tobacco_stock" {stock+=inserted}
   result=p["returning"] as? String=="single" ? inserted[0] : inserted
  }else if op=="delete" {
   let filters=p["filters"] as? [[String:Any]] ?? []
   let ids=filters.first?["val"] as? [String] ?? []
   if table=="tobacco_movements" {movements.removeAll {ids.contains($0["id"] as? String ?? "")}}
  }
  return try JSONSerialization.data(withJSONObject:["data":result])
 }
}
@MainActor enum API {
 static func dbRequest(_ p:[String:Any]) async throws->Data {try await Transport.shared.request(p)}
 static func aiChat(module:String,message:String,context:String) async throws->[String:Any] {[:]}
}
@main struct Tests {
 @MainActor static func reset() async->StashModel {
  await DB.clearCacheNow();Transport.shared=Transport()
  let m=StashModel(rid:"test",canSeeMoney:true)
  m.stock=try! JSONDecoder().decode([StockItem].self,from:JSONSerialization.data(withJSONObject:Transport.shared.stock))
  m.venueBase=500;m.paid=["draft":"9"];m.savedGrams=60
  return m
 }
 @MainActor static func wait(_ condition:()->Bool) async throws {
  let end=ContinuousClock.now.advanced(by:.seconds(4))
  while !condition() && ContinuousClock.now<end {try await Task.sleep(for:.milliseconds(1))}
  assert(condition(),"gate not reached")
 }
 @MainActor static func main() async throws {
  var failures:[String]=[]
  func check(_ b:Bool,_ msg:String){if !b {print("FAIL "+msg);failures.append(msg)}}
  for mode in ["in","out","writeoff"] {
   let m=await reset();let f=Transport.shared
   f.arrayRPC=mode=="out"
   let rows=(0..<6).map{StashModel.MovRow(brand:" a ",flavor:"f\($0)",grams:"100")}
   let ok=await m.saveMovement(rows,reason:mode=="writeoff" ? "Damage" : "",mode:mode)
   check(ok && !m.saving,"\(mode): success not released")
   check(f.requests.filter{$0["table"] as? String=="tobacco_movements" && $0["op"] as? String=="insert"}.count==1,"\(mode): movement inserts not batched")
   check(!f.requests.contains{($0["op"] as? String=="select") && ["hookah_sales","tobacco_movements","tobacco_inventories","hookah_types","restaurant_settings"].contains($0["table"] as? String ?? "")},"\(mode): unrelated history still blocks save")
   check(m.stock.first?.quantity_g==(mode=="in" ? 1107 : 907),"\(mode): lost canonical server stock")
   check(m.movements.count==6 && m.movements.allSatisfy{$0.brand=="A" && $0.quantity_g==100},"\(mode): confirmed history not applied")
   check(m.venueBase==(mode=="out" ? 1100 : 500),"\(mode): venue delta incorrect")
   check(m.paid==["draft":"9"] && m.savedGrams==60,"\(mode): save overwrote shift draft")
  }
  print("CHECK receipt/issue/writeoff batching, returned stock, history and draft preservation")
  let vm=await reset();let vf=Transport.shared
  let venueOK=await vm.saveVenueWriteoff(grams:"75",reason:"Damage")
  check(venueOK && vm.venueBase==425 && vm.movements.count==1,"venue: confirmed totals/history missing")
  check(vf.requests.count==1,"venue: unrelated reloads still block save")
  check(vm.stock.first?.quantity_g==1000 && vm.paid==["draft":"9"],"venue: warehouse or shift draft changed")

  let nm=await reset();let nf=Transport.shared
  let newRows=(0..<6).map{StashModel.MovRow(brand:"New",flavor:"N\($0)",grams:"25")}
  let newOK=await nm.saveMovement(newRows,reason:"",mode:"in")
  check(newOK && nm.stock.filter{$0.brand=="New"}.count==6,"new receipt lost confirmed stock")
  check(nf.requests.filter{$0["table"] as? String=="tobacco_stock" && $0["op"] as? String=="insert"}.count==1,"new stock inserts not batched")

  let gm=await reset();let gf=Transport.shared;gf.rpcGate.held=true
  var done=false;let saving=Task{let ok=await gm.saveMovement([.init(brand:"A",flavor:"F0",grams:"10")],reason:"",mode:"out");done=ok}
  try await wait{gf.rpcGate.entered}
  check(gm.saving && !done,"success shown before stock confirmed")
  let twice=await gm.saveMovement([.init(brand:"A",flavor:"F0",grams:"10")],reason:"",mode:"out")
  check(!twice,"double tap accepted")
  gf.rpcGate.release();await saving.value
  check(done && gf.movements.count==1,"double tap wrote duplicate movement")

  let bm=await reset();let bf=Transport.shared;bf.failInsert=true
  let badOK=await bm.saveMovement([.init(brand:"A",flavor:"F0",grams:"10")],reason:"",mode:"in")
  check(!badOK && !bm.saving && bf.movements.isEmpty && bm.toast != nil,"failed movement falsely succeeded")
  check(!bf.requests.contains{$0["op"] as? String=="rpc"},"stock changed after movement insert failed")

  let im=await reset();let inf=Transport.shared
  let invalid=await im.saveMovement([.init(brand:"A",flavor:"F0",grams:"2000")],reason:"",mode:"out")
  let noReason=await im.saveMovement([.init(brand:"A",flavor:"F0",grams:"10")],reason:" ",mode:"writeoff")
  check(!invalid && !noReason && inf.movements.isEmpty,"invalid amount or reason wrote stock")

  let dm=await reset();let df=Transport.shared
  let merged=await dm.saveMovement([.init(brand:"A",flavor:"F0",grams:"10"),.init(brand:" a ",flavor:"f0",grams:"15")],reason:"",mode:"in")
  check(merged && df.movements.count==1 && df.movements.first?["quantity_g"] as? Double==25,"duplicate rows lost grams")
  print("CHECK mandatory write gate, double tap, failed insert, validation and merged rows")

  let rm=await reset();let rf=Transport.shared;rf.failRPC=true
  let rpcOK=await rm.saveMovement([.init(brand:"A",flavor:"F0",grams:"10")],reason:"",mode:"out")
  check(!rpcOK && !rm.saving && rm.venueBase==500 && rm.toast != nil,"stock RPC failure falsely confirmed movement")
  check(rf.requests.filter{$0["op"] as? String=="rpc"}.count==1,"failed stock delta was retried")
  let mm=await reset();let mf=Transport.shared;mf.invalidRPC=true
  let malformedOK=await mm.saveMovement([.init(brand:"A",flavor:"F0",grams:"10")],reason:"",mode:"in")
  check(!malformedOK && !mm.saving,"malformed RPC result falsely confirmed stock")
  check(mf.requests.filter{$0["op"] as? String=="rpc"}.count==1,"malformed stock response retried delta")

  let lm=await reset();let lf=Transport.shared;lf.historyGate.held=true
  let older=Task {await lm.loadWarehouse()}
  try await wait{lf.historyGate.entered}
  let latest=await lm.saveMovement([.init(brand:"A",flavor:"F0",grams:"10")],reason:"",mode:"in")
  lf.historyGate.release();await older.value
  check(latest && lm.stock.first?.quantity_g==1017 && lm.movements.count==1,"older warehouse load overwrote confirmed save")

  let em=await reset();let ef=Transport.shared
  let old=Movement(id:"old",brand:"A",flavor:"F0",quantity_g:50,type:"in",batch_id:"old-batch",reason:"Delivery",created_at:"2026-01-01T12:00:00Z")
  em.movements=[old];ef.movements=try JSONSerialization.jsonObject(with:JSONEncoder().encode([old])) as! [[String:Any]]
  let edited=await em.replaceMovementBatch([old],rows:[.init(brand:"A",flavor:"F0",grams:"100")],reason:"Delivery",mode:"in")
  check(edited && em.movements.count==1 && em.movements.first?.id != "old" && em.movements.first?.created_at=="2026-01-01T12:00:00Z","edit lost date or retained old rows")
  check(em.stock.first?.quantity_g==1064,"edit failed to use confirmed post-revert stock")
  print("CHECK RPC failure/malformed response, no retries, stale warehouse load and edit records")

  let deficit=await reset();Transport.shared.pastGrams=50
  _ = await deficit.loadShift()
  check(deficit.venueBase==0,"historical deficit fixture not clamped for display")
  let deficitOK=await deficit.saveMovement([.init(brand:"A",flavor:"F0",grams:"100")],reason:"",mode:"out")
  check(deficitOK && deficit.venueBase==50,"historical deficit was lost in venue delta")

  let convert=await reset();let cf=Transport.shared;convert.venueBase=425
  let oldVenue=Movement(id:"venue-old",brand:"",flavor:"",quantity_g:75,type:"writeoff",batch_id:"v",reason:"Damage",created_at:"2026-01-01T12:00:00Z")
  convert.movements=[oldVenue];cf.movements=try JSONSerialization.jsonObject(with:JSONEncoder().encode([oldVenue])) as! [[String:Any]]
  let converted=await convert.replaceMovementBatch([oldVenue],rows:[.init(brand:"A",flavor:"F0",grams:"75")],reason:"Damage",mode:"writeoff")
  check(converted && convert.venueBase==500,"converting venue writeoff did not restore venue stock")

  let pending=await reset();let pf=Transport.shared;pf.historyGate.held=true
  pending.types=[];pending.venueBase=0
  let initial=Task {await pending.loadShift()}
  try await wait{pf.historyGate.entered}
  var pendingDone=false
  let pendingSave=Task {let result=await pending.saveMovement([.init(brand:"A",flavor:"F0",grams:"25")],reason:"",mode:"in");pendingDone=result}
  for _ in 0..<30 {await Task.yield()}
  pf.historyGate.release();_ = await initial.value;await pendingSave.value
  check(pendingDone && pending.types.first?.id=="h1","save discarded an initial shift load")
  print("CHECK pending initial shift load, venue-scope conversion and historical deficit")

  let toVenue=await reset();let tvf=Transport.shared
  let warehouseOld=Movement(id:"warehouse-old",brand:"A",flavor:"F0",quantity_g:50,type:"in",batch_id:"to-venue",reason:"Delivery",created_at:"2026-01-01T12:00:00Z")
  toVenue.movements=[warehouseOld];tvf.movements=try JSONSerialization.jsonObject(with:JSONEncoder().encode([warehouseOld])) as! [[String:Any]]
  let venueEdit=await toVenue.replaceVenueWriteoff([warehouseOld],grams:"75",reason:"Damage")
  check(venueEdit && toVenue.venueBase==425 && toVenue.movements.count==1 && toVenue.movements.first?.brand=="","warehouse-to-venue edit has wrong venue totals/history")
  check(toVenue.stock.first?.quantity_g==957,"warehouse-to-venue conversion lost canonical reverted stock")
  check(toVenue.paid==["draft":"9"],"venue edit overwrote sales draft")
  print("CHECK warehouse-to-venue conversion retains canonical reverted stock")

  let tm=await reset();Transport.shared.delay=80
  let start=ContinuousClock.now
  _=await tm.saveMovement((0..<6).map{.init(brand:"A",flavor:"F\($0)",grams:"100")},reason:"",mode:"out")
  print("MEASURE six-item issue 80ms/request: \(start.duration(to:.now)), requests=\(Transport.shared.requests.count)")
  if !failures.isEmpty {print("FAILED \(failures.count)");exit(1)}
  print("PASS native Stash confirmed-save performance regressions")
 }
}
'''
with tempfile.TemporaryDirectory(prefix='mise-stash-save-') as folder:
 base=Path(folder);swift=base/'test.swift'
 swift.write_text('import Foundation\nimport Observation\n'+(root/'Models.swift').read_text()+'\n'+db+'\n'+model+'\n'+fixture)
 subprocess.run(['xcrun','swiftc','-parse-as-library','-module-cache-path',str(base/'cache'),str(swift),'-o',str(base/'test')],check=True)
 subprocess.run([str(base/'test')],check=True)
