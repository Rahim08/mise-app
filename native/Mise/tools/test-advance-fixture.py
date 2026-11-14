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
   for p:[String:Any] in [["op":"rpc","fn":"settle_debts"],["op":"update","table":"employees","values":["salary":0]],["op":"insert","table":"salary_advances","values":["restaurant_id":"foreign"]]] {
    do {_ = try await data(p);assertionFailure("unsupported operation/scope allowed")}catch{}
   }
   let insert:[String:Any]=["op":"insert","table":"salary_advances","returning":"single","values":["restaurant_id":"demo","employee_id":"e1","amount":100.0,"date":"2026-11-13","period":"2026-11-01"]]
   let mode=ProcessInfo.processInfo.environment["MISE_DEMO_ADVANCE_SAVE"] ?? ""
   if mode=="fail-once" {do {_ = try await data(insert);assertionFailure("missing insert failure")}catch{}}
   let advance=try await data(insert) as! [String:Any]
   assert(advance["id"] != nil)
   let update:[String:Any]=["op":"update","table":"inkassations","returning":"single","filters":[["col":"shift_id","op":"eq","val":"s1"],["col":"expense","op":"eq","val":50.0]],"values":["expense":150.0,"total":400.0]]
   if mode=="fail-cash-once" {
    for _ in 0..<2 {do {_ = try await data(update);assertionFailure("missing cash failure")}catch{}}
    _ = try await data(["op":"delete","table":"salary_advances","filters":[["col":"id","op":"eq","val":advance["id"]!]]])
    let rolledBack=try await data(select) as! [[String:Any]]
    assert(rolledBack.isEmpty)
    _ = try await data(insert)
   }
   let cash=try await data(update) as! [String:Any]
   assert(cash["expense"] as? Double==150 && cash["total"] as? Double==400)
   let balance=try await data(["op":"select","table":"inkassation_balance"]) as! [[String:Any]]
   assert(balance.first?["balance"] as? Double==400)
   let saved=try await data(select) as! [[String:Any]]
   assert(saved.count==1)
  }
  print("PASS offline advance fixture enabled=\(expected), scope/CAS/rollback checked")
 }
}
'''
with tempfile.TemporaryDirectory(prefix='mise-advance-fixture-') as folder:
 p=Path(folder);(p/'test.swift').write_text(code)
 subprocess.run(['xcrun','swiftc','-DDEBUG','-parse-as-library','-module-cache-path',str(p/'cache'),str(p/'test.swift'),'-o',str(p/'test')],check=True)
 for flags in ({'MISE_DEMO_UI':'1'},{'MISE_DEMO_ADVANCE_SAVE':'success'},{'MISE_DEMO_UI':'1','MISE_DEMO_ADVANCE_SAVE':'success','EXPECT':'1'},{'MISE_DEMO_UI':'1','MISE_DEMO_ADVANCE_SAVE':'fail-once','EXPECT':'1'},{'MISE_DEMO_UI':'1','MISE_DEMO_ADVANCE_SAVE':'fail-cash-once','EXPECT':'1'}):
  env={k:v for k,v in os.environ.items() if k not in ('MISE_DEMO_UI','MISE_DEMO_ADVANCE_SAVE','EXPECT')};env.update(flags)
  subprocess.run([str(p/'test')],check=True,env=env)
