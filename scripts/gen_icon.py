#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成应用图标母版（1024x1024）—— 深蓝圆角底 + 白色芯片/移植箭头符号。

仅用于产出 src-tauri/icons 下的图标资源，不参与运行时逻辑。
"""
from PIL import Image, ImageDraw

S = 1024
SS = 4                      # 超采样倍数，抗锯齿
W = S * SS

PRIMARY = (42, 91, 143, 255)      # MD3 primary 深蓝
ON_PRIMARY = (255, 255, 255, 255)
ACCENT = (140, 199, 255, 255)     # 亮蓝点缀

img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角方底（MD3 大圆角 ≈ 22.5%）
d.rounded_rectangle([0, 0, W - 1, W - 1], radius=int(W * 0.22), fill=PRIMARY)

# 左侧芯片本体
chip = [int(W * 0.16), int(W * 0.30), int(W * 0.58), int(W * 0.70)]
d.rounded_rectangle(chip, radius=int(W * 0.045), fill=ON_PRIMARY)
# 芯片内部四个功能块
inner_pad = int(W * 0.035)
cw = (chip[2] - chip[0] - inner_pad * 3) // 2
ch = (chip[3] - chip[1] - inner_pad * 3) // 2
for r in range(2):
    for c in range(2):
        x0 = chip[0] + inner_pad + c * (cw + inner_pad)
        y0 = chip[1] + inner_pad + r * (ch + inner_pad)
        d.rounded_rectangle([x0, y0, x0 + cw, y0 + ch], radius=int(W * 0.016), fill=PRIMARY)

# 右侧移植箭头（指向右的折线 + 箭头）
ay = int(W * 0.50)
x_start, x_end = int(W * 0.66), int(W * 0.88)
d.line([(x_start, ay), (x_end, ay)], fill=ACCENT, width=int(W * 0.045))
head = int(W * 0.055)
d.polygon(
    [(x_end + head, ay), (x_end - head // 2, ay - head), (x_end - head // 2, ay + head)],
    fill=ACCENT,
)

img = img.resize((S, S), Image.LANCZOS)
img.save(r"D:\worker\mtk-porttool-master-ui\src-tauri\app-icon.png")
print("wrote app-icon.png", img.size)
