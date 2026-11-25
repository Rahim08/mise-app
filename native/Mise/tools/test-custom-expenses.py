#!/usr/bin/env python3
"""Native one-off expense regression checks. No API or financial writes.
Run: python3 native/Mise/tools/test-custom-expenses.py
"""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
MODELS = ROOT / 'native/Mise/Mise'

def run_swift(source):
    with tempfile.TemporaryDirectory(prefix='mise-custom-expenses-') as directory:
        folder = Path(directory)
        swift = folder / 'test.swift'
        swift.write_text(source)
        executable = folder / 'test'
        subprocess.run(['xcrun', 'swiftc', '-parse-as-library', '-module-cache-path', str(folder / 'cache'), str(swift), '-o', str(executable)], check=True)
        subprocess.run([str(executable)], check=True)

models = (MODELS / 'Models.swift').read_text()
expense = models[models.index('nonisolated struct ShiftExpense:'):models.index('nonisolated struct CardAmount:')]
split = (MODELS / 'ShiftForm.swift').read_text()
custom_path = MODELS / 'CustomExpenses.swift'
custom = custom_path.read_text() if custom_path.exists() else ''
opt_in = ', includeCustom: true' if 'includeCustom' in split else ''
run_swift('import Foundation\n' + expense + custom + split + '''
@main struct Test {
 static func main() throws {
  let rows = try JSONDecoder().decode([ShiftExpense].self, from: Data("""
  [
   {"id":"a","is_custom":true,"category_name":"Perfume","amount":12.5},
   {"id":"b","is_custom":true,"category_name":"Taxi","amount":7,"is_paid":false},
   {"id":"legacy","category_name":"Old","amount":4},
   {"id":"settle","is_custom":true,"category_name":"Perfume","amount":8,"paid_shift_id":"today"},
   {"id":"salary","is_custom":true,"category_name":"Payroll","amount":10,"note":"SALPERIOD:2026-11-01"},
   {"id":"malformed","is_custom":true,"category_id":"c","category_name":"Broken","amount":5},
   {"id":"cat","category_id":"c","category_name":"Supplies","amount":3}
  ]
  """.utf8))
  let result = splitShiftExpenses(rows, shiftId:"today", activeCategoryIds:["c"], activeEmployeeIds:[]''' + opt_in + ''')
  guard Set(result.ownedIds) == Set(["a", "b", "cat"]) else { fatalError("custom rows must be independently owned; settlement, salary, legacy and malformed rows stay protected") }
  guard result.unmanagedPaidTotal == 19 && result.settledTodayTotal == 8 && result.catAmounts["c"] == 3 else { fatalError("custom cash amounts must count once and system amounts retain their semantics") }
  let oldClient = splitShiftExpenses(rows, shiftId:"today", activeCategoryIds:["c"], activeEmployeeIds:[])
  guard oldClient.ownedIds == ["cat"] && oldClient.unmanagedPaidTotal == 31.5 else { fatalError("old callers must preserve custom rows") }
  print("PASS native custom expense ownership, backward compatibility and settlement classification")
 }
}
''')

# Money parsing and serialization use the current native helpers, not duplicated formulas.
run_swift('import Foundation\n' + custom + '''
@main struct MoneyTest {
 static func main() throws {
  for (text, cents) in [("12.50", Int64(1250)), ("12,50", 1250), (".5", 50), ("1.", 100), (" 0.01 ", 1)] {
   guard parseExpenseCents(text) == cents else { fatalError("valid money rejected: \\(text)") }
  }
  for text in ["", "0", "-1", "NaN", "Infinity", "1e3", "1.001", "1,2,3", "1000000000.01"] {
   guard parseExpenseCents(text) == nil else { fatalError("invalid money accepted: \\(text)") }
  }
  let id = "11111111-1111-4111-8111-111111111111"
  let row = CustomExpenseDraft(id:id, name:"  Perfume \\n refill  ", amount:"12,50", unpaid:false, note:"receipt")
  let prepared = try prepareCustomExpenses([row, CustomExpenseDraft()])
  guard prepared.count == 1, prepared[0].name == "Perfume refill", prepared[0].amount == 12.5 else { fatalError("normalization/blank-row handling") }
  let values = prepared[0].values(restaurantId:"venue", shiftId:"today")
  guard values["id"] as? String == id, values["category_name"] as? String == "Perfume refill", values["is_custom"] as? Bool == true, values["is_paid"] as? Bool == true, values["category_id"] == nil, values["employee_id"] == nil else { fatalError("custom ledger metadata or ownership incorrect") }
  guard customExpenseTotal([row, CustomExpenseDraft(name:"Taxi",amount:"7",unpaid:true)]) == 12.5 else { fatalError("unpaid cash counting") }
  for invalid in [CustomExpenseDraft(name:"",amount:"12"), CustomExpenseDraft(name:"Perfume",amount:""), CustomExpenseDraft(name:String(repeating:"x",count:121),amount:"1")] {
   do { _ = try prepareCustomExpenses([invalid]); fatalError("partial/overlong row accepted") } catch CustomExpenseValidationError.invalid {}
  }
  let restored = try JSONDecoder().decode([CustomExpenseDraft].self, from: JSONEncoder().encode([row]))
  guard restored == [row] else { fatalError("draft ID, amount, debt or note lost") }
  print("PASS native money validation, totals, payload and draft row round trip")
 }
}
''')

manager = (MODELS / 'ManagerView.swift').read_text()
manager = manager[:manager.index('// MARK: - Экран Manager')].replace('import SwiftUI', 'import Observation')
stubs = r'''
enum APIError:Error {case http(Int,String?)}
actor CacheStore { static let shared=CacheStore(); func invalidate(table:String) {} }
@MainActor func t(_ key:String,_ vars:[String:String]=[:])->String { key }
@MainActor func aiErrorMessage(_ error:Error)->String { "error" }
enum Money { static let symbol="€"; static func s(_ amount:Double)->String { String(amount) } }
@MainActor enum AppModel { static func businessDate(dayStartHour:Int)->Date { Date(timeIntervalSince1970:1_794_571_200) } }
@MainActor final class InkTopupsModel { init(rid:String) {} }
enum ShiftReminder { static func isEnabled()->Bool { false };static func schedule() {};static func cancel() {} }
enum Notify { static func send(type:String,title:String,body:String,audience:[String:Bool],titleKey:String,bodyKey:String,bodyParams:[String:String],secureBody:String,secureBodySegments:[[String:String]],data:[String:String]) async {} }
@MainActor final class Fixture {
 static let shared=Fixture()
 var saves:[[String:Any]]=[]
 var writes:[[String:Any]]=[]
 var expenses:[[String:Any]]=[]
 var shift:[String:Any]=["id":"shift", "date":"2026-11-13", "status":"open", "income":0, "income_card":0, "total_expense":0,"inkassation":0,"opening_balance":100,"closing_balance":100]
 func rows(_ table:String,_ columns:String)->[[String:Any]] {
  if table=="shifts" { return [shift] }
  if table=="shift_expenses" { return expenses }
  return []
 }
 func write(table:String,op:String,values:Any?,ids:[String],conflict:String?) {
  writes.append(["table":table,"op":op,"values":values ?? NSNull(),"conflict":conflict ?? ""])
  if table=="shifts", let update=values as? [String:Any] { shift.merge(update) { _,new in new } }
  guard table=="shift_expenses" else { return }
  if op=="delete" { expenses.removeAll { ids.contains($0["id"] as? String ?? "") } }
  if op=="upsert", let rows=values as? [[String:Any]] {
   for row in rows { expenses.removeAll { $0["id"] as? String == row["id"] as? String }; expenses.append(row) }
  }
 }
}
enum DB {
 static func from(_ table:String)->Query { Query(table) }
 @MainActor static func rpcRow<T:Decodable>(_ fn:String,args:[String:Any],cacheInvalidate:[String],as type:T.Type) async throws->T {
  let p=args["p"] as! [String:Any];Fixture.shared.saves.append(p)
  let rows=(p["custom"] as! [[String:Any]]).map { r in ["id":r["id"]!,"category_name":r["name"]!,"amount":r["amount"]!,"is_custom":true,"is_paid":true,"note":r["note"]!] }
  let data=try JSONSerialization.data(withJSONObject:["opening_balance":100,"total_expense":12.5,"closing_balance":187.5,"rows":rows])
  return try JSONDecoder().decode(T.self,from:data)
 }
}
final class Query: @unchecked Sendable {
 let table:String;var op="select";var columns="*";var values:Any?;var ids:[String]=[];var conflict:String?
 init(_ table:String){self.table=table}
 func fresh()->Self {self};func select(_ value:String="*")->Self {columns=value;return self};func order(_ c:String,ascending:Bool=true)->Self {self};func eq(_ c:String,_ v:Any)->Self {self};func lte(_ c:String,_ v:Any)->Self {self};func limit(_ n:Int)->Self {self}
 func `in`(_ c:String,_ values:[String])->Self {ids=values;return self}
 func insert(_ value:Any)->Self {op="insert";values=value;return self};func update(_ value:Any)->Self {op="update";values=value;return self};func delete()->Self {op="delete";return self}
 func upsert(_ value:Any,onConflict:String?=nil)->Self {op="upsert";values=value;conflict=onConflict;return self}
 func run() async throws {
  await Fixture.shared.write(table:table,op:op,values:values,ids:ids,conflict:conflict) }
 func list<T:Decodable>(_ type:T.Type) async throws->[T] {
  let rows=await Fixture.shared.rows(table,columns)
  return try JSONDecoder().decode([T].self,from:JSONSerialization.data(withJSONObject:rows))
 }
 func single<T:Decodable>(_ type:T.Type) async throws->T? { try await list(type).first }
}
enum API {
 static func dbRequest(_ payload:[String:Any]) async throws->Data { Data("{\"data\":[{\"name\":\" Perfume \"},{\"name\":\"perfume\"},{\"name\":\"Parking\"},{\"name\":\"Taxi\"}]}".utf8) }
 static func aiChat(module:String,message:String,context:String) async throws->[String:Any] { [:] }
}
'''
model_test = r'''
@main struct ModelTest {
 @MainActor static func main() async throws {
  let fixture=Fixture.shared
  let rid="native-test-"+UUID().uuidString
  let m=ManagerModel(rid:rid)
  m.shift=Shift(id:"shift",date:m.key(m.currentDate),status:"open",income:0,income_card:0,total_expense:0,inkassation:0,closing_balance:100,opening_balance:100)
  m.income="100"
  let id="abcdef12-1234-4234-8234-abcdef123456"
  m.customExpenses=[CustomExpenseDraft(id:id.uppercased(),name:"Perfume",amount:"12,50")]
  guard m.customExpenses[0].id==id else { fatalError("new UUID was not canonicalized") }
  guard m.calc.totalExp==12.5 && m.calc.balance==187.5 else { fatalError("custom amount not counted exactly once") }
  m.customExpenses[0].unpaid=true
  guard m.calc.totalExp==0 && m.calc.balance==200 else { fatalError("unpaid custom row reduced cash") }
  m.customExpenses[0].unpaid=false
  let previousDate=m.currentDate
  m.customExpenses[0].name=""
  await m.save(force:true)
  guard fixture.saves.isEmpty && m.customExpenseError != nil else { fatalError("invalid save wrote financial data") }
  await m.changeDate(1)
  guard fixture.saves.isEmpty && m.currentDate==previousDate else { fatalError("invalid autosave wrote data or changed date") }
  m.customExpenses[0].name="Perfume"
  await m.save(force:true)
  guard m.locked && fixture.writes.isEmpty && (fixture.saves.last?["custom"] as? [[String:Any]])?.first?["id"] as? String==id else { fatalError("custom row must travel in the atomic save with a stable ID") }
  await m.save(force:true)
  guard (fixture.saves.last?["replace_ids"] as? [String])==[id], (fixture.saves.last?["seen"] as? [[String:Any]])?.count==1 else { fatalError("saved rows must become the next form snapshot") }
  let matches=try await m.expenseNameSuggestions(prefix:"p")
  guard matches==["Perfume","Parking"] else { fatalError("suggestions must normalize/dedupe/filter prefix") }
  m.locked=false;m.customExpenses=[CustomExpenseDraft(id:id,name:"Perfume",amount:"12.50",unpaid:true,note:"receipt")]
  m.saveDraft()
  fixture.shift["income"]=0;fixture.shift["total_expense"]=0
  let replacement=ManagerModel(rid:rid)
  await replacement.loadDay(replacement.currentDate)
  guard replacement.customExpenses==m.customExpenses else { fatalError("custom draft not restored") }
  let draftKey="mgDraft_"+rid+"_"+m.key(m.currentDate)
  let legacyDraft:[String:Any]=["income":"2", "incomeCard":"", "inkSum":"", "inkExpense":"", "inkReason":"", "catAmounts":[:],"catNotes":[:],"empExtras":[:],"catUnpaid":[:],"empUnpaid":[:]]
  UserDefaults.standard.set(try JSONSerialization.data(withJSONObject:legacyDraft),forKey:draftKey)
  let legacy=ManagerModel(rid:rid)
  fixture.shift["income"]=0;fixture.shift["total_expense"]=0
  await legacy.loadDay(legacy.currentDate)
  guard legacy.income=="2" && legacy.customExpenses.isEmpty else { fatalError("legacy draft failed backward decode") }
  UserDefaults.standard.removeObject(forKey:draftKey)
  let currentDebt=ManagerModel.DebtRow(id:id,shiftId:"shift",date:m.key(m.currentDate),categoryId:nil,categoryName:"Perfume",employeeId:nil,amount:12.5,note:nil,isCustom:true)
  m.openDebts=[currentDebt];m.selectedDebtIds=[id]
  guard m.selectableDebts.isEmpty && m.debtSettleTotal==0 else { fatalError("current-shift debt must be paid through row toggle") }
  print("PASS native Manager validation-before-writes/autosave, atomic payload and snapshot, drafts, suggestions and same-shift debt guard")
 }
}
'''
run_swift(models + custom + split + stubs + manager + model_test)
