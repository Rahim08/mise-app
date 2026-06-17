// Генератор иконки приложения: вордмарк «mise» (SF Pro Display, вес .heavy ≈ 800,
// letter-spacing -0.05em) с «mis» белым и «e» фирменным градиентом (синий→фиолетовый→розовый),
// чёрный фон, 1024×1024. Шрифт совпадает с вебом (components/brand.tsx) и Wordmark в приложении.
//
// Запуск:  swift native/Mise/tools/gen-icon.swift <output.png>
import AppKit
import CoreText

let outPath = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : "Mise/Assets.xcassets/AppIcon.appiconset/AppIcon.png"

let size: CGFloat = 1024
let cs = CGColorSpaceCreateDeviceRGB()
guard let ctx = CGContext(data: nil, width: Int(size), height: Int(size),
                          bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
    fatalError("no context")
}

func hex(_ h: UInt) -> CGColor {
    CGColor(red: CGFloat((h >> 16) & 0xff) / 255, green: CGFloat((h >> 8) & 0xff) / 255,
            blue: CGFloat(h & 0xff) / 255, alpha: 1)
}

// фон — чёрный
ctx.setFillColor(hex(0x000000))
ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))

let text = "mise"
let targetW: CGFloat = 760   // ширина слова в пределах safe-area иконки

// подобрать кегль под целевую ширину
func bounds(_ fs: CGFloat) -> CGRect {
    let f = NSFont.systemFont(ofSize: fs, weight: .heavy)
    let a = NSAttributedString(string: text, attributes: [.font: f, .kern: -0.05 * fs])
    return CTLineGetImageBounds(CTLineCreateWithAttributedString(a), ctx)
}
let probe = bounds(100)
let fontSize = 100 * targetW / probe.width

let font = NSFont.systemFont(ofSize: fontSize, weight: .heavy)
let attr = NSAttributedString(string: text, attributes: [.font: font, .kern: -0.05 * fontSize])
let line = CTLineCreateWithAttributedString(attr)
let b = CTLineGetImageBounds(line, ctx)

// собрать пути глифов: «mis» (индексы 0–2) и «e» (индекс 3) отдельно
let misPath = CGMutablePath()
let ePath = CGMutablePath()
let runs = CTLineGetGlyphRuns(line) as! [CTRun]
for run in runs {
    let n = CTRunGetGlyphCount(run)
    var glyphs = [CGGlyph](repeating: 0, count: n)
    var pos = [CGPoint](repeating: .zero, count: n)
    var idx = [CFIndex](repeating: 0, count: n)
    CTRunGetGlyphs(run, CFRange(location: 0, length: n), &glyphs)
    CTRunGetPositions(run, CFRange(location: 0, length: n), &pos)
    CTRunGetStringIndices(run, CFRange(location: 0, length: n), &idx)
    let runFont = (CTRunGetAttributes(run) as NSDictionary)[kCTFontAttributeName as String] as! CTFont
    for i in 0..<n {
        guard let gp = CTFontCreatePathForGlyph(runFont, glyphs[i], nil) else { continue }
        let t = CGAffineTransform(translationX: pos[i].x, y: pos[i].y)
        if idx[i] >= 3 { ePath.addPath(gp, transform: t) } else { misPath.addPath(gp, transform: t) }
    }
}

// центрируем слово
let offX = (size - b.width) / 2 - b.minX
let offY = (size - b.height) / 2 - b.minY
ctx.translateBy(x: offX, y: offY)

// «mis» — белым
ctx.addPath(misPath)
ctx.setFillColor(hex(0xffffff))
ctx.fillPath()

// «e» — диагональный градиент бренда
ctx.saveGState()
ctx.addPath(ePath)
ctx.clip()
let grad = CGGradient(colorsSpace: cs,
                      colors: [hex(0x0a84ff), hex(0x5e5ce6), hex(0xbf5af2), hex(0xff375f)] as CFArray,
                      locations: [0, 0.4, 0.7, 1])!
let eb = ePath.boundingBoxOfPath
ctx.drawLinearGradient(grad,
                       start: CGPoint(x: eb.minX, y: eb.maxY),
                       end: CGPoint(x: eb.maxX, y: eb.minY),
                       options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
ctx.restoreGState()

guard let img = ctx.makeImage() else { fatalError("no image") }
let rep = NSBitmapImageRep(cgImage: img)
guard let png = rep.representation(using: .png, properties: [:]) else { fatalError("no png") }
try! png.write(to: URL(fileURLWithPath: outPath))
print("wrote \(outPath)  fontSize=\(Int(fontSize))  wordW=\(Int(b.width))")
