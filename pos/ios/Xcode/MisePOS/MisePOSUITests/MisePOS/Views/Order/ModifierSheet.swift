import SwiftUI

// MARK: - Modifier Selection Sheet

struct ModifierSheet: View {
    let item: MenuItem
    let onConfirm: (Int, [ModifierSelection], String) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var qty = 1
    @State private var note = ""
    @State private var selections: [String: Set<String>] = [:] // groupId → selected modifier ids
    @State private var showNoteField = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        // Item header
                        ItemHeader(item: item)

                        Divider().background(Color.white.opacity(0.08))

                        // Quantity
                        QuantityRow(qty: $qty)

                        Divider().background(Color.white.opacity(0.08))

                        // Modifier groups
                        ForEach(item.modifier_groups ?? []) { group in
                            ModifierGroupSection(
                                group: group,
                                selected: selections[group.id] ?? [],
                                onToggle: { modId in toggleModifier(groupId: group.id, modId: modId, group: group) }
                            )
                            Divider().background(Color.white.opacity(0.08))
                        }

                        // Note
                        NoteSection(note: $note, show: $showNoteField)
                    }
                }

                // Confirm button pinned at bottom
                VStack {
                    Spacer()
                    ConfirmButton(
                        item: item,
                        qty: qty,
                        extra: extraTotal,
                        onConfirm: confirm
                    )
                }
            }
            .navigationTitle(item.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.black, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                        .foregroundStyle(.gray)
                }
            }
        }
    }

    private var extraTotal: Double {
        (item.modifier_groups ?? []).reduce(0.0) { sum, group in
            let sel = selections[group.id] ?? []
            return sum + (group.modifiers ?? []).filter { sel.contains($0.id) }.reduce(0) { $0 + $1.priceDelta }
        }
    }

    private func toggleModifier(groupId: String, modId: String, group: ModifierGroup) {
        var sel = selections[groupId] ?? []
        if sel.contains(modId) {
            sel.remove(modId)
        } else {
            let max = group.max_select ?? 1
            if max == 1 { sel.removeAll() }
            if sel.count < max { sel.insert(modId) }
        }
        selections[groupId] = sel
    }

    private func confirm() {
        let mods: [ModifierSelection] = (item.modifier_groups ?? []).flatMap { group in
            let sel = selections[group.id] ?? []
            return (group.modifiers ?? []).filter { sel.contains($0.id) }.map {
                ModifierSelection(
                    groupId: group.id,
                    groupName: group.name,
                    optionId: $0.id,
                    optionName: $0.name,
                    priceDelta: $0.priceDelta
                )
            }
        }
        onConfirm(qty, mods, note)
        dismiss()
    }
}

// MARK: - Item Header

private struct ItemHeader: View {
    let item: MenuItem

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            if let url = item.photo_url, !url.isEmpty {
                AsyncImage(url: URL(string: url)) { img in
                    img.resizable().scaledToFill()
                } placeholder: {
                    Color(white: 0.1)
                }
                .frame(width: 80, height: 80)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(item.name)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                if let desc = item.description, !desc.isEmpty {
                    Text(desc)
                        .font(.subheadline)
                        .foregroundStyle(.gray)
                        .lineLimit(3)
                }
                Text(item.formattedPrice)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color(white: 0.7))
            }
            Spacer()
        }
        .padding(20)
    }
}

// MARK: - Quantity Row

private struct QuantityRow: View {
    @Binding var qty: Int

    var body: some View {
        HStack {
            Text("Количество")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white)
            Spacer()
            HStack(spacing: 20) {
                Button {
                    if qty > 1 { qty -= 1 }
                } label: {
                    Image(systemName: "minus")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(qty > 1 ? .white : Color(white: 0.3))
                        .frame(width: 36, height: 36)
                        .background(Color(white: 0.12))
                        .clipShape(Circle())
                }
                .disabled(qty <= 1)

                Text("\(qty)")
                    .font(.system(size: 20, weight: .black))
                    .foregroundStyle(.white)
                    .frame(minWidth: 24)

                Button {
                    qty += 1
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(Color(white: 0.12))
                        .clipShape(Circle())
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
    }
}

// MARK: - Modifier Group Section

private struct ModifierGroupSection: View {
    let group: ModifierGroup
    let selected: Set<String>
    let onToggle: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(group.name)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color(white: 0.5))
                    .textCase(.uppercase)
                    .tracking(0.5)
                Spacer()
                let req = group.required
                let max = group.max_select
                Text(req ? "обязательно" : max > 1 ? "до \(max)" : "по желанию")
                    .font(.caption)
                    .foregroundStyle(req ? .orange : Color(white: 0.35))
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 10)

            ForEach(group.modifiers ?? []) { mod in
                ModifierRow(
                    mod: mod,
                    isSelected: selected.contains(mod.id),
                    isMulti: (group.max_select ?? 1) > 1,
                    onTap: { onToggle(mod.id) }
                )
            }
        }
    }
}

private struct ModifierRow: View {
    let mod: Modifier
    let isSelected: Bool
    let isMulti: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 14) {
                ZStack {
                    if isMulti {
                        RoundedRectangle(cornerRadius: 5)
                            .stroke(isSelected ? Color.white : Color(white: 0.25), lineWidth: 1.5)
                            .frame(width: 20, height: 20)
                        if isSelected {
                            RoundedRectangle(cornerRadius: 5)
                                .fill(Color.white)
                                .frame(width: 20, height: 20)
                            Image(systemName: "checkmark")
                                .font(.system(size: 11, weight: .black))
                                .foregroundStyle(.black)
                        }
                    } else {
                        Circle()
                            .stroke(isSelected ? Color.white : Color(white: 0.25), lineWidth: 1.5)
                            .frame(width: 20, height: 20)
                        if isSelected {
                            Circle()
                                .fill(Color.white)
                                .frame(width: 12, height: 12)
                        }
                    }
                }
                .animation(.spring(response: 0.2), value: isSelected)

                Text(mod.name)
                    .font(.system(size: 15))
                    .foregroundStyle(isSelected ? .white : Color(white: 0.6))

                Spacer()

                if mod.priceDelta != 0 {
                    Text(mod.priceDelta > 0 ? "+€\(mod.priceDelta, specifier: "%.2f")" : "-€\(abs(mod.priceDelta), specifier: "%.2f")")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(isSelected ? .white : Color(white: 0.4))
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 13)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(isSelected ? Color(white: 0.06) : Color.clear)
    }
}

// MARK: - Note Section

private struct NoteSection: View {
    @Binding var note: String
    @Binding var show: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.spring(response: 0.25)) { show.toggle() }
            } label: {
                HStack {
                    Image(systemName: show ? "xmark.circle" : "text.bubble")
                        .foregroundStyle(Color(white: 0.4))
                    Text(show ? "Убрать заметку" : "Добавить заметку")
                        .font(.system(size: 14))
                        .foregroundStyle(Color(white: 0.4))
                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 14)
            }
            .buttonStyle(.plain)

            if show {
                TextField("напр. без лука, аллергия на орехи...", text: $note, axis: .vertical)
                    .font(.system(size: 14))
                    .foregroundStyle(.white)
                    .padding(12)
                    .background(Color(white: 0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
            }
        }
    }
}

// MARK: - Confirm Button

private struct ConfirmButton: View {
    let item: MenuItem
    let qty: Int
    let extra: Double
    let onConfirm: () -> Void

    var body: some View {
        let total = (item.price + extra) * Double(qty)
        Button(action: onConfirm) {
            HStack {
                Text("Добавить \(qty > 1 ? "×\(qty)" : "")")
                    .font(.system(size: 16, weight: .bold))
                Spacer()
                Text("€\(total, specifier: "%.2f")")
                    .font(.system(size: 16, weight: .bold))
            }
            .foregroundStyle(.black)
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            .background(.white)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .buttonStyle(.plain)
        .background(
            Color(white: 0.05)
                .ignoresSafeArea()
        )
    }
}
