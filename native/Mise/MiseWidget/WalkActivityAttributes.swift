import ActivityKit
import Foundation

// MARK: - Live Activity атрибуты для «Восьмёрки» (обход-восьмёрка)
//
// Этот файл дублируется В ТОЧНОСТИ в Mise/ И MiseWidget/ (тот же приём, что и
// WidgetShared.swift) — PBXFileSystemSynchronizedRootGroup добавляет файл в таргет
// автоматически по папке, отдельного shared-фреймворка не заводим.
//
// startDate вместо «живого» elapsedSeconds, который приложение пушило бы каждую
// секунду — такие частые апдейты система троттлит/останавливает (особенно если
// экран блокируется), из-за чего секундомер в Island замирал. Text(startDate, style: .timer)
// в виджете считает сама ОС, без апдейтов от приложения — апдейт нужен только
// на паузе/резюме/смене блока, не каждую секунду.
public struct WalkActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable, Sendable {
        public var blockLabel: String      // текущий блок обхода
        public var startDate: Date         // отсчёт для системного авто-таймера (учитывает уже накопленное)
        public var isPaused: Bool
        public var pausedSeconds: Int      // статичный снимок — валиден только когда isPaused=true
        public var steps: Int

        public init(blockLabel: String, startDate: Date, isPaused: Bool, pausedSeconds: Int, steps: Int) {
            self.blockLabel = blockLabel
            self.startDate = startDate
            self.isPaused = isPaused
            self.pausedSeconds = pausedSeconds
            self.steps = steps
        }
    }

    public var templateTitle: String

    public init(templateTitle: String) { self.templateTitle = templateTitle }
}
