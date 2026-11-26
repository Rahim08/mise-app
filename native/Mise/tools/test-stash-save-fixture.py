#!/usr/bin/env python3
"""Exercise the actual simulator transport activation and write boundaries offline."""
from pathlib import Path
import tempfile,subprocess,os
root=Path(__file__).resolve().parents[1]/'Mise'
code='import Foundation\nenum APIError:Error {case http(Int,String?)}\n'+(root/'Models.swift').read_text()+'\n'+(root/'StashSaveFixture.swift').read_text()+r'''
@main struct Test {
 @MainActor static func main() async throws {
  let expected=ProcessInfo.processInfo.environment["EXPECT"]=="1"
  assert(StashSaveFixture.enabled==expected)
  if !expected {
   do {_ = try await StashSaveFixture.request(["op":"select","table":"tobacco_stock"]);assertionFailure("single flag enabled fixture")}catch{}
  }else{
   for p:[String:Any] in [["op":"rpc","fn":"settle_debts"],["op":"delete","table":"tobacco_movements"],["op":"insert","table":"tobacco_movements","values":["restaurant_id":"demo"]]] {
    do {_ = try await StashSaveFixture.request(p);assertionFailure("unhandled/scope accepted")}catch{}
   }
   let save:[String:Any]=["op":"rpc","fn":"stock_save_movement","args":["p":["op_id":"1","mode":"in","replace_ids":[String](),"rows":[["brand":"Проверка","flavor":"Позиция 1","grams":25.0]]]]]
   if ProcessInfo.processInfo.environment["MISE_DEMO_STASH_SAVE"]=="fail-once" {
    do {_ = try await StashSaveFixture.request(save);assertionFailure("expected failure missing")}catch{}
   }
   let data=try await StashSaveFixture.request(save)
   let answer=(try JSONSerialization.jsonObject(with:data) as! [String:Any])["data"] as! [String:Any]
   assert((answer["movements"] as! [[String:Any]]).count==1)
   assert((answer["stock"] as! [[String:Any]])[0]["quantity_g"] as? Double==1025)
  }
  print("PASS offline Stash fixture flags, scope and confirmed records: \(expected)")
 }
}
'''
with tempfile.TemporaryDirectory(prefix='mise-stash-fixture-') as folder:
 p=Path(folder);(p/'test.swift').write_text(code)
 subprocess.run(['xcrun','swiftc','-DDEBUG','-parse-as-library','-module-cache-path',str(p/'cache'),str(p/'test.swift'),'-o',str(p/'test')],check=True)
 for flags in ({'MISE_DEMO_UI':'1'},{'MISE_DEMO_STASH_SAVE':'success'},{'MISE_DEMO_UI':'1','MISE_DEMO_STASH_SAVE':'success','EXPECT':'1'},{'MISE_DEMO_UI':'1','MISE_DEMO_STASH_SAVE':'fail-once','EXPECT':'1'}):
  env={k:v for k,v in os.environ.items() if k not in ('MISE_DEMO_UI','MISE_DEMO_STASH_SAVE','EXPECT')};env.update(flags)
  subprocess.run([str(p/'test')],check=True,env=env)
