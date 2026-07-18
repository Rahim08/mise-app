import SwiftUI
import CoreLocation
import UIKit
// Техкарты
// Распил PeopleView.swift (Д2, 2026-07-18): секция вынесена без изменений логики.

// MARK: Техкарты

let TC_CAT_CODES = ["dish", "prep", "stoplist"]
@MainActor func tcCatLabel(_ c: String?) -> String {
    switch c { case "dish": return t("pe.tc.dish"); case "prep": return t("pe.tc.prep"); case "stoplist": return t("pe.tc.other"); default: return c ?? "—" }
}

struct TechCardsTab: View {
    @Bindable var m: PeopleModel
    @State private var openId: String?
    @State private var edit: TechEdit?

    struct TechEdit: Identifiable {
        var id = UUID()
        var cardId: String?
        var name: String
        var category: String
        var items: [String]
    }

    var body: some View {
        Group {
            if !m.techLoaded {
                RowListSkeleton(rows: 3)
            } else {
                if m.isManager {
                    Button { edit = TechEdit(cardId: nil, name: "", category: "dish", items: [""]) } label: {
                        Label(t("pe.newTech"), systemImage: "plus")
                            .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 14)
                            .background(PEOPLE_ACCENT, in: RoundedRectangle(cornerRadius: 14))
                    }
                }
                if m.techCards.isEmpty {
                    Text(t("pe.noTech")).font(.system(size: 15)).foregroundStyle(.primary.opacity(0.4)).padding(.top, 50)
                } else {
                    ForEach(m.techCards) { c in card(c) }
                }
            }
        }
        .task(id: m.opsView) { if m.opsView == "tech" && !m.techLoaded { await m.loadTechCards() } }
        .sheet(item: $edit) { e in TechCardSheet(m: m, edit: e) }
    }

    private func card(_ c: TechCard) -> some View {
        let items = c.items ?? []
        let opened = openId == c.id
        return VStack(alignment: .leading, spacing: 0) {
            Button { withAnimation(.easeInOut(duration: 0.18)) { openId = opened ? nil : c.id } } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(c.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(.primary)
                        Text("\(tcCatLabel(c.category)) · \(t("pe.stepsCount", ["n": "\(items.count)"]))").font(.system(size: 12)).foregroundStyle(.primary.opacity(0.45))
                    }
                    Spacer()
                    Image(systemName: opened ? "chevron.up" : "chevron.down").font(.system(size: 12)).foregroundStyle(.primary.opacity(0.4))
                }
                .padding(14)
            }
            .buttonStyle(.plain)
            if opened {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(items.enumerated()), id: \.offset) { i, step in
                        HStack(alignment: .top, spacing: 10) {
                            Text("\(i + 1)").font(.system(size: 12, weight: .heavy)).foregroundStyle(PEOPLE_ACCENT).frame(width: 18, alignment: .leading)
                            Text(step).font(.system(size: 14)).foregroundStyle(.primary.opacity(0.8))
                        }
                    }
                    if m.isManager {
                        HStack(spacing: 8) {
                            Button(t("edit")) { edit = TechEdit(cardId: c.id, name: c.name, category: c.category ?? "dish", items: items.isEmpty ? [""] : items) }
                                .font(.system(size: 13, weight: .semibold)).foregroundStyle(PEOPLE_ACCENT)
                            Button(t("delete")) { Task { await m.deleteTechCard(c.id) } }
                                .font(.system(size: 13, weight: .semibold)).foregroundStyle(BrandKit.menu)
                        }
                        .padding(.top, 4)
                    }
                }
                .padding(.horizontal, 14).padding(.bottom, 14)
            }
        }
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
    }
}

struct TechCardSheet: View {
    @Bindable var m: PeopleModel
    @Environment(\.dismiss) private var dismiss
    @State var edit: TechCardsTab.TechEdit
    @State private var saving = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.miseBg.ignoresSafeArea()
                Form {
                    Section { TextField(t("pe.techName"), text: $edit.name) }
                    Section(t("pe.type")) {
                        Picker(t("pe.type"), selection: $edit.category) {
                            ForEach(TC_CAT_CODES, id: \.self) { code in Text(tcCatLabel(code)).tag(code) }
                        }.pickerStyle(.segmented)
                    }
                    Section(t("pe.steps")) {
                        ForEach(edit.items.indices, id: \.self) { i in
                            TextField(t("pe.stepN", ["n": "\(i + 1)"]), text: $edit.items[i])
                        }
                        Button { edit.items.append("") } label: { Label(t("pe.moreStep"), systemImage: "plus") }
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle(edit.cardId == nil ? t("pe.newTech") : t("pe.techTitle")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(t("cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("save")) {
                        guard !saving else { return }
                        saving = true
                        Task {
                            defer { saving = false }
                            await m.saveTechCard(id: edit.cardId, name: edit.name, category: edit.category, items: edit.items)
                            dismiss()
                        }
                    }.disabled(saving)
                }
            }
            .toolbarBackground(Color.miseBg, for: .navigationBar)
        }
    }
}

