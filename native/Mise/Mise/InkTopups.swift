import SwiftUI

// Поступления в баланс инкассации (inkassation_topups, docs/migrations/inkassation-topups-2026-09-21.sql).
// Отдельная таблица: кассу (наличные/карта смены) не трогает, в выручку/прибыль не входит.
// Здесь — добавление/правка/удаление (только Manager); Analytics строку только показывает.
// Удаление физическое — «до»-образ остаётся в financial_audit_log (триггер + /api/db).

@MainActor
@Observable
final class InkTopupsModel {
    let rid: String
    var rows: [InkTopup] = []
    var saving = false

    private let df: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f
    }()
    func key(_ d: Date) -> String { df.string(from: d) }
    func parse(_ s: String) -> Date { df.date(from: s) ?? Date() }

    init(rid: String) { self.rid = rid }

    func load() async {
        if let r = try? await DB.from("inkassation_topups").select("id, date, amount, reason")
            .eq("restaurant_id", rid).order("date", ascending: false).limit(20).list(InkTopup.self) {
            rows = r
        }
    }

    private struct ShiftInk: Codable, Sendable { let inkassation: Double? }
    private struct InkDeduct: Codable, Sendable { let expense: Double?; let salary: Double? }
    private struct Amt: Codable, Sendable { let amount: Double? }

    /// Баланс инкассации «сейчас» (та же формула, что в Analytics/выплате ЗП): валовая инкассация −
    /// (расход + ЗП) + поступления. nil — не удалось прочитать (fail-closed: правку не пускаем).
    private func inkBalance() async -> Double? {
        async let a = DB.from("shifts").select("inkassation").eq("restaurant_id", rid).fresh().list(ShiftInk.self)
        async let b = DB.from("inkassations").select("expense, salary").eq("restaurant_id", rid).fresh().list(InkDeduct.self)
        async let c = DB.from("inkassation_topups").select("amount").eq("restaurant_id", rid).fresh().list(Amt.self)
        guard let sh = try? await a, let ink = try? await b, let tp = try? await c else { return nil }
        return sh.reduce(0) { $0 + ($1.inkassation ?? 0) }
            - ink.reduce(0) { $0 + ($1.expense ?? 0) + ($1.salary ?? 0) }
            + tp.reduce(0) { $0 + ($1.amount ?? 0) }
    }
    /// Уменьшение/удаление поступления, из которого уже платили (ЗП, расход), увело бы баланс в минус.
    private func guardReduction(_ reduceBy: Double) async -> String? {
        guard reduceBy > 0 else { return nil }
        guard let bal = await inkBalance() else { return t("mg.topupErrVerify") }
        if bal - reduceBy < -0.005 { return t("mg.topupErrNegative", ["avail": Money.s(max(0, bal))]) }
        return nil
    }

    /// nil = сохранено; иначе текст ошибки для показа в форме.
    func save(id: String?, date: Date, amount: Double, reason: String) async -> String? {
        guard !saving else { return nil }
        let amt = (amount * 100).rounded() / 100
        let why = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        if !(amt > 0) { return t("mg.topupErrAmount") }
        if why.isEmpty { return t("mg.topupErrReason") }
        if date > Date() { return t("mg.topupErrDate") }
        saving = true; defer { saving = false }
        if let id, let old = rows.first(where: { $0.id == id }), let e = await guardReduction(old.amount - amt) { return e }
        let values: [String: Any] = ["date": key(date), "amount": amt, "reason": String(why.prefix(200))]
        do {
            if let id {
                try await DB.from("inkassation_topups").update(values).eq("id", id).run()
            } else {
                try await DB.from("inkassation_topups").insert(values.merging(["restaurant_id": rid]) { a, _ in a }).run()
            }
        } catch {
            return t("mg.err") + ": " + error.localizedDescription
        }
        await load()
        return nil
    }

    func delete(id: String) async -> String? {
        guard !saving else { return nil }
        saving = true; defer { saving = false }
        if let old = rows.first(where: { $0.id == id }), let e = await guardReduction(old.amount) { return e }
        do { try await DB.from("inkassation_topups").delete().eq("id", id).run() }
        catch { return t("mg.err") + ": " + error.localizedDescription }
        await load()
        return nil
    }
}

struct InkTopupsCard: View {
    let m: InkTopupsModel
    private let accent = BrandKit.manager   // синий, как карта

    private struct SheetItem: Identifiable { let id: String; let topup: InkTopup? }
    @State private var sheet: SheetItem?

    var body: some View {
        VStack(spacing: 6) {
            HStack {
                Text(t("mg.topups").uppercased()).font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.primary.opacity(0.45)).kerning(0.5)
                Spacer()
            }
            .padding(.horizontal, 4).padding(.top, 8)

            VStack(spacing: 0) {
                if m.rows.isEmpty {
                    Text(t("mg.topupNone")).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.4))
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 12).padding(.horizontal, 14)
                    Divider().overlay(Color.primary.opacity(0.08)).padding(.leading, 14)
                } else {
                    ForEach(m.rows) { r in
                        Button { sheet = SheetItem(id: r.id, topup: r) } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    Text(display(r.date)).font(.system(size: 13)).foregroundStyle(.primary.opacity(0.5))
                                    Spacer()
                                    Text("+" + Money.s(r.amount)).font(.system(size: 15, weight: .bold)).foregroundStyle(accent)
                                }
                                if let why = r.reason, !why.isEmpty {
                                    Text(why).font(.system(size: 12)).foregroundStyle(.primary.opacity(0.5))
                                        .multilineTextAlignment(.leading)
                                }
                            }
                            .padding(.vertical, 11).padding(.horizontal, 14)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        Divider().overlay(Color.primary.opacity(0.08)).padding(.leading, 14)
                    }
                }
                Button { sheet = SheetItem(id: "new", topup: nil) } label: {
                    HStack {
                        Image(systemName: "plus")
                        Text(t("mg.addTx"))
                        Spacer()
                    }
                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(accent)
                    .padding(.vertical, 13).padding(.horizontal, 14)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .task { await m.load() }
        .sheet(item: $sheet) { item in
            InkTopupForm(m: m, existing: item.topup) { sheet = nil }
                .presentationDetents([.medium, .large])
        }
    }

    private func display(_ ymd: String) -> String {
        let p = ymd.split(separator: "-")
        return p.count == 3 ? "\(p[2]).\(p[1]).\(p[0])" : ymd
    }
}

private struct InkTopupForm: View {
    let m: InkTopupsModel
    let existing: InkTopup?
    let close: () -> Void

    @State private var date = Date()
    @State private var amount = ""
    @State private var reason = ""
    @State private var error: String?
    @State private var confirmDelete = false
    private let accent = BrandKit.manager

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker(t("mg.topupDate"), selection: $date, in: ...Date(), displayedComponents: .date)
                    HStack {
                        Text(t("mg.topupAmount"))
                        Spacer()
                        TextField(Money.symbol + " 0", text: $amount)
                            .keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                            .font(.system(size: 16, weight: .semibold)).foregroundStyle(accent)
                    }
                    TextField(t("mg.topupReason"), text: $reason, axis: .vertical).lineLimit(1...3)
                } footer: {
                    Text(t("mg.topupHint"))
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red).font(.system(size: 14)) }
                }
                if let existing {
                    Section {
                        Button(role: .destructive) {
                            if !confirmDelete { confirmDelete = true; return }
                            Task {
                                if let e = await m.delete(id: existing.id) { error = e } else { close() }
                            }
                        } label: {
                            Text(confirmDelete ? t("mg.topupDeleteSure") : t("delete"))
                        }
                        .disabled(m.saving)
                    }
                }
            }
            .navigationTitle(existing == nil ? t("mg.topupNew") : t("mg.topupEdit"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { close() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("save")) {
                        Task {
                            let v = Double(amount.replacingOccurrences(of: ",", with: ".")) ?? 0
                            if let e = await m.save(id: existing?.id, date: date, amount: v, reason: reason) { error = e } else { close() }
                        }
                    }
                    .disabled(m.saving)
                }
            }
        }
        .onAppear {
            guard let existing else { return }
            date = m.parse(existing.date)
            amount = existing.amount == existing.amount.rounded() ? String(Int(existing.amount)) : String(existing.amount)
            reason = existing.reason ?? ""
        }
    }
}
