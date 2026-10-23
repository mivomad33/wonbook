// Dock 앱 아이콘 원본(1024px PNG)을 그린다(design.md 2.4). 실행: swift scripts/launcher-icon.swift <출력 PNG>
// make-launcher.sh가 부른다. Senseful.app(기본 스크립트 아이콘)과 Dock에서 구별되게 "원" 글자 아이콘을 쓴다.
import AppKit

let output = CommandLine.arguments[1]
let size = 1024.0
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()

// macOS 아이콘 격자처럼 둘레에 여백을 두고 둥근 사각형을 그린다.
let body = NSRect(x: 100, y: 100, width: 824, height: 824)
let shape = NSBezierPath(roundedRect: body, xRadius: 185, yRadius: 185)
NSGradient(
  starting: NSColor(srgbRed: 0.13, green: 0.70, blue: 0.47, alpha: 1),
  ending: NSColor(srgbRed: 0.05, green: 0.42, blue: 0.36, alpha: 1)
)!.draw(in: shape, angle: -90)

let text = NSAttributedString(
  string: "원",
  attributes: [
    .font: NSFont.systemFont(ofSize: 500, weight: .bold),
    .foregroundColor: NSColor.white,
  ]
)
let textSize = text.size()
text.draw(at: NSPoint(x: (size - textSize.width) / 2, y: (size - textSize.height) / 2))

image.unlockFocus()

let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try! bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output))
