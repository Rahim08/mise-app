#!/usr/bin/env python3
"""Check native loading order with controlled read-only fixtures.

Run from any directory: python3 native/Mise/tools/test-loading.py
Requires Xcode's Swift compiler. No server, credentials, or simulator is used.
The tests compile the current production loader methods with a fake DB transport.
"""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]

def run_swift(source: str) -> None:
    with tempfile.TemporaryDirectory(prefix="mise-loading-") as directory:
        folder = Path(directory)
        swift = folder / "test.swift"
        swift.write_text(source)
        executable = folder / "test"
        subprocess.run(["xcrun", "swiftc", "-parse-as-library", "-module-cache-path", str(folder / "cache"), str(swift), "-o", str(executable)], check=True)
        subprocess.run([str(executable)], check=True)

from pathlib import Path
source=(ROOT / 'native/Mise/Mise/HubStats.swift').read_text().replace('@Observable\n','')
stubs='''
struct Shift: Decodable, Sendable { let status: String?; let closing_balance: Double?; let income: Double?; let income_card: Double? }
struct StockItem: Decodable, Sendable { let quantity_g: Double; let min_quantity_g: Double? }
struct AttendanceRecord: Decodable, Sendable { let check_in_at: String?; let check_out_at: String? }
struct Booking: Decodable, Sendable { let status: String?; let booking_time: String? }
enum AppModel { static func businessDate(dayStartHour: Int) -> Date { Date() } }
enum DB { static func from(_ table: String) -> Query { Query(table: table) } }
struct Query: Sendable {
 let table: String
 func fresh() -> Self { self }; func select() -> Self { self }; func eq(_ key:String,_ value:String) -> Self { self }; func lte(_ key:String,_ value:String)->Self {self};func order(_ key:String,ascending:Bool = true)->Self { self };func limit(_ n:Int)->Self {self}
 func list<T: Decodable>(_ type:T.Type) async throws -> [T] {
  if table == "tobacco_stock" { try await Task.sleep(for:.milliseconds(500)) }
  let json = table == "shifts" ? "[{\\"status\\":\\"open\\",\\"closing_balance\\":125,\\"income\\":100,\\"income_card\\":20}]" : "[]"
  return try JSONDecoder().decode([T].self,from:Data(json.utf8))
 }
}
@main struct Test {
 @MainActor static func main() async throws {
  let model = HubStatsModel()
  let task = Task { await model.load(canSeeMoney:true,dayStartHour:6) }
  try await Task.sleep(for:.milliseconds(100))
  guard model.managerCash == 125 && model.analyticsIncome == 120 else { print("FAIL unrelated stock request blocked money tiles"); await task.value; exit(1) }
  await task.value
  await model.load(canSeeMoney:false,dayStartHour:6)
  guard model.managerCash == nil && model.analyticsIncome == nil else { exit(1) }
  print("PASS independent money tiles and role visibility")
 }
}
'''
run_swift(source + stubs)

from pathlib import Path
source=(ROOT / 'native/Mise/Mise/AnalyticsView.swift').read_text();a=source.index('    private var loadGeneration');b=source.index('    // MARK: - Банк',a);methods=source[a:b]
stubs='''import Foundation
struct Row: Codable, Sendable {
 var id: String = ""; var is_active: Bool?; var employee_id: String?; var is_pinned: Bool?; var name: String?; var source: String?; var shift_id: String?; var type: String?; var quantity_g: Double = 0; var balance: Double?; var income: Double?
 var include_card_in_analytics: Bool?; var hookah_price: Double?; var hookah_portion_g: Double?; var salary_payout_day: Int?
}
typealias Shift=Row;typealias Employee=Row;typealias CardAmount=Row;typealias Absence=Row;typealias HookahSale=Row;typealias SalaryAdvance=Row;typealias SalaryPayment=Row;typealias SalaryHistoryRow=Row;typealias ShiftExpense=Row;typealias Inkassation=Row;typealias InkTopup=Row;typealias InkBalanceRow=Row;typealias StockItem=Row;typealias Movement=Row;typealias HookahType=Row;typealias AnalyticsSettings=Row;typealias SalDebtRow=Row
enum ManagerSalaryModel { static let salperiodPrefix = "SALPERIOD:" }
func resolveEmployees(_ emps:[Employee],history:[SalaryHistoryRow],monthStart:String)->[Employee] { emps }
enum DB { static func from(_ table:String)->Query { Query(table:table) } }
struct Query: Sendable {
 let table:String
 func select(_ columns:String="*")->Self {self};func limit(_ n:Int)->Self {self};func order(_ col:String)->Self {self};func gte(_ key:String,_ value:String)->Self {self};func lte(_ key:String,_ value:String)->Self {self};func eq<T>(_ key:String,_ value:T)->Self {self};func `in`(_ key:String,_ value:[String])->Self {self}
 func list<T:Decodable>(_ type:T.Type) async throws->[T] {
  if table == "employees" { try await Task.sleep(for:.milliseconds(500)) }
  let json = table == "inkassation_balance" ? "[{\\"id\\":\\"balance\\",\\"quantity_g\\":0,\\"balance\\":245}]" : table == "shifts" ? "[{\\"id\\":\\"shift\\",\\"quantity_g\\":0,\\"income\\":123}]" : "[]"
  return try JSONDecoder().decode([T].self,from:Data(json.utf8))
 }
}
@MainActor final class AnalyticsModel {
 var currentDate=Date();var loading=true;var historyLoading=false;var histLoaded=false;var includeCard=false;var hkPrice=0.0;var hkPortion=20.0;var payoutDay:Int?;var cumulativeInkass=0.0;var issuedG=0.0;var stockG=0.0;var debtsLoadFailed=false
 var shiftsRaw:[Shift]=[];var prevShiftsRaw:[Shift]=[];var employees:[Employee]=[];var cardAmounts:[CardAmount]=[];var absences:[Absence]=[];var prevCardAmounts:[CardAmount]=[];var prevAbsences:[Absence]=[];var advances:[SalaryAdvance]=[];var prevAdvances:[SalaryAdvance]=[];var payments:[SalaryPayment]=[];var prevPayments:[SalaryPayment]=[];var salaryHistory:[SalaryHistoryRow]=[];var expenses:[ShiftExpense]=[];var prevExpenses:[ShiftExpense]=[];var salDebts:[SalDebtRow]=[];var hookahRows:[HookahSale]=[];var allHookah:[HookahSale]=[];var allTopups:[InkTopup]=[];var stockRows:[StockItem]=[];var types:[HookahType]=[];var inkDetails:[String:Inkassation]=[:];var pinnedCats:Set<String>=[]
 func key(_ date:Date)->String { "2026-11-12" }
 func loadDebts(generation:Int) async {}
 func loadBank(generation:Int) async { try? await Task.sleep(for:.milliseconds(900)) }
'''
test='''
}
@main struct Test {
 @MainActor static func main() async throws {
  let m=AnalyticsModel();let task=Task { await m.load() }
  try await Task.sleep(for:.milliseconds(100))
  guard m.shiftsRaw.first?.income == 123 && m.cumulativeInkass == 245 else { print("FAIL primary figures blocked by payroll/history");exit(1) }
  try await Task.sleep(for:.milliseconds(550))
  guard m.loading == false else { print("FAIL bank blocked period loading");exit(1) }
  await task.value
  print("PASS turnover and collection balance precede payroll/history; bank does not gate period")
 }
}
'''
run_swift(stubs + methods + test)
