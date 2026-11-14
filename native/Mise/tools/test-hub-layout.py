#!/usr/bin/env python3
"""Run real home layout/store algorithms with isolated preferences; no app/network mocks."""
from pathlib import Path
import subprocess,tempfile,sys
root=Path(__file__).resolve().parents[1]/'Mise'
source=Path('/tmp/mise-hub-before-HubLayout.swift').read_text() if '--baseline' in sys.argv else (root/'HubLayout.swift').read_text()
pure=source.split('/// Springboard-')[0].replace('import SwiftUI','import Foundation\nimport CoreGraphics').replace('UserDefaults.standard','TestDefaults.value')
probe=''
if 'struct HubDragSession' not in pure:
 a=source.index('    private func insertionIndex(');b=source.index('    private func loadOrder(',a)
 probe='struct Probe {let order:[HubItem];let tileFrames:[String:CGRect]\n'+source[a:b].replace('private func insertionIndex','func insertionIndex')+'}\n'
if not probe:
 a=source.index('    private func clearInteraction()');b=source.index('    private func setSize(',a)
 probe='final class CancellationProbe {var drag:HubDragSession?;var resizingID:String?;var resizeStartSize:HubTileSize?;var resizePreview:HubTileSize?;var ignoredTouchID:String?;var activeID:String? {drag?.id ?? resizingID}\n'+source[a:b].replace('private func','func')+'}\n'
body=r'''
enum TestDefaults {static let name="mise-hub-test-"+UUID().uuidString;static let value=UserDefaults(suiteName:name)!}
@main struct Test {
 static func main() throws {
  defer {TestDefaults.value.removePersistentDomain(forName:TestDefaults.name)}
  var failures:[String]=[]
  func check(_ c:Bool,_ message:String){if !c {print("FAIL "+message);failures.append(message)}}
  let ids=["manager","analytics","stash","people","bookings","news"]
  let initial=[HubItem(id:"manager",size:.large),HubItem(id:"analytics",size:.medium),HubItem(id:"stash",size:.medium),HubItem(id:"people",size:.small),HubItem(id:"bookings",size:.small),HubItem(id:"news",size:.small)]
  let frames:[String:CGRect]=["manager":CGRect(x:0,y:0,width:330,height:150),"analytics":CGRect(x:0,y:160,width:216.666,height:76),"stash":CGRect(x:0,y:246,width:216.666,height:76),"people":CGRect(x:226.666,y:246,width:103.334,height:76),"bookings":CGRect(x:0,y:332,width:103.334,height:76),"news":CGRect(x:113.334,y:332,width:103.334,height:76)]
  /*DRAG_CHECKS*/
  let damaged=[HubItem(id:"manager",size:.small),HubItem(id:"manager",size:.large),HubItem(id:"private-module",size:.large),HubItem(id:"people",size:.medium)]
  HubLayoutStore.save(damaged,staffId:"one")
  let repaired=HubLayoutStore.load(staffId:"one",fallback:ids)
  check(repaired.map(\.id)==["manager","people","analytics","stash","bookings","news"],"saved duplicate IDs survived and displaced modules")
  check(repaired.first?.size == .small && repaired[1].size == .medium,"repair discarded existing size choice")
  check(HubLayoutStore.load(staffId:"two",fallback:["people"]).map(\.id)==["people"],"layout leaked across staff")
  check(HubLayoutStore.load(staffId:"one",fallback:["people","news"]).map(\.id)==["people","news"],"removed permissions retained inaccessible tiles")
  /*GEOMETRY_CHECKS*/
  if !failures.isEmpty {print("FAILED \(failures.count)");exit(1)}
  print("PASS real hub geometry, drag sessions and per-staff persistence")
 }
}
'''
if 'struct Probe {' in probe:
 body=body.replace('  /*DRAG_CHECKS*/',r'''
  let probe=Probe(order:initial,tileFrames:frames)
  check(probe.insertionIndex(at:CGPoint(x:170,y:70),moving:"manager")==0,"short move inside own full-width row jumps to the end")
  check(probe.insertionIndex(at:CGPoint(x:100,y:190),moving:"analytics")==1,"short move inside own medium-only row jumps to the end")
''').replace('  /*GEOMETRY_CHECKS*/','')
else:
 body=body.replace('  /*DRAG_CHECKS*/',r'''
  var manager=HubDragSession(items:initial,frames:frames,id:"manager")!
  manager.update(at:CGPoint(x:170,y:70),translation:CGSize(width:20,height:0))
  check(manager.previewItems==initial,"short move inside own full-width row jumps to the end")
  manager.update(at:CGPoint(x:320,y:380),translation:CGSize(width:150,height:300))
  check(manager.previewItems.map(\.id)==["analytics","stash","people","bookings","news","manager"],"move to final slot failed")
  let stable=manager.previewItems
  for _ in 0..<20 {manager.update(at:CGPoint(x:320,y:380),translation:CGSize(width:150,height:300))}
  check(manager.previewItems==stable && initial.first?.id=="manager","stationary drag oscillated or mutated committed order")
  manager.update(at:CGPoint(x:170,y:70),translation:.zero)
  check(manager.previewItems==initial,"returning to origin did not restore preview")
  var last=HubDragSession(items:initial,frames:frames,id:"news")!
  last.update(at:CGPoint(x:0,y:-20),translation:CGSize(width:-150,height:-400))
  check(last.previewItems.map(\.id)==["news","manager","analytics","stash","people","bookings"],"move to first slot failed")
  var horizontal=HubDragSession(items:initial,frames:frames,id:"bookings")!
  horizontal.update(at:CGPoint(x:210,y:365),translation:CGSize(width:160,height:0))
  check(horizontal.previewItems.suffix(2).map(\.id)==["news","bookings"],"same-row move failed")
''').replace('  /*GEOMETRY_CHECKS*/',r'''
  for width in [280.0,350.0,768.0] {
   for mask in 0..<729 {
    var n=mask
    let items=ids.map {id -> HubItem in let size=HubTileSize.ordered[n%3];n/=3;return HubItem(id:id,size:size)}
    let heights=Dictionary(uniqueKeysWithValues:ids.enumerated().map {($0.element,CGFloat(76+$0.offset*13))})
    let layout=hubGridGeometry(items,width:width,heights:heights)
    check(layout.frames.count==6,"size combination lost a tile")
    for (i,id) in ids.enumerated() {
     let frame=layout.frames[id]!
     check(frame.minX>=0 && frame.maxX<=width+0.001 && frame.minY>=0 && frame.height>=heights[id]!,"tile escaped grid or clipped measured height")
     for other in ids.dropFirst(i+1) {check(!frame.intersects(layout.frames[other]!),"settled tile frames overlap")}
    }
    let lastY=layout.frames.values.map(\.maxY).max() ?? 0
    check(abs(layout.height-lastY)<0.001,"content height hides last row")
   }
  }
  check(HubTileSize.resized(from:.medium,translation:CGSize(width:80,height:80)) == .large,"resize grow not snapped")
  check(HubTileSize.resized(from:.medium,translation:CGSize(width:-80,height:-80)) == .small,"resize shrink not snapped")
  check(HubTileSize.resized(from:.medium,translation:.zero) == .medium,"zero resize changes size")
  let cancelled=CancellationProbe()
  cancelled.drag=HubDragSession(items:initial,frames:frames,id:"manager")
  cancelled.cancelInteraction()
  check(cancelled.activeID==nil && cancelled.ignoredTouchID=="manager","cancelled move keeps drag/scroll locked")
  cancelled.cancelTouch("manager")
  check(cancelled.ignoredTouchID==nil,"cancelled touch prevents next move")
  cancelled.resizingID="news";cancelled.resizeStartSize = .small;cancelled.resizePreview = .large
  cancelled.cancelInteraction()
  check(cancelled.activeID==nil && cancelled.resizeStartSize==nil && cancelled.resizePreview==nil,"cancelled resize retains transient size/scroll lock")
  cancelled.cancelTouch("news")
  cancelled.drag=HubDragSession(items:initial,frames:frames,id:"manager")
  cancelled.cancelTouch("news")
  check(cancelled.activeID=="manager","another tile cancellation interrupted active move")
  HubLayoutStore.save(initial,staffId:"preview")
  var preview=HubDragSession(items:initial,frames:frames,id:"manager")!
  preview.update(at:CGPoint(x:320,y:380),translation:CGSize(width:0,height:300))
  check(HubLayoutStore.load(staffId:"preview",fallback:ids)==initial,"uncommitted preview changed persisted layout")
  HubLayoutStore.save(preview.previewItems,staffId:"preview")
  check(HubLayoutStore.load(staffId:"preview",fallback:ids).map(\.id)==["analytics","stash","people","bookings","news","manager"],"committed move did not survive store round trip")
  print("PASS cancellation releases gesture/scroll state; preview remains unsaved until commit")
  print("PASS 2,187 size/width layouts: disjoint bounded frames and measured content height")
''')
with tempfile.TemporaryDirectory(prefix='mise-hub-test-') as folder:
 p=Path(folder);(p/'test.swift').write_text(pure+'\n'+probe+'\n'+body)
 subprocess.run(['xcrun','swiftc','-parse-as-library','-module-cache-path',str(p/'cache'),str(p/'test.swift'),'-o',str(p/'test')],check=True)
 subprocess.run([str(p/'test')],check=True)
