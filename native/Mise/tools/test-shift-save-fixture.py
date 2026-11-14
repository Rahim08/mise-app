#!/usr/bin/env python3
"""Verify the DEBUG simulator transport and actual Notify guard cannot send network traffic."""
from pathlib import Path
import os
import subprocess
import tempfile

root=Path(__file__).resolve().parents[1]/'Mise'
fixture=(root/'ShiftSaveFixture.swift').read_text()
notify=(root/'Push.swift').read_text().split('enum Notify {',1)[1]
source=r'''
import Foundation
enum APIError:Error {case http(Int,String?)}
enum API {static let base="https://example.invalid"}
final class RejectNetwork:URLProtocol {
 static var attempts=0
 override class func canInit(with request:URLRequest)->Bool {true}
 override class func canonicalRequest(for request:URLRequest)->URLRequest {request}
 override func startLoading(){Self.attempts += 1;client?.urlProtocol(self,didFailWithError:URLError(.notConnectedToInternet))}
 override func stopLoading(){}
}
enum MiseSharedSession {static let session:URLSession={let c=URLSessionConfiguration.ephemeral;c.protocolClasses=[RejectNetwork.self];return URLSession(configuration:c)}()}
'''+fixture+'\nenum Notify {'+notify+r'''
@main struct Test {
 @MainActor static func main() async throws {
  let enabled=ProcessInfo.processInfo.environment["EXPECT_FIXTURE"]=="1"
  assert(ShiftSaveFixture.enabled==enabled)
  let select:[String:Any]=["table":"shift_expenses","op":"select"]
  if !enabled {
   do {_ = try await ShiftSaveFixture.request(select);assertionFailure("disabled fixture accepted request")}catch{}
  }else {
   for payload in [["table":"unknown","op":"select"],["op":"rpc","fn":"settle_debts"]] {
    do {_ = try await ShiftSaveFixture.request(payload);assertionFailure("unhandled fixture fell through")}catch{}
   }
   do {_ = try await ShiftSaveFixture.request(["table":"shift_expenses","op":"insert","values":["restaurant_id":"other"]]);assertionFailure("foreign fixture scope accepted")}catch{}
   let insert:[String:Any]=["table":"shift_expenses","op":"insert","values":[["id":"a","restaurant_id":"demo","amount":2],["id":"b","restaurant_id":"demo","amount":3]]]
   _ = try await ShiftSaveFixture.request(insert)
   let data=try await ShiftSaveFixture.request(select)
   let json=try JSONSerialization.jsonObject(with:data) as! [String:Any]
   assert((json["data"] as? [[String:Any]])?.count==2)
  }
  if ProcessInfo.processInfo.environment["MISE_DEMO_UI"]=="1" {
   let notification=Task {await Notify.send(type:"cash_close",title:"test",body:"test",audience:["managers":true])}
   notification.cancel();await notification.value
  }
  assert(RejectNetwork.attempts==0,"demo notification attempted network")
  print("PASS DEBUG fixture enabled=\(enabled), blocked operations/scope, offline notification")
 }
}
'''
with tempfile.TemporaryDirectory(prefix='mise-shift-fixture-') as folder:
    base=Path(folder);file=base/'test.swift';file.write_text(source)
    subprocess.run(['xcrun','swiftc','-DDEBUG','-parse-as-library','-module-cache-path',str(base/'cache'),str(file),'-o',str(base/'test')],check=True)
    for flags in ({'MISE_DEMO_UI':'1'},{'MISE_DEMO_SHIFT_SAVE':'success'},{'MISE_DEMO_UI':'1','MISE_DEMO_SHIFT_SAVE':'success','EXPECT_FIXTURE':'1'}):
        env={k:v for k,v in os.environ.items() if k not in ('MISE_DEMO_UI','MISE_DEMO_SHIFT_SAVE','EXPECT_FIXTURE')}
        env.update(flags)
        # A non-demo run does not call real Notify: all transport is intercepted regardless.
        if flags.get('MISE_DEMO_UI')!='1':env['MISE_DEMO_UI']='0'
        subprocess.run([str(base/'test')],check=True,env=env)
