import WidgetKit
import AppIntents

// MARK: - Configurable choices (long-press the widget -> Edit Widget)

/// Which metric this widget instance shows. The user picks per-widget, so one
/// person can pin "Касса дня" and another "Ближайшие брони".
enum WidgetMetric: String, AppEnum {
    case cash      // Касса дня
    case hookahs   // Кальяны смены
    case bookings  // Ближайшие брони

    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        TypeDisplayRepresentation(name: "Metric / Метрика")
    }

    static var caseDisplayRepresentations: [WidgetMetric: DisplayRepresentation] {
        [
            .cash:     DisplayRepresentation(title: "Касса дня · Cash"),
            .hookahs:  DisplayRepresentation(title: "Кальяны · Hookahs"),
            .bookings: DisplayRepresentation(title: "Брони · Bookings"),
        ]
    }
}

/// Accent color for the widget, so it can match the module the user cares about.
enum WidgetAccent: String, AppEnum {
    case mint
    case blue
    case amber
    case violet

    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        TypeDisplayRepresentation(name: "Accent / Акцент")
    }

    static var caseDisplayRepresentations: [WidgetAccent: DisplayRepresentation] {
        [
            .mint:   DisplayRepresentation(title: "Mint"),
            .blue:   DisplayRepresentation(title: "Blue"),
            .amber:  DisplayRepresentation(title: "Amber"),
            .violet: DisplayRepresentation(title: "Violet"),
        ]
    }
}

struct MiseWidgetConfig: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Mise"
    static var description = IntentDescription("Pick what this widget shows. / Выберите, что показывает виджет.")

    @Parameter(title: "Show / Показывать", default: .cash)
    var metric: WidgetMetric

    @Parameter(title: "Accent / Акцент", default: .mint)
    var accent: WidgetAccent

    init() {}
    init(metric: WidgetMetric, accent: WidgetAccent = .mint) {
        self.metric = metric
        self.accent = accent
    }
}
