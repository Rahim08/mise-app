#!/usr/bin/env python3
"""Exercise the movement form's real focus order; no API, credentials or UI mocks."""
from pathlib import Path
import subprocess
import tempfile

source = (Path(__file__).resolve().parents[1] / 'Mise/StashView.swift').read_text()
start = source.index('private struct MovLine:')
end = source.index('private struct AddMovementSheet:', start)
declarations = source[start:end]
tests = r'''
@main struct Tests {
 static func main() {
  let a = MovGroup(brand: "A", lines: (0..<6).map { _ in MovLine() })
  let b = MovGroup(brand: "B")
  let manual = movementFocusOrder(groups: [a,b], outOnly: false, fromStock: false, stockIDs: [], venue: false, reason: false)
  assert(manual.count == 16)
  assert(manual.first == .brand(a.id))
  assert(manual[1] == .flavor(a.lines[0].id) && manual[2] == .grams(a.lines[0].id))
  assert(manual[11] == .flavor(a.lines[5].id) && manual[12] == .grams(a.lines[5].id))
  assert(nextMovementField(after: .grams(a.lines[4].id), in: manual) == .flavor(a.lines[5].id))
  assert(nextMovementField(after: .grams(a.lines[5].id), in: manual) == .brand(b.id))
  assert(nextMovementField(after: .grams(b.lines[0].id), in: manual) == nil)
  assert(nextMovementField(after: .reason, in: manual) == nil)
  print("PASS six lines, multiple brands and final/missing field traversal")

  let blank = MovGroup()
  let restricted = movementFocusOrder(groups: [blank], outOnly: true, fromStock: false, stockIDs: [], venue: false, reason: true)
  assert(restricted == [.brand(blank.id), .grams(blank.lines[0].id), .reason])
  let advanceAfterBrandPick = MovementFocusRequest.after(.brand(blank.id))
  var enabled = blank; enabled.brand = "Selected brand"
  let enabledOrder = movementFocusOrder(groups: [enabled], outOnly: true, fromStock: false, stockIDs: [], venue: false, reason: true)
  assert(advanceAfterBrandPick.target(in: enabledOrder) == .flavor(blank.lines[0].id), "resolve against fields enabled by the selection")
  assert(MovementFocusRequest.field(.brand(a.id)).target(in: []) == nil)
  let stock = movementFocusOrder(groups: [a], outOnly: true, fromStock: true, stockIDs: ["s2","s1","s3"], venue: false, reason: true)
  assert(stock == [.stock("s2"),.stock("s1"),.stock("s3"),.reason])
  assert(nextMovementField(after: .stock("s3"), in: stock) == .reason)
  assert(movementFocusOrder(groups: [a], outOnly: true, fromStock: true, stockIDs: [], venue: true, reason: true) == [.venueGrams,.reason])
  assert(movementFocusOrder(groups: [a], outOnly: true, fromStock: true, stockIDs: [], venue: false, reason: false).isEmpty)
  print("PASS only visible enabled fields, displayed stock order and write-off reason")

  let remaining = manual.filter { $0 != .flavor(a.lines[2].id) && $0 != .grams(a.lines[2].id) }
  assert(repairedMovementFocus(.flavor(a.lines[2].id), previous: manual, remaining: remaining) == .flavor(a.lines[3].id))
  assert(repairedMovementFocus(.grams(b.lines[0].id), previous: manual, remaining: Array(manual.dropLast())) == .flavor(b.lines[0].id))
  assert(repairedMovementFocus(.brand(a.id), previous: manual, remaining: []) == nil)
  assert(repairedMovementFocus(nil, previous: manual, remaining: remaining) == nil)
  assert(repairedMovementFocus(.brand(a.id), previous: manual, remaining: remaining) == .brand(a.id))
  assert(Set(manual.map(\.scrollID)).count == manual.count)
  print("PASS removed-row repair, stable unique scroll targets and dismissed focus")
  var editable = [a,b]
  let binding = Binding<[MovGroup]>(get: { editable }, set: { editable = $0 })
  let staleLine = movementLineBinding(binding, groupID: a.id, lineID: a.lines[5].id, keyPath: \.flavor)
  staleLine.wrappedValue = "Last flavor"
  editable[0].lines.removeLast()
  assert(staleLine.wrappedValue.isEmpty)
  staleLine.wrappedValue = "Late keyboard callback"
  assert(editable[0].lines.count == 5 && editable[1].lines[0].flavor.isEmpty)
  let staleBrand = movementBrandBinding(binding, groupID: a.id)
  editable.removeFirst()
  assert(staleBrand.wrappedValue.isEmpty)
  staleBrand.wrappedValue = "Late brand callback"
  assert(editable[0].brand == "B")
  print("PASS keyboard callbacks after row/group deletion cannot index or modify another item")
 }
}
'''
with tempfile.TemporaryDirectory(prefix='mise-stash-focus-') as folder:
    base = Path(folder)
    file = base / 'test.swift'
    file.write_text('import Foundation\nimport SwiftUI\n' + declarations + tests)
    subprocess.run(['xcrun','swiftc','-parse-as-library','-module-cache-path',str(base/'cache'),str(file),'-o',str(base/'test')],check=True)
    subprocess.run([str(base/'test')],check=True)
