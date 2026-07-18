import SwiftUI
import CoreLocation
import UIKit

let PEOPLE_ACCENT = BrandKit.people

func eur(_ v: Double) -> String { Money.s(v) }

// Число без хвостовых нулей: 5.0 → "5", 1.5 → "1.5".
extension Double {
    var clean: String {
        truncatingRemainder(dividingBy: 1) == 0 ? String(Int(self)) : String(self)
    }
}

let STATUS_ORDER = ["todo", "in_progress", "done"]
@MainActor func statusLabel(_ s: String) -> String { t("pe.st." + (s == "in_progress" ? "inprogress" : s)) }
@MainActor func prioLabel(_ p: String?) -> String { t("pe.prio." + (p ?? "medium")) }
func prioColor(_ p: String?) -> Color { ["high": BrandKit.menu, "medium": BrandKit.stash, "low": Color.primary.opacity(0.4)][p ?? "medium"] ?? BrandKit.stash }
/// "yyyy-MM-dd" → "dd.MM" для бейджа срока задачи (ревью Б5/P3).
func dueLabel(_ due: String) -> String {
    let parts = due.split(separator: "-")
    guard parts.count == 3 else { return due }
    return "\(parts[2]).\(parts[1])"
}


// MARK: - Экран People

struct PeopleView: View {
    @Environment(AppModel.self) private var app
    @State private var m: PeopleModel?

    var body: some View {
        Group {
            if let m {
                PeopleBody(m: m)
                    .transition(.opacity)
            } else {
                PeopleSkeleton()
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.3), value: m == nil)
        .task {
            if m == nil {
                let s = app.staff
                let model = PeopleModel(rid: app.restaurant?.id ?? "", myId: s?.id ?? "",
                                        myName: s?.name ?? "", isManager: (s?.isOwner ?? false) || s?.role == "manager" || s?.role == "admin",
                                        myRole: s?.role)
                m = model
                #if DEBUG
                if let t = ProcessInfo.processInfo.environment["MISE_DEMO_TAB"] { model.tab = t }
                if let o = ProcessInfo.processInfo.environment["MISE_DEMO_OPS"] { model.opsView = o }
                if let sv = ProcessInfo.processInfo.environment["MISE_DEMO_SHIFTS"] { model.shiftsView = sv }
                #endif
                await model.loadTasks()
                await model.loadOrders() // для бейджа активных заказов на вкладке «Зал»
            }
        }
    }
}

struct PeopleBody: View {
    @Environment(AppModel.self) private var app
    @Bindable var m: PeopleModel
    @State private var showTaskForm = false

    var body: some View {
        ZStack(alignment: .bottom) {
            TabView(selection: $m.tab) {
                AppTabPage(refresh: { await refreshShifts() }) { ShiftsHubTab(m: m) }
                    .tabItem { Label(t("tab.shifts"), systemImage: "calendar") }.tag("shifts")
                AppTabPage(refresh: { await refreshTasks() }) { TasksTab(m: m, showForm: $showTaskForm) }
                    .tabItem { Label(t("tab.tasks"), systemImage: "checklist") }.tag("tasks")
                    .badge(m.newReportsCount)
                AppTabPage(refresh: { await refreshOps() }) { ZalTab(m: m) }
                    .tabItem { Label(t("tab.hall"), systemImage: "storefront") }.tag("ops")
                    .badge(m.activeOrders.isEmpty ? 0 : m.activeOrders.count)
                AppTabPage(refresh: { await m.loadPurchase() }) { PurchaseTab(m: m) }
                    .tabItem { Label(t("tab.purchase"), systemImage: "cart") }.tag("purchase")
                AppTabPage(refresh: { await m.loadSalary() }) { PeopleSalaryTab(m: m) }
                    .tabItem { Label(t("tab.salary"), systemImage: "creditcard.fill") }.tag("salary")
            }
            .tint(PEOPLE_ACCENT)
            .sensoryFeedback(.selection, trigger: m.tab)
            .tabEdgeSwipe(tabs: ["shifts", "tasks", "ops", "purchase", "salary"],
                          selection: $m.tab,
                          onFirstBack: app.availableApps.count > 1 ? { app.backToLauncher() } : nil)

            if let toast = m.toast {
                Text(toast).font(.system(size: 14, weight: .semibold)).foregroundStyle(.primary)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.bottom, 60)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.2), value: m.toast)
        .sheet(isPresented: $showTaskForm) { TaskFormSheet(m: m) }
        .task(id: m.tab) {
            switch m.tab {
            case "tasks":
                if !m.tasksLoaded { await m.loadTasks() }
                if !m.reportsLoaded { await m.loadReports() }
            case "ops":
                if !m.menuLoaded { await m.loadMenu() }
                if !m.ordersLoaded { await m.loadOrders() }
            case "purchase": if !m.purchaseLoaded { await m.loadPurchase() }
            case "salary": if !m.salaryLoaded { await m.loadSalary() }
            default:       if !m.schedLoaded { await m.loadSchedule() }
            }
        }
    }

    private func refreshTasks() async {
        if m.tasksSeg == "reports" { await m.loadReports() } else { await m.loadTasks() }
    }
    private func refreshShifts() async {
        if m.shiftsView == "swaps" { await m.loadSwaps() }
        else { await m.loadAttendance(); await m.loadSchedule() }
    }
    private func refreshOps() async {
        switch m.opsView {
        case "orders": await m.loadOrders()
        case "check":  await m.loadChecklists()
        case "tech":   await m.loadTechCards()
        default:       await m.loadMenu()
        }
    }
}


// MARK: даты

func hhmm(_ s: String?) -> String {
    guard let s, s.count >= 5 else { return "—" }
    return String(s.prefix(5))
}
func clock(_ iso: String?) -> String {
    guard let d = parseISO(iso) else { return "—" }
    let f = DateFormatter(); f.dateFormat = "HH:mm"; return f.string(from: d)
}
func dayLabel(_ ymd: String) -> String {
    let inF = DateFormatter(); inF.dateFormat = "yyyy-MM-dd"; inF.locale = Locale(identifier: "en_US_POSIX")
    guard let d = inF.date(from: ymd) else { return ymd }
    let f = DateFormatter(); f.locale = appLocale(); f.dateFormat = "EEE, d MMM"
    return f.string(from: d).capitalized
}
