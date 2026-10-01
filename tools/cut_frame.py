"""Đục lỗ vùng tròn trắng của frame thành trong suốt, giữ mép mịn.

Cách làm:
1. Flood-fill vùng trắng nối với tâm ảnh -> lõi trong suốt hoàn toàn.
2. Dải viền vài px quanh lõi: tách màu (unmix) mỗi pixel C = a*F + (1-a)*Trắng,
   với F là màu frame gần nhất bên ngoài -> ra alpha a và màu gốc F (mép mịn, không viền trắng).
3. Kiểm tra: ghép kết quả lên nền trắng phải ra lại đúng ảnh gốc.
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd

src, dst = sys.argv[1], sys.argv[2]
# Điểm mồi nằm trong vùng trắng cần đục: tâm vòng tròn + mảnh trắng bên phải chữ "TẠI"
# (phần vòng tròn bị khối chữ cắt rời). Viền trắng của nhãn đỏ / chữ trắng KHÔNG nằm trong danh sách.
SEEDS = [(600, 600), (1080, 820)]
img = np.array(Image.open(src).convert("RGB")).astype(np.float64)
H, W, _ = img.shape
white = np.array([255.0, 255.0, 255.0])

# 1. Lõi: pixel gần trắng, liên thông với tâm
near_white = img.min(axis=2) >= 250
lab, _ = nd.label(near_white)
for x, y in SEEDS:
    assert near_white[y, x], f"điểm mồi {(x, y)} không phải màu trắng"
core = np.isin(lab, [lab[y, x] for x, y in SEEDS])

# 2. Dải viền cần tách màu
BAND = 8  # đủ rộng để phủ cả bóng đổ mềm dưới khối chữ
grown = nd.binary_dilation(core, iterations=BAND)
band = grown & ~core
outside = ~nd.binary_dilation(core, iterations=BAND + 1)
# màu frame "thuần" gần nhất cho mỗi pixel
_, (iy, ix) = nd.distance_transform_edt(~outside, return_indices=True)
F = img[iy, ix]

d = F - white
denom = (d * d).sum(axis=2)
alpha = np.where(denom > 1e-6, ((img - white) * d).sum(axis=2) / np.maximum(denom, 1e-6), 1.0)
# alpha tối thiểu để màu khôi phục không vượt khỏi [0,255] -> ghép lên nền trắng khớp tuyệt đối
alpha_min = (255.0 - img.min(axis=2)) / 255.0
alpha = np.clip(np.maximum(alpha, alpha_min), 0.0, 1.0)

out_rgb = img.copy()
out_a = np.ones((H, W))
out_a[core] = 0.0
out_a[band] = alpha[band]
# khôi phục màu gốc (bỏ phần trắng đã trộn vào)
safe = np.maximum(alpha, 1e-3)[..., None]
recovered = np.clip(white + (img - white) / safe, 0, 255)
out_rgb[band] = recovered[band]
out_rgb[core] = 0.0

rgba = np.dstack([np.round(out_rgb), np.round(out_a * 255)]).astype(np.uint8)
Image.fromarray(rgba, "RGBA").save(dst, optimize=True)

# 3. Kiểm tra: ghép lên nền trắng phải ra lại ảnh gốc
re = np.array(Image.open(dst).convert("RGBA")).astype(np.float64)
a = re[..., 3:4] / 255.0
comp = re[..., :3] * a + white * (1 - a)
diff = np.abs(comp - img)
print(f"size {W}x{H}; trong suốt hoàn toàn: {(re[...,3]==0).sum()} px; mép mịn: {((re[...,3]>0)&(re[...,3]<255)).sum()} px")
print(f"sai lệch so với gốc khi đặt trên nền trắng: max {diff.max():.1f}, trung bình {diff.mean():.4f} (thang 0-255)")
print(f"pixel ngoài vùng tròn bị thay đổi: {int(((re[...,3]<255) & ~grown).sum())}")
