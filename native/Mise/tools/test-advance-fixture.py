#!/usr/bin/env python3
"""Validate actual offline advance fixture flags, response/CAS and rollback boundaries."""
from pathlib import Path
import subprocess,tempfile,os
root=Path(__file__).resolve().parents[1]/'Mise'
code='import Foundation\nenum APIError:Error {case http(Int,String?)}\n'+(root/'AdvanceSaveFixture.swift').read_text()+r'''
@main struct Test {
 @MainActor static func data(_ p:[String:Any]) async throws->Any {
  let raw=try await AdvanceSaveFixture.request(p)
  return (try JSONSerialization.jsonObject(with:raw) as! [String:Any])["data"]!
 }
 @MainActor static func main() async throws {
  let expected=ProcessInfo.processInfo.environment["EXPECT"]=="1"
  assert(AdvanceSaveFixture.enabled==expected)
  let select:[String:Any]=["op":"select","table":"salary_advances"]
  if !expected {do {_ = try await data(select);assertionFailure("single flag activated fixture")}catch{}}
  else {
   for p:[String:Any] in [["op":"rpc","fn":"settle_debts","args":["p":[:] as [String:Any]]],["op":"update","table":"employees","values":["salary":0]],["op":"insert","table":"salary_advances","values":["restaurant_id":"demo"]]] {
    do {_ = try await data(p);assertionFailure("unsupported operation allowed")}catch{}
   }
   let add:[String:Any]=["op":"rpc","fn":"add_advance","args":["p":["op_id":"a1","employee_id":"e1","amount":100.0,"date":"2026-11-13","period":"2026-11-01"] as [String:Any]]]
   if ProcessInfo.processInfo.environment["MISE_DEMO_ADVANCE_SAVE"] != "success" {
    do {_ = try await data(add);assertionFailure("missing failure")}catch{}
    let none=try await data(select) as! [[String:Any]];assert(none.isEmpty,"failed operation left a row")
   }
   _ = try await data(add);_ = try await data(add)
   let balance=try await data(["op":"select","table":"inkassation_balance"]) as! [[String:Any]]
   assert(balance.first?["balance"] as? Double==400)
   let saved=try await data(select) as! [[String:Any]]
   assert(saved.count==1,"replay duplicated advance")
  }
  print("PASS offline advance fixture enabled=\(expected), scope/atomicity/replay checked")
 }
}
'''
with tempfile.TemporaryDirectory(prefix='mise-advance-fixture-') as folder:
 p=Path(folder);(p/'test.swift').write_text(code)
 subprocess.run(['xcrun','swiftc','-DDEBUG','-parse-as-library','-module-cache-path',str(p/'cache'),str(p/'test.swift'),'-o',str(p/'test')],check=True)
 for flags in ({'MISE_DEMO_UI':'1'},{'MISE_DEMO_ADVANCE_SAVE':'success'},{'MISE_DEMO_UI':'1','MISE_DEMO_ADVANCE_SAVE':'success','EXPECT':'1'},{'MISE_DEMO_UI':'1','MISE_DEMO_ADVANCE_SAVE':'fail-once','EXPECT':'1'},{'MISE_DEMO_UI':'1','MISE_DEMO_ADVANCE_SAVE':'fail-cash-once','EXPECT':'1'}):
  env={k:v for k,v in os.environ.items() if k not in ('MISE_DEMO_UI','MISE_DEMO_ADVANCE_SAVE','EXPECT')};env.update(flags)
  subprocess.run([str(p/'test')],check=True,env=env)
